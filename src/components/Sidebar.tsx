import { useMemo, useState } from "react";
import { baseName } from "../lib/paths";
import { fileKey, type ClearOptions, type FileEntry, type Position, type RecentItem } from "../lib/types";
import {
  IconChevron,
  IconEdit,
  IconGrid,
  IconClock,
  IconClose,
  IconFolder,
  IconFolderPlus,
  IconList,
  IconMd,
  IconPdf,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconStar,
} from "./Icons";

type Tab = "all" | "fav" | "recent";

interface Props {
  folders: string[];
  files: FileEntry[];
  favorites: Set<string>;
  recent: RecentItem[];
  positions: Record<string, Position>;
  current: FileEntry | null;
  scanning: boolean;
  onOpenFolder: () => void;
  onRemoveFolder: (path: string) => void;
  onRefresh: () => void;
  onOpen: (f: FileEntry) => void;
  onOpenRecent: (r: RecentItem) => void;
  onToggleFavorite: (path: string) => void;
  onOpenSettings: () => void;
  onCollapse: () => void;
  onShowLibrary: () => void;
  libraryActive: boolean;
  onClearReading: (items: { path: string; key: string }[], opts: ClearOptions) => void;
  onClearAll: (opts: ClearOptions) => void;
}

export function progressOf(pos: Position | undefined, kind: "pdf" | "md"): number | null {
  if (!pos) return null;
  if (kind === "md") return pos.ratio !== undefined ? pos.ratio : null;
  if (pos.page && pos.pages) return pos.page / pos.pages;
  return null;
}

