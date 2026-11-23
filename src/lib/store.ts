import { load, type Store } from "@tauri-apps/plugin-store";
import type { HistoryItem, Position, RecentItem, Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  theme: "light",
  pageMode: "theme",
  customBg: "#f4ecd8",
  customFg: "#3e3022",
  targetLang: "TR",
  engineMode: "auto",
  engineOrder: ["deepl", "gemini", "gemma"],
  enabledEngines: { deepl: true, gemini: true, gemma: true },
  customProviders: [],
  geminiModel: "gemini-flash-latest",
  gemmaModel: "gemma-4-31b-it",
  autoTranslate: false,
  useContext: true,
  mdFontSize: 18,
  sidebarOpen: true,
  historyOpen: false,
  inkColor: "#e03131",
  inkSize: 3,
  libraryGroup: true,
  librarySort: "name",
};

let dataStore: Store | null = null;
let cacheStore: Store | null = null;

export async function initStores() {
  dataStore = await load("data.json", { autoSave: 400, defaults: {} });
  cacheStore = await load("ceviri-onbellek.json", { autoSave: 1500, defaults: {} });
}

function data(): Store {
  if (!dataStore) throw new Error("Depo henüz yüklenmedi");
  return dataStore;
}

export async function saveAll() {
  await Promise.all([dataStore?.save(), cacheStore?.save()]);
}

// ---------------------------------------------------------------- Ayarlar

export async function loadSettings(): Promise<Settings> {
  const s = (await data().get<Partial<Settings>>("settings")) ?? {};
  const merged = { ...DEFAULT_SETTINGS, ...s };
  merged.customProviders = Array.isArray(s.customProviders) ? s.customProviders : [];
  merged.enabledEngines = { ...DEFAULT_SETTINGS.enabledEngines, ...(s.enabledEngines ?? {}) };
  // Sıra listesi: var olmayan sağlayıcıları çıkar, eksikleri sona ekle
  const ids = [...DEFAULT_SETTINGS.engineOrder, ...merged.customProviders.map((p) => p.id)];
  merged.engineOrder = merged.engineOrder.filter((e) => ids.includes(e));
  for (const id of ids) {
    if (!merged.engineOrder.includes(id)) merged.engineOrder = [...merged.engineOrder, id];
    if (merged.enabledEngines[id] === undefined) merged.enabledEngines[id] = true;
  }
  if (merged.engineMode !== "auto" && !ids.includes(merged.engineMode)) merged.engineMode = "auto";
  return merged;
}

export async function saveSettings(s: Settings) {
  await data().set("settings", s);
}

// ---------------------------------------------------------------- Kütüphane

export async function loadLibrary() {
  const d = data();
  return {
    folders: (await d.get<string[]>("folders")) ?? [],
    favorites: (await d.get<string[]>("favorites")) ?? [],
    recent: (await d.get<RecentItem[]>("recent")) ?? [],
    positions: (await d.get<Record<string, Position>>("positions")) ?? {},
  };
}

export async function saveFolders(folders: string[]) {
  await data().set("folders", folders);
}
export async function saveFavorites(favs: string[]) {
  await data().set("favorites", favs);
}
export async function saveRecent(recent: RecentItem[]) {
  await data().set("recent", recent);
}
export async function savePositions(positions: Record<string, Position>) {
  await data().set("positions", positions);
}

// ---------------------------------------------------------------- Çeviri geçmişi (belge başına)

export async function loadHistory(key: string): Promise<HistoryItem[]> {
  return (await data().get<HistoryItem[]>(`history:${key}`)) ?? [];
}
export async function saveHistory(key: string, items: HistoryItem[]) {
  await data().set(`history:${key}`, items.slice(0, 500));
}

// ---------------------------------------------------------------- Çeviri önbelleği

const CACHE_LIMIT = 4000;

interface CacheValue {
  text: string;
  model?: string;
  t: number;
}

export async function cacheGet(id: string): Promise<CacheValue | undefined> {
  return cacheStore?.get<CacheValue>(id);
}

export async function cacheSet(id: string, value: CacheValue) {
  if (!cacheStore) return;
  await cacheStore.set(id, value);
  const index = ((await cacheStore.get<string[]>("__index")) ?? []).filter((k) => k !== id);
  index.push(id);
  while (index.length > CACHE_LIMIT) {
    const old = index.shift();
    if (old) await cacheStore.delete(old);
  }
  await cacheStore.set("__index", index);
}

export async function cacheClear() {
  if (!cacheStore) return;
  await cacheStore.clear();
  await cacheStore.save();
}

export async function cacheCount(): Promise<number> {
  return ((await cacheStore?.get<string[]>("__index")) ?? []).length;
}

export async function deleteHistory(key: string) {
  await data().delete(`history:${key}`);
}

/** Tüm belgelerin çeviri geçmişini siler */
export async function clearAllHistory() {
  const d = data();
  for (const k of await d.keys()) {
    if (k.startsWith("history:")) await d.delete(k);
  }
}

// ---------------------------------------------------------------- Çizimler (belge başına)

import type { InkData } from "./ink";

const inkCache = new Map<string, InkData>();

export async function loadInk(key: string): Promise<InkData> {
  const cached = inkCache.get(key);
  if (cached) return cached;
  const d = (await data().get<InkData>(`ink:${key}`)) ?? {};
  inkCache.set(key, d);
  return d;
}

export async function saveInk(key: string, ink: InkData) {
  // Boş sayfaları at
  const clean: InkData = {};
  for (const [page, strokes] of Object.entries(ink)) {
    if (strokes?.length) clean[Number(page)] = strokes;
  }
  inkCache.set(key, clean);
  if (Object.keys(clean).length) await data().set(`ink:${key}`, clean);
  else await data().delete(`ink:${key}`);
}
