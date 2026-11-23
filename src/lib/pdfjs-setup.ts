// pdf.js kurulumu. pdf_viewer.mjs, kütüphaneyi globalThis.pdfjsLib üzerinden bekler;
// bu yüzden bu dosya viewer'dan ÖNCE içe aktarılmalıdır.
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
(globalThis as unknown as { pdfjsLib: typeof pdfjsLib }).pdfjsLib = pdfjsLib;

export { pdfjsLib };
