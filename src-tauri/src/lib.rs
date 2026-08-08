mod vault;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{borrow::Cow, fs, path::Path, sync::{Arc, atomic::{AtomicBool, Ordering}}, thread, time::Duration};
use tauri::{Emitter, Manager, menu::{Menu, MenuItem}, tray::TrayIconBuilder};
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
fn delete_api_key(profile_id: String) -> Result<(), String> {
    VaultService::delete_api_key(profile_id).map_err(|error| error.to_string())
}

#[tauri::command]
async fn run_ai_action(request: AiActionRequest) -> Result<String, String> {
    VaultService::run_ai_action(request).await.map_err(|error| error.to_string())
}

#[tauri::command]
fn create_backup(vault_path: String, output_path: String) -> Result<(), String> {
    VaultService::open(vault_path).map_err(|error| error.to_string())?.backup(output_path).map_err(|error| error.to_string())
}

#[derive(Clone, Default)]
struct ClipboardMonitorState {
    enabled: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardPayload { kind: String, content: Option<String>, asset_path: Option<String>, hash: String }

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
struct GitHubRelease { tag_name: String, html_url: String, published_at: Option<String>, name: Option<String>, body: Option<String> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InputFilePayload { name: String, path: String, mime: String, size: u64, data: Vec<u8> }

fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

fn start_clipboard_monitor(app: tauri::AppHandle, state: ClipboardMonitorState) {
    thread::spawn(move || {
        let mut clipboard = match arboard::Clipboard::new() { Ok(value) => value, Err(_) => return };
        let mut last_hash = String::new();
        loop {
            if state.enabled.load(Ordering::Relaxed) && !state.paused.load(Ordering::Relaxed) {
                if let Ok(text) = clipboard.get_text() {
                    let hash = digest(text.as_bytes());
                    if !text.is_empty() && hash != last_hash {
                        last_hash = hash.clone();
                        let _ = app.emit("toolknit://clipboard", ClipboardPayload { kind: "text".into(), content: Some(text), asset_path: None, hash });
                    }
                } else if let Ok(image) = clipboard.get_image() {
                    let hash = digest(image.bytes.as_ref());
                    if hash != last_hash {
                        last_hash = hash.clone();
                        if let Ok(root) = app.path().app_data_dir() {
                            let directory = root.join("clipboard");
                            let path = directory.join(format!("{}.png", hash));
                            let _ = fs::create_dir_all(&directory);
                            let _ = image::save_buffer(
                                &path,
                                image.bytes.as_ref(),
                                image.width as u32,
                                image.height as u32,
                                image::ColorType::Rgba8,
                            );
                            let _ = app.emit("toolknit://clipboard", ClipboardPayload { kind: "image".into(), content: None, asset_path: Some(path.to_string_lossy().into_owned()), hash });
                        }
                    }
                }
            }
            thread::sleep(Duration::from_millis(900));
        }
    });
}

#[tauri::command]
fn set_clipboard_monitor(enabled: bool, paused: bool, state: tauri::State<'_, ClipboardMonitorState>) {
    state.enabled.store(enabled, Ordering::Relaxed);
    state.paused.store(paused, Ordering::Relaxed);
}

#[tauri::command]
fn copy_clipboard(kind: String, content: Option<String>, asset_path: Option<String>) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    if kind == "image" {
        let path = asset_path.ok_or("缺少图片资源路径")?;
        let image = image::open(path).map_err(|error| error.to_string())?.to_rgba8();
        let (width, height) = image.dimensions();
        clipboard.set_image(arboard::ImageData { width: width as usize, height: height as usize, bytes: Cow::Owned(image.into_raw()) }).map_err(|error| error.to_string())
    } else { clipboard.set_text(content.unwrap_or_default()).map_err(|error| error.to_string()) }
}

#[tauri::command]
fn copy_png_bytes(data: Vec<u8>) -> Result<(), String> {
    let image = image::load_from_memory_with_format(&data, image::ImageFormat::Png)
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let (width, height) = image.dimensions();
    arboard::Clipboard::new()
        .map_err(|error| error.to_string())?
        .set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::Owned(image.into_raw()),
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn cleanup_clipboard_assets(active_paths: Vec<String>, app: tauri::AppHandle) -> Result<(), String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?.join("clipboard");
    if !directory.exists() { return Ok(()); }
    let active: std::collections::HashSet<String> = active_paths.into_iter().collect();
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())?.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_file() && !active.contains(&path.to_string_lossy().into_owned()) { let _ = fs::remove_file(path); }
    }
    Ok(())
}

