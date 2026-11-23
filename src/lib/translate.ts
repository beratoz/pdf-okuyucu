import { api, toErrorInfo } from "./api";
import { getLanguage } from "./languages";
import { allProviders, getProvider } from "./providers";
import { cacheGet, cacheSet } from "./store";
import type { Attempt, Engine, Settings, TranslationResult } from "./types";

/**
 * PDF'ten seçilen metni çeviriye hazırlar:
 * satır sonu tirelemelerini birleştirir, cümle içindeki satır kırılmalarını boşluğa çevirir,
 * paragraf aralarını korur.
 */
export function cleanSelectedText(raw: string): string {
  let s = raw.replace(/\r/g, "").replace(/­/g, "");
  // "transla-\ntion" → "translation" (yalnızca devamı küçük harfle başlıyorsa)
  s = s.replace(/(\p{L})[-‐]\n\s*(\p{Ll})/gu, "$1$2");
  // Paragraf aralarını işaretle
  s = s.replace(/[ \t]*\n[ \t]*\n+/g, "\u0000");
  // Madde işaretli satırları koru
  s = s.replace(/\n\s*([•▪◦‣\-–]\s)/g, "\u0001$1");
  // Kalan tek satır sonları → boşluk
  s = s.replace(/\s*\n\s*/g, " ");
  s = s.replace(/\u0000/g, "\n\n").replace(/\u0001/g, "\n");
  return s.replace(/[ \t]{2,}/g, " ").trim();
}

async function sha1(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function cacheId(engine: Engine, s: Settings, text: string) {
  const p = getProvider(s, engine);
  return `${engine}|${p?.model ?? ""}|${p?.baseUrl ?? ""}|${s.targetLang}|${await sha1(text)}`;
}

/** Kota dolan / hata veren motorlar bir süre atlanır (otomatik modda). */
const cooldownUntil: Record<string, { until: number; reason: string }> = {};

function cooldownMs(kind: string, engine: Engine): number {
  switch (kind) {
    case "quota":
      return engine === "deepl" ? 6 * 60 * 60_000 : 20 * 60_000;
    case "auth":
      return 10 * 60_000;
    case "network":
      return 60_000;
    case "model":
      return 30 * 60_000;
    default:
      return 0;
  }
}

export function resetCooldowns() {
  for (const k of Object.keys(cooldownUntil)) delete cooldownUntil[k];
}

export function enginesToTry(s: Settings, force?: Engine): Engine[] {
  if (force) return [force];
  if (s.engineMode !== "auto") return [s.engineMode];
  const ids = new Set(allProviders(s).map((p) => p.id));
  return s.engineOrder.filter((e) => ids.has(e) && s.enabledEngines[e] !== false);
}

/**
 * Metni çevirir. Otomatik modda sıra: DeepL → Gemini Flash → Gemma (ayarlardan değiştirilebilir).
 * Bir motor kota/anahtar/ağ hatası verirse sıradakine geçilir.
 */
export async function translateText(opts: {
  text: string;
  context?: string;
  settings: Settings;
  force?: Engine;
  /** true ise önbellek atlanır (yeniden çevir) */
  skipCache?: boolean;
}): Promise<TranslationResult> {
  const { settings: s, force } = opts;
  const text = cleanSelectedText(opts.text);
  if (!text) throw new Error("Çevrilecek metin yok");
  const lang = getLanguage(s.targetLang);
  const engines = enginesToTry(s, force);
  if (engines.length === 0) throw new Error("Etkin çeviri motoru yok. Ayarlardan en az birini açın.");

  // 1) Önce önbellek: aynı metin daha önce çevrildiyse kota harcamadan anında getir
  for (const engine of opts.skipCache ? [] : engines) {
    const hit = await cacheGet(await cacheId(engine, s, text));
    if (hit) {
      return { text: hit.text, engine, model: hit.model, fromCache: true, attempts: [], source: text };
    }
  }

  // 2) Sırayla motorları dene
  const attempts: Attempt[] = [];
  const multi = engines.length > 1;
  for (const engine of engines) {
    const cd = cooldownUntil[engine];
    if (multi && cd && cd.until > Date.now()) {
      attempts.push({ engine, skipped: cd.reason });
      continue;
    }
    const provider = getProvider(s, engine);
    if (!provider) {
      attempts.push({ engine, error: { kind: "other", message: "Sağlayıcı bulunamadı" } });
      continue;
    }
    try {
      const res = await api.translate({
        engine,
        kind: provider.kind,
        keyRef: provider.keyRef,
        baseUrl: provider.baseUrl,
        model: provider.model || undefined,
        text,
        context: s.useContext ? opts.context : undefined,
        targetCode: lang.code,
        targetName: lang.llmName,
      });
      delete cooldownUntil[engine];
      await cacheSet(await cacheId(engine, s, text), { text: res.text, model: res.model, t: Date.now() });
      return { text: res.text, engine, model: res.model, fromCache: false, attempts, source: text };
    } catch (e) {
      const err = toErrorInfo(e);
      attempts.push({ engine, error: err });
      const ms = cooldownMs(err.kind, engine);
      if (ms > 0) cooldownUntil[engine] = { until: Date.now() + ms, reason: err.message };
    }
  }
  const error = new Error("Hiçbir çeviri motoru yanıt veremedi") as Error & { attempts: Attempt[] };
  error.attempts = attempts;
  throw error;
}

/** Seçimin etrafından bağlam metni çıkarır (en fazla ~1200 karakter). */
export function extractContext(fullText: string, selected: string, radius = 600): string {
  const norm = (x: string) => x.replace(/\s+/g, " ").trim();
  const all = norm(fullText);
  const sel = norm(selected);
  if (!all || all.length <= sel.length + 20) return "";
  const probe = sel.slice(0, 40);
  const idx = all.indexOf(probe);
  if (idx < 0) return all.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(all.length, idx + sel.length + radius);
  return (start > 0 ? "… " : "") + all.slice(start, end) + (end < all.length ? " …" : "");
}
