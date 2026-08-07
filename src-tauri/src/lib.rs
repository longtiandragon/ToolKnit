mod vault;

use tauri::Manager;
use vault::{AiActionRequest, AiProfileInput, ImportedSource, VaultService};

#[tauri::command]
fn init_vault(path: String) -> Result<vault::VaultInfo, String> {
    VaultService::open(path).map_err(|error| error.to_string())?.info().map_err(|error| error.to_string())
}

#[tauri::command]
fn import_source(vault_path: String, source_path: String) -> Result<ImportedSource, String> {
    VaultService::open(vault_path).map_err(|error| error.to_string())?.import_source(source_path).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_markdown(vault_path: String, id: String, kind: String, markdown: String) -> Result<(), String> {
    VaultService::open(vault_path).map_err(|error| error.to_string())?.save_markdown(id, kind, markdown).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_api_key(profile: AiProfileInput) -> Result<(), String> {
    VaultService::write_api_key(profile).map_err(|error| error.to_string())
}

#[tauri::command]
async fn run_ai_action(request: AiActionRequest) -> Result<String, String> {
    VaultService::run_ai_action(request).await.map_err(|error| error.to_string())
}

#[tauri::command]
fn create_backup(vault_path: String, output_path: String) -> Result<(), String> {
    VaultService::open(vault_path).map_err(|error| error.to_string())?.backup(output_path).map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let _ = app.handle().path().app_data_dir();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![init_vault, import_source, save_markdown, write_api_key, run_ai_action, create_backup])
        .run(tauri::generate_context!())
        .expect("error while running ToolKnit");
}
