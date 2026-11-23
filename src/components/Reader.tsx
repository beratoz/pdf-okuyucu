import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INK_COLORS, type InkMode } from "../lib/ink";
import { dirOf, joinPath } from "../lib/paths";
import { loadHistory, saveHistory } from "../lib/store";
import { mdColors, pdfPageColors } from "../lib/themes";
import { extractContext, translateText } from "../lib/translate";
import { allProviders, providerLabel } from "../lib/providers";
import {
  fileKey,
  type Attempt,
  type EngineMode,
  type FileEntry,
  type HistoryItem,
  type Position,
  type Settings,
} from "../lib/types";
import HistoryPanel from "./HistoryPanel";
import {
  IconBack,
  IconClose,
  IconEraser,
  IconFitWidth,
  IconPen,
  IconTrash,
  IconUndo,
  IconMinus,
  IconPanel,
  IconPlus,
  IconSearch,
  IconSidebar,
  IconStar,
  IconTextSize,
  IconTranslate,
} from "./Icons";
import MdReader, { type MdReaderApi } from "./MdReader";
import PdfReader, { type PdfReaderApi } from "./PdfReader";
import TranslatePopup, { autoLabel, type PopupState } from "./TranslatePopup";

interface Props {
  file: FileEntry;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onBack: () => void;
  getPosition: (key: string) => Position | undefined;
  onPosition: (key: string, pos: Position) => void;
  onOpenPath: (path: string) => void;
  onOpenSettings: () => void;
  toast: (msg: string, kind?: "info" | "error") => void;
}

interface Pending {
  text: string;
  rect: PopupState["rect"];
  /** Seçimin son satırının sağ alt köşesi ("Çevir" düğmesi için) */
  end: { x: number; y: number };
  page?: number;
  contextText: string;
}

