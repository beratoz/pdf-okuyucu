import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Home from "./components/Home";
import Library from "./components/Library";
import Reader from "./components/Reader";
import SettingsModal from "./components/SettingsModal";
import Sidebar from "./components/Sidebar";
import { api } from "./lib/api";
import { baseName } from "./lib/paths";
import {
  clearAllHistory,
  deleteHistory,
  DEFAULT_SETTINGS,
  initStores,
  loadLibrary,
  loadSettings,
  saveAll,
  saveFavorites,
  saveFolders,
  savePositions,
  saveRecent,
  saveSettings,
} from "./lib/store";
import { fileKey, type ClearOptions, type FileEntry, type Position, type RecentItem, type Settings } from "./lib/types";

interface Toast {
  id: number;
  msg: string;
  kind: "info" | "error";
}

function entryFromPath(path: string, size = 0): FileEntry {
  const name = baseName(path);
  return {
    path,
    name,
    kind: /\.pdf$/i.test(name) ? "pdf" : "md",
    size,
    modified: 0,
    dir: "",
    root: "",
  };
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const positionsRef = useRef<Record<string, Position>>({});
  const [current, setCurrent] = useState<FileEntry | null>(null);
  const [view, setView] = useState<"home" | "library">("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((msg: string, kind: "info" | "error" = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 5000 : 2200);
  }, []);

  // ------------------------------------------------------------ Başlangıç

  const scan = useCallback(
    async (list: string[]): Promise<FileEntry[]> => {
      const results = await Promise.allSettled(list.map((f) => api.scanFolder(f)));
      const out: FileEntry[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") out.push(...r.value);
        else toast(`Klasör okunamadı: ${list[i]}`, "error");
      });
      return out;
    },
    [toast],
  );

  const rescanAll = useCallback(
    async (list: string[]) => {
      setScanning(true);
      try {
        setFiles(await scan(list));
      } finally {
        setScanning(false);
      }
    },
    [scan],
  );

  useEffect(() => {
    (async () => {
      try {
        await initStores();
        const [s, lib] = await Promise.all([loadSettings(), loadLibrary()]);
        setSettings(s);
        setFolders(lib.folders);
        setFavorites(lib.favorites);
        setRecent(lib.recent);
        setPositions(lib.positions);
        positionsRef.current = lib.positions;
        setReady(true);
        if (lib.folders.length) rescanAll(lib.folders);
      } catch (e) {
        toast(`Veriler yüklenemedi: ${e}`, "error");
        setReady(true);
      }
    })();

    // Kapatırken bekleyen kayıtları diske yaz
    const unlisten = getCurrentWindow().onCloseRequested(async () => {
      await saveAll();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // ------------------------------------------------------------ Ayarlar

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  // ------------------------------------------------------------ Klasörler

  const openFolder = useCallback(async () => {
    const picked = await open({ directory: true, multiple: false, title: "PDF / Markdown klasörünü seçin" });
    if (typeof picked !== "string") return;
    if (folders.includes(picked)) {
      toast("Bu klasör zaten listede");
      return;
    }
    const next = [...folders, picked];
    setFolders(next);
    saveFolders(next);
    setScanning(true);
    try {
      const found = await scan([picked]);
      setFiles((prev) => [...prev.filter((f) => f.root !== picked), ...found]);
      toast(`${found.length} dosya bulundu`);
    } finally {
      setScanning(false);
    }
  }, [folders, scan, toast]);

  const removeFolder = (path: string) => {
    const next = folders.filter((f) => f !== path);
    setFolders(next);
    saveFolders(next);
    setFiles((prev) => prev.filter((f) => f.root !== path));
  };

  // ------------------------------------------------------------ Favoriler / son okunanlar / konum

  const favSet = useMemo(() => new Set(favorites), [favorites]);

  const toggleFavorite = useCallback((path: string) => {
    setFavorites((prev) => {
      const next = prev.includes(path) ? prev.filter((p) => p !== path) : [path, ...prev];
      saveFavorites(next);
      return next;
    });
  }, []);

  const openFile = useCallback((f: FileEntry) => {
    setCurrent(f);
    setRecent((prev) => {
      const item: RecentItem = { path: f.path, name: f.name, kind: f.kind, key: fileKey(f), time: Date.now() };
      const next = [item, ...prev.filter((r) => r.path !== f.path)].slice(0, 40);
      saveRecent(next);
      return next;
    });
  }, []);

  const openRecent = useCallback(
    async (r: RecentItem) => {
      const known = files.find((f) => f.path === r.path);
      if (known) return openFile(known);
      if (await api.pathExists(r.path)) {
        const size = Number(r.key.split("|").pop()) || 0;
        return openFile(entryFromPath(r.path, size));
      }
      toast(`Dosya bulunamadı: ${r.name}`, "error");
      setRecent((prev) => {
        const next = prev.filter((x) => x.path !== r.path);
        saveRecent(next);
        return next;
      });
    },
    [files, openFile, toast],
  );

  const openPath = useCallback(
    async (path: string) => {
      const known = files.find((f) => f.path.toLowerCase() === path.toLowerCase());
      if (known) return openFile(known);
      if (await api.pathExists(path)) return openFile(entryFromPath(path));
      toast(`Dosya bulunamadı: ${baseName(path)}`, "error");
    },
    [files, openFile, toast],
  );

  /** Seçilen kitapların okuma kayıtlarını siler (PDF dosyalarına dokunmaz) */
  const clearReading = useCallback(
    (items: { path: string; key: string }[], opts: ClearOptions) => {
      const paths = new Set(items.map((i) => i.path));
      const keys = new Set(items.map((i) => i.key));
      if (opts.recent) {
        setRecent((prev) => {
          const next = prev.filter((r) => !paths.has(r.path));
          saveRecent(next);
          return next;
        });
      }
      if (opts.progress) {
        const next = { ...positionsRef.current };
        keys.forEach((k) => delete next[k]);
        positionsRef.current = next;
        setPositions(next);
        savePositions(next);
      }
      if (opts.translations) keys.forEach((k) => deleteHistory(k));
      toast("Seçilen kayıtlar silindi");
    },
    [toast],
  );

  const clearAll = useCallback(
    (opts: ClearOptions) => {
      if (opts.recent) {
        setRecent([]);
        saveRecent([]);
      }
      if (opts.progress) {
        positionsRef.current = {};
        setPositions({});
        savePositions({});
      }
      if (opts.translations) clearAllHistory();
      toast("Okuma kayıtları temizlendi");
    },
    [toast],
  );

  const getPosition = useCallback((key: string) => positionsRef.current[key], []);
  const onPosition = useCallback((key: string, pos: Position) => {
    const prev = positionsRef.current[key];
    const next = { ...positionsRef.current, [key]: { ...prev, ...pos } };
    positionsRef.current = next;
    setPositions(next);
    savePositions(next);
  }, []);

  // ------------------------------------------------------------ Genel kısayollar

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "o") {
        e.preventDefault();
        openFolder();
      } else if (k === "b") {
        e.preventDefault();
        updateSettings({ sidebarOpen: !settings.sidebarOpen });
      } else if (k === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (k === "r" || k === "p") {
        e.preventDefault(); // tarayıcının yenile / yazdır davranışını engelle
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFolder, updateSettings, settings.sidebarOpen]);

  if (!ready) return <div className="boot">Yükleniyor…</div>;

  const favFiles = files.filter((f) => favSet.has(f.path));

  return (
    <div className="app">
      {settings.sidebarOpen && (
        <Sidebar
          folders={folders}
          files={files}
          favorites={favSet}
          recent={recent}
          positions={positions}
          current={current}
          scanning={scanning}
          onOpenFolder={openFolder}
          onRemoveFolder={removeFolder}
          onRefresh={() => rescanAll(folders)}
          onOpen={openFile}
          onOpenRecent={openRecent}
          onToggleFavorite={toggleFavorite}
          onOpenSettings={() => setSettingsOpen(true)}
          onCollapse={() => updateSettings({ sidebarOpen: false })}
          onShowLibrary={() => {
            setCurrent(null);
            setView("library");
          }}
          libraryActive={!current && view === "library"}
          onClearReading={clearReading}
          onClearAll={clearAll}
        />
      )}
      <main className="main">
        {current ? (
          <Reader
            key={current.path}
            file={current}
            settings={settings}
            updateSettings={updateSettings}
            isFavorite={favSet.has(current.path)}
            onToggleFavorite={() => toggleFavorite(current.path)}
            onBack={() => setCurrent(null)}
            getPosition={getPosition}
            onPosition={onPosition}
            onOpenPath={openPath}
            onOpenSettings={() => setSettingsOpen(true)}
            toast={toast}
          />
        ) : view === "library" ? (
          <Library
            folders={folders}
            files={files}
            favorites={favSet}
            recent={recent}
            positions={positions}
            settings={settings}
            updateSettings={updateSettings}
            onOpen={openFile}
            onToggleFavorite={toggleFavorite}
            onBack={() => setView("home")}
          />
        ) : (
          <Home
            hasFolders={folders.length > 0}
            fileCount={files.length}
            recent={recent}
            favorites={favFiles}
            positions={positions}
            sidebarOpen={settings.sidebarOpen}
            onShowSidebar={() => updateSettings({ sidebarOpen: true })}
            onOpenFolder={openFolder}
            onOpenRecent={openRecent}
            onOpen={openFile}
            onOpenSettings={() => setSettingsOpen(true)}
            onShowLibrary={() => setView("library")}
            onRemoveRecent={(r) => clearReading([r], { recent: true, progress: false, translations: false })}
          />
        )}
      </main>

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          update={updateSettings}
          onClose={() => setSettingsOpen(false)}
          onClearAll={clearAll}
          toast={toast}
        />
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
