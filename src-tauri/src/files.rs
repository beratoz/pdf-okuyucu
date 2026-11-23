use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::{DirEntry, WalkDir};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// Tam dosya yolu
    path: String,
    /// Dosya adı (uzantılı)
    name: String,
    /// "pdf" veya "md"
    kind: String,
    size: u64,
    /// Son değişiklik zamanı (ms)
    modified: u64,
    /// Seçilen klasöre göre alt klasör yolu ("" = kök)
    dir: String,
    /// Taramanın yapıldığı kök klasör
    root: String,
}

const MAX_FILES: usize = 20_000;

fn is_hidden(entry: &DirEntry) -> bool {
    entry.depth() > 0
        && entry
            .file_name()
            .to_str()
            .map(|s| s.starts_with('.') || s == "node_modules" || s == "$RECYCLE.BIN")
            .unwrap_or(false)
}

fn kind_of(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => Some("pdf"),
        "md" | "markdown" | "mdown" => Some("md"),
        _ => None,
    }
}

/// Klasörü alt klasörleriyle birlikte tarar ve PDF / Markdown dosyalarını döndürür.
#[tauri::command]
pub async fn scan_folder(path: String) -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&path);
        if !root.is_dir() {
            return Err(format!("Klasör bulunamadı: {path}"));
        }
        let mut out = Vec::new();
        for entry in WalkDir::new(root)
            .follow_links(false)
            .max_depth(12)
            .into_iter()
            .filter_entry(|e| !is_hidden(e))
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let p = entry.path();
            let Some(kind) = kind_of(p) else { continue };
            let meta = entry.metadata().ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let dir = p
                .parent()
                .and_then(|parent| parent.strip_prefix(root).ok())
                .map(|rel| rel.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            out.push(FileEntry {
                path: p.to_string_lossy().to_string(),
                name: entry.file_name().to_string_lossy().to_string(),
                kind: kind.to_string(),
                size,
                modified,
                dir,
                root: path.clone(),
            });
            if out.len() >= MAX_FILES {
                break;
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Güvenlik: arayüz yalnızca PDF ve Markdown dosyalarını okuyabilir; böylece arayüze
/// kötü amaçlı kod sızsa bile başka dosyalar (belgeler, anahtar dosyaları) okunamaz.
fn ensure_kind(path: &str, allowed: &[&str]) -> Result<(), String> {
    match kind_of(Path::new(path)) {
        Some(k) if allowed.contains(&k) => Ok(()),
        _ => Err("Yalnızca PDF ve Markdown dosyaları açılabilir".into()),
    }
}

/// Dosyayı ham bayt olarak döndürür (JS tarafında ArrayBuffer olarak gelir, hızlıdır).
#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    ensure_kind(&path, &["pdf"])?;
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Dosya okunamadı: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    ensure_kind(&path, &["md"])?;
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Dosya okunamadı: {e}"))?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[cfg(test)]
mod tests {
    use super::ensure_kind;

    #[test]
    fn only_pdf_and_markdown_can_be_read() {
        assert!(ensure_kind("C:\\Kitap\\a.PDF", &["pdf"]).is_ok());
        assert!(ensure_kind("C:\\Notlar\\b.md", &["md"]).is_ok());
        assert!(ensure_kind("C:\\Users\\x\\.ssh\\id_rsa", &["pdf"]).is_err());
        assert!(ensure_kind("C:\\gizli.txt", &["md"]).is_err());
        assert!(ensure_kind("C:\\Notlar\\b.md", &["pdf"]).is_err());
    }
}
