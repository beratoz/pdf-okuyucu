import type { Settings, ThemeId } from "./types";

export interface ThemeDef {
  id: ThemeId;
  label: string;
  /** PDF sayfası ve Markdown metni için renkler */
  pageBg: string;
  pageFg: string;
  /** Önizleme kartında kullanılan arka plan */
  swatch: string;
}

export const THEMES: ThemeDef[] = [
  { id: "light", label: "Açık", pageBg: "#ffffff", pageFg: "#1f2328", swatch: "#f6f6f4" },
  { id: "sepia", label: "Sepya", pageBg: "#f4ecd8", pageFg: "#3b2e20", swatch: "#efe4cc" },
  { id: "dark", label: "Koyu", pageBg: "#262a30", pageFg: "#e2e4e8", swatch: "#1d2025" },
  { id: "night", label: "Gece", pageBg: "#111111", pageFg: "#cdbfa6", swatch: "#050505" },
];

export const PAGE_PRESETS: { label: string; bg: string; fg: string }[] = [
  { label: "Krem", bg: "#fbf3e0", fg: "#2f2a22" },
  { label: "Yeşil", bg: "#e3efdc", fg: "#1f2d1c" },
  { label: "Gri", bg: "#d9d9d6", fg: "#1c1c1c" },
  { label: "Lacivert", bg: "#14213d", fg: "#e5e5e5" },
  { label: "Kahve", bg: "#2b2118", fg: "#e8d9c0" },
  { label: "Siyah-Yeşil", bg: "#000000", fg: "#7ee787" },
];

export function getTheme(id: ThemeId): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** pdf.js için sayfa renkleri; null = orijinal renkler */
export function pdfPageColors(s: Settings): { background: string; foreground: string } | null {
  if (s.pageMode === "original") return null;
  if (s.pageMode === "custom") return { background: s.customBg, foreground: s.customFg };
  if (s.theme === "light") return null;
  const t = getTheme(s.theme);
  return { background: t.pageBg, foreground: t.pageFg };
}

/** Markdown okuyucu için metin renkleri */
export function mdColors(s: Settings): { bg: string; fg: string } {
  if (s.pageMode === "custom") return { bg: s.customBg, fg: s.customFg };
  const t = getTheme(s.theme);
  return { bg: t.pageBg, fg: t.pageFg };
}
