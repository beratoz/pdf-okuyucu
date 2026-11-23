import { timeAgo } from "../lib/paths";
import { providerKindOf, providerLabel } from "../lib/providers";
import type { HistoryItem, Settings } from "../lib/types";
import { IconClose, IconCopy, IconTrash } from "./Icons";

interface Props {
  items: HistoryItem[];
  settings: Settings;
  onGoTo: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onCopy: (text: string) => void;
  onClose: () => void;
}

export default function HistoryPanel({ items, settings, onGoTo, onDelete, onClear, onCopy, onClose }: Props) {
  return (
    <aside className="history-panel">
      <div className="panel-head">
        <strong>Bu belgedeki çevirilerim</strong>
        <span className="muted">{items.length}</span>
        <div className="grow" />
        {items.length > 0 && (
          <button
            className="icon-btn sm"
            title="Tümünü sil"
            onClick={() => {
              if (window.confirm("Bu belgedeki tüm çeviri geçmişi silinsin mi?")) onClear();
            }}
          >
            <IconTrash size={15} />
          </button>
        )}
        <button className="icon-btn sm" onClick={onClose} title="Paneli kapat">
          <IconClose size={15} />
        </button>
      </div>
      <div className="history-list">
        {items.length === 0 && (
          <div className="empty-note">
            Metin seçip <kbd>Çevir</kbd> düğmesine (veya <kbd>Ctrl</kbd>+<kbd>T</kbd>) bastığınızda
            çeviriler burada birikir.
          </div>
        )}
        {items.map((it) => (
          <div key={it.id} className="history-item">
            <div className="hi-source" title={it.source}>
              {it.source}
            </div>
            <div className="hi-text">{it.translation}</div>
            <div className="hi-foot">
              <span className={`badge engine-${providerKindOf(settings, it.engine)}`} title={it.model ?? ""}>
                {providerLabel(settings, it.engine, it.engineName)}
              </span>
              {it.page !== undefined && (
                <button className="link-btn" onClick={() => onGoTo(it)}>
                  s. {it.page}
                </button>
              )}
              <span className="muted small">{timeAgo(it.time)}</span>
              <div className="grow" />
              <button className="icon-btn xs" title="Kopyala" onClick={() => onCopy(it.translation)}>
                <IconCopy size={14} />
              </button>
              <button className="icon-btn xs" title="Sil" onClick={() => onDelete(it.id)}>
                <IconTrash size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
