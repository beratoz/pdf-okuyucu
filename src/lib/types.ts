export type FileKind = "pdf" | "md";

export interface FileEntry {
  path: string;
  name: string;
  kind: FileKind;
  size: number;
  modified: number;
  /** Kök klasöre göre alt klasör ("" = kök) */
  dir: string;
  root: string;
}

/** Sağlayıcı kimliği: "deepl", "gemini", "gemma" veya kullanıcının eklediği "p_..." */
export type Engine = string;
export type EngineMode = "auto" | Engine;

export type ProviderKind = "deepl" | "gemini" | "openai" | "anthropic";

export interface Provider {
  id: string;
  kind: ProviderKind;
  /** Arayüzde görünen ad */
  name: string;
  model?: string;
  /** OpenAI uyumlu sağlayıcılar için adres (ör. https://api.deepseek.com/v1) */
  baseUrl?: string;
  /** Anahtarın Windows kasasındaki adı */
  keyRef: string;
  builtin?: boolean;
  /** Bu bilgisayarda çalışan, anahtar istemeyen sunucu (Ollama, LM Studio) */
  local?: boolean;
  /** Hangi hazır şablondan eklendi (bilgi amaçlı) */
  preset?: string;
}

export type ThemeId = "light" | "sepia" | "dark" | "night";
export type PageMode = "original" | "theme" | "custom";

export interface Settings {
  theme: ThemeId;
  /** PDF sayfalarının renklendirilmesi */
  pageMode: PageMode;
  customBg: string;
  customFg: string;
  targetLang: string;
  engineMode: EngineMode;
  engineOrder: Engine[];
  enabledEngines: Record<Engine, boolean>;
  /** Kullanıcının eklediği sağlayıcılar (DeepL / Gemini / Gemma yerleşiktir) */
  customProviders: Provider[];
  geminiModel: string;
  gemmaModel: string;
  /** Metin seçilir seçilmez çevir */
  autoTranslate: boolean;
  /** Seçimin çevresindeki metni bağlam olarak gönder */
  useContext: boolean;
  mdFontSize: number;
  sidebarOpen: boolean;
  historyOpen: boolean;
  /** Kalem rengi ve kalınlığı */
  inkColor: string;
  inkSize: number;
  /** Tümünü gör ekranı */
  libraryGroup: boolean;
  librarySort: "name" | "recent";
}

export interface ClearOptions {
  /** Son okunanlar listesinden kaldır */
  recent: boolean;
  /** Kaldığı yeri / ilerlemeyi sıfırla */
  progress: boolean;
  /** Çeviri geçmişini sil */
  translations: boolean;
}

export interface Position {
  page?: number;
  pages?: number;
  top?: number;
  left?: number;
  /** pdf.js ölçek değeri: yüzde (125) veya "page-width" gibi */
  scale?: number | string;
  /** Markdown için kaydırma oranı (0–1) */
  ratio?: number;
  updated: number;
}

export interface RecentItem {
  path: string;
  name: string;
  kind: FileKind;
  key: string;
  time: number;
}

export interface HistoryItem {
  id: string;
  page?: number;
  source: string;
  translation: string;
  engine: Engine;
  /** Çeviri anındaki sağlayıcı adı (sağlayıcı sonradan silinse de görünsün) */
  engineName?: string;
  model?: string;
  time: number;
}

export interface TranslateErrorInfo {
  kind: "noKey" | "auth" | "quota" | "model" | "network" | "blocked" | "other";
  message: string;
}

export interface Attempt {
  engine: Engine;
  error?: TranslateErrorInfo;
  skipped?: string;
}

export interface TranslationResult {
  text: string;
  engine: Engine;
  model?: string;
  fromCache: boolean;
  attempts: Attempt[];
  source: string;
}


export function fileKey(f: { name: string; size: number }): string {
  return `${f.name}|${f.size}`;
}
