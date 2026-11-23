import { useLayoutEffect, useRef, useState } from "react";
import { allProviders, orderLabel, providerKindOf, providerLabel } from "../lib/providers";
import type { Attempt, EngineMode, Settings, TranslationResult } from "../lib/types";
import { IconClose, IconCopy, IconRefresh, IconTranslate } from "./Icons";

export interface PopupState {
  source: string;
  rect: { left: number; top: number; right: number; bottom: number };
  status: "loading" | "done" | "error";
  choice: EngineMode;
  result?: TranslationResult;
  error?: string;
  attempts?: Attempt[];
}

interface Props {
  state: PopupState;
  settings: Settings;
  onChoice: (mode: EngineMode) => void;
  onRetry: () => void;
  onClose: () => void;
  onCopy: (text: string) => void;
  onOpenSettings: () => void;
}

const WIDTH = 440;

export function autoLabel(s: Settings) {
  return `Otomatik (${orderLabel(s)})`;
}

function attemptText(s: Settings, a: Attempt) {
  if (a.skipped) return `${providerLabel(s, a.engine)} atlandı: ${a.skipped}`;
  return `${providerLabel(s, a.engine)}: ${a.error?.message ?? "hata"}`;
}

export default function TranslatePopup({ state, settings, onChoice, onRetry, onClose, onCopy, onOpenSettings }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  const [showSource, setShowSource] = useState(false);

  // Seçimin altına (yer yoksa üstüne) yerleştir, pencere dışına taşmasın
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = state.rect;
    let top = r.bottom + 10;
    if (top + h > vh - 12) top = Math.max(12, r.top - h - 10);
    let left = r.left + (r.right - r.left) / 2 - WIDTH / 2;
    left = Math.min(Math.max(12, left), vw - WIDTH - 12);
    setPos({ left, top });
  }, [state.rect, state.status, state.result, showSource]);

  const failedNoKey =
    state.status === "error" &&
    (state.attempts ?? []).some((a) => a.error?.kind === "noKey" || a.error?.kind === "auth");

  const fallbackNotes = (state.result?.attempts ?? []).map((a) => attemptText(settings, a));

  return (
    <div
      ref={ref}
      className="tr-popup"
      style={{ left: pos.left, top: pos.top, width: WIDTH }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div className="tr-head">
        <IconTranslate size={16} />
        <select
          className="tr-select"
          value={state.choice}
          onChange={(e) => onChoice(e.target.value as EngineMode)}
          title="Bu çeviri için motor seç"
        >
          <option value="auto">{autoLabel(settings)}</option>
          {allProviders(settings).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="grow" />
        <button className="icon-btn sm" onClick={onRetry} title="Yeniden çevir">
          <IconRefresh size={15} />
        </button>
        <button className="icon-btn sm" onClick={onClose} title="Kapat (Esc)">
          <IconClose size={15} />
        </button>
      </div>

      <div className="tr-body">
        {state.status === "loading" && (
          <div className="tr-loading">
            <span className="spinner" /> Çevriliyor…
          </div>
        )}
        {state.status === "done" && state.result && (
          <div className="tr-text" lang={settings.targetLang.toLowerCase()}>
            {state.result.text}
          </div>
        )}
        {state.status === "error" && (
          <div className="tr-error">
            <strong>{state.error}</strong>
            {(state.attempts ?? []).length > 0 && (
              <ul>
                {state.attempts!.map((a, i) => (
                  <li key={i}>{attemptText(settings, a)}</li>
                ))}
              </ul>
            )}
            {failedNoKey && (
              <button className="btn primary sm" onClick={onOpenSettings}>
                API anahtarlarını gir
              </button>
            )}
          </div>
        )}
        {showSource && <div className="tr-source">{state.source}</div>}
      </div>

      <div className="tr-foot">
        {state.result && (
          <span
            className={`badge engine-${providerKindOf(settings, state.result.engine)}`}
            title={state.result.model ?? ""}
          >
            {providerLabel(settings, state.result.engine)}
            {state.result.fromCache ? " · önbellek" : ""}
          </span>
        )}
        {fallbackNotes.length > 0 && (
          <span className="tr-note" title={fallbackNotes.join("\n")}>
            {[...new Set((state.result?.attempts ?? []).map((a) => providerLabel(settings, a.engine)))].join(", ")}{" "}
            kullanılamadı
          </span>
        )}
        <div className="grow" />
        <button className="link-btn" onClick={() => setShowSource((v) => !v)}>
          {showSource ? "Orijinali gizle" : "Orijinal"}
        </button>
        {state.result && (
          <button className="btn sm" onClick={() => onCopy(state.result!.text)}>
            <IconCopy size={14} /> Kopyala
          </button>
        )}
      </div>
    </div>
  );
}
