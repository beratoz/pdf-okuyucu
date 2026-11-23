mod files;
mod providers;
mod secrets;
mod thumbs;
mod translate;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(translate::HttpClient::new())
        .invoke_handler(tauri::generate_handler![
            files::scan_folder,
            files::read_file_bytes,
            files::read_text_file,
            files::path_exists,
            secrets::set_api_key,
            secrets::has_api_key,
            secrets::delete_api_key,
            translate::translate_text,
            translate::deepl_usage,
            translate::list_gemini_models,
            providers::list_provider_models,
            thumbs::read_thumb,
            thumbs::save_thumb,
        ])
        .run(tauri::generate_context!())
        .expect("uygulama başlatılırken hata oluştu");
}