function FileRow({
  f,
  active,
  fav,
  progress,
  onOpen,
  onFav,
  showDir,
}: {
  f: FileEntry;
  active: boolean;
  fav: boolean;
  progress: number | null;
  onOpen: () => void;
  onFav: () => void;
  showDir?: boolean;
}) {
  const title = f.name.replace(/\.(pdf|md|markdown|mdown)$/i, "");
  return (
    <div className={`file-row ${active ? "active" : ""}`} onClick={onOpen} title={f.path}>
      {f.kind === "pdf" ? <IconPdf className="ic-pdf" size={17} /> : <IconMd className="ic-md" size={17} />}
      <div className="file-main">
        <div className="file-name">{title}</div>
        {showDir && f.dir && <div className="file-dir">{f.dir}</div>}
        {progress !== null && (
          <div className="mini-progress">
            <span style={{ width: `${Math.max(3, Math.round(progress * 100))}%` }} />
          </div>
        )}
      </div>
      <button
        className={`star-btn ${fav ? "on" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onFav();
        }}
        title={fav ? "Favorilerden çıkar" : "Favorilere ekle"}
      >
        <IconStar size={15} filled={fav} />
      </button>
    </div>
  );
}

export default function Sidebar(p: Props) {
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [opts, setOpts] = useState<ClearOptions>({ recent: true, progress: true, translations: false });

  const q = query.trim().toLocaleLowerCase("tr");
  const match = (f: { name: string; dir?: string }) =>
    !q || f.name.toLocaleLowerCase("tr").includes(q) || (f.dir ?? "").toLocaleLowerCase("tr").includes(q);

  const filtered = useMemo(() => p.files.filter(match), [p.files, q]);

  // Kök klasör → alt klasör → dosyalar
  const groups = useMemo(() => {
    const byRoot = new Map<string, Map<string, FileEntry[]>>();
    for (const root of p.folders) byRoot.set(root, new Map());
    for (const f of filtered) {
      if (!byRoot.has(f.root)) byRoot.set(f.root, new Map());
      const dirs = byRoot.get(f.root)!;
      if (!dirs.has(f.dir)) dirs.set(f.dir, []);
      dirs.get(f.dir)!.push(f);
    }
    return [...byRoot.entries()].map(([root, dirs]) => ({
      root,
      dirs: [...dirs.entries()]
        .sort(([a], [b]) => a.localeCompare(b, "tr"))
        .map(([dir, list]) => ({ dir, list: list.sort((a, b) => a.name.localeCompare(b.name, "tr", { numeric: true })) })),
    }));
  }, [filtered, p.folders]);

  const favFiles = useMemo(
    () => p.files.filter((f) => p.favorites.has(f.path) && match(f)),
    [p.files, p.favorites, q],
  );
  const missingFavs = useMemo(
    () => [...p.favorites].filter((path) => !p.files.some((f) => f.path === path)),
    [p.files, p.favorites],
  );
  const recent = p.recent.filter((r) => match({ name: r.name }));

  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-dot" /> PDF Okuyucu
        </div>
        <div className="grow" />
        <button className="icon-btn sm" title="Ayarlar (Ctrl+,)" onClick={p.onOpenSettings}>
          <IconSettings size={16} />
        </button>
        <button className="icon-btn sm" title="Kenar çubuğunu gizle (Ctrl+B)" onClick={p.onCollapse}>
          <IconSidebar size={16} />
        </button>
      </div>

      <div className="sidebar-actions">
        <button className="btn primary block" onClick={p.onOpenFolder} title="Klasör ekle (Ctrl+O)">
          <IconFolderPlus size={16} /> Klasör aç
        </button>
        <button className="icon-btn" title="Klasörleri yeniden tara" onClick={p.onRefresh} disabled={p.scanning}>
          <IconRefresh size={16} className={p.scanning ? "spin" : ""} />
        </button>
      </div>
      <div className="sidebar-actions tight">
        <button className={`btn block ${p.libraryActive ? "selected" : ""}`} onClick={p.onShowLibrary}>
          <IconGrid size={16} /> Tümünü gör
        </button>
      </div>

      <div className="search-box">
        <IconSearch size={15} />
        <input placeholder="Dosya ara…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <button className="icon-btn xs" onClick={() => setQuery("")}>
            <IconClose size={13} />
          </button>
        )}
      </div>

      <div className="tabs">
        <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
          <IconList size={15} /> Tümü <span className="muted">{p.files.length}</span>
        </button>
        <button className={tab === "fav" ? "on" : ""} onClick={() => setTab("fav")}>
          <IconStar size={15} /> Favoriler <span className="muted">{p.favorites.size}</span>
        </button>
        <button className={tab === "recent" ? "on" : ""} onClick={() => setTab("recent")}>
          <IconClock size={15} /> Son
        </button>
      </div>

      <div className="file-list">
        {tab === "all" && (
          <>
            {p.folders.length === 0 && (
              <div className="empty-note">
                PDF ve Markdown dosyalarınızın bulunduğu klasörü açın. Alt klasörler de taranır.
              </div>
            )}
            {groups.map(({ root, dirs }) => {
              const rootCollapsed = collapsed[root];
              const count = dirs.reduce((n, d) => n + d.list.length, 0);
              return (
                <div key={root} className="root-group">
                  <div className="root-head" onClick={() => toggle(root)} title={root}>
                    <IconChevron size={14} className={`chev ${rootCollapsed ? "" : "open"}`} />
                    <IconFolder size={15} />
                    <span className="root-name">{baseName(root) || root}</span>
                    <span className="muted small">{count}</span>
                    <button
                      className="icon-btn xs hover-only"
                      title="Klasörü listeden kaldır (dosyalar silinmez)"
                      onClick={(e) => {
                        e.stopPropagation();
                        p.onRemoveFolder(root);
                      }}
                    >
                      <IconClose size={13} />
                    </button>
                  </div>
                  {!rootCollapsed &&
                    dirs.map(({ dir, list }) => {
                      const id = `${root}::${dir}`;
                      // Alt klasörler başlangıçta kapalı; arama yaparken eşleşenler açılır
                      const dirCollapsed = collapsed[id] ?? (!q && dir !== "");
                      return (
                        <div key={id} className="dir-group">
                          {dir && (
                            <div className="dir-head" onClick={() => setCollapsed((c) => ({ ...c, [id]: !dirCollapsed }))}>
                              <IconChevron size={13} className={`chev ${dirCollapsed ? "" : "open"}`} />
                              <span>{dir}</span>
                              <span className="muted small">{list.length}</span>
                            </div>
                          )}
                          {!dirCollapsed &&
                            list.map((f) => (
                              <FileRow
                                key={f.path}
                                f={f}
                                active={p.current?.path === f.path}
                                fav={p.favorites.has(f.path)}
                                progress={progressOf(p.positions[fileKey(f)], f.kind)}
                                onOpen={() => p.onOpen(f)}
                                onFav={() => p.onToggleFavorite(f.path)}
                              />
                            ))}
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </>
        )}

        {tab === "fav" && (
          <>
            {favFiles.length === 0 && missingFavs.length === 0 && (
              <div className="empty-note">
                Henüz favori yok. Dosyaların yanındaki <IconStar size={13} /> simgesine tıklayarak ekleyin.
              </div>
            )}
            {favFiles.map((f) => (
              <FileRow
                key={f.path}
                f={f}
                showDir
                active={p.current?.path === f.path}
                fav
                progress={progressOf(p.positions[fileKey(f)], f.kind)}
                onOpen={() => p.onOpen(f)}
                onFav={() => p.onToggleFavorite(f.path)}
              />
            ))}
            {missingFavs.map((path) => (
              <div key={path} className="file-row missing" title={`${path} (bulunamadı)`}>
                <IconPdf size={17} />
                <div className="file-main">
                  <div className="file-name">{baseName(path)}</div>
                  <div className="file-dir">Dosya bulunamadı</div>
                </div>
                <button className="star-btn on" onClick={() => p.onToggleFavorite(path)} title="Favorilerden çıkar">
                  <IconStar size={15} filled />
                </button>
              </div>
            ))}
          </>
        )}

        {tab === "recent" && (
          <>
            {recent.length === 0 && <div className="empty-note">Henüz bir dosya açmadınız.</div>}
            {recent.length > 0 && (
              <div className="recent-tools">
                {editing ? (
                  <label className="check small">
                    <input
                      type="checkbox"
                      checked={selected.size === recent.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(recent.map((r) => r.path)) : new Set())}
                    />
                    Tümünü seç
                  </label>
                ) : (
                  <span className="muted small">{recent.length} kitap</span>
                )}
                <div className="grow" />
                <button
                  className="link-btn"
                  onClick={() => {
                    setEditing((v) => !v);
                    setSelected(new Set());
                  }}
                >
                  {editing ? "Bitti" : (
                    <>
                      <IconEdit size={13} /> Düzenle / sil
                    </>
                  )}
                </button>
              </div>
            )}
            {recent.map((r) => {
              const prog = progressOf(p.positions[r.key], r.kind);
              const checked = selected.has(r.path);
              return (
                <div
                  key={r.path}
                  className={`file-row ${p.current?.path === r.path ? "active" : ""} ${editing && checked ? "checked" : ""}`}
                  onClick={() => {
                    if (!editing) return p.onOpenRecent(r);
                    setSelected((s) => {
                      const n = new Set(s);
                      if (n.has(r.path)) n.delete(r.path);
                      else n.add(r.path);
                      return n;
                    });
                  }}
                  title={r.path}
                >
                  {editing && <input type="checkbox" className="row-check" checked={checked} readOnly />}
                  {r.kind === "pdf" ? <IconPdf className="ic-pdf" size={17} /> : <IconMd className="ic-md" size={17} />}
                  <div className="file-main">
                    <div className="file-name">{r.name.replace(/\.(pdf|md|markdown|mdown)$/i, "")}</div>
                    {prog !== null && (
                      <div className="mini-progress">
                        <span style={{ width: `${Math.max(3, Math.round(prog * 100))}%` }} />
                      </div>
                    )}
                  </div>
                  <button
                    className={`star-btn ${p.favorites.has(r.path) ? "on" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onToggleFavorite(r.path);
                    }}
                  >
                    <IconStar size={15} filled={p.favorites.has(r.path)} />
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>

      {tab === "recent" && editing && recent.length > 0 && (
        <div className="clear-panel">
          <div className="small muted">Silinecekler (PDF dosyaları silinmez):</div>
          <label className="check small">
            <input type="checkbox" checked={opts.recent} onChange={(e) => setOpts({ ...opts, recent: e.target.checked })} />
            Son okunanlar listesi
          </label>
          <label className="check small">
            <input type="checkbox" checked={opts.progress} onChange={(e) => setOpts({ ...opts, progress: e.target.checked })} />
            Kaldığı yer / ilerleme
          </label>
          <label className="check small">
            <input
              type="checkbox"
              checked={opts.translations}
              onChange={(e) => setOpts({ ...opts, translations: e.target.checked })}
            />
            Çeviri geçmişi
          </label>
          <div className="row">
            <button
              className="btn sm danger"
              disabled={selected.size === 0 || (!opts.recent && !opts.progress && !opts.translations)}
              onClick={() => {
                const items = recent.filter((r) => selected.has(r.path));
                if (!window.confirm(`${items.length} kitap için seçilen kayıtlar silinsin mi?`)) return;
                p.onClearReading(items, opts);
                setSelected(new Set());
              }}
            >
              Seçilenleri sil ({selected.size})
            </button>
            <button
              className="btn sm"
              disabled={!opts.recent && !opts.progress && !opts.translations}
              onClick={() => {
                if (!window.confirm("Tüm kitapların seçilen kayıtları silinsin mi? (PDF dosyaları silinmez)")) return;
                p.onClearAll(opts);
                setSelected(new Set());
                setEditing(false);
              }}
            >
              Tümünü temizle
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
