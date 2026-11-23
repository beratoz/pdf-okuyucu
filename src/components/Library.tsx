import { useEffect, useMemo, useRef, useState } from "react";
import { baseName } from "../lib/paths";
import { cachedThumb, getThumb } from "../lib/thumbs";
import { fileKey, type FileEntry, type Position, type RecentItem, type Settings } from "../lib/types";
import { IconBack, IconClose, IconFolder, IconMd, IconPdf, IconSearch, IconSidebar, IconStar } from "./Icons";
import { progressOf } from "./Sidebar";

interface Props {
  folders: string[];
  files: FileEntry[];
  favorites: Set<string>;
  recent: RecentItem[];
  positions: Record<string, Position>;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  onOpen: (f: FileEntry) => void;
  onToggleFavorite: (path: string) => void;
  onBack: () => void;
}

type KindFilter = "all" | "pdf" | "md" | "fav";

function Cover({ f }: { f: FileEntry }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(() => cachedThumb(f.path) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (src || f.kind !== "pdf") return;
    const el = ref.current;
    if (!el) return;
    let alive = true;
    // Yalnızca ekrana yaklaşan kartlar için görsel üret
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        getThumb(f).then((url) => {
          if (!alive) return;
          if (url) setSrc(url);
          else setFailed(true);
        });
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [f.path]);

  return (
    <div ref={ref} className={`cover ${f.kind}`}>
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <div className="cover-placeholder">
          {f.kind === "pdf" ? <IconPdf size={34} /> : <IconMd size={34} />}
          {f.kind === "pdf" && !failed && <span className="spinner small" />}
        </div>
      )}
      <span className={`kind-tag ${f.kind}`}>{f.kind === "pdf" ? "PDF" : "MD"}</span>
    </div>
  );
}

export default function Library(p: Props) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const sort = p.settings.librarySort;
  const group = p.settings.libraryGroup;

  const recentTime = useMemo(() => new Map(p.recent.map((r) => [r.path, r.time])), [p.recent]);
  const q = query.trim().toLocaleLowerCase("tr");

  const list = useMemo(() => {
    const out = p.files.filter((f) => {
      if (kind === "pdf" && f.kind !== "pdf") return false;
      if (kind === "md" && f.kind !== "md") return false;
      if (kind === "fav" && !p.favorites.has(f.path)) return false;
      return !q || f.name.toLocaleLowerCase("tr").includes(q) || f.dir.toLocaleLowerCase("tr").includes(q);
    });
    out.sort((a, b) =>
      sort === "recent"
        ? (recentTime.get(b.path) ?? 0) - (recentTime.get(a.path) ?? 0) ||
          a.name.localeCompare(b.name, "tr", { numeric: true })
        : a.name.localeCompare(b.name, "tr", { numeric: true }),
    );
    return out;
  }, [p.files, p.favorites, kind, q, sort, recentTime]);

  // Klasöre göre grupla: "Kök / alt klasör"
  const sections = useMemo(() => {
    if (!group) return [{ id: "all", title: "Tüm dosyalar", sub: "", items: list }];
    const map = new Map<string, { id: string; title: string; sub: string; items: FileEntry[] }>();
    for (const f of list) {
      const id = `${f.root}::${f.dir}`;
      if (!map.has(id)) {
        map.set(id, {
          id,
          title: f.dir ? f.dir.split("/").join(" › ") : baseName(f.root) || f.root,
          sub: f.dir ? baseName(f.root) : "",
          items: [],
        });
      }
      map.get(id)!.items.push(f);
    }
    return [...map.values()].sort((a, b) => a.id.localeCompare(b.id, "tr"));
  }, [list, group]);

  const card = (f: FileEntry) => {
    const prog = progressOf(p.positions[fileKey(f)], f.kind);
    const fav = p.favorites.has(f.path);
    return (
      <div key={f.path} className="book" onClick={() => p.onOpen(f)} title={f.path}>
        <Cover f={f} />
        <button
          className={`book-star ${fav ? "on" : ""}`}
          title={fav ? "Favorilerden çıkar" : "Favorilere ekle"}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggleFavorite(f.path);
          }}
        >
          <IconStar size={15} filled={fav} />
        </button>
        <div className="book-title">{f.name.replace(/\.(pdf|md|markdown|mdown)$/i, "")}</div>
        {prog !== null && (
          <div className="card-progress">
            <span style={{ width: `${Math.max(3, Math.round(prog * 100))}%` }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="library">
      <div className="toolbar">
        {!p.settings.sidebarOpen && (
          <button className="icon-btn" title="Kenar çubuğunu aç" onClick={() => p.updateSettings({ sidebarOpen: true })}>
            <IconSidebar />
          </button>
        )}
        <button className="icon-btn" title="Ana sayfaya dön" onClick={p.onBack}>
          <IconBack />
        </button>
        <div className="doc-title">Tüm kitaplar</div>
        <span className="muted small">{list.length} dosya</span>
        <div className="grow" />
        <div className="search-box inline">
          <IconSearch size={15} />
          <input placeholder="Ara…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button className="icon-btn xs" onClick={() => setQuery("")}>
              <IconClose size={13} />
            </button>
          )}
        </div>
        <div className="seg small-seg">
          {(
            [
              ["all", "Tümü"],
              ["pdf", "PDF"],
              ["md", "MD"],
              ["fav", "Favori"],
            ] as [KindFilter, string][]
          ).map(([id, label]) => (
            <button key={id} className={kind === id ? "on" : ""} onClick={() => setKind(id)}>
              {label}
            </button>
          ))}
        </div>
        <select
          className="compact-select"
          value={sort}
          onChange={(e) => p.updateSettings({ librarySort: e.target.value as Settings["librarySort"] })}
          title="Sıralama"
        >
          <option value="name">Ada göre</option>
          <option value="recent">Son okunana göre</option>
        </select>
        <label className="check small" title="Klasörlere göre grupla">
          <input
            type="checkbox"
            checked={group}
            onChange={(e) => p.updateSettings({ libraryGroup: e.target.checked })}
          />
          Klasörler
        </label>
      </div>

      <div className="library-body">
        {p.folders.length === 0 && <div className="empty-note">Önce soldan bir klasör açın.</div>}
        {p.folders.length > 0 && list.length === 0 && <div className="empty-note">Eşleşen dosya yok.</div>}
        {sections.map((s) => (
          <section key={s.id} className="lib-section">
            {group && (
              <div className="lib-head" onClick={() => setClosed((c) => ({ ...c, [s.id]: !c[s.id] }))}>
                <IconFolder size={17} />
                <span className="lib-title">{s.title}</span>
                {s.sub && <span className="muted small">{s.sub}</span>}
                <span className="muted small">· {s.items.length}</span>
                <div className="grow" />
                <span className="muted small">{closed[s.id] ? "Göster" : "Gizle"}</span>
              </div>
            )}
            {!closed[s.id] && <div className="book-grid">{s.items.map(card)}</div>}
          </section>
        ))}
      </div>
    </div>
  );
}
