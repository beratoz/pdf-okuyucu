//! Kullanıcının eklediği sağlayıcılar:
//! - "openai": OpenAI uyumlu Chat Completions API'si (DeepSeek, OpenRouter, Groq, Mistral,
//!   xAI, Together, yerelde Ollama / LM Studio ve benzerleri)
//! - "anthropic": Claude (Anthropic Messages API)

use crate::secrets::get_api_key;
use crate::translate::{
    clean_llm_output, instruction, short, user_prompt, TranslateError, TranslateRequest,
    TranslateResponse,
};
use serde::Serialize;
use serde_json::{json, Value};

const ANTHROPIC_BASE: &str = "https://api.anthropic.com";
const ANTHROPIC_VERSION: &str = "2026-10-21";

/// Kullanıcının girdiği adresi doğrular. Uzak adreslerde https zorunlu;
/// http yalnızca bu bilgisayarda çalışan sunucular (localhost) için kabul edilir.
pub fn validate_base_url(raw: &str) -> Result<String, TranslateError> {
    let trimmed = raw.trim().trim_end_matches('/');
    let url = reqwest::Url::parse(trimmed)
        .map_err(|_| TranslateError::new("other", "Sağlayıcı adresi geçersiz"))?;
    let host = url.host_str().unwrap_or_default();
    let local = matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1")
        || host.ends_with(".localhost");
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        _ => {
            return Err(TranslateError::new(
                "other",
                "Güvenlik için uzak adresler https:// ile başlamalı (http yalnızca localhost için)",
            ))
        }
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(TranslateError::new(
            "other",
            "Adrese kullanıcı adı / şifre yazmayın; anahtarı ayrı alana girin",
        ));
    }
    Ok(trimmed.to_string())
}

fn required_model(req: &TranslateRequest) -> Result<String, TranslateError> {
    req.model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(String::from)
        .ok_or_else(|| TranslateError::new("model", "Bu sağlayıcı için model seçilmemiş"))
}

fn key_of(req: &TranslateRequest) -> Option<String> {
    req.key_ref.as_deref().and_then(get_api_key)
}

// ---------------------------------------------------------------- OpenAI uyumlu

fn openai_error(status: u16, body: &str, name: &str, has_key: bool) -> TranslateError {
    match status {
        401 | 403 if !has_key => TranslateError::new("noKey", format!("{name}: anahtar gerekiyor")),
        401 | 403 => TranslateError::new("auth", format!("{name}: anahtar geçersiz veya yetkisiz")),
        402 => TranslateError::new("quota", format!("{name}: bakiye / kredi yetersiz")),
        429 => TranslateError::new("quota", format!("{name}: kota veya hız sınırı doldu")),
        404 => TranslateError::new("model", format!("{name}: model veya adres bulunamadı")),
        500..=599 => TranslateError::new("network", format!("{name}: sunucu hatası ({status})")),
        _ => TranslateError::new("other", format!("{name} hatası ({status}): {}", short(body))),
    }
}

