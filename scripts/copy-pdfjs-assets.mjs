// pdf.js'in yazı tipi, karakter haritası ve wasm dosyalarını public/ klasörüne kopyalar.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");

for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const from = join(src, dir);
  if (!existsSync(from)) continue;
  mkdirSync(join(dest, dir), { recursive: true });
  cpSync(from, join(dest, dir), { recursive: true });
}
console.log("pdf.js varlıkları kopyalandı → public/pdfjs");
