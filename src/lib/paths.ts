export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i >= 0 ? path.slice(0, i) : "";
}

export function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i >= 0 ? path.slice(i + 1) : path;
}

export function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\") || p.startsWith("/");
}

/** Göreli yolu (../resim.png gibi) temel klasöre göre çözümler. Windows ayracı kullanır. */
export function joinPath(base: string, rel: string): string {
  const parts = base.split(/[\\/]/).filter((x, i) => x !== "" || i === 0);
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 1) parts.pop();
    } else parts.push(seg);
  }
  return parts.join("\\");
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} saat önce`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} gün önce`;
  return new Date(ms).toLocaleDateString("tr-TR");
}
