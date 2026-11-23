//! API anahtarları Windows Kimlik Bilgisi Yöneticisi'nde (Credential Manager) saklanır.
//! Anahtarlar arayüze hiçbir zaman geri gönderilmez; yalnızca Rust tarafında kullanılır.
//!
//! Güvenlik: Kullanıcının eklediği sağlayıcıların anahtarı, kaydedildiği adresin kökenine
//! (ör. https://api.deepseek.com) bağlanır. İstek başka bir adrese gidecekse anahtar
//! gönderilmez; adres değişirse anahtarın yeniden girilmesi gerekir. Böylece arayüze bir
//! şekilde kötü amaçlı kod sızsa bile anahtar yabancı bir sunucuya yönlendirilemez.
//! DeepL ve Gemini anahtarları zaten yalnızca koda gömülü resmi adreslerine gider.

use serde::{Deserialize, Serialize};

const SERVICE: &str = "com.okuyucu.pdf";

/// Kullanıcı sağlayıcıları için kasada saklanan kayıt
#[derive(Serialize, Deserialize)]
struct BoundKey {
    key: String,
    origin: String,
}

pub fn is_builtin(provider: &str) -> bool {
    matches!(provider, "deepl" | "gemini")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 48
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

fn account(provider: &str) -> Result<String, String> {
    match provider {
        // Yerleşik sağlayıcılar (eski sürümlerle aynı adlar)
        "deepl" => Ok("deepl-api-key".into()),
        "gemini" => Ok("gemini-api-key".into()),
        // Kullanıcının eklediği sağlayıcılar
        id if valid_id(id) => Ok(format!("provider-{id}-key")),
        _ => Err(format!("Geçersiz sağlayıcı kimliği: {provider}")),
    }
}

fn entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &account(provider)?).map_err(|e| e.to_string())
}

fn raw_secret(provider: &str) -> Option<String> {
    entry(provider)
        .ok()?
        .get_password()
        .ok()
        .filter(|k| !k.trim().is_empty())
}

/// Yerleşik sağlayıcıların (DeepL, Gemini) anahtarı
pub fn get_api_key(provider: &str) -> Option<String> {
    if !is_builtin(provider) {
        return None;
    }
    raw_secret(provider)
}

/// Kullanıcı sağlayıcısının anahtarı ve bağlı olduğu köken. Eski biçimde (kökensiz)
/// saklanmış bir anahtar güvenli sayılmaz ve yok kabul edilir.
pub fn get_bound_key(provider: &str) -> Option<(String, String)> {
    if is_builtin(provider) {
        return None;
    }
    let raw = raw_secret(provider)?;
    let b: BoundKey = serde_json::from_str(&raw).ok()?;
    Some((b.key, b.origin))
}

/// Anahtarı kaydeder. Kullanıcı sağlayıcıları için `origin_url` (sağlayıcının adresi)
/// zorunludur ve anahtar bu adresin kökenine bağlanır.
#[tauri::command]
pub fn set_api_key(provider: String, key: String, origin_url: Option<String>) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("Anahtar boş olamaz".into());
    }
    let value = if is_builtin(&provider) {
        key.to_string()
    } else {
        let url = origin_url.ok_or("Sağlayıcı adresi gerekli")?;
        let origin = crate::providers::origin_of(&url).map_err(|e| e.message)?;
        serde_json::to_string(&BoundKey { key: key.to_string(), origin }).map_err(|e| e.to_string())?
    };
    entry(&provider)?
        .set_password(&value)
        .map_err(|e| format!("Anahtar kaydedilemedi: {e}"))
}

#[tauri::command]
pub fn has_api_key(provider: String) -> bool {
    if is_builtin(&provider) {
        get_api_key(&provider).is_some()
    } else {
        get_bound_key(&provider).is_some()
    }
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    match entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{account, is_builtin, BoundKey};

    #[test]
    fn account_names() {
        assert_eq!(account("deepl").unwrap(), "deepl-api-key");
        assert_eq!(account("gemini").unwrap(), "gemini-api-key");
        assert_eq!(account("p_ab12").unwrap(), "provider-p_ab12-key");
        assert!(account("../kotu").is_err());
        assert!(account("").is_err());
        assert!(is_builtin("deepl") && is_builtin("gemini") && !is_builtin("p_ab12"));
    }

    #[test]
    fn legacy_plain_key_is_not_a_bound_key() {
        assert!(serde_json::from_str::<BoundKey>("sk-duz-metin").is_err());
        let b: BoundKey =
            serde_json::from_str(r#"{"key":"k","origin":"https://api.deepseek.com"}"#).unwrap();
        assert_eq!(b.origin, "https://api.deepseek.com");
    }
}
