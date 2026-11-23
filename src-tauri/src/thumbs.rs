//! PDF kapak görselleri (ilk sayfanın küçük JPEG'i) uygulamanın önbellek klasöründe saklanır.
//! Görsel arayüzde bir kez üretilir, sonraki açılışlarda diskten anında okunur.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const MAX_THUMB_BYTES: usize = 2_000_000;

fn valid_id(id: &str) -> Result<(), String> {
    if id.len() >= 16 && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("Geçersiz görsel kimliği".into())
    }
}

fn thumb_file(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    valid_id(id)?;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("kapaklar");
    Ok(dir.join(format!("{id}.jpg")))
}

/// Kayıtlı kapak görselini döndürür; yoksa hata verir (arayüz o zaman yenisini üretir).
#[tauri::command]
pub async fn read_thumb(app: AppHandle, id: String) -> Result<tauri::ipc::Response, String> {
    let path = thumb_file(&app, &id)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "yok".to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Arayüzde üretilen JPEG'i kaydeder. Gövde ham bayt, kimlik "x-thumb-id" başlığında gelir.
#[tauri::command]
pub async fn save_thumb(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let id = request
        .headers()
        .get("x-thumb-id")
        .and_then(|v| v.to_str().ok())
        .ok_or("Görsel kimliği eksik")?
        .to_string();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Ham görsel verisi bekleniyordu".into());
    };
    if bytes.is_empty() || bytes.len() > MAX_THUMB_BYTES {
        return Err("Görsel boyutu geçersiz".into());
    }
    let path = thumb_file(&app, &id)?;
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(path, bytes)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Görsel kaydedilemedi: {e}"))
}

#[cfg(test)]
mod tests {
    use super::valid_id;

    #[test]
    fn ids_must_be_hex() {
        assert!(valid_id("0123456789abcdef0123456789abcdef01234567").is_ok());
        assert!(valid_id("../../etc/passwd").is_err());
        assert!(valid_id("abc").is_err());
    }
}