#[tauri::command]
fn save_output(output_dir: String, filename: String, data: Vec<u8>) -> Result<String, String> {
    let name = Path::new(&filename).file_name().ok_or("无效输出文件名")?;
    let directory = Path::new(&output_dir);
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let path = directory.join(name);
    fs::write(&path, data).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn copy_output_file(source: String, destination: String) -> Result<String, String> {
    let input = Path::new(&source);
    if !input.is_file() { return Err("原输出文件已不存在".into()); }
    let output = Path::new(&destination);
    if let Some(parent) = output.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    fs::copy(input, output).map_err(|error| error.to_string())?;
    Ok(output.to_string_lossy().into_owned())
}

#[tauri::command]
fn file_exists(path: String) -> bool { Path::new(&path).is_file() }

#[tauri::command]
fn read_input_file(path: String) -> Result<InputFilePayload, String> {
    let file = Path::new(&path);
    if !file.is_file() { return Err("拖入的路径不是文件".into()); }
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if metadata.len() > 250 * 1024 * 1024 { return Err("单个文件不能超过 250 MB".into()); }
    Ok(InputFilePayload { name: file.file_name().and_then(|value| value.to_str()).unwrap_or("file").to_string(), path: path.clone(), mime: mime_guess::from_path(file).first_or_octet_stream().to_string(), size: metadata.len(), data: fs::read(file).map_err(|error| error.to_string())? })
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() { return Err("文件已不存在".into()); }
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer.exe").arg("/select,").arg(&path).spawn().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn directory_size(path: String) -> u64 {
    walkdir::WalkDir::new(path).into_iter().filter_map(Result::ok).filter_map(|entry| entry.metadata().ok()).filter(|meta| meta.is_file()).map(|meta| meta.len()).sum()
}

#[tauri::command]
async fn check_github_update() -> Result<GitHubRelease, String> {
    reqwest::Client::new().get("https://api.github.com/repos/longtiandragon/ToolKnit/releases/latest").header("User-Agent", "ToolKnit").send().await.map_err(|error| error.to_string())?.error_for_status().map_err(|error| error.to_string())?.json().await.map_err(|error| error.to_string())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) { app.exit(0); }

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(ClipboardMonitorState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<ClipboardMonitorState>().inner().clone();
            start_clipboard_monitor(handle, state);
            let show = MenuItem::with_id(app, "show", "显示 ToolKnit", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "隐藏到托盘", true, None::<&str>)?;
            let clipboard = MenuItem::with_id(app, "clipboard", "暂停 / 继续剪贴板", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "彻底退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &clipboard, &settings, &quit])?;
            let mut tray = TrayIconBuilder::new().menu(&menu).show_menu_on_left_click(false).on_menu_event(|app, event| match event.id.as_ref() {
                "show" => if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus(); },
                "hide" => if let Some(window) = app.get_webview_window("main") { let _ = window.hide(); },
                "clipboard" => { let _ = app.emit("toolknit://tray-clipboard", ()); },
                "settings" => { if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); } let _ = app.emit("toolknit://tray-settings", ()); },
                "quit" => app.exit(0),
                _ => {}
            });
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            tray.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![init_vault, import_source, save_markdown, write_api_key, delete_api_key, run_ai_action, create_backup, set_clipboard_monitor, copy_clipboard, copy_png_bytes, cleanup_clipboard_assets, save_output, copy_output_file, file_exists, read_input_file, reveal_in_folder, directory_size, check_github_update, quit_app])
        .run(tauri::generate_context!())
        .expect("error while running ToolKnit");
}