/// "content" bazı servislerde düz metin, bazılarında parça dizisidir.
fn openai_content(v: &Value) -> String {
    let content = &v["choices"][0]["message"]["content"];
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    content
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| p["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

pub async fn openai_translate(
    client: &reqwest::Client,
    req: &TranslateRequest,
) -> Result<TranslateResponse, TranslateError> {
    let base = validate_base_url(
        req.base_url
            .as_deref()
            .ok_or_else(|| TranslateError::new("other", "Sağlayıcı adresi eksik"))?,
    )?;
    let model = required_model(req)?;
    let key = key_of(req);
    let name = req.engine.as_str();

    let mut with_temperature = true;
    let (status, text) = loop {
        let mut body = json!({
            "model": model,
            "messages": [
                { "role": "system", "content": instruction(&req.target_name) },
                { "role": "user", "content": user_prompt(req) },
            ],
            "stream": false,
        });
        if with_temperature {
            body["temperature"] = json!(0.2);
        }
        let mut rb = client.post(format!("{base}/chat/completions")).json(&body);
        if let Some(k) = &key {
            rb = rb.bearer_auth(k);
        }
        let res = rb.send().await?;
        let status = res.status().as_u16();
        let text = res.text().await?;
        // Bazı modeller (akıl yürütme modelleri) temperature kabul etmez → onsuz tekrar dene
        if status == 400 && with_temperature && text.to_ascii_lowercase().contains("temperature") {
            with_temperature = false;
            continue;
        }
        break (status, text);
    };
    if !(200..300).contains(&status) {
        return Err(openai_error(status, &text, name, key.is_some()));
    }
    let v: Value = serde_json::from_str(&text)
        .map_err(|_| TranslateError::new("other", format!("{name}: yanıt okunamadı")))?;
    let out = clean_llm_output(&openai_content(&v));
    if out.is_empty() {
        let reason = v["choices"][0]["finish_reason"].as_str().unwrap_or("bilinmiyor");
        return Err(TranslateError::new(
            if reason == "content_filter" { "blocked" } else { "other" },
            format!("{name} boş yanıt döndürdü ({reason})"),
        ));
    }
    Ok(TranslateResponse {
        text: out,
        engine: req.engine.clone(),
        model: Some(model),
        detected_source: None,
    })
}

// ---------------------------------------------------------------- Claude (Anthropic)

fn anthropic_error(status: u16, body: &str) -> TranslateError {
    let lower = body.to_ascii_lowercase();
    match status {
        401 => TranslateError::new("auth", "Claude anahtarı geçersiz"),
        403 => TranslateError::new("auth", "Claude: bu anahtarın yetkisi yok"),
        400 if lower.contains("credit balance") => {
            TranslateError::new("quota", "Claude: hesap bakiyesi yetersiz")
        }
        404 => TranslateError::new("model", "Claude: model bulunamadı"),
        429 => TranslateError::new("quota", "Claude: hız sınırı doldu, biraz bekleyin"),
        529 => TranslateError::new("network", "Claude şu an aşırı yoğun"),
        500..=599 => TranslateError::new("network", format!("Claude sunucu hatası ({status})")),
        _ => TranslateError::new("other", format!("Claude hatası ({status}): {}", short(body))),
    }
}

fn anthropic_base(req: &TranslateRequest) -> Result<String, TranslateError> {
    match req.base_url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(url) => validate_base_url(url),
        None => Ok(ANTHROPIC_BASE.to_string()),
    }
}

pub(crate) fn anthropic_body(req: &TranslateRequest, model: &str, with_effort: bool) -> Value {
    let mut body = json!({
        "model": model,
        "max_tokens": 8000,
        "system": instruction(&req.target_name),
        "messages": [{ "role": "user", "content": user_prompt(req) }],
    });
    if with_effort {
        // Kısa çevirilerde hızlı yanıt için düşük efor
        body["output_config"] = json!({ "effort": "low" });
    }
    body
}

pub async fn anthropic_translate(
    client: &reqwest::Client,
    req: &TranslateRequest,
) -> Result<TranslateResponse, TranslateError> {
    let base = anthropic_base(req)?;
    let model = required_model(req)?;
    let key = key_of(req).ok_or_else(|| TranslateError::new("noKey", "Claude anahtarı girilmemiş"))?;

    let mut with_effort = true;
    let (status, text) = loop {
        let res = client
            .post(format!("{base}/v1/messages"))
            .header("x-api-key", &key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .json(&anthropic_body(req, &model, with_effort))
            .send()
            .await?;
        let status = res.status().as_u16();
        let text = res.text().await?;
        // Eski modeller efor ayarını desteklemez → onsuz tekrar dene
        if status == 400 && with_effort {
            let lower = text.to_ascii_lowercase();
            if lower.contains("effort") || lower.contains("output_config") {
                with_effort = false;
                continue;
            }
        }
        break (status, text);
    };
    if !(200..300).contains(&status) {
        return Err(anthropic_error(status, &text));
    }
    let v: Value = serde_json::from_str(&text)
        .map_err(|_| TranslateError::new("other", "Claude yanıtı okunamadı"))?;
    if v["stop_reason"].as_str() == Some("refusal") {
        return Err(TranslateError::new("blocked", "Claude bu metni çevirmeyi reddetti"));
    }
    let out: String = v["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    let out = clean_llm_output(&out);
    if out.is_empty() {
        let reason = v["stop_reason"].as_str().unwrap_or("bilinmiyor");
        return Err(TranslateError::new("other", format!("Claude boş yanıt döndürdü ({reason})")));
    }
    Ok(TranslateResponse {
        text: out,
        engine: req.engine.clone(),
        model: Some(model),
        detected_source: None,
    })
}

// ---------------------------------------------------------------- Model listesi

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    id: String,
    display_name: String,
}

/// Sağlayıcının sunduğu modelleri listeler (bağlantı testi olarak da kullanılır).
#[tauri::command]
pub async fn list_provider_models(
    client: tauri::State<'_, crate::translate::HttpClient>,
    kind: String,
    key_ref: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<ProviderModel>, TranslateError> {
    let key = key_ref.as_deref().and_then(get_api_key);
    let (status, text) = match kind.as_str() {
        "openai" => {
            let base = validate_base_url(
                base_url
                    .as_deref()
                    .ok_or_else(|| TranslateError::new("other", "Sağlayıcı adresi eksik"))?,
            )?;
            let mut rb = client.0.get(format!("{base}/models"));
            if let Some(k) = &key {
                rb = rb.bearer_auth(k);
            }
            let res = rb.send().await?;
            (res.status().as_u16(), res.text().await?)
        }
        "anthropic" => {
            let base = match base_url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                Some(url) => validate_base_url(url)?,
                None => ANTHROPIC_BASE.to_string(),
            };
            let key = key
                .clone()
                .ok_or_else(|| TranslateError::new("noKey", "Claude anahtarı girilmemiş"))?;
            let res = client
                .0
                .get(format!("{base}/v1/models?limit=100"))
                .header("x-api-key", key)
                .header("anthropic-version", ANTHROPIC_VERSION)
                .send()
                .await?;
            (res.status().as_u16(), res.text().await?)
        }
        other => {
            return Err(TranslateError::new("other", format!("Bilinmeyen sağlayıcı türü: {other}")))
        }
    };
    if !(200..300).contains(&status) {
        return Err(if kind == "anthropic" {
            anthropic_error(status, &text)
        } else {
            openai_error(status, &text, "Sağlayıcı", key.is_some())
        });
    }
    let v: Value = serde_json::from_str(&text)
        .map_err(|_| TranslateError::new("other", "Model listesi okunamadı"))?;
    let mut models: Vec<ProviderModel> = v["data"]
        .as_array()
        .or_else(|| v["models"].as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let id = m["id"].as_str().or_else(|| m["name"].as_str())?.to_string();
                    let display_name = m["display_name"].as_str().unwrap_or(&id).to_string();
                    Some(ProviderModel { id, display_name })
                })
                .collect()
        })
        .unwrap_or_default();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_urls_must_be_https() {
        assert!(validate_base_url("https://api.deepseek.com/v1/").is_ok());
        assert_eq!(
            validate_base_url("https://api.deepseek.com/v1/").unwrap(),
            "https://api.deepseek.com/v1"
        );
        assert!(validate_base_url("http://localhost:11434/v1").is_ok());
        assert!(validate_base_url("http://127.0.0.1:1234/v1").is_ok());
        assert!(validate_base_url("http://evil.example.com/v1").is_err());
        assert!(validate_base_url("https://user:pass@example.com").is_err());
        assert!(validate_base_url("ftp://example.com").is_err());
        assert!(validate_base_url("bozuk adres").is_err());
    }

    #[test]
    fn openai_content_handles_string_and_parts() {
        let a: Value = json!({ "choices": [{ "message": { "content": "Merhaba" } }] });
        assert_eq!(openai_content(&a), "Merhaba");
        let b: Value = json!({ "choices": [{ "message": { "content": [
            { "type": "text", "text": "Mer" }, { "type": "text", "text": "haba" }
        ] } }] });
        assert_eq!(openai_content(&b), "Merhaba");
    }

    #[test]
    fn anthropic_body_shape() {
        let req = TranslateRequest::for_test("anthropic", "Hello");
        let body = anthropic_body(&req, "claude-opus-5-5", true);
        assert_eq!(body["model"], "claude-opus-5-5");
        assert!(body.get("temperature").is_none());
        assert_eq!(body["output_config"]["effort"], "low");
        assert!(body["system"].as_str().unwrap().contains("Turkish"));
        let no_effort = anthropic_body(&req, "claude-opus-5-5", false);
        assert!(no_effort.get("output_config").is_none());
    }

    #[test]
    fn errors_are_classified() {
        assert_eq!(openai_error(401, "", "X", false).kind, "noKey");
        assert_eq!(openai_error(401, "", "X", true).kind, "auth");
        assert_eq!(openai_error(402, "", "X", true).kind, "quota");
        assert_eq!(anthropic_error(429, "").kind, "quota");
        assert_eq!(anthropic_error(529, "").kind, "network");
        assert_eq!(anthropic_error(400, "Your credit balance is too low").kind, "quota");
    }
}
