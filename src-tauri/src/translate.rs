//! Çeviri servisleri: DeepL ve Google Gemini API (Gemini Flash + Gemma modelleri).
//! Ağ istekleri Rust tarafında yapılır: anahtarlar arayüze çıkmaz ve CORS sorunu olmaz.

use crate::secrets::get_api_key;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

pub struct HttpClient(pub(crate) reqwest::Client);

impl HttpClient {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(90))
            .user_agent("pdf-okuyucu/0.1")
            .build()
            .expect("HTTP istemcisi oluşturulamadı");
        Self(client)
    }
}

/// Arayüzün yedek motora geçip geçmeyeceğine karar verebilmesi için hata türü.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranslateError {
    /// "noKey" | "auth" | "quota" | "model" | "network" | "blocked" | "other"
    pub(crate) kind: &'static str,
    pub(crate) message: String,
}

impl TranslateError {
    pub(crate) fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

impl From<reqwest::Error> for TranslateError {
    fn from(e: reqwest::Error) -> Self {
        let msg = if e.is_timeout() {
            "Sunucu zamanında yanıt vermedi".to_string()
        } else if e.is_connect() {
            "Sunucuya bağlanılamadı (internet bağlantınızı kontrol edin)".to_string()
        } else {
            e.to_string()
        };
        TranslateError::new("network", msg)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateRequest {
    /// Sağlayıcı kimliği: "deepl", "gemini", "gemma" veya kullanıcının eklediği "p_..." kimliği
    pub(crate) engine: String,
    /// Sağlayıcı türü: "deepl" | "gemini" | "openai" | "anthropic"
    pub(crate) kind: Option<String>,
    /// Anahtarın kasadaki adı (ör. "deepl", "gemini", "p_ab12")
    pub(crate) key_ref: Option<String>,
    /// OpenAI uyumlu sağlayıcılar için adres (ör. "https://api.deepseek.com/v1")
    pub(crate) base_url: Option<String>,
    /// Model kimliği (ör. "gemini-flash-latest", "deepseek-chat", "claude-opus-5-5")
    pub(crate) model: Option<String>,
    pub(crate) text: String,
    /// Çevrilmeyecek, sadece anlamı netleştirmek için kullanılan çevre metin
    pub(crate) context: Option<String>,
    /// DeepL hedef dil kodu (örn. "TR", "EN-US")
    pub(crate) target_code: String,
    /// LLM'ler için hedef dil adı (örn. "Turkish")
    pub(crate) target_name: String,
}

#[cfg(test)]
impl TranslateRequest {
    pub(crate) fn for_test(kind: &str, text: &str) -> Self {
        Self {
            engine: kind.into(),
            kind: Some(kind.into()),
            key_ref: None,
            base_url: None,
            model: None,
            text: text.into(),
            context: Some("Hello world".into()),
            target_code: "TR".into(),
            target_name: "Turkish".into(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateResponse {
    pub(crate) text: String,
    pub(crate) engine: String,
    pub(crate) model: Option<String>,
    pub(crate) detected_source: Option<String>,
}

#[tauri::command]
pub async fn translate_text(
    client: tauri::State<'_, HttpClient>,
    req: TranslateRequest,
) -> Result<TranslateResponse, TranslateError> {
    if req.text.trim().is_empty() {
        return Err(TranslateError::new("other", "Çevrilecek metin boş"));
    }
    // Eski sürümlerle uyum: tür verilmediyse kimlikten çıkar
    let kind = req.kind.clone().unwrap_or_else(|| {
        if req.engine == "deepl" { "deepl" } else { "gemini" }.to_string()
    });
    // Güvenlik: yerleşik anahtarlar yalnızca kendi servislerinde kullanılabilir
    let key_ref = req.key_ref.as_deref();
    match kind.as_str() {
        "deepl" if key_ref.is_some_and(|k| k != "deepl") => {
            return Err(TranslateError::new("auth", "Geçersiz anahtar eşleşmesi"))
        }
        "gemini" if key_ref.is_some_and(|k| k != "gemini") => {
            return Err(TranslateError::new("auth", "Geçersiz anahtar eşleşmesi"))
        }
        _ => {}
    }
    match kind.as_str() {
        "deepl" => deepl_translate(&client.0, &req).await,
        "gemini" => gemini_translate(&client.0, &req).await,
        "openai" => crate::providers::openai_translate(&client.0, &req).await,
        "anthropic" => crate::providers::anthropic_translate(&client.0, &req).await,
        other => Err(TranslateError::new(
            "other",
            format!("Bilinmeyen sağlayıcı türü: {other}"),
        )),
    }
}

// ---------------------------------------------------------------- DeepL

fn deepl_base(key: &str) -> &'static str {
    // Ücretsiz anahtarlar ":fx" ile biter ve ayrı bir sunucu kullanır.
    if key.ends_with(":fx") {
        "https://api-free.deepl.com"
    } else {
        "https://api.deepl.com"
    }
}

fn deepl_error(status: u16, body: &str) -> TranslateError {
    match status {
        403 | 401 => TranslateError::new("auth", "DeepL anahtarı geçersiz"),
        456 => TranslateError::new("quota", "DeepL aylık karakter kotası doldu"),
        429 => TranslateError::new("quota", "DeepL çok fazla istek aldı, biraz bekleyin"),
        500..=599 => TranslateError::new("network", format!("DeepL sunucu hatası ({status})")),
        _ => TranslateError::new("other", format!("DeepL hatası ({status}): {}", short(body))),
    }
}

async fn deepl_translate(
    client: &reqwest::Client,
    req: &TranslateRequest,
) -> Result<TranslateResponse, TranslateError> {
    let key = get_api_key("deepl")
        .ok_or_else(|| TranslateError::new("noKey", "DeepL anahtarı girilmemiş"))?;
    let mut body = json!({
        "text": [req.text],
        "target_lang": req.target_code,
        "preserve_formatting": true,
    });
    if let Some(ctx) = req.context.as_ref().filter(|c| !c.trim().is_empty()) {
        // DeepL "context" alanı ücretlendirilmez ve kaliteyi artırır.
        body["context"] = json!(ctx);
    }
    let res = client
        .post(format!("{}/v2/translate", deepl_base(&key)))
        .header("Authorization", format!("DeepL-Auth-Key {key}"))
        .json(&body)
        .send()
        .await?;
    let status = res.status().as_u16();
    let text = res.text().await?;
    if !(200..300).contains(&status) {
        return Err(deepl_error(status, &text));
    }
    let v: Value = serde_json::from_str(&text)
        .map_err(|_| TranslateError::new("other", "DeepL yanıtı okunamadı"))?;
    let first = &v["translations"][0];
    let out = first["text"]
        .as_str()
        .ok_or_else(|| TranslateError::new("other", "DeepL boş yanıt döndürdü"))?;
    Ok(TranslateResponse {
        text: out.to_string(),
        engine: "deepl".into(),
        model: None,
        detected_source: first["detected_source_language"].as_str().map(String::from),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeeplUsage {
    character_count: u64,
    character_limit: u64,
}

#[tauri::command]
pub async fn deepl_usage(
    client: tauri::State<'_, HttpClient>,
) -> Result<DeeplUsage, TranslateError> {
    let key = get_api_key("deepl")
        .ok_or_else(|| TranslateError::new("noKey", "DeepL anahtarı girilmemiş"))?;
    let res = client
        .0
        .get(format!("{}/v2/usage", deepl_base(&key)))
        .header("Authorization", format!("DeepL-Auth-Key {key}"))
        .send()
        .await?;
    let status = res.status().as_u16();
    let text = res.text().await?;
    if !(200..300).contains(&status) {
        return Err(deepl_error(status, &text));
    }
    let v: Value = serde_json::from_str(&text)
        .map_err(|_| TranslateError::new("other", "DeepL yanıtı okunamadı"))?;
    Ok(DeeplUsage {
        character_count: v["character_count"].as_u64().unwrap_or(0),
        character_limit: v["character_limit"].as_u64().unwrap_or(0),
    })
}

// ---------------------------------------------------------------- Gemini / Gemma

const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";

pub(crate) fn instruction(target_name: &str) -> String {
    format!(
        "You are a professional translator. Translate the user's text into {target_name}.\n\
         Rules:\n\
         - Output ONLY the translation. No explanations, notes, quotes or preamble.\n\
         - Keep the meaning exact; do not add or omit information.\n\
         - Keep numbers, formulas, code, URLs, citations and proper names unchanged.\n\
         - Keep technical terms accurate; if a term is commonly left in English, keep it.\n\
         - Preserve paragraph breaks and list structure.\n\
         - The text was extracted from a PDF; ignore broken line breaks inside sentences.\n\
         - If CONTEXT is given, use it only to understand the text. Never translate or output the context."
    )
}

pub(crate) fn user_prompt(req: &TranslateRequest) -> String {
    match req.context.as_ref().filter(|c| !c.trim().is_empty()) {
        Some(ctx) => format!(
            "CONTEXT (do not translate):\n\"\"\"\n{ctx}\n\"\"\"\n\nTEXT TO TRANSLATE:\n\"\"\"\n{}\n\"\"\"",
            req.text
        ),
        None => format!("TEXT TO TRANSLATE:\n\"\"\"\n{}\n\"\"\"", req.text),
    }
}

fn thinking_config(model: &str) -> Option<Value> {
    let m = model.to_ascii_lowercase();
    if m.contains("gemma") {
        None
    } else if m.starts_with("gemini-2.5") {
        Some(json!({ "thinkingBudget": 0 }))
    } else if m.starts_with("gemini-2.0") || m.starts_with("gemini-1") {
        None
    } else {
        // Gemini 3 ve sonrası: düşünmeyi en aza indir → hızlı yanıt
        Some(json!({ "thinkingLevel": "minimal" }))
    }
}

fn build_gemini_body(req: &TranslateRequest, model: &str, with_thinking: bool) -> Value {
    let is_gemma = model.to_ascii_lowercase().contains("gemma");
    let mut generation = json!({ "temperature": 0.2 });
    if with_thinking {
        if let Some(t) = thinking_config(model) {
            generation["thinkingConfig"] = t;
        }
    }
    if is_gemma {
        // Gemma modelleri "systemInstruction" desteklemez; talimat mesajın başına eklenir.
        json!({
            "contents": [{
                "role": "user",
                "parts": [{ "text": format!("{}\n\n{}", instruction(&req.target_name), user_prompt(req)) }]
            }],
            "generationConfig": generation,
        })
    } else {
        json!({
            "systemInstruction": { "parts": [{ "text": instruction(&req.target_name) }] },
            "contents": [{ "role": "user", "parts": [{ "text": user_prompt(req) }] }],
            "generationConfig": generation,
        })
    }
}

fn gemini_error(status: u16, body: &str, model: &str) -> TranslateError {
    let lower = body.to_ascii_lowercase();
    match status {
        429 => TranslateError::new("quota", format!("{model}: ücretsiz kota/limit doldu")),
        400 if lower.contains("api_key_invalid") || lower.contains("api key not valid") => {
            TranslateError::new("auth", "Gemini anahtarı geçersiz")
        }
        401 | 403 => TranslateError::new("auth", format!("{model}: anahtar yetkisiz ({status})")),
        404 => TranslateError::new("model", format!("Model bulunamadı: {model}")),
        500..=599 => TranslateError::new("network", format!("{model}: sunucu hatası ({status})")),
        _ => TranslateError::new("other", format!("{model} hatası ({status}): {}", short(body))),
    }
}

async fn gemini_translate(
    client: &reqwest::Client,
    req: &TranslateRequest,
) -> Result<TranslateResponse, TranslateError> {
    let key = get_api_key("gemini")
        .ok_or_else(|| TranslateError::new("noKey", "Gemini anahtarı girilmemiş"))?;
    let default_model = if req.engine == "gemma" {
        "gemma-4-31b-it"
    } else {
        "gemini-flash-latest"
    };
    let model = req
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .unwrap_or(default_model)
        .trim_start_matches("models/")
        .to_string();
    let url = format!("{GEMINI_BASE}/models/{model}:generateContent");

    let mut with_thinking = true;
    let (status, text) = loop {
        let body = build_gemini_body(req, &model, with_thinking);
        let res = client
            .post(&url)
            .header("x-goog-api-key", &key)
            .json(&body)
            .send()
            .await?;
        let status = res.status().as_u16();
        let text = res.text().await?;
        // Bazı modeller düşünme ayarını kabul etmez → ayarsız tekrar dene.
        if status == 400 && with_thinking && text.to_ascii_lowercase().contains("thinking") {
            with_thinking = false;
            continue;
        }
        break (status, text);
    };
    if !(200..300).contains(&status) {
        return Err(gemini_error(status, &text, &model));
    }

    let v: Value = serde_json::from_str(&text)
        .map_err(|_| TranslateError::new("other", "Gemini yanıtı okunamadı"))?;
    if let Some(reason) = v["promptFeedback"]["blockReason"].as_str() {
        return Err(TranslateError::new(
            "blocked",
            format!("{model} bu metni çevirmeyi reddetti ({reason})"),
        ));
    }
    let candidate = &v["candidates"][0];
    let out: String = candidate["content"]["parts"]
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter(|p| !p["thought"].as_bool().unwrap_or(false))
                .filter_map(|p| p["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    let out = clean_llm_output(&out);
    if out.is_empty() {
        let reason = candidate["finishReason"].as_str().unwrap_or("bilinmiyor");
        return Err(TranslateError::new(
            if reason == "SAFETY" { "blocked" } else { "other" },
            format!("{model} boş yanıt döndürdü ({reason})"),
        ));
    }
    Ok(TranslateResponse {
        text: out,
        engine: req.engine.clone(),
        model: Some(model),
        detected_source: None,
    })
}

/// LLM bazen çeviriyi tırnak içine alır veya "Çeviri:" gibi bir önek ekler; bunları temizler.
pub(crate) fn clean_llm_output(s: &str) -> String {
    let mut t = s.trim().to_string();
    for wrap in ["\"\"\"", "```"] {
        if t.starts_with(wrap) && t.ends_with(wrap) && t.len() >= wrap.len() * 2 {
            t = t[wrap.len()..t.len() - wrap.len()].trim().to_string();
        }
    }
    for prefix in ["Çeviri:", "Translation:", "TRANSLATION:", "Türkçe çeviri:"] {
        if let Some(rest) = t.strip_prefix(prefix) {
            t = rest.trim().to_string();
        }
    }
    t
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    id: String,
    display_name: String,
}

/// Anahtarın erişebildiği, metin üretebilen modelleri listeler (anahtar testi olarak da kullanılır).
#[tauri::command]
pub async fn list_gemini_models(
    client: tauri::State<'_, HttpClient>,
) -> Result<Vec<ModelInfo>, TranslateError> {
    let key = get_api_key("gemini")
        .ok_or_else(|| TranslateError::new("noKey", "Gemini anahtarı girilmemiş"))?;
    let res = client
        .0
        .get(format!("{GEMINI_BASE}/models?pageSize=1000"))
        .header("x-goog-api-key", &key)
        .send()
        .await?;
    let status = res.status().as_u16();
    let text = res.text().await?;
    if !(200..300).contains(&status) {
        return Err(gemini_error(status, &text, "Gemini"));
    }
    let v: Value = serde_json::from_str(&text)
        .map_err(|_| TranslateError::new("other", "Model listesi okunamadı"))?;
    let models = v["models"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter(|m| {
                    m["supportedGenerationMethods"]
                        .as_array()
                        .map(|methods| methods.iter().any(|x| x == "generateContent"))
                        .unwrap_or(false)
                })
                .filter_map(|m| {
                    let id = m["name"].as_str()?.trim_start_matches("models/").to_string();
                    let display_name = m["displayName"].as_str().unwrap_or(&id).to_string();
                    Some(ModelInfo { id, display_name })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(models)
}

pub(crate) fn short(s: &str) -> String {
    let s = s.trim();
    let cut: String = s.chars().take(300).collect();
    if cut.len() < s.len() {
        format!("{cut}…")
    } else {
        cut
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_deepl_keys_use_free_endpoint() {
        assert_eq!(deepl_base("abc:fx"), "https://api-free.deepl.com");
        assert_eq!(deepl_base("abc"), "https://api.deepl.com");
    }

    #[test]
    fn llm_output_is_cleaned() {
        assert_eq!(clean_llm_output("Çeviri: Merhaba dünya"), "Merhaba dünya");
        assert_eq!(clean_llm_output("\"\"\"\nMerhaba\n\"\"\""), "Merhaba");
        assert_eq!(clean_llm_output("  Merhaba  "), "Merhaba");
    }

    #[test]
    fn thinking_config_per_model() {
        assert!(thinking_config("gemma-4-31b-it").is_none());
        assert_eq!(thinking_config("gemini-2.5-flash").unwrap()["thinkingBudget"], 0);
        assert_eq!(thinking_config("gemini-flash-latest").unwrap()["thinkingLevel"], "minimal");
    }

    #[test]
    fn gemma_body_has_no_system_instruction() {
        let mut req = TranslateRequest::for_test("gemini", "Hello");
        req.engine = "gemma".into();
        let body = build_gemini_body(&req, "gemma-4-31b-it", true);
        assert!(body.get("systemInstruction").is_none());
        assert!(body["generationConfig"].get("thinkingConfig").is_none());
        let text = body["contents"][0]["parts"][0]["text"].as_str().unwrap();
        assert!(text.contains("Turkish") && text.contains("CONTEXT") && text.contains("Hello"));
    }

    #[test]
    fn errors_are_classified() {
        assert_eq!(deepl_error(456, "").kind, "quota");
        assert_eq!(deepl_error(403, "").kind, "auth");
        assert_eq!(gemini_error(429, "", "m").kind, "quota");
        assert_eq!(gemini_error(400, "API_KEY_INVALID", "m").kind, "auth");
        assert_eq!(gemini_error(404, "", "m").kind, "model");
    }
}
