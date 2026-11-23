export interface Language {
  /** DeepL hedef dil kodu */
  code: string;
  /** Arayüzde görünen ad */
  label: string;
  /** LLM'e verilen İngilizce ad */
  llmName: string;
}

export const LANGUAGES: Language[] = [
  { code: "TR", label: "Türkçe", llmName: "Turkish" },
  { code: "EN-US", label: "İngilizce (ABD)", llmName: "English" },
  { code: "EN-GB", label: "İngilizce (Birleşik Krallık)", llmName: "British English" },
  { code: "DE", label: "Almanca", llmName: "German" },
  { code: "FR", label: "Fransızca", llmName: "French" },
  { code: "ES", label: "İspanyolca", llmName: "Spanish" },
  { code: "IT", label: "İtalyanca", llmName: "Italian" },
  { code: "RU", label: "Rusça", llmName: "Russian" },
  { code: "AR", label: "Arapça", llmName: "Arabic" },
  { code: "NL", label: "Felemenkçe", llmName: "Dutch" },
  { code: "PT-BR", label: "Portekizce (Brezilya)", llmName: "Brazilian Portuguese" },
  { code: "JA", label: "Japonca", llmName: "Japanese" },
  { code: "ZH-HANS", label: "Çince (Basitleştirilmiş)", llmName: "Simplified Chinese" },
  { code: "KO", label: "Korece", llmName: "Korean" },
  { code: "UK", label: "Ukraynaca", llmName: "Ukrainian" },
];

export function getLanguage(code: string): Language {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}
