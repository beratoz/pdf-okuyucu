import { timeAgo } from "../lib/paths";
import type { FileEntry, Position, RecentItem } from "../lib/types";
import { fileKey } from "../lib/types";
import { IconBook, IconClose, IconFolderPlus, IconGrid, IconMd, IconPdf, IconSidebar, IconStar, IconTranslate } from "./Icons";
import { progressOf } from "./Sidebar";

interface Props {
  hasFolders: boolean;
  fileCount: number;
  recent: RecentItem[];
  favorites: FileEntry[];
  positions: Record<string, Position>;
  sidebarOpen: boolean;
  onShowSidebar: () => void;
  onOpenFolder: () => void;
  onOpenRecent: (r: RecentItem) => void;
  onOpen: (f: FileEntry) => void;
  onOpenSettings: () => void;
  onShowLibrary: () => void;
  onRemoveRecent: (r: RecentItem) => void;
}

function Card({
  name,
  kind,
  progress,
  sub,
  onClick,
  onRemove,
}: {
  name: string;
  kind: "pdf" | "md";
  progress: number | null;
  sub: string;
  onClick: () => void;
  onRemove?: () => void;
}) {
  return (
    <button className="card" onClick={onClick} title={name}>
      <div className={`card-icon ${kind}`}>{kind === "pdf" ? <IconPdf size={26} /> : <IconMd size={26} />}</div>
      <div className="card-title">{name.replace(/\.(pdf|md|markdown|mdown)$/i, "")}</div>
      <div className="card-sub">{sub}</div>
      <div className="card-progress">
        <span style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
      </div>
      {onRemove && (
        <span
          className="card-remove"
          role="button"
          title="Listeden kaldır (dosya silinmez)"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <IconClose size={13} />
        </span>
      )}
    </button>
  );
}

export default function Home(p: Props) {
  return (
    <div className="home">
      {!p.sidebarOpen && (
        <button className="icon-btn home-sidebar-btn" title="Kenar çubuğunu aç" onClick={p.onShowSidebar}>
          <IconSidebar />
        </button>
      )}
      <div className="home-inner">
        {!p.hasFolders ? (
          <div className="welcome">
            <div className="welcome-icon">
              <IconBook size={44} />
            </div>
            <h1>Hoş geldiniz</h1>
            <p>
              PDF ve Markdown dosyalarınızın bulunduğu klasörü açın. Kaldığınız yeri otomatik hatırlar,
              seçtiğiniz metni tek tıkla çevirir.
            </p>
            <button className="btn primary lg" onClick={p.onOpenFolder}>
              <IconFolderPlus size={18} /> Klasör aç
            </button>
            <div className="welcome-tips">
              <div>
                <IconTranslate size={16} /> Çeviri için <button className="link-btn" onClick={p.onOpenSettings}>Ayarlar</button>'dan
                ücretsiz DeepL ve Gemini anahtarlarınızı girin.
              </div>
              <div>
                <IconStar size={16} /> Sık okuduklarınızı yıldızlayarak Favorilere ekleyin.
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="home-head">
              <h2>Okumaya devam et</h2>
              <div className="grow" />
              <button className="btn" onClick={p.onShowLibrary}>
                <IconGrid size={16} /> Tümünü gör ({p.fileCount})
              </button>
            </div>
            {p.recent.length === 0 ? (
              <div className="empty-note left">
                Soldaki listeden bir dosya seçin. Kütüphanenizde {p.fileCount} dosya var.
              </div>
            ) : (
              <div className="card-grid">
                {p.recent.slice(0, 8).map((r) => {
                  const prog = progressOf(p.positions[r.key], r.kind);
                  const pos = p.positions[r.key];
                  const sub =
                    r.kind === "pdf" && pos?.page
                      ? `Sayfa ${pos.page}${pos.pages ? ` / ${pos.pages}` : ""} · ${timeAgo(r.time)}`
                      : `%${Math.round((prog ?? 0) * 100)} · ${timeAgo(r.time)}`;
                  return (
                    <Card
                      key={r.path}
                      name={r.name}
                      kind={r.kind}
                      progress={prog}
                      sub={sub}
                      onClick={() => p.onOpenRecent(r)}
                      onRemove={() => p.onRemoveRecent(r)}
                    />
                  );
                })}
              </div>
            )}

            {p.favorites.length > 0 && (
              <>
                <h2>
                  <IconStar size={18} filled className="fav-on" /> Favoriler
                </h2>
                <div className="card-grid">
                  {p.favorites.slice(0, 12).map((f) => {
                    const prog = progressOf(p.positions[fileKey(f)], f.kind);
                    return (
                      <Card
                        key={f.path}
                        name={f.name}
                        kind={f.kind}
                        progress={prog}
                        sub={f.dir || "Kök klasör"}
                        onClick={() => p.onOpen(f)}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
