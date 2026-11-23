import { invoke } from "@tauri-apps/api/core";
import type { Engine, FileEntry, ProviderKind, TranslateErrorInfo } from "./types";

export const api = {
  scanFolder: (path: string) => invoke<FileEntry[]>("scan_folder", { path }),
  readFileBytes: (path: string) => invoke<ArrayBuffer>("read_file_bytes", { path }),
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
  pathExists: (path: string) => invoke<boolean>("path_exists", { path }),

  /** provider: anahtarın kasadaki adı ("deepl", "gemini" veya eklenen sağlayıcının kimliği) */
  /** Ek sağlayıcılarda originUrl zorunlu: anahtar bu adrese kilitlenir */
  setApiKey: (provider: string, key: string, originUrl?: string) =>
    invoke<void>("set_api_key", { provider, key, originUrl }),
  hasApiKey: (provider: string) => invoke<boolean>("has_api_key", { provider }),
  deleteApiKey: (provider: string) => invoke<void>("delete_api_key", { provider }),

  translate: (req: {
    engine: Engine;
    kind: ProviderKind;
    keyRef: string;
    baseUrl?: string;
    model?: string;
    text: string;
    context?: string;
    targetCode: string;
    targetName: string;
  }) =>
    invoke<{ text: string; engine: Engine; model?: string; detectedSource?: string }>(
      "translate_text",
      { req },
    ),
  deeplUsage: () =>
    invoke<{ characterCount: number; characterLimit: number }>("deepl_usage"),
  listGeminiModels: () =>
    invoke<{ id: string; displayName: string }[]>("list_gemini_models"),
  listProviderModels: (kind: ProviderKind, keyRef: string, baseUrl?: string) =>
    invoke<{ id: string; displayName: string }[]>("list_provider_models", { kind, keyRef, baseUrl }),
};

/** Rust'tan gelen hatayı tek tipe dönüştürür. */
export function toErrorInfo(e: unknown): TranslateErrorInfo {
  if (e && typeof e === "object" && "kind" in e && "message" in e) {
    return e as TranslateErrorInfo;
  }
  return { kind: "other", message: typeof e === "string" ? e : String(e) };
}
