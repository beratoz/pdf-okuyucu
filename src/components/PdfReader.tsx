import { pdfjsLib } from "../lib/pdfjs-setup";
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { api } from "../lib/api";
import { InkManager, type InkTool } from "../lib/ink";
import { loadInk, saveInk } from "../lib/store";
import { fileKey, type FileEntry, type Position } from "../lib/types";

export interface PdfReaderApi {
  inkUndo(): void;
  /** Geçerli sayfadaki çizimleri siler */
  inkClearPage(): void;
  zoomIn(): void;
  zoomOut(): void;
  fitWidth(): void;
  fitPage(): void;
  goToPage(n: number): void;
  find(query: string, previous?: boolean, again?: boolean): void;
  closeFind(): void;
}

interface Props {
  file: FileEntry;
  pageColors: { background: string; foreground: string } | null;
  ink: { enabled: boolean; tool: InkTool };
  getPosition: () => Position | undefined;
  onPosition: (p: Position) => void;
  onPageChange: (page: number, pages: number) => void;
  onScaleChange: (scale: number, preset: string | null) => void;
  onFindResult: (current: number, total: number) => void;
  onError: (message: string) => void;
  apiRef: Ref<PdfReaderApi>;
}

export default function PdfReader(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerElRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const busRef = useRef<EventBus | null>(null);
  const inkRef = useRef<InkManager | null>(null);
  // Geri çağrıları ref'te tut: efekt yalnızca dosya / renk değişince yeniden kurulsun
  const cb = useRef(props);
  cb.current = props;

  // Kalem aracı / çizim modu değişince yöneticiye bildir
  useEffect(() => {
    const ink = inkRef.current;
    if (!ink) return;
    ink.tool = props.ink.tool;
    ink.setEnabled(props.ink.enabled);
  }, [props.ink.enabled, props.ink.tool.mode, props.ink.tool.color, props.ink.tool.size]);

  const colorsKey = props.pageColors
    ? `${props.pageColors.background}|${props.pageColors.foreground}`
    : "original";

  useImperativeHandle(props.apiRef, () => ({
    inkUndo: () => inkRef.current?.undo(),
    inkClearPage: () => {
      const v = viewerRef.current;
      if (v) inkRef.current?.clearPage(v.currentPageNumber);
    },
    zoomIn: () => viewerRef.current?.increaseScale(),
    zoomOut: () => viewerRef.current?.decreaseScale(),
    fitWidth: () => {
      if (viewerRef.current) viewerRef.current.currentScaleValue = "page-width";
    },
    fitPage: () => {
      if (viewerRef.current) viewerRef.current.currentScaleValue = "page-fit";
    },
    goToPage: (n: number) => {
      const v = viewerRef.current;
      if (v && n >= 1 && n <= v.pagesCount) v.currentPageNumber = n;
    },
    find: (query: string, previous = false, again = false) => {
      busRef.current?.dispatch("find", {
        source: null,
        type: again ? "again" : "",
        query,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        findPrevious: previous,
        matchDiacritics: false,
      });
    },
    closeFind: () => busRef.current?.dispatch("findbarclose", { source: null }),
  }));

  useEffect(() => {
    const container = containerRef.current!;
    const viewerEl = viewerElRef.current!;
    viewerEl.innerHTML = "";
    let cancelled = false;
    let restored = false;
    let saveTimer: number | undefined;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const findController = new PDFFindController({ eventBus, linkService });
    const pageColors = cb.current.pageColors;
    const viewer = new PDFViewer({
      container,
      viewer: viewerEl,
      eventBus,
      linkService,
      findController,
      removePageBorders: false,
      ...(pageColors ? { pageColors } : {}),
    });
    linkService.setViewer(viewer);
    viewerRef.current = viewer;
    busRef.current = eventBus;

    // Çizim katmanı
    const key = fileKey(cb.current.file);
    let inkTimer: number | undefined;
    let inkDirty = false;
    const ink = new InkManager(() => {
      inkDirty = true;
      window.clearTimeout(inkTimer);
      inkTimer = window.setTimeout(() => {
        inkDirty = false;
        saveInk(key, ink.data);
      }, 500);
    });
    ink.tool = cb.current.ink.tool;
    ink.setEnabled(cb.current.ink.enabled);
    inkRef.current = ink;
    loadInk(key).then((d) => !cancelled && ink.load(structuredClone(d)));
    eventBus.on(
      "pagerendered",
      (e: { source: { div: HTMLElement }; pageNumber: number; isDetailView?: boolean }) => {
        if (!e.isDetailView && e.source?.div) ink.attach(e.pageNumber, e.source.div);
      },
    );

    eventBus.on("pagesinit", () => {
      const pos = cb.current.getPosition();
      if (typeof pos?.scale === "number" && pos.scale > 0) {
        viewer.currentScale = pos.scale / 100;
      } else {
        viewer.currentScaleValue = typeof pos?.scale === "string" ? pos.scale : "page-width";
      }
      if (pos?.page && pos.page > 1 || (pos?.top ?? null) !== null) {
        viewer.scrollPageIntoView({
          pageNumber: Math.min(Math.max(pos?.page ?? 1, 1), viewer.pagesCount),
          destArray: [null, { name: "XYZ" }, pos?.left ?? 0, pos?.top ?? null, null],
          allowNegativeOffset: true,
        });
      }
      restored = true;
      cb.current.onPageChange(viewer.currentPageNumber, viewer.pagesCount);
    });

    eventBus.on("pagechanging", (e: { pageNumber: number }) => {
      cb.current.onPageChange(e.pageNumber, viewer.pagesCount);
    });
    eventBus.on("scalechanging", (e: { scale: number; presetValue?: string }) => {
      cb.current.onScaleChange(e.scale, e.presetValue ?? null);
    });
    eventBus.on(
      "updateviewarea",
      (e: { location: { pageNumber: number; scale: number | string; top: number; left: number } }) => {
        if (!restored) return; // Açılıştaki ilk olaylar kayıtlı konumu ezmesin
        window.clearTimeout(saveTimer);
        const loc = e.location;
        saveTimer = window.setTimeout(() => {
          cb.current.onPosition({
            page: loc.pageNumber,
            pages: viewer.pagesCount,
            top: Math.round(loc.top),
            left: Math.round(loc.left),
            scale: loc.scale,
            updated: Date.now(),
          });
        }, 400);
      },
    );
    eventBus.on(
      "updatefindmatchescount",
      (e: { matchesCount: { current: number; total: number } }) => {
        cb.current.onFindResult(e.matchesCount.current, e.matchesCount.total);
      },
    );
    eventBus.on(
      "updatefindcontrolstate",
      (e: { matchesCount?: { current: number; total: number } }) => {
        if (e.matchesCount) cb.current.onFindResult(e.matchesCount.current, e.matchesCount.total);
      },
    );

    // Ctrl + tekerlek ile yakınlaştırma
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY < 0) viewer.increaseScale();
      else viewer.decreaseScale();
    };
    container.addEventListener("wheel", onWheel, { passive: false });

    // Pencere / panel boyutu değişince "genişliğe sığdır" yeniden hesaplansın
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const v = viewer.currentScaleValue;
        if (viewer.pagesCount && typeof v === "string" && isNaN(parseFloat(v))) {
          viewer.currentScaleValue = v;
        }
      });
    });
    ro.observe(container);

    (async () => {
      const buf = await api.readFileBytes(cb.current.file.path);
      if (cancelled) return;
      loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buf),
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        wasmUrl: "/pdfjs/wasm/",
        iccUrl: "/pdfjs/iccs/",
      });
      loadingTask.onPassword = (update: (pw: string) => void, reason: number) => {
        const pw = window.prompt(
          reason === 2 ? "Şifre yanlış. Tekrar deneyin:" : "Bu PDF şifreli. Şifreyi girin:",
        );
        if (pw === null) loadingTask?.destroy();
        else update(pw);
      };
      const doc = await loadingTask.promise;
      if (cancelled) {
        loadingTask?.destroy();
        return;
      }
      viewer.setDocument(doc);
      linkService.setDocument(doc, null);
    })().catch((err) => {
      if (!cancelled) cb.current.onError(err?.message ?? String(err));
    });

    return () => {
      cancelled = true;
      window.clearTimeout(saveTimer);
      window.clearTimeout(inkTimer);
      if (inkDirty) saveInk(key, ink.data);
      ink.destroy();
      inkRef.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      container.removeEventListener("wheel", onWheel);
      try {
        viewer.setDocument(null as never);
        linkService.setDocument(null, null);
      } catch {
        /* yoksay */
      }
      loadingTask?.destroy();
      viewerRef.current = null;
      busRef.current = null;
    };
  }, [props.file.path, colorsKey]);

  return (
    <div className="pdf-host">
      <div ref={containerRef} className="pdf-container" tabIndex={0}>
        <div ref={viewerElRef} className="pdfViewer" />
      </div>
    </div>
  );
}
