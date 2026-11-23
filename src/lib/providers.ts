// Çeviri sağlayıcıları: yerleşikler (DeepL, Gemini Flash, Gemma) + kullanıcının eklediği
// OpenAI uyumlu servisler ve Claude. Yeni bir servis için kod yazmak gerekmez; çoğu servis
// OpenAI'ın istek biçimini desteklediği için "adres + anahtar + model" yeterlidir.
import type { Provider, ProviderKind, Settings } from "./types";

export const BUILTIN_IDS = ["deepl", "gemini", "gemma"];

export function builtinProviders(s: Settings): Provider[] {
  return [
    { id: "deepl", kind: "deepl", name: "DeepL", keyRef: "deepl", builtin: true },
    { id: "gemini", kind: "gemini", name: "Gemini Flash", model: s.geminiModel, keyRef: "gemini", builtin: true },
    { id: "gemma", kind: "gemini", name: "Gemma", model: s.gemmaModel, keyRef: "gemini", builtin: true },
  ];
}

export function allProviders(s: Settings): Provider[] {
  return [...builtinProviders(s), ...s.customProviders];
}

export function getProvider(s: Settings, id: string): Provider | undefined {
  return allProviders(s).find((p) => p.id === id);
}

/** Sağlayıcının görünen adı; silinmişse kayıttaki ada / kimliğe düşer */
export function providerLabel(s: Settings, id: string, fallback?: string): string {
  return getProvider(s, id)?.name ?? fallback ?? id;
}

/** Rozet rengi için tür */
export function providerKindOf(s: Settings, id: string): ProviderKind | "unknown" {
  return getProvider(s, id)?.kind ?? "unknown";
}

/** Sıradaki etkin sağlayıcıların adları: "DeepL → Gemini Flash → Gemma" */
export function orderLabel(s: Settings): string {
  return (
    s.engineOrder
      .filter((id) => s.enabledEngines[id] !== false)
      .map((id) => getProvider(s, id)?.name)
      .filter(Boolean)
      .join(" → ") || "kapalı"
  );
}

export function newProviderId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return "p_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const KIND_LABEL: Record<ProviderKind, string> = {
  deepl: "DeepL",
  gemini: "Google Gemini",
  openai: "OpenAI uyumlu",
  anthropic: "Claude (Anthropic)",
};

export interface Preset {
  id: string;
  label: string;
  kind: "openai" | "anthropic";
  name: string;
  baseUrl?: string;
  model?: string;
  /** Anahtarın alınacağı sayfa */
  keyUrl?: string;
  local?: boolean;
  hint?: string;
}

/** Hazır şablonlar: adres kendiliğinden dolar. Liste dışı servisler "Diğer" ile eklenir. */
export const PRESETS: Preset[] = [
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    kind: "anthropic",
    name: "Claude",
    model: "claude-opus-5-5",
    keyUrl: "https://platform.claude.com",
    hint: "claude-opus-5-5 en yetenekli modeldir; claude-haiku-5-5 çok daha ucuz ve hızlıdır.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    keyUrl: "https://platform.deepseek.com",
  },
  {
    id: "openrouter",
    label: "OpenRouter (tek anahtarla yüzlerce model)",
    kind: "openai",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    hint: "Ücretsiz modellerin adı “:free” ile biter.",
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyUrl: "https://console.groq.com/keys",
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "openai",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    keyUrl: "https://console.mistral.ai",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    kind: "openai",
    name: "Grok",
    baseUrl: "https://api.x.ai/v1",
    keyUrl: "https://console.x.ai",
  },
  {
    id: "together",
    label: "Together AI",
    kind: "openai",
    name: "Together",
    baseUrl: "https://api.together.xyz/v1",
    keyUrl: "https://api.together.ai",
  },
  {
    id: "ollama",
    label: "Ollama (bu bilgisayarda, anahtarsız)",
    kind: "openai",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    local: true,
    hint: "Ollama'yı kurup bir model indirin (ör. “ollama pull gemma3”). İnternetsiz çalışır.",
  },
  {
    id: "lmstudio",
    label: "LM Studio (bu bilgisayarda, anahtarsız)",
    kind: "openai",
    name: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    local: true,
    hint: "LM Studio'da bir model yükleyip yerel sunucuyu başlatın.",
  },
  {
    id: "custom",
    label: "Diğer (OpenAI uyumlu herhangi bir servis)",
    kind: "openai",
    name: "",
    baseUrl: "https://",
    hint: "Servisin belgelerindeki “OpenAI compatible” adresini girin (genelde /v1 ile biter).",
  },
];