export default function Reader(props: Props) {
  const { file, settings } = props;
  const key = fileKey(file);
  const isPdf = file.kind === "pdf";

  const pdfApi = useRef<PdfReaderApi>(null);
  const mdApi = useRef<MdReaderApi>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState<number>(1);
  const [mdProgress, setMdProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCount, setFindCount] = useState<{ current: number; total: number } | null>(null);

  const [drawing, setDrawing] = useState(false);
  const [inkMode, setInkMode] = useState<InkMode>("pen");
  const inkTool = useMemo(
    () => ({ mode: inkMode, color: settings.inkColor, size: settings.inkSize }),
    [inkMode, settings.inkColor, settings.inkSize],
  );
  const inkProp = useMemo(() => ({ enabled: drawing, tool: inkTool }), [drawing, inkTool]);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [floatBtn, setFloatBtn] = useState<{ x: number; y: number } | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const reqCounter = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Belge değişince durumu sıfırla, geçmişi yükle
  useEffect(() => {
    setLoadError(null);
    setPopup(null);
    setFloatBtn(null);
    setFindOpen(false);
    setFindCount(null);
    setPage(props.getPosition(key)?.page ?? 1);
    setPages(props.getPosition(key)?.pages ?? 0);
    let cancelled = false;
    loadHistory(key).then((h) => !cancelled && setHistory(h));
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => setPageInput(String(page)), [page]);

  const getPosition = useCallback(() => props.getPosition(key), [key, props.getPosition]);
  const onPosition = useCallback((p: Position) => props.onPosition(key, p), [key, props.onPosition]);

  // ------------------------------------------------------------ Geçmiş

  const addHistory = useCallback(
    (item: Omit<HistoryItem, "id" | "time">) => {
      setHistory((prev) => {
        const rest = prev.filter((h) => !(h.source === item.source && h.engine === item.engine));
        const next = [{ ...item, id: crypto.randomUUID(), time: Date.now() }, ...rest];
        saveHistory(key, next);
        return next;
      });
    },
    [key],
  );

  const deleteHistory = (id: string) =>
    setHistory((prev) => {
      const next = prev.filter((h) => h.id !== id);
      saveHistory(key, next);
      return next;
    });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      props.toast("Kopyalandı");
    } catch {
      props.toast("Kopyalanamadı", "error");
    }
  };

  // ------------------------------------------------------------ Seçim ve çeviri

  const readSelection = useCallback((): Pending | null => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().trim();
    if (text.length < 2) return null;
    const range = sel.getRangeAt(0);
    if (!contentRef.current?.contains(range.commonAncestorContainer)) return null;
    const b = range.getBoundingClientRect();
    const lineRects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    const last = lineRects[lineRects.length - 1] ?? b;
    const start =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const pageEl = start?.closest(".page") as HTMLElement | null;
    const pageNum = pageEl?.dataset.pageNumber ? Number(pageEl.dataset.pageNumber) : undefined;
    const ctxEl = (start?.closest(".textLayer") ?? start?.closest(".md-article")) as HTMLElement | null;
    return {
      text,
      rect: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
      end: { x: last.right, y: last.bottom },
      page: pageNum,
      contextText: ctxEl ? ctxEl.innerText : "",
    };
  }, []);

  const runTranslate = useCallback(
    async (choice?: EngineMode, skipCache = false) => {
      const p = pendingRef.current;
      if (!p) return;
      const s = settingsRef.current;
      const mode = choice ?? s.engineMode;
      const id = ++reqCounter.current;
      setFloatBtn(null);
      setPopup({ source: p.text, rect: p.rect, status: "loading", choice: mode });
      try {
        const res = await translateText({
          text: p.text,
          context: extractContext(p.contextText, p.text),
          settings: { ...s, engineMode: mode },
          skipCache,
        });
        if (id !== reqCounter.current) return;
        setPopup((prev) => prev && { ...prev, status: "done", result: res });
        addHistory({
          page: p.page,
          source: res.source,
          translation: res.text,
          engine: res.engine,
          engineName: providerLabel(settingsRef.current, res.engine),
          model: res.model,
        });
      } catch (e) {
        if (id !== reqCounter.current) return;
        const attempts = (e as { attempts?: Attempt[] }).attempts ?? [];
        setPopup((prev) =>
          prev && {
            ...prev,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
            attempts,
          },
        );
      }
    },
    [addHistory],
  );

  const translateCurrentSelection = useCallback(() => {
    const p = readSelection() ?? pendingRef.current;
    if (!p) {
      props.toast("Önce çevirmek istediğiniz metni seçin");
      return;
    }
    pendingRef.current = p;
    runTranslate();
  }, [readSelection, runTranslate]);

  useEffect(() => {
    const el = contentRef.current!;
    const onUp = (e: MouseEvent) => {
      if ((e.target as Element).closest?.(".tr-popup, .tr-float")) return;
      // Seçim, mouseup'tan hemen sonra kesinleşir
      window.setTimeout(() => {
        const p = readSelection();
        if (!p) {
          setFloatBtn(null);
          return;
        }
        pendingRef.current = p;
        if (settingsRef.current.autoTranslate) {
          runTranslate();
        } else {
          setFloatBtn({
            x: Math.min(p.end.x + 4, window.innerWidth - 100),
            y: Math.min(p.end.y + 6, window.innerHeight - 44),
          });
        }
      }, 10);
    };
    const onScroll = () => setFloatBtn(null);
    el.addEventListener("mouseup", onUp);
    el.addEventListener("scroll", onScroll, true);
    return () => {
      el.removeEventListener("mouseup", onUp);
      el.removeEventListener("scroll", onScroll, true);
    };
  }, [readSelection, runTranslate]);

  // Popup dışına tıklayınca kapat
  useEffect(() => {
    if (!popup) return;
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element).closest?.(".tr-popup, .tr-float")) return;
      setPopup(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [popup !== null]);

  // Bağlantılar: web adresleri tarayıcıda, .md bağlantıları uygulamada açılsın
  useEffect(() => {
    const el = contentRef.current!;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) {
        e.preventDefault();
        e.stopPropagation();
        openUrl(href).catch(() => props.toast("Bağlantı açılamadı", "error"));
        return;
      }
      if (isPdf) return; // PDF içi bağlantıları pdf.js yönetir
      e.preventDefault();
      if (href.startsWith("#")) {
        document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: "smooth" });
        return;
      }
      const clean = decodeURIComponent(href.split("#")[0]);
      if (/\.(md|markdown|pdf)$/i.test(clean)) props.onOpenPath(joinPath(dirOf(file.path), clean));
    };
    el.addEventListener("click", onClick, true);
    return () => el.removeEventListener("click", onClick, true);
  }, [file.path, isPdf]);

  // ------------------------------------------------------------ Klavye kısayolları

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const inInput = (e.target as Element).closest?.("input, textarea, select");
      if (e.key === "Escape") {
        if (popup) setPopup(null);
        else if (floatBtn) setFloatBtn(null);
        else if (findOpen) closeFind();
        else if (drawing) setDrawing(false);
        return;
      }
      if (!ctrl) return;
      const k = e.key.toLowerCase();
      if (k === "z" && drawing && !inInput) {
        e.preventDefault();
        pdfApi.current?.inkUndo();
      } else if (k === "d" && isPdf) {
        e.preventDefault();
        setDrawing((d) => !d);
      } else if (k === "t") {
        e.preventDefault();
        translateCurrentSelection();
      } else if (k === "f" && isPdf) {
        e.preventDefault();
        setFindOpen(true);
        window.setTimeout(() => findInputRef.current?.select(), 0);
      } else if (k === "j") {
        e.preventDefault();
        props.updateSettings({ historyOpen: !settingsRef.current.historyOpen });
      } else if (!inInput && (k === "=" || k === "+")) {
        e.preventDefault();
        zoomIn();
      } else if (!inInput && k === "-") {
        e.preventDefault();
        zoomOut();
      } else if (!inInput && k === "0") {
        e.preventDefault();
        if (isPdf) pdfApi.current?.fitWidth();
        else props.updateSettings({ mdFontSize: 18 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const zoomIn = () => {
    if (isPdf) pdfApi.current?.zoomIn();
    else props.updateSettings({ mdFontSize: Math.min(32, settings.mdFontSize + 1) });
  };
  const zoomOut = () => {
    if (isPdf) pdfApi.current?.zoomOut();
    else props.updateSettings({ mdFontSize: Math.max(12, settings.mdFontSize - 1) });
  };

  const closeFind = () => {
    setFindOpen(false);
    setFindCount(null);
    pdfApi.current?.closeFind();
  };

  const goToPage = (n: number) => {
    if (!Number.isFinite(n)) return;
    pdfApi.current?.goToPage(Math.round(n));
  };

  // ------------------------------------------------------------ Görünüm

  const pageColors = pdfPageColors(settings);
  const progressPct = isPdf
    ? pages > 0
      ? Math.round((page / pages) * 100)
      : 0
    : Math.round(mdProgress * 100);

  return (
    <div className="reader">
      <div className="toolbar">
        {!settings.sidebarOpen && (
          <button
            className="icon-btn"
            title="Kenar çubuğunu aç (Ctrl+B)"
            onClick={() => props.updateSettings({ sidebarOpen: true })}
          >
            <IconSidebar />
          </button>
        )}
        <button className="icon-btn" title="Kütüphaneye dön" onClick={props.onBack}>
          <IconBack />
        </button>
        <div className="doc-title" title={file.path}>
          {file.name.replace(/\.(pdf|md|markdown|mdown)$/i, "")}
        </div>
        <button
          className={`icon-btn ${props.isFavorite ? "fav-on" : ""}`}
          title={props.isFavorite ? "Favorilerden çıkar" : "Favorilere ekle"}
          onClick={props.onToggleFavorite}
        >
          <IconStar filled={props.isFavorite} />
        </button>

        <div className="grow" />

        {isPdf ? (
          <>
            <div className="page-nav">
              <input
                className="page-input"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") goToPage(Number(pageInput));
                }}
                onBlur={() => setPageInput(String(page))}
                aria-label="Sayfa"
              />
              <span className="muted">/ {pages || "…"}</span>
            </div>
            <div className="sep" />
            <button className="icon-btn" title="Uzaklaştır (Ctrl −)" onClick={zoomOut}>
              <IconMinus />
            </button>
            <span className="zoom-label">{Math.round(scale * 100)}%</span>
            <button className="icon-btn" title="Yakınlaştır (Ctrl +)" onClick={zoomIn}>
              <IconPlus />
            </button>
            <button className="icon-btn" title="Genişliğe sığdır (Ctrl 0)" onClick={() => pdfApi.current?.fitWidth()}>
              <IconFitWidth />
            </button>
            <button
              className={`icon-btn ${findOpen ? "active" : ""}`}
              title="Belgede ara (Ctrl+F)"
              onClick={() => (findOpen ? closeFind() : setFindOpen(true))}
            >
              <IconSearch />
            </button>
            <button
              className={`icon-btn ${drawing ? "active" : ""}`}
              title="Kalemle çiz (Ctrl+D)"
              onClick={() => setDrawing((d) => !d)}
            >
              <IconPen />
            </button>
          </>
        ) : (
          <>
            <span className="muted small">%{progressPct}</span>
            <div className="sep" />
            <button className="icon-btn" title="Yazıyı küçült" onClick={zoomOut}>
              <IconMinus />
            </button>
            <span className="zoom-label">
              <IconTextSize size={16} /> {settings.mdFontSize}
            </span>
            <button className="icon-btn" title="Yazıyı büyüt" onClick={zoomIn}>
              <IconPlus />
            </button>
          </>
        )}
        <div className="sep" />
        <label className="engine-pick" title={`Çeviri motoru — ${autoLabel(settings)}`}>
          <IconTranslate size={16} />
          <select
            value={settings.engineMode}
            onChange={(e) => props.updateSettings({ engineMode: e.target.value as EngineMode })}
          >
            <option value="auto" title={autoLabel(settings)}>
              Otomatik
            </option>
            {allProviders(settings).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className={`icon-btn ${settings.historyOpen ? "active" : ""}`}
          title="Çeviri geçmişi paneli (Ctrl+J)"
          onClick={() => props.updateSettings({ historyOpen: !settings.historyOpen })}
        >
          <IconPanel />
          {history.length > 0 && <span className="count-dot">{history.length}</span>}
        </button>
      </div>

      {drawing && isPdf && (
        <div className="ink-bar">
          <div className="seg small-seg">
            <button className={inkMode === "pen" ? "on" : ""} onClick={() => setInkMode("pen")} title="Kalem">
              <IconPen size={15} /> Kalem
            </button>
            <button className={inkMode === "eraser" ? "on" : ""} onClick={() => setInkMode("eraser")} title="Silgi">
              <IconEraser size={15} /> Silgi
            </button>
          </div>
          <div className="ink-colors">
            {INK_COLORS.map((c) => (
              <button
                key={c}
                className={`ink-swatch ${settings.inkColor === c && inkMode === "pen" ? "on" : ""}`}
                style={{ background: c }}
                title={c}
                onClick={() => {
                  setInkMode("pen");
                  props.updateSettings({ inkColor: c });
                }}
              />
            ))}
          </div>
          <label className="ink-size" title="Kalınlık">
            <span
              className="ink-dot"
              style={{
                width: Math.min(22, settings.inkSize + 2),
                height: Math.min(22, settings.inkSize + 2),
                background: inkMode === "pen" ? settings.inkColor : "transparent",
              }}
            />
            <input
              type="range"
              min={1}
              max={20}
              value={settings.inkSize}
              onChange={(e) => props.updateSettings({ inkSize: Number(e.target.value) })}
            />
            <span className="small muted">{settings.inkSize}</span>
          </label>
          <button className="icon-btn sm" title="Geri al (Ctrl+Z)" onClick={() => pdfApi.current?.inkUndo()}>
            <IconUndo size={16} />
          </button>
          <button
            className="icon-btn sm"
            title="Bu sayfadaki çizimleri sil"
            onClick={() => {
              if (window.confirm(`Sayfa ${page} üzerindeki tüm çizimler silinsin mi?`)) pdfApi.current?.inkClearPage();
            }}
          >
            <IconTrash size={16} />
          </button>
          <button className="icon-btn sm" title="Çizimi bitir (Esc)" onClick={() => setDrawing(false)}>
            <IconClose size={16} />
          </button>
        </div>
      )}

      {findOpen && isPdf && (
        <div className="find-bar">
          <IconSearch size={16} />
          <input
            ref={findInputRef}
            autoFocus
            placeholder="Belgede ara…"
            value={findQuery}
            onChange={(e) => {
              setFindQuery(e.target.value);
              pdfApi.current?.find(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") pdfApi.current?.find(findQuery, e.shiftKey, true);
              if (e.key === "Escape") closeFind();
            }}
          />
          <span className="muted small">
            {findQuery && findCount ? `${findCount.current} / ${findCount.total}` : ""}
          </span>
          <button className="icon-btn sm" title="Önceki (Shift+Enter)" onClick={() => pdfApi.current?.find(findQuery, true, true)}>
            ↑
          </button>
          <button className="icon-btn sm" title="Sonraki (Enter)" onClick={() => pdfApi.current?.find(findQuery, false, true)}>
            ↓
          </button>
        </div>
      )}

      <div className="reader-body">
        <div className="reader-content" ref={contentRef}>
          {loadError ? (
            <div className="center-note error">
              Dosya açılamadı: {loadError}
            </div>
          ) : isPdf ? (
            <PdfReader
              file={file}
              pageColors={pageColors}
              ink={inkProp}
              getPosition={getPosition}
              onPosition={onPosition}
              onPageChange={(p, total) => {
                setPage(p);
                setPages(total);
              }}
              onScaleChange={(s) => setScale(s)}
              onFindResult={(current, total) => setFindCount({ current, total })}
              onError={setLoadError}
              apiRef={pdfApi}
            />
          ) : (
            <MdReader
              file={file}
              fontSize={settings.mdFontSize}
              colors={mdColors(settings)}
              getPosition={getPosition}
              onPosition={onPosition}
              onProgress={setMdProgress}
              onError={setLoadError}
              apiRef={mdApi}
            />
          )}
        </div>
        {settings.historyOpen && (
          <HistoryPanel
            items={history}
            settings={settings}
            onGoTo={(it) => it.page && goToPage(it.page)}
            onDelete={deleteHistory}
            onClear={() => {
              setHistory([]);
              saveHistory(key, []);
            }}
            onCopy={copy}
            onClose={() => props.updateSettings({ historyOpen: false })}
          />
        )}
      </div>

      <div className="progress-line" style={{ width: `${progressPct}%` }} />

      {floatBtn && !popup && (
        <button
          className="tr-float"
          style={{ left: floatBtn.x, top: floatBtn.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runTranslate()}
          title="Seçili metni çevir (Ctrl+T)"
        >
          <IconTranslate size={15} /> Çevir
        </button>
      )}

      {popup && (
        <TranslatePopup
          state={popup}
          settings={settings}
          onChoice={(mode) => runTranslate(mode)}
          onRetry={() => runTranslate(popup.choice, true)}
          onClose={() => setPopup(null)}
          onCopy={copy}
          onOpenSettings={props.onOpenSettings}
        />
      )}
    </div>
  );
}
