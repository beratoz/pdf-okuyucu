// YALNIZCA GELİŞTİRME: Uygulama Tauri dışında (normal tarayıcıda) açıldığında
// Rust komutlarını taklit eder; arayüzü tarayıcıda test etmeyi sağlar.
// Üretim derlemesine dahil edilmez (main.tsx'te import.meta.env.DEV ile korunur).
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const PARAGRAPHS = [
  "Machine translation has improved dramatically over the last decade. Neural models now produce fluent output for many language pairs, yet morphologically rich languages such as Turkish remain challenging because a single word can carry several suffixes.",
  "In this chapter we examine how context affects the quality of transla-",
  "tion. When a sentence is translated in isolation, pronouns like it or this are often ambiguous. Providing the surrounding paragraph helps the system choose the right meaning.",
  "Large language models can also follow instructions such as preserving technical terms, keeping numbers unchanged and returning only the translated text without explanations.",
  "The reader should be able to select any passage, press a single button and see the translation immediately, without leaving the page or losing their place in the document.",
];

function wrap(text: string, width = 88): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    if ((line + " " + w).trim().length > width) {
      out.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Bellekte basit, çok sayfalı bir test PDF'i üretir. */
function makePdf(pages: number): Uint8Array {
  const objs: string[] = [];
  const pageIds: number[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  let id = 5;
  for (let p = 1; p <= pages; p++) {
    const lines: string[] = [];
    lines.push(`BT /F2 18 Tf 72 740 Td (${esc(`Chapter ${p}: Notes on Translation`)}) Tj ET`);
    let y = 708;
    for (const para of PARAGRAPHS) {
      const ls = para.endsWith("-") ? [para] : wrap(para);
      for (const l of ls) {
        lines.push(`BT /F1 11.5 Tf 72 ${y} Td (${esc(l)}) Tj ET`);
        y -= 16;
      }
      if (!para.endsWith("-")) y -= 10;
    }
    lines.push(`BT /F1 9 Tf 290 40 Td (${p}) Tj ET`);
    const content = lines.join("\n");
    const contentId = id++;
    const pageId = id++;
    objs[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    pageIds.push(pageId);
  }
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pages} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

const SAMPLE_MD = `# Örnek Markdown Belgesi

Bu dosya **Markdown** okuyucusunu test etmek içindir.

## Introduction

Reading technical documentation in a foreign language can be tiring. Select any sentence in this document and press the translate button to see it in Turkish.

- Remembers where you left off
- Supports themes and custom page colors
- Translation with DeepL, Gemini Flash and Gemma

> Quality translation depends on context; the app sends the surrounding paragraph along with your selection.

\`\`\`ts
const answer = 42;
\`\`\`

${Array.from({ length: 12 }, (_, i) => `### Section ${i + 1}\n\nThis is paragraph number ${i + 1}. It contains enough English text to scroll the page and test that the reading position is restored correctly after reopening the file.`).join("\n\n")}
`;

const ROOT = "C:\\Kitaplar";
const FILES = [
  { path: `${ROOT}\\Ceviri Notlari.pdf`, name: "Ceviri Notlari.pdf", kind: "pdf", size: 120000, modified: Date.now(), dir: "", root: ROOT },
  { path: `${ROOT}\\Makaleler\\Uzun Makale.pdf`, name: "Uzun Makale.pdf", kind: "pdf", size: 340000, modified: Date.now(), dir: "Makaleler", root: ROOT },
  { path: `${ROOT}\\Notlar\\Okuma Notlari.md`, name: "Okuma Notlari.md", kind: "md", size: 4000, modified: Date.now(), dir: "Notlar", root: ROOT },
  ...["Tarih", "Felsefe", "Fizik"].flatMap((dir) =>
    Array.from({ length: 10 }, (_, i) => ({
      path: `${ROOT}\\${dir}\\${dir} Cilt ${i + 1}.pdf`,
      name: `${dir} Cilt ${i + 1}.pdf`,
      kind: "pdf",
      size: 500000 + i,
      modified: Date.now(),
      dir,
      root: ROOT,
    })),
  ),
  ...["Algoritmalar", "Veri Yapilari", "Isletim Sistemleri", "Ag Temelleri"].map((n, i) => ({
    path: `${ROOT}\\Ders Kitaplari\\${n}.pdf`,
    name: `${n}.pdf`,
    kind: "pdf",
    size: 200000 + i,
    modified: Date.now(),
    dir: "Ders Kitaplari",
    root: ROOT,
  })),
];

const stores = new Map<number, Map<string, unknown>>();
const storeByPath = new Map<string, number>();
let nextRid = 1;

const keys: Record<string, boolean> = { deepl: true, gemini: true };

// Gerçek eklentide otomatik kaydı Rust yapar; taklitte her değişiklikte yaz
function persist(rid: number) {
  for (const [path, r] of storeByPath) {
    if (r === rid) localStorage.setItem(`mockstore:${path}`, JSON.stringify([...stores.get(rid)!]));
  }
}

mockWindows("main");
mockConvertFileSrc("windows");
mockIPC(
  async (cmd, args) => {
    const a = (args ?? {}) as Record<string, any>;
    switch (cmd) {
      case "plugin:store|load": {
        const existing = storeByPath.get(a.path);
        if (existing) return existing;
        const rid = nextRid++;
        const saved = localStorage.getItem(`mockstore:${a.path}`);
        stores.set(rid, new Map(saved ? JSON.parse(saved) : []));
        storeByPath.set(a.path, rid);
        return rid;
      }
      case "plugin:store|get": {
        const m = stores.get(a.rid)!;
        return [m.get(a.key) ?? null, m.has(a.key)];
      }
      case "plugin:store|set":
        stores.get(a.rid)!.set(a.key, a.value);
        persist(a.rid);
        return null;
      case "plugin:store|delete": {
        const ok = stores.get(a.rid)!.delete(a.key);
        persist(a.rid);
        return ok;
      }
      case "plugin:store|clear":
        stores.get(a.rid)!.clear();
        persist(a.rid);
        return null;
      case "plugin:store|save":
        persist(a.rid);
        return null;
      case "plugin:dialog|open":
        return ROOT;
      case "plugin:opener|open_url":
        console.log("open_url", a);
        return null;
      case "scan_folder":
        return FILES;
      case "path_exists":
        return true;
      case "read_thumb":
        throw "yok";
      case "save_thumb":
        return null;
      case "read_file_bytes":
        return makePdf(a.path.includes("Uzun") ? 40 : 6).buffer;
      case "read_text_file":
        return SAMPLE_MD;
      case "has_api_key":
        return keys[a.provider] ?? false;
      case "set_api_key":
        keys[a.provider] = true;
        return null;
      case "delete_api_key":
        keys[a.provider] = false;
        return null;
      case "deepl_usage":
        return { characterCount: 500000, characterLimit: 500000 };
      case "list_gemini_models":
        return [
          { id: "gemini-flash-latest", displayName: "Gemini Flash Latest" },
          { id: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash" },
          { id: "gemma-4-31b-it", displayName: "Gemma 4 31B" },
          { id: "gemma-4-26b-a4b-it", displayName: "Gemma 4 26B A4B" },
        ];
      case "list_provider_models":
        if (a.kind === "anthropic") return [{ id: "claude-opus-5-5", displayName: "Claude Opus 5.5" }, { id: "claude-haiku-5-5", displayName: "Claude Haiku 5.5" }];
        return [{ id: "deepseek-chat", displayName: "deepseek-chat" }, { id: "deepseek-reasoner", displayName: "deepseek-reasoner" }];
      case "translate_text": {
        const req = a.req;
        await new Promise((r) => setTimeout(r, 500));
        if (req.engine === "deepl") throw { kind: "quota", message: "DeepL aylık karakter kotası doldu" };
        return {
          text: `[${req.engine} çevirisi] ${req.text}`,
          engine: req.engine,
          model: req.model,
          detectedSource: null,
        };
      }
      default:
        console.warn("Taklit edilmeyen komut:", cmd, a);
        return null;
    }
  },
  { shouldMockEvents: true },
);
