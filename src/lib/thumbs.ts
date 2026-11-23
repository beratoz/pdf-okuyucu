// PDF kapak görselleri: ilk sayfa küçük boyutta çizilir, JPEG olarak diske kaydedilir.
// Sistemi yormamak için görseller sırayla (aynı anda tek tek) ve yalnızca ekranda
// görünen kartlar için üretilir; bir kez üretilen görsel sonra diskten okunur.
import { invoke } from "@tauri-apps/api/core";
import { api } from "./api";
import { pdfjsLib } from "./pdfjs-setup";
import type { FileEntry } from "./types";

const THUMB_WIDTH = 280;
const MAX_PDF_BYTES = 250 * 1024 * 1024;

const urls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

// Tüm kapaklar için tek bir pdf.js işçisi: her PDF'te yeniden başlatmak yavaş olur
let worker: InstanceType<typeof pdfjsLib.PDFWorker> | null = null;
function sharedWorker() {
  if (!worker || worker.destroyed) worker = new pdfjsLib.PDFWorker();
  return worker;
}

async function sha1(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Önbellekte varsa görselin adresini hemen döndürür */
export function cachedThumb(path: string): string | undefined {
  return urls.get(path);
}

async function render(f: FileEntry, id: string): Promise<string | null> {
  if (f.size > MAX_PDF_BYTES) return null;
  const buf = await api.readFileBytes(f.path);
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
    worker: sharedWorker(),
  });
  // Şifreli PDF'lerde şifre sorma; kapak üretme
  task.onPassword = () => task.destroy();
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport, background: "#ffffff" }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    invoke("save_thumb", bytes, { headers: { "x-thumb-id": id } }).catch(() => {});
    return URL.createObjectURL(blob);
  } finally {
    task.destroy();
  }
}

/** Dosyanın kapak görselini döndürür (diskten veya yeni üreterek). PDF değilse null. */
export function getThumb(f: FileEntry): Promise<string | null> {
  if (f.kind !== "pdf") return Promise.resolve(null);
  const hit = urls.get(f.path);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(f.path);
  if (inflight) return inflight;

  const job = (async () => {
    const id = await sha1(`${f.path}|${f.size}|${f.modified}`);
    try {
      const buf = await invoke<ArrayBuffer>("read_thumb", { id });
      const url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
      urls.set(f.path, url);
      return url;
    } catch {
      // Diskte yok → sıraya girip üret
    }
    const run = queue.then(() => render(f, id).catch(() => null));
    queue = run;
    const url = await run;
    if (url) urls.set(f.path, url);
    return url;
  })();
  pending.set(f.path, job);
  job.finally(() => pending.delete(f.path));
  return job;
}
