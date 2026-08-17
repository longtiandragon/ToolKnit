#[cfg(not(feature = "public-core"))]
mod private_tools;
mod archive_tools;
mod engine_registry;
mod file_health;
mod image_metadata;
mod pdf_tools;
mod transcription;
mod vault;
mod windows_ocr;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::ImageEncoder;
use notify::{RecursiveMode, Watcher};
use percent_encoding::percent_decode_str;
#[cfg(not(feature = "public-core"))]
use private_tools::{PrivateToolRunResult, PrivateToolRunState, PrivateToolsCatalog};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Cursor, Read, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc, Arc, LazyLock, Mutex, Once,
    },
    thread,
    time::{Duration, Instant},
};

type AiRequestCanceller = Arc<dyn Fn() + Send + Sync>;
static ACTIVE_AI_REQUESTS: LazyLock<Mutex<HashMap<String, AiRequestCanceller>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use transcription::{
    cancel_transcription, probe_transcription_engine, transcribe_media_file, TranscriptionState,
};
use vault::{
    AiActionRequest, AiProfileInput, ContentFavorite, ContentRecent, ImportedSource,
    ImportedVaultSource, VaultBackupInspection, VaultClipboardItem, VaultDocument, VaultEvent,
    VaultHealth, VaultHydration, VaultMarkdownAttachment, VaultMarkdownReconcile,
    VaultProcessingJob, VaultProcessingJobHydration, VaultQuestionAttachment, VaultRelation,
    VaultReviewAnalytics, VaultReviewCursor, VaultReviewGradeInput, VaultReviewGradeResult,
    VaultReviewHistoryEntry, VaultReviewQueuePage, VaultReviewQueueSummary, VaultReviewUndoInput,
    VaultSearchResult, VaultService, VaultSource, VaultVisualProject, VisualProjectImageInput,
    VisualProjectInput, VisualProjectSummary, VocabularyEntry, VocabularySummary,
};

fn default_vault_path(app: &tauri::AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|error| error.to_string())?;
    Ok(base.join("KnitspaceVault").to_string_lossy().into_owned())
}

#[tauri::command]
fn init_vault(path: String) -> Result<vault::VaultInfo, String> {
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .info()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_vault_health(app: tauri::AppHandle) -> Result<VaultHealth, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .and_then(|service| service.health())
        .map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageSpaceInfo {
    path: String,
    available_bytes: u64,
    total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowCapturePayload {
    path: String,
    name: String,
    width: u32,
    height: u32,
    captured_at: String,
    window_title: String,
}

fn bgra_to_rgba(mut pixels: Vec<u8>) -> Vec<u8> {
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
        pixel[3] = 255;
    }
    pixels
}

fn prune_capture_cache(directory: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut captures = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let is_capture = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("capture-") && name.ends_with(".png"));
            if !is_capture {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, path))
        })
        .collect::<Vec<_>>();
    captures.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    for (_, path) in captures.into_iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(windows)]
fn capture_foreground_window_pixels() -> Result<(Vec<u8>, u32, u32, String), String> {
    use windows_sys::Win32::{
        Foundation::RECT,
        Graphics::Gdi::{
            BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
            GetWindowDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
            DIB_RGB_COLORS, SRCCOPY,
        },
        UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
        },
    };

    let window = unsafe { GetForegroundWindow() };
    if window.is_null() {
        return Err("没有可采集的前台窗口。请先切换到目标窗口。".into());
    }
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(window, &mut rect) } == 0 {
        return Err(format!(
            "无法读取前台窗口范围：{}",
            std::io::Error::last_os_error()
        ));
    }
    let width = rect.right.saturating_sub(rect.left);
    let height = rect.bottom.saturating_sub(rect.top);
    let pixel_count = i64::from(width) * i64::from(height);
    if width <= 0 || height <= 0 || width > 16_384 || height > 16_384 || pixel_count > 64_000_000 {
        return Err(format!("前台窗口尺寸超出安全范围：{width} × {height}。"));
    }

    let title_length = unsafe { GetWindowTextLengthW(window) };
    let mut title_buffer = vec![0_u16; usize::try_from(title_length.max(0)).unwrap_or(0) + 1];
    let copied = unsafe {
        GetWindowTextW(
            window,
            title_buffer.as_mut_ptr(),
            i32::try_from(title_buffer.len()).unwrap_or(i32::MAX),
        )
    };
    let title = if copied > 0 {
        String::from_utf16_lossy(&title_buffer[..usize::try_from(copied).unwrap_or(0)])
    } else {
        "未命名前台窗口".into()
    };

    let window_dc = unsafe { GetWindowDC(window) };
    if window_dc.is_null() {
        return Err(format!(
            "无法打开前台窗口画面：{}",
            std::io::Error::last_os_error()
        ));
    }
    let memory_dc = unsafe { CreateCompatibleDC(window_dc) };
    if memory_dc.is_null() {
        unsafe { ReleaseDC(window, window_dc) };
        return Err(format!(
            "无法创建截图缓冲区：{}",
            std::io::Error::last_os_error()
        ));
    }
    let bitmap = unsafe { CreateCompatibleBitmap(window_dc, width, height) };
    if bitmap.is_null() {
        unsafe {
            DeleteDC(memory_dc);
            ReleaseDC(window, window_dc);
        }
        return Err(format!(
            "无法创建截图位图：{}",
            std::io::Error::last_os_error()
        ));
    }
    let previous = unsafe { SelectObject(memory_dc, bitmap) };

    let capture_result = (|| {
        if unsafe {
            BitBlt(
                memory_dc,
                0,
                0,
                width,
                height,
                window_dc,
                0,
                0,
                SRCCOPY | CAPTUREBLT,
            )
        } == 0
        {
            return Err(format!(
                "无法读取前台窗口像素：{}",
                std::io::Error::last_os_error()
            ));
        }
        let byte_count = usize::try_from(pixel_count)
            .ok()
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(|| "截图像素数量超出内存安全范围。".to_string())?;
        let mut pixels = vec![0_u8; byte_count];
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..Default::default()
            },
            ..Default::default()
        };
        let lines = unsafe {
            GetDIBits(
                memory_dc,
                bitmap,
                0,
                height as u32,
                pixels.as_mut_ptr().cast(),
                &mut info,
                DIB_RGB_COLORS,
            )
        };
        if lines != height {
            return Err(format!("截图像素读取不完整：{lines} / {height} 行。"));
        }
        Ok(bgra_to_rgba(pixels))
    })();

    unsafe {
        if !previous.is_null() {
            SelectObject(memory_dc, previous);
        }
        DeleteObject(bitmap);
        DeleteDC(memory_dc);
        ReleaseDC(window, window_dc);
    }
    capture_result.map(|pixels| (pixels, width as u32, height as u32, title))
}

#[cfg(not(windows))]
fn capture_foreground_window_pixels() -> Result<(Vec<u8>, u32, u32, String), String> {
    Err("当前版本的前台窗口采集仅支持 Windows。".into())
}

#[tauri::command]
fn capture_foreground_window(app: tauri::AppHandle) -> Result<WindowCapturePayload, String> {
    let (pixels, width, height, window_title) = capture_foreground_window_pixels()?;
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(&pixels, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|error| format!("无法编码窗口截图：{error}"))?;
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("scroll-captures");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let captured_at = chrono::Utc::now();
    let name = format!(
        "capture-{}-{}.png",
        captured_at.format("%Y%m%d-%H%M%S-%3f"),
        uuid::Uuid::now_v7()
    );
    let path = directory.join(&name);
    fs::write(&path, png).map_err(|error| format!("无法保存临时截图：{error}"))?;
    prune_capture_cache(&directory, 48);
    Ok(WindowCapturePayload {
        path: path.to_string_lossy().into_owned(),
        name,
        width,
        height,
        captured_at: captured_at.to_rfc3339(),
        window_title,
    })
}

#[cfg(test)]
mod window_capture_tests {
    use super::*;

    #[test]
    fn converts_windows_bgra_pixels_to_opaque_rgba() {
        assert_eq!(
            bgra_to_rgba(vec![30, 20, 10, 0, 90, 80, 70, 123]),
            vec![10, 20, 30, 255, 70, 80, 90, 255]
        );
    }

    #[test]
    fn capture_cache_pruning_is_bounded_and_ignores_other_files() {
        let directory = std::env::temp_dir().join(format!(
            "knitspace-window-capture-cache-{}",
            uuid::Uuid::now_v7()
        ));
        fs::create_dir_all(&directory).unwrap();
        for index in 0..5 {
            fs::write(
                directory.join(format!("capture-{index}.png")),
                [index as u8],
            )
            .unwrap();
        }
        fs::write(directory.join("keep-me.txt"), b"safe").unwrap();
        prune_capture_cache(&directory, 2);
        let capture_count = fs::read_dir(&directory)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.starts_with("capture-") && name.ends_with(".png"))
            })
            .count();
        assert_eq!(capture_count, 2);
        assert!(directory.join("keep-me.txt").is_file());
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "opens a short-lived visible Windows smoke-test window"]
    fn captures_a_real_visible_window() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, SetForegroundWindow, ShowWindow, SW_SHOW,
            WS_OVERLAPPEDWINDOW, WS_VISIBLE,
        };

        let class = "STATIC\0".encode_utf16().collect::<Vec<_>>();
        let title = "Knitspace Capture Smoke Test\0"
            .encode_utf16()
            .collect::<Vec<_>>();
        let window = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                80,
                80,
                640,
                480,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        assert!(!window.is_null(), "failed to create smoke-test window");
        unsafe {
            ShowWindow(window, SW_SHOW);
            SetForegroundWindow(window);
        }
        std::thread::sleep(Duration::from_millis(160));
        let captured = capture_foreground_window_pixels();
        unsafe { DestroyWindow(window) };

        let (pixels, width, height, captured_title) = captured.unwrap();
        assert!(width >= 600 && height >= 400);
        assert_eq!(pixels.len(), width as usize * height as usize * 4);
        assert!(!captured_title.trim().is_empty());
    }
}

fn existing_storage_probe_path(path: &Path) -> Result<PathBuf, String> {
    let mut candidate = path.to_path_buf();
    while !candidate.exists() {
        if !candidate.pop() {
            return Err("找不到可检查的资料库磁盘。".into());
        }
    }
    if candidate.is_file() {
        candidate.pop();
    }
    if !candidate.is_dir() {
        return Err("资料库所在位置不是有效目录。".into());
    }
    Ok(candidate)
}

#[cfg(windows)]
fn storage_space_for_path(path: &Path) -> Result<(u64, u64), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let probe = existing_storage_probe_path(path)?;
    let wide = probe
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut available = 0_u64;
    let mut total = 0_u64;
    let mut total_free = 0_u64;
    let succeeded =
        unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, &mut total, &mut total_free) };
    if succeeded == 0 {
        return Err(format!(
            "无法读取资料库磁盘空间：{}",
            std::io::Error::last_os_error()
        ));
    }
    Ok((available, total))
}

#[cfg(not(windows))]
fn storage_space_for_path(path: &Path) -> Result<(u64, u64), String> {
    let _ = existing_storage_probe_path(path)?;
    Err("当前平台尚未提供资料库磁盘空间探针。".into())
}

#[tauri::command]
fn get_default_vault_storage_space(app: tauri::AppHandle) -> Result<StorageSpaceInfo, String> {
    let path = PathBuf::from(default_vault_path(&app)?);
    let (available_bytes, total_bytes) = storage_space_for_path(&path)?;
    Ok(StorageSpaceInfo {
        path: path.to_string_lossy().into_owned(),
        available_bytes,
        total_bytes,
    })
}

#[tauri::command]
fn import_source(vault_path: String, source_path: String) -> Result<ImportedSource, String> {
    VaultService::open(vault_path)
        .map_err(|error| error.to_string())?
        .import_source(source_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_markdown(
    vault_path: String,
    id: String,
    kind: String,
    markdown: String,
) -> Result<(), String> {
    VaultService::open(vault_path)
        .map_err(|error| error.to_string())?
        .save_markdown(id, kind, markdown)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn hydrate_default_vault(
    app: tauri::AppHandle,
    browser_documents: Vec<VaultDocument>,
    browser_vocabulary: Vec<VocabularyEntry>,
    browser_relations: Vec<VaultRelation>,
) -> Result<VaultHydration, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .hydrate_documents(browser_documents, browser_vocabulary, browser_relations)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn hydrate_default_sources(
    app: tauri::AppHandle,
    browser_sources: Vec<VaultSource>,
) -> Result<Vec<VaultSource>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .hydrate_sources(browser_sources)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn hydrate_default_content_favorites(
    app: tauri::AppHandle,
    browser_favorites: Vec<ContentFavorite>,
) -> Result<Vec<ContentFavorite>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .hydrate_content_favorites(browser_favorites)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_default_content_favorite(
    app: tauri::AppHandle,
    item_id: String,
    item_kind: String,
    favorite: bool,
) -> Result<Option<ContentFavorite>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .set_content_favorite(item_id, item_kind, favorite)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn replace_default_content_favorites(
    app: tauri::AppHandle,
    favorites: Vec<ContentFavorite>,
) -> Result<Vec<ContentFavorite>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .replace_content_favorites(favorites)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn hydrate_default_content_recents(
    app: tauri::AppHandle,
    browser_recents: Vec<ContentRecent>,
) -> Result<Vec<ContentRecent>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .hydrate_content_recents(browser_recents)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn touch_default_content_recent(
    app: tauri::AppHandle,
    item_id: String,
    item_kind: String,
) -> Result<ContentRecent, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .touch_content_recent(item_id, item_kind)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_default_content_recent(
    app: tauri::AppHandle,
    item_id: String,
    item_kind: String,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .remove_content_recent(item_id, item_kind)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_default_content_recents(app: tauri::AppHandle) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .clear_content_recents()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn replace_default_content_recents(
    app: tauri::AppHandle,
    recents: Vec<ContentRecent>,
) -> Result<Vec<ContentRecent>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .replace_content_recents(recents)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn import_default_source(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<ImportedVaultSource, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .import_source_record(source_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn automatic_default_vault_backup(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = default_vault_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        VaultService::open(path)
            .and_then(|service| service.automatic_backup())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("自动备份任务失败：{error}"))?
}

/// Manual archives deliberately receive only an output path from the renderer.
/// The Vault root always comes from the app, which prevents an arbitrary
/// directory from being zipped through this user-facing command.
#[tauri::command]
async fn create_default_vault_backup(
    app: tauri::AppHandle,
    output_path: String,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        VaultService::open(path)
            .and_then(|service| service.backup(output_path))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("完整归档任务失败：{error}"))?
}

#[tauri::command]
async fn restore_default_vault_backup(
    app: tauri::AppHandle,
    archive_path: String,
) -> Result<String, String> {
    let path = default_vault_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        VaultService::open(path)
            .and_then(|service| service.restore_backup(archive_path))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("完整恢复任务失败：{error}"))?
}

#[tauri::command]
async fn inspect_default_vault_backup(
    app: tauri::AppHandle,
    archive_path: String,
) -> Result<VaultBackupInspection, String> {
    let path = default_vault_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        VaultService::open(path)
            .and_then(|service| service.inspect_backup(archive_path))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("完整归档检查任务失败：{error}"))?
}

#[tauri::command]
async fn create_zip_archive(
    input_paths: Vec<String>,
    output_path: String,
) -> Result<archive_tools::ArchiveOperationSummary, String> {
    tauri::async_runtime::spawn_blocking(move || archive_tools::create_zip(input_paths, output_path).map_err(|error| error.to_string()))
        .await
        .map_err(|error| format!("ZIP 创建任务失败：{error}"))?
}

#[tauri::command]
async fn list_zip_archive(archive_path: String) -> Result<archive_tools::ArchiveListing, String> {
    tauri::async_runtime::spawn_blocking(move || archive_tools::list_zip(archive_path).map_err(|error| error.to_string()))
        .await
        .map_err(|error| format!("ZIP 检查任务失败：{error}"))?
}

#[tauri::command]
async fn extract_zip_archive(
    archive_path: String,
    output_directory: String,
) -> Result<archive_tools::ArchiveOperationSummary, String> {
    tauri::async_runtime::spawn_blocking(move || archive_tools::extract_zip(archive_path, output_directory).map_err(|error| error.to_string()))
        .await
        .map_err(|error| format!("ZIP 解压任务失败：{error}"))?
}

#[tauri::command]
async fn create_tar_archive(
    input_paths: Vec<String>,
    output_path: String,
    gzip: bool,
) -> Result<archive_tools::ArchiveOperationSummary, String> {
    tauri::async_runtime::spawn_blocking(move || archive_tools::create_tar(input_paths, output_path, gzip).map_err(|error| error.to_string()))
        .await
        .map_err(|error| format!("TAR 创建任务失败：{error}"))?
}

#[tauri::command]
async fn list_tar_archive(archive_path: String) -> Result<archive_tools::ArchiveListing, String> {
    tauri::async_runtime::spawn_blocking(move || archive_tools::list_tar(archive_path).map_err(|error| error.to_string()))
        .await
        .map_err(|error| format!("TAR 检查任务失败：{error}"))?
}

#[tauri::command]
async fn extract_tar_archive(
    archive_path: String,
    output_directory: String,
) -> Result<archive_tools::ArchiveOperationSummary, String> {
    tauri::async_runtime::spawn_blocking(move || archive_tools::extract_tar(archive_path, output_directory).map_err(|error| error.to_string()))
        .await
        .map_err(|error| format!("TAR 解压任务失败：{error}"))?
}

#[tauri::command]
async fn seven_zip_engine_status() -> archive_tools::SevenZipEngineStatus {
    tauri::async_runtime::spawn_blocking(archive_tools::seven_zip_engine_status)
        .await
        .unwrap_or(archive_tools::SevenZipEngineStatus {
            available: false,
            executable: None,
            version: None,
        })
}

#[tauri::command]
async fn engine_registry_status() -> Vec<engine_registry::EngineStatus> {
    tauri::async_runtime::spawn_blocking(engine_registry::list_engine_statuses)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn create_seven_zip_archive(
    input_paths: Vec<String>,
    output_path: String,
) -> Result<archive_tools::ArchiveOperationSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        archive_tools::create_seven_zip(input_paths, output_path).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("7z 创建任务失败：{error}"))?
}

#[tauri::command]
async fn list_seven_zip_archive(archive_path: String) -> Result<archive_tools::ArchiveListing, String> {
    tauri::async_runtime::spawn_blocking(move || {
        archive_tools::list_seven_zip(archive_path).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("7z 检查任务失败：{error}"))?
}

#[tauri::command]
async fn extract_seven_zip_archive(
    archive_path: String,
    output_directory: String,
) -> Result<archive_tools::ArchiveOperationSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        archive_tools::extract_seven_zip(archive_path, output_directory)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("7z 解压任务失败：{error}"))?
}

#[tauri::command]
fn save_default_source(app: tauri::AppHandle, source: VaultSource) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .save_source(source)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_source(app: tauri::AppHandle, id: String) -> Result<VaultSource, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .get_source(id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn touch_default_source(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .touch_source(id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_default_source_tags(
    app: tauri::AppHandle,
    id: String,
    tags: Vec<String>,
) -> Result<Vec<String>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .save_source_tags(id, tags)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_default_source_crops(
    app: tauri::AppHandle,
    id: String,
    crops: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .save_source_crops(id, crops)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_source_crop(
    app: tauri::AppHandle,
    id: String,
    crop_id: String,
) -> Result<Option<String>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .get_source_crop(id, crop_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_default_vault_document(
    app: tauri::AppHandle,
    document: VaultDocument,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .save_document(document)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_default_question_batch(
    app: tauri::AppHandle,
    documents: Vec<VaultDocument>,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .save_question_batch(documents)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_vault_document(app: tauri::AppHandle, id: String) -> Result<VaultDocument, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .get_document(id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn reconcile_default_vault_markdown(
    app: tauri::AppHandle,
    id: String,
) -> Result<VaultMarkdownReconcile, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .reconcile_document_markdown(id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_default_document_versions(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<Vec<vault::VaultDocumentVersionSummary>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .list_document_versions(document_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_document_version(
    app: tauri::AppHandle,
    document_id: String,
    version_id: String,
) -> Result<VaultDocument, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .get_document_version(document_id, version_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn preserve_default_document_version(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .preserve_current_document_version(document_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_default_editor_crash_draft(
    app: tauri::AppHandle,
    kind: String,
    entity_id: String,
    base_updated_at: String,
    payload_json: String,
) -> Result<vault::EditorCrashDraft, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .save_editor_crash_draft(kind, entity_id, base_updated_at, payload_json)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_editor_crash_draft(
    app: tauri::AppHandle,
    kind: String,
    entity_id: String,
) -> Result<Option<vault::EditorCrashDraft>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .get_editor_crash_draft(kind, entity_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_default_editor_crash_draft(
    app: tauri::AppHandle,
    kind: String,
    entity_id: String,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .delete_editor_crash_draft(kind, entity_id)
        .map_err(|error| error.to_string())
}

/// Full-document export is intentionally explicit. Normal startup receives
/// summaries only, while a user-requested JSON backup receives every body.
#[tauri::command]
fn export_default_vault_documents(app: tauri::AppHandle) -> Result<Vec<VaultDocument>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .list_documents()
        .map_err(|error| error.to_string())
}

/// Manual backup is an explicit heavy operation. Unlike startup hydration it
/// includes every word form, sense, example, collocation and review state.
#[tauri::command]
fn export_default_vocabulary(app: tauri::AppHandle) -> Result<Vec<VocabularyEntry>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .list_vocabulary()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_default_vault_document(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .delete_document(id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_default_question_attachments(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<Vec<VaultQuestionAttachment>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .list_question_attachments(document_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn import_default_question_attachment(
    app: tauri::AppHandle,
    document_id: String,
    source_path: String,
) -> Result<VaultQuestionAttachment, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .import_question_attachment(document_id, source_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn resolve_default_question_attachment(
    app: tauri::AppHandle,
    document_id: String,
    attachment_id: String,
) -> Result<String, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .question_attachment_path(document_id, attachment_id)
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_default_question_attachment(
    app: tauri::AppHandle,
    document_id: String,
    attachment_id: String,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .delete_question_attachment(document_id, attachment_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn stage_default_visual_project_image(
    request: tauri::ipc::Request<'_>,
    app: tauri::AppHandle,
) -> Result<VisualProjectImageInput, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("画布源图传输格式无效".into());
    };
    let project_id = request
        .headers()
        .get("x-knitspace-project-id")
        .and_then(|value| value.to_str().ok())
        .ok_or("画布项目 ID 缺失")?;
    let encoded_name = request
        .headers()
        .get("x-knitspace-file-name")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("canvas-image");
    let name = percent_decode_str(encoded_name)
        .decode_utf8()
        .map(Cow::into_owned)
        .unwrap_or_else(|_| "canvas-image".into());
    let mime = request
        .headers()
        .get("x-knitspace-file-mime")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream");
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .and_then(|service| service.stage_visual_project_image(project_id, &name, mime, data))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_default_visual_project(
    app: tauri::AppHandle,
    project: VisualProjectInput,
) -> Result<VaultVisualProject, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .and_then(|service| service.save_visual_project(project))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_default_visual_projects(
    app: tauri::AppHandle,
    limit: usize,
) -> Result<Vec<VisualProjectSummary>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .and_then(|service| service.list_visual_projects(limit))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_visual_project(
    app: tauri::AppHandle,
    id: String,
) -> Result<VaultVisualProject, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .and_then(|service| service.get_visual_project(id))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_default_visual_project(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .and_then(|service| service.delete_visual_project(id))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn replace_default_vault_documents(
    app: tauri::AppHandle,
    documents: Vec<VaultDocument>,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .replace_documents(documents)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn search_default_vault_documents(
    app: tauri::AppHandle,
    query: String,
) -> Result<Vec<VaultSearchResult>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .search_documents(query, 12)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn search_default_vocabulary(
    app: tauri::AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<VocabularySummary>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .search_vocabulary_summaries(query, limit.unwrap_or(120))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn find_default_wiki_backlinks(
    app: tauri::AppHandle,
    target_title: String,
    exclude_id: String,
) -> Result<Vec<VaultSearchResult>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .find_wiki_backlinks(target_title, exclude_id, 30)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_default_wiki_links(
    app: tauri::AppHandle,
    limit: usize,
) -> Result<vault::VaultWikiLinkProjection, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .list_wiki_links(limit)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_default_vocabulary(app: tauri::AppHandle, entry: VocabularyEntry) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .save_vocabulary(entry)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_default_vocabulary_batch(
    app: tauri::AppHandle,
    entries: Vec<VocabularyEntry>,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .save_vocabulary_batch(entries)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_vocabulary(app: tauri::AppHandle, id: String) -> Result<VocabularyEntry, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .get_vocabulary(id)
        .map_err(|error| error.to_string())
}

/// Returns only compact card pointers. The selected question or word is read
/// through its single-entity command, keeping a large review library out of
/// renderer startup and Pinia scans.
#[tauri::command]
fn list_default_due_review_cards(
    app: tauri::AppHandle,
    as_of: Option<String>,
    limit: Option<usize>,
    cursor: Option<VaultReviewCursor>,
    review_kind: Option<String>,
) -> Result<VaultReviewQueuePage, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .list_due_review_cards(as_of, limit.unwrap_or(100), cursor, review_kind)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_review_queue_summary(
    app: tauri::AppHandle,
    as_of: Option<String>,
) -> Result<VaultReviewQueueSummary, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .review_queue_summary(as_of)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn grade_default_review_card(
    app: tauri::AppHandle,
    input: VaultReviewGradeInput,
) -> Result<VaultReviewGradeResult, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .grade_review_card(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn undo_default_review_grade(
    app: tauri::AppHandle,
    input: VaultReviewUndoInput,
) -> Result<VaultReviewGradeResult, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .undo_review_grade(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_default_review_history(
    app: tauri::AppHandle,
    card_id: String,
    limit: Option<usize>,
) -> Result<Vec<VaultReviewHistoryEntry>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .list_review_history(card_id, limit.unwrap_or(50))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_review_analytics(
    app: tauri::AppHandle,
    as_of: Option<String>,
    utc_offset_minutes: i32,
) -> Result<VaultReviewAnalytics, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .review_analytics(as_of, utc_offset_minutes)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_default_vocabulary(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .delete_vocabulary(id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn replace_default_vocabulary(
    app: tauri::AppHandle,
    entries: Vec<VocabularyEntry>,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .replace_vocabulary(entries)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_default_relation(app: tauri::AppHandle, relation: VaultRelation) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .save_relation(relation)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_default_relation(app: tauri::AppHandle, relation: VaultRelation) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .delete_relation(relation)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn replace_default_relations(
    app: tauri::AppHandle,
    relations: Vec<VaultRelation>,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .replace_relations(relations)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_default_events(
    app: tauri::AppHandle,
    limit: Option<usize>,
) -> Result<Vec<VaultEvent>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .list_events(limit.unwrap_or(80))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_default_personal_events(
    app: tauri::AppHandle,
    limit_per_type: Option<usize>,
) -> Result<Vec<VaultEvent>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .list_personal_events(limit_per_type.unwrap_or(120))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_default_focus_events(
    app: tauri::AppHandle,
    limit: Option<usize>,
    before_starts_at: Option<String>,
    before_updated_at: Option<String>,
    before_id: Option<String>,
) -> Result<Vec<VaultEvent>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .list_focus_events(
            limit.unwrap_or(120),
            before_starts_at,
            before_updated_at,
            before_id,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_focus_analytics(
    app: tauri::AppHandle,
    as_of: Option<String>,
    utc_offset_minutes: i32,
) -> Result<vault::VaultFocusAnalytics, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .focus_analytics(as_of, utc_offset_minutes)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_default_activity_events(
    app: tauri::AppHandle,
    limit: Option<usize>,
    before_starts_at: Option<String>,
    before_updated_at: Option<String>,
    before_id: Option<String>,
) -> Result<Vec<VaultEvent>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .list_activity_events(
            limit.unwrap_or(80),
            before_starts_at,
            before_updated_at,
            before_id,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_default_event(app: tauri::AppHandle, event: VaultEvent) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .save_event(event)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn import_default_legacy_events(
    app: tauri::AppHandle,
    events: Vec<VaultEvent>,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .import_legacy_events(events)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn replace_default_activity_events(
    app: tauri::AppHandle,
    events: Vec<VaultEvent>,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .replace_activity_events(events)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_default_event(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .delete_event(id)
        .map_err(|error| error.to_string())
}

/// Imports the renderer prototype's bounded task snapshot once. Existing
/// native rows win on ID conflicts and the Rust side archives the original
/// payload before writing the migration marker.
#[tauri::command]
fn hydrate_default_processing_jobs(
    app: tauri::AppHandle,
    browser_jobs: Vec<VaultProcessingJob>,
) -> Result<VaultProcessingJobHydration, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .hydrate_processing_jobs(browser_jobs)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_default_processing_jobs(
    app: tauri::AppHandle,
    limit: Option<usize>,
    before_created_at: Option<String>,
    before_id: Option<String>,
    status: Option<String>,
    kind: Option<String>,
) -> Result<Vec<VaultProcessingJob>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .list_processing_jobs(
            limit.unwrap_or(100),
            before_created_at,
            before_id,
            status,
            kind,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_processing_job(
    app: tauri::AppHandle,
    id: String,
) -> Result<VaultProcessingJob, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .get_processing_job(id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_default_processing_job(
    app: tauri::AppHandle,
    job: VaultProcessingJob,
) -> Result<VaultProcessingJob, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .save_processing_job(job)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_default_processing_job(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .delete_processing_job(id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_default_processing_jobs(
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<usize, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .delete_processing_jobs(ids)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_default_finished_processing_jobs(app: tauri::AppHandle) -> Result<usize, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .clear_finished_processing_jobs()
        .map_err(|error| error.to_string())
}

/// Clipboard history has a separate SQLite table because it is high-churn and
/// may contain long code. The browser snapshot is imported once, then the
/// renderer only receives bounded text previews at startup.
#[tauri::command]
fn hydrate_default_clipboard(
    app: tauri::AppHandle,
    browser_items: Vec<VaultClipboardItem>,
    limit: usize,
    retention_days: i64,
) -> Result<Vec<VaultClipboardItem>, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .hydrate_clipboard_items(browser_items, limit, retention_days)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_default_clipboard_item(
    app: tauri::AppHandle,
    id: String,
) -> Result<VaultClipboardItem, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .get_clipboard_item(id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_default_clipboard_item(
    app: tauri::AppHandle,
    item: VaultClipboardItem,
) -> Result<VaultClipboardItem, String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .save_clipboard_item(item)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_default_clipboard_item_pinned(
    app: tauri::AppHandle,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .set_clipboard_item_pinned(id, pinned)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_default_clipboard_item(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .delete_clipboard_item(id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_default_clipboard_items(app: tauri::AppHandle) -> Result<(), String> {
    let path = default_vault_path(&app)?;
    VaultService::open(path)
        .map_err(|error| error.to_string())?
        .clear_unpinned_clipboard_items()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn write_api_key(profile: AiProfileInput) -> Result<(), String> {
    VaultService::write_api_key(profile).map_err(|error| error.to_string())
}

#[tauri::command]
fn has_api_key(profile_id: String) -> Result<bool, String> {
    VaultService::has_api_key(profile_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_api_key(profile_id: String) -> Result<(), String> {
    VaultService::delete_api_key(profile_id).map_err(|error| error.to_string())
}

#[tauri::command]
async fn run_ai_action(request_id: String, request: AiActionRequest) -> Result<String, String> {
    if request_id.trim().is_empty() {
        return Err("AI 请求 ID 不能为空".to_owned());
    }
    let task = tauri::async_runtime::spawn(async move {
        VaultService::run_ai_action(request)
            .await
            .map_err(|error| error.to_string())
    });
    let abort_handle = task.inner().abort_handle();
    let canceller: AiRequestCanceller = Arc::new(move || abort_handle.abort());
    ACTIVE_AI_REQUESTS
        .lock()
        .map_err(|_| "AI 请求状态暂时不可用".to_owned())?
        .insert(request_id.clone(), canceller);
    let outcome = task.await;
    ACTIVE_AI_REQUESTS
        .lock()
        .map_err(|_| "AI 请求状态暂时不可用".to_owned())?
        .remove(&request_id);
    match outcome {
        Ok(result) => result,
        Err(tauri::Error::JoinError(error)) if error.is_cancelled() => {
            Err("AI 请求已取消。".to_owned())
        }
        Err(error) => Err(format!("AI 请求任务异常：{error}")),
    }
}

#[tauri::command]
fn cancel_ai_action(request_id: String) -> Result<bool, String> {
    let canceller = ACTIVE_AI_REQUESTS
        .lock()
        .map_err(|_| "AI 请求状态暂时不可用".to_owned())?
        .remove(&request_id);
    if let Some(cancel) = canceller {
        cancel();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
#[cfg(not(feature = "public-core"))]
fn load_private_tools(manifest_path: String) -> Result<PrivateToolsCatalog, String> {
    private_tools::load_catalog(&manifest_path)
}

#[tauri::command]
#[cfg(not(feature = "public-core"))]
async fn run_private_tool(
    manifest_path: String,
    tool_id: String,
    operation_id: String,
    input: serde_json::Value,
    run_id: String,
    mode: String,
    confirmed: bool,
    state: tauri::State<'_, PrivateToolRunState>,
) -> Result<PrivateToolRunResult, String> {
    let state = state.inner().clone();
    state.begin(&run_id)?;
    let worker_state = state.clone();
    let worker_run_id = run_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        private_tools::run_tool(
            &manifest_path,
            &tool_id,
            &operation_id,
            input,
            &worker_run_id,
            &mode,
            confirmed,
            worker_state,
        )
    })
    .await;
    state.finish(&run_id);
    result.map_err(|error| format!("私人工具后台任务失败：{error}"))?
}

#[tauri::command]
#[cfg(not(feature = "public-core"))]
fn cancel_private_tool_run(
    run_id: String,
    state: tauri::State<'_, PrivateToolRunState>,
) -> Result<(), String> {
    private_tools::cancel_tool_run(&run_id, state.inner())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaEngineStatus {
    available: bool,
    version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaTrackInfo {
    index: u32,
    kind: String,
    codec: String,
    language: Option<String>,
    title: Option<String>,
    channels: Option<u32>,
    sample_rate: Option<u32>,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaChapterInfo {
    id: u32,
    start_seconds: f64,
    end_seconds: f64,
    title: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaFileInfo {
    path: String,
    name: String,
    size: u64,
    duration_seconds: Option<f64>,
    format_name: Option<String>,
    audio_codec: Option<String>,
    video_codec: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    bit_rate: Option<u64>,
    tracks: Vec<MediaTrackInfo>,
    chapters: Vec<MediaChapterInfo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaTranscodeRequest {
    input_path: String,
    output_dir: String,
    operation: String,
    run_id: String,
    start_seconds: Option<f64>,
    duration_seconds: Option<f64>,
    subtitle_path: Option<String>,
    chapters_json: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaOutput {
    path: String,
    name: String,
    size: u64,
    elapsed_ms: u128,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaDetectionSegment {
    start_seconds: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    end_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_seconds: Option<f64>,
    closed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaDetectionReport {
    kind: String,
    segments: Vec<MediaDetectionSegment>,
    truncated: bool,
    elapsed_ms: u128,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaWaveformReport {
    sample_rate: u32,
    sampled_duration_seconds: f64,
    source_duration_seconds: Option<f64>,
    limited: bool,
    peaks: Vec<f32>,
    elapsed_ms: u128,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaProgress {
    run_id: String,
    progress: u8,
    detail: String,
}

#[derive(Clone, Default)]
struct MediaTranscodeState {
    cancelled: Arc<Mutex<HashSet<String>>>,
    active: Arc<Mutex<HashSet<String>>>,
}

impl MediaTranscodeState {
    fn begin(&self, run_id: &str) -> Result<(), String> {
        if run_id.trim().is_empty() || run_id.len() > 120 {
            return Err("媒体任务标识无效。".into());
        }
        let mut active = self
            .active
            .lock()
            .map_err(|_| "媒体任务状态不可用".to_string())?;
        if !active.is_empty() {
            return Err("已有一个媒体任务正在执行，请完成或停止后再开始。".into());
        }
        active.insert(run_id.to_owned());
        self.cancelled
            .lock()
            .map_err(|_| "媒体任务状态不可用".to_string())?
            .remove(run_id);
        Ok(())
    }

    fn finish(&self, run_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(run_id);
        }
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.remove(run_id);
        }
    }

    fn cancel(&self, run_id: &str) -> Result<(), String> {
        if !self
            .active
            .lock()
            .map_err(|_| "媒体任务状态不可用".to_string())?
            .contains(run_id)
        {
            return Err("没有找到正在执行的媒体任务。".into());
        }
        self.cancelled
            .lock()
            .map_err(|_| "媒体任务状态不可用".to_string())?
            .insert(run_id.to_owned());
        Ok(())
    }

    fn is_cancelled(&self, run_id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|items| items.contains(run_id))
            .unwrap_or(false)
    }
}

const SUPPORTED_MEDIA_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "mkv", "webm", "avi", "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus",
];
const SUPPORTED_SUBTITLE_EXTENSIONS: &[&str] = &["srt", "vtt", "ass", "ssa", "sub", "smi"];
const MAX_SUBTITLE_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MEDIA_PROGRESS_EVENT: &str = "toolknit://media-progress";
const MAX_MEDIA_CHAPTERS: usize = 1_000;
const MAX_MEDIA_CHAPTER_JSON_BYTES: usize = 64 * 1024;
const MAX_MEDIA_CHAPTER_TITLE_CHARS: usize = 256;
const MEDIA_WAVEFORM_SAMPLE_RATE: u32 = 1_000;
const MEDIA_WAVEFORM_MAX_POINTS: usize = 1_600;
const MEDIA_WAVEFORM_MAX_BYTES: usize = 24 * 1024 * 1024;
const MEDIA_WAVEFORM_TIMEOUT: Duration = Duration::from_secs(180);

fn media_engine_version() -> Option<String> {
    let output = Command::new("ffmpeg").arg("-version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(|line| line.trim().to_owned())
        .filter(|line| !line.is_empty())
}

fn media_probe_available() -> bool {
    Command::new("ffprobe")
        .arg("-version")
        .output()
        .is_ok_and(|output| output.status.success())
}

fn require_media_engine() -> Result<(), String> {
    if media_engine_version().is_some() && media_probe_available() {
        Ok(())
    } else {
        Err("未检测到 FFmpeg。请将 ffmpeg 与 ffprobe 加入系统 PATH 后重试。".into())
    }
}

fn validated_media_input_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if !path.is_file() {
        return Err("媒体文件不存在或不是普通文件。".into());
    }
    let extension = path
        .extension()
        .and_then(|item| item.to_str())
        .map(|item| item.to_ascii_lowercase());
    if !extension
        .as_deref()
        .is_some_and(|item| SUPPORTED_MEDIA_EXTENSIONS.contains(&item))
    {
        return Err("仅支持常见本地音频或视频格式。".into());
    }
    Ok(path)
}

fn validated_subtitle_input_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err("字幕文件路径必须是本地绝对路径。".into());
    }
    let metadata = fs::metadata(&path).map_err(|_| "字幕文件不存在或无法读取。".to_string())?;
    if !metadata.is_file() {
        return Err("字幕路径不是普通文件。".into());
    }
    if metadata.len() > MAX_SUBTITLE_FILE_BYTES {
        return Err("字幕文件过大，单个文件最多支持 5 MB。".into());
    }
    let extension = path
        .extension()
        .and_then(|item| item.to_str())
        .map(|item| item.to_ascii_lowercase());
    if !extension
        .as_deref()
        .is_some_and(|item| SUPPORTED_SUBTITLE_EXTENSIONS.contains(&item))
    {
        return Err("仅支持 SRT、VTT、ASS、SSA、SUB 或 SMI 字幕文件。".into());
    }
    fs::canonicalize(path).map_err(|error| format!("无法定位字幕文件：{error}"))
}

/// Build an FFmpeg subtitles filter without interpolating a user path into a
/// shell command. The process still receives one argument, but the filter
/// parser has its own escaping rules for Windows drive letters and separators.
fn subtitle_burn_filter(path: &Path) -> Result<String, String> {
    let value = path
        .to_str()
        .ok_or("字幕文件路径包含无法处理的字符。")?;
    let mut escaped = String::with_capacity(value.len() + 16);
    for character in value.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            ':' => escaped.push_str("\\:"),
            '\'' => escaped.push_str("\\'"),
            '[' => escaped.push_str("\\["),
            ']' => escaped.push_str("\\]"),
            ',' => escaped.push_str("\\,"),
            ';' => escaped.push_str("\\;"),
            _ => escaped.push(character),
        }
    }
    Ok(format!("subtitles=filename='{escaped}'"))
}

fn media_safe_stem(path: &Path) -> String {
    let source = path
        .file_stem()
        .and_then(|item| item.to_str())
        .unwrap_or("media");
    let name = source
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let name = name.trim_matches('-');
    if name.is_empty() {
        "media".into()
    } else {
        name.chars().take(72).collect()
    }
}

fn next_media_output_path(
    input: &Path,
    output_dir: &Path,
    suffix: &str,
    extension: &str,
) -> PathBuf {
    let stem = media_safe_stem(input);
    for index in 1..10_000 {
        let serial = if index == 1 {
            String::new()
        } else {
            format!("-{index}")
        };
        let candidate = output_dir.join(format!("{stem}-knitspace-{suffix}{serial}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    output_dir.join(format!("{stem}-knitspace-{suffix}-overflow.{extension}"))
}

fn media_temporary_output_path(output: &Path) -> PathBuf {
    let stem = output
        .file_stem()
        .and_then(|item| item.to_str())
        .unwrap_or("knitspace-media");
    let extension = output
        .extension()
        .and_then(|item| item.to_str())
        .unwrap_or("bin");
    output.with_file_name(format!(
        ".{stem}-working-{}.{}",
        uuid::Uuid::now_v7(),
        extension
    ))
}

fn media_progress_percent(seconds: f64, duration_seconds: Option<f64>) -> Option<u8> {
    let duration = duration_seconds.filter(|value| value.is_finite() && *value > 0.0)?;
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    Some(((seconds / duration * 100.0).floor() as i32).clamp(1, 99) as u8)
}

fn validated_media_clip_range(
    start_seconds: Option<f64>,
    duration_seconds: Option<f64>,
    source_duration: Option<f64>,
) -> Result<(f64, f64), String> {
    let start = start_seconds
        .filter(|value| value.is_finite() && *value >= 0.0)
        .ok_or("片段开始时间无效。")?;
    let duration = duration_seconds
        .filter(|value| value.is_finite() && *value >= 0.1 && *value <= 86_400.0)
        .ok_or("片段时长必须在 0.1 秒到 24 小时之间。")?;
    if let Some(total) = source_duration.filter(|value| value.is_finite() && *value > 0.0) {
        if start >= total || start + duration > total + 0.05 {
            return Err("截取区间超出了媒体时长。".into());
        }
    }
    Ok((start, duration))
}

fn media_progress_seconds(line: &str) -> Option<f64> {
    let (key, value) = line.split_once('=')?;
    if !matches!(key, "out_time_us" | "out_time_ms") {
        return None;
    }
    value
        .parse::<f64>()
        .ok()
        .map(|microseconds| microseconds / 1_000_000.0)
}

fn read_media_log<R: Read>(mut reader: R) -> String {
    const MAX_BYTES: usize = 128 * 1024;
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(length) => {
                let remaining = MAX_BYTES.saturating_sub(bytes.len());
                if remaining > 0 {
                    bytes.extend_from_slice(&buffer[..length.min(remaining)]);
                }
            }
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn read_media_waveform<R: Read>(mut reader: R) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 16 * 1024];
    let mut oversized = false;
    loop {
        let length = reader
            .read(&mut buffer)
            .map_err(|error| format!("读取 FFmpeg 波形数据失败：{error}"))?;
        if length == 0 {
            break;
        }
        if !oversized {
            let remaining = MEDIA_WAVEFORM_MAX_BYTES.saturating_sub(bytes.len());
            if length <= remaining {
                bytes.extend_from_slice(&buffer[..length]);
            } else {
                bytes.extend_from_slice(&buffer[..remaining]);
                oversized = true;
            }
        }
    }
    if oversized {
        Err("媒体波形数据超过安全上限，请先截取较短的片段。".into())
    } else {
        Ok(bytes)
    }
}

fn summarize_media_waveform(
    pcm: &[u8],
    source_duration_seconds: Option<f64>,
    elapsed_ms: u128,
) -> Result<MediaWaveformReport, String> {
    let sample_count = pcm.len() / 2;
    if sample_count == 0 {
        return Err("媒体没有可生成波形的音频样本。".into());
    }
    let point_count = sample_count.min(MEDIA_WAVEFORM_MAX_POINTS);
    let mut peaks = Vec::with_capacity(point_count);
    for point in 0..point_count {
        let start = point * sample_count / point_count;
        let end = ((point + 1) * sample_count / point_count).max(start + 1);
        let mut peak = 0.0_f32;
        for sample in start..end.min(sample_count) {
            let offset = sample * 2;
            let value = i16::from_le_bytes([pcm[offset], pcm[offset + 1]]);
            peak = peak.max((f32::from(value).abs() / 32_768.0).min(1.0));
        }
        peaks.push(peak);
    }
    let sampled_duration_seconds = sample_count as f64 / f64::from(MEDIA_WAVEFORM_SAMPLE_RATE);
    let limited = source_duration_seconds
        .filter(|value| value.is_finite() && *value > 0.0)
        .is_some_and(|value| value > sampled_duration_seconds + 1.0);
    Ok(MediaWaveformReport {
        sample_rate: MEDIA_WAVEFORM_SAMPLE_RATE,
        sampled_duration_seconds,
        source_duration_seconds,
        limited,
        peaks,
        elapsed_ms,
    })
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaChapterInput {
    #[serde(alias = "start_seconds")]
    start_seconds: f64,
    #[serde(alias = "end_seconds")]
    end_seconds: f64,
    #[serde(default)]
    title: String,
}

fn parse_media_chapter_json(
    raw: &str,
    source_duration_seconds: Option<f64>,
) -> Result<Vec<MediaChapterInput>, String> {
    if raw.len() > MAX_MEDIA_CHAPTER_JSON_BYTES {
        return Err("章节 JSON 过大，最多支持 64 KB。".into());
    }
    let chapters: Vec<MediaChapterInput> = serde_json::from_str(raw)
        .map_err(|error| format!("章节 JSON 无法解析：{error}"))?;
    if chapters.len() > MAX_MEDIA_CHAPTERS {
        return Err(format!("章节数量不能超过 {MAX_MEDIA_CHAPTERS} 条。"));
    }
    let source_duration = source_duration_seconds.filter(|value| value.is_finite() && *value > 0.0);
    let mut previous_end = 0.0_f64;
    for (index, chapter) in chapters.iter().enumerate() {
        if !chapter.start_seconds.is_finite()
            || !chapter.end_seconds.is_finite()
            || chapter.start_seconds < 0.0
            || chapter.end_seconds <= chapter.start_seconds
            || chapter.end_seconds > 7.0 * 24.0 * 60.0 * 60.0
        {
            return Err(format!("第 {} 条章节的时间范围无效。", index + 1));
        }
        if let Some(duration) = source_duration {
            if chapter.end_seconds > duration + 0.05 {
                return Err(format!("第 {} 条章节超出了媒体时长。", index + 1));
            }
        }
        if index > 0 && chapter.start_seconds < previous_end {
            return Err(format!("第 {} 条章节与上一条重叠或未按时间排序。", index + 1));
        }
        if chapter.title.chars().count() > MAX_MEDIA_CHAPTER_TITLE_CHARS {
            return Err(format!("第 {} 条章节标题不能超过 {MAX_MEDIA_CHAPTER_TITLE_CHARS} 个字符。", index + 1));
        }
        if chapter.title.chars().any(char::is_control) {
            return Err(format!("第 {} 条章节标题包含不可用控制字符。", index + 1));
        }
        previous_end = chapter.end_seconds;
    }
    Ok(chapters)
}

fn escape_media_ffmetadata_value(value: &str) -> String {
    value
        .chars()
        .filter_map(|character| match character {
            '\\' => Some("\\\\".to_owned()),
            '=' => Some("\\=".to_owned()),
            ';' => Some("\\;".to_owned()),
            '#' => Some("\\#".to_owned()),
            '\n' | '\r' => Some(" ".to_owned()),
            character if character.is_control() => None,
            character => Some(character.to_string()),
        })
        .collect()
}

fn render_media_ffmetadata(chapters: &[MediaChapterInput]) -> String {
    let mut output = String::from(";FFMETADATA1\n");
    for chapter in chapters {
        output.push_str("[CHAPTER]\nTIMEBASE=1/1000\n");
        output.push_str(&format!("START={}\n", (chapter.start_seconds * 1_000.0).round() as i64));
        output.push_str(&format!("END={}\n", (chapter.end_seconds * 1_000.0).round() as i64));
        let title = chapter.title.trim();
        if !title.is_empty() {
            output.push_str("title=");
            output.push_str(&escape_media_ffmetadata_value(title));
            output.push('\n');
        }
        output.push('\n');
    }
    output
}

struct TemporaryMediaMetadata {
    directory: PathBuf,
    path: PathBuf,
}

impl Drop for TemporaryMediaMetadata {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn create_media_chapter_metadata(
    raw: &str,
    source_duration_seconds: Option<f64>,
) -> Result<TemporaryMediaMetadata, String> {
    let chapters = parse_media_chapter_json(raw, source_duration_seconds)?;
    let directory = std::env::temp_dir().join(format!(
        "knitspace-media-chapters-{}",
        uuid::Uuid::now_v7()
    ));
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建章节临时目录：{error}"))?;
    let path = directory.join("metadata.txt");
    if let Err(error) = fs::write(&path, render_media_ffmetadata(&chapters)) {
        let _ = fs::remove_dir_all(&directory);
        return Err(format!("无法写入章节临时文件：{error}"));
    }
    Ok(TemporaryMediaMetadata { directory, path })
}

fn emit_media_progress(
    app: &tauri::AppHandle,
    run_id: &str,
    progress: u8,
    detail: impl Into<String>,
) {
    let _ = app.emit(
        MEDIA_PROGRESS_EVENT,
        MediaProgress {
            run_id: run_id.to_owned(),
            progress,
            detail: detail.into(),
        },
    );
}

fn probe_media_file(path: PathBuf) -> Result<MediaFileInfo, String> {
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    let output = Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "format=duration,format_name,bit_rate,size:stream=index,codec_type,codec_name,width,height,bit_rate,channels,sample_rate:stream_tags=language,title:chapter=id,start_time,end_time:chapter_tags=title", "-of", "json"])
        .arg(&path)
        .output()
        .map_err(|error| format!("无法启动 FFprobe：{error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr)
            .trim()
            .chars()
            .take(360)
            .collect::<String>();
        return Err(if detail.is_empty() {
            "FFprobe 无法读取这份媒体文件。".into()
        } else {
            detail
        });
    }
    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("无法解析 FFprobe 返回结果：{error}"))?;
    let streams = json
        .get("streams")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let audio = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(|item| item.as_str()) == Some("audio"));
    let video = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(|item| item.as_str()) == Some("video"));
    let format = json.get("format");
    let parse_number = |value: Option<&serde_json::Value>| {
        value.and_then(|item| {
            item.as_str()
                .and_then(|source| source.parse::<f64>().ok())
                .or_else(|| item.as_f64())
        })
    };
    let parse_integer = |value: Option<&serde_json::Value>| {
        value.and_then(|item| {
            item.as_str()
                .and_then(|source| source.parse::<u64>().ok())
                .or_else(|| item.as_u64())
        })
    };
    let chapters = json
        .get("chapters")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .take(MAX_MEDIA_CHAPTERS)
                .filter_map(|chapter| {
                    let start_seconds = parse_number(chapter.get("start_time"))?;
                    let end_seconds = parse_number(chapter.get("end_time"))?;
                    if !start_seconds.is_finite() || !end_seconds.is_finite() || end_seconds <= start_seconds {
                        return None;
                    }
                    let title = chapter
                        .get("tags")
                        .and_then(|value| value.get("title"))
                        .and_then(|value| value.as_str())
                        .map(|value| value.chars().take(MAX_MEDIA_CHAPTER_TITLE_CHARS).collect::<String>())
                        .filter(|value| !value.trim().is_empty());
                    Some(MediaChapterInfo {
                        id: parse_integer(chapter.get("id"))?.try_into().ok()?,
                        start_seconds: start_seconds.max(0.0),
                        end_seconds,
                        title,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let tracks = streams
        .iter()
        .filter_map(|stream| {
            let kind = stream.get("codec_type")?.as_str()?.to_owned();
            let codec = stream
                .get("codec_name")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown")
                .to_owned();
            let tags = stream.get("tags");
            Some(MediaTrackInfo {
                index: parse_integer(stream.get("index"))?.try_into().ok()?,
                kind,
                codec,
                language: tags
                    .and_then(|value| value.get("language"))
                    .and_then(|value| value.as_str())
                    .map(str::to_owned),
                title: tags
                    .and_then(|value| value.get("title"))
                    .and_then(|value| value.as_str())
                    .map(str::to_owned),
                channels: parse_integer(stream.get("channels")).and_then(|value| value.try_into().ok()),
                sample_rate: parse_integer(stream.get("sample_rate")).and_then(|value| value.try_into().ok()),
                width: parse_integer(stream.get("width")).and_then(|value| value.try_into().ok()),
                height: parse_integer(stream.get("height")).and_then(|value| value.try_into().ok()),
            })
        })
        .collect();
    Ok(MediaFileInfo {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .and_then(|item| item.to_str())
            .unwrap_or("media")
            .to_owned(),
        size: metadata.len(),
        duration_seconds: parse_number(format.and_then(|item| item.get("duration"))),
        format_name: format
            .and_then(|item| item.get("format_name"))
            .and_then(|item| item.as_str())
            .map(str::to_owned),
        audio_codec: audio
            .and_then(|item| item.get("codec_name"))
            .and_then(|item| item.as_str())
            .map(str::to_owned),
        video_codec: video
            .and_then(|item| item.get("codec_name"))
            .and_then(|item| item.as_str())
            .map(str::to_owned),
        width: video
            .and_then(|item| item.get("width"))
            .and_then(|item| item.as_u64())
            .and_then(|item| u32::try_from(item).ok()),
        height: video
            .and_then(|item| item.get("height"))
            .and_then(|item| item.as_u64())
            .and_then(|item| u32::try_from(item).ok()),
        bit_rate: parse_integer(format.and_then(|item| item.get("bit_rate"))),
        tracks,
        chapters,
    })
}

#[tauri::command]
async fn media_engine_status() -> MediaEngineStatus {
    tauri::async_runtime::spawn_blocking(|| {
        let version = media_engine_version();
        MediaEngineStatus {
            available: version.is_some() && media_probe_available(),
            version,
        }
    })
    .await
    .unwrap_or(MediaEngineStatus {
        available: false,
        version: None,
    })
}

#[tauri::command]
async fn inspect_media_file(path: String) -> Result<MediaFileInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = validated_media_input_path(&path)?;
        require_media_engine()?;
        probe_media_file(path)
    })
    .await
    .map_err(|error| format!("媒体探测任务失败：{error}"))?
}

const MEDIA_DETECTION_MAX_SEGMENTS: usize = 256;
const MEDIA_DETECTION_TIMEOUT: Duration = Duration::from_secs(120);

fn parse_detection_number(line: &str, marker: &str) -> Option<f64> {
    let start = line.find(marker)? + marker.len();
    let value = line[start..]
        .trim_start()
        .split(|character: char| character.is_whitespace() || character == '|')
        .next()?;
    let number = value.trim().parse::<f64>().ok()?;
    number.is_finite().then_some(number.max(0.0))
}

fn parse_detection_segments(
    log: &str,
    prefix: &str,
    source_duration: Option<f64>,
) -> (Vec<MediaDetectionSegment>, bool) {
    let start_marker = format!("{prefix}_start:");
    let end_marker = format!("{prefix}_end:");
    let duration_marker = format!("{prefix}_duration:");
    let mut segments = Vec::new();
    let mut pending_start = None;
    let mut truncated = false;

    for line in log.lines() {
        if let Some(start) = parse_detection_number(line, &start_marker) {
            pending_start = Some(start);
        }
        let Some(start) = pending_start else {
            continue;
        };
        let Some(end) = parse_detection_number(line, &end_marker) else {
            continue;
        };
        let duration = parse_detection_number(line, &duration_marker)
            .or_else(|| (end >= start).then_some(end - start));
        if segments.len() < MEDIA_DETECTION_MAX_SEGMENTS {
            segments.push(MediaDetectionSegment {
                start_seconds: start,
                end_seconds: Some(end.max(start)),
                duration_seconds: duration,
                closed: true,
            });
        } else {
            truncated = true;
        }
        pending_start = None;
    }

    if let Some(start) = pending_start {
        let end = source_duration.filter(|value| value.is_finite() && *value >= start);
        let duration = end.map(|value| value - start);
        if segments.len() < MEDIA_DETECTION_MAX_SEGMENTS {
            segments.push(MediaDetectionSegment {
                start_seconds: start,
                end_seconds: end,
                duration_seconds: duration,
                closed: false,
            });
        } else {
            truncated = true;
        }
    }

    (segments, truncated)
}

fn run_media_waveform(path: String) -> Result<MediaWaveformReport, String> {
    let input = validated_media_input_path(&path)?;
    require_media_engine()?;
    let media_info = probe_media_file(input.clone())?;
    if media_info.audio_codec.is_none() {
        return Err("当前文件没有可生成波形的音轨。".into());
    }
    let started = Instant::now();
    let mut command = Command::new("ffmpeg");
    command
        .args(["-hide_banner", "-loglevel", "error", "-nostdin"])
        .arg("-i")
        .arg(&input)
        .args(["-map", "0:a:0", "-vn", "-ac", "1", "-ar"])
        .arg(MEDIA_WAVEFORM_SAMPLE_RATE.to_string())
        .args(["-t", "10800", "-f", "s16le", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 FFmpeg 生成波形：{error}"))?;
    let stdout = child.stdout.take().ok_or("无法读取 FFmpeg 波形数据。")?;
    let stderr = child.stderr.take().ok_or("无法读取 FFmpeg 波形日志。")?;
    let waveform_reader = thread::spawn(move || read_media_waveform(stdout));
    let stderr_reader = thread::spawn(move || read_media_log(stderr));
    let status = loop {
        if started.elapsed() >= MEDIA_WAVEFORM_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            let _ = waveform_reader.join();
            let _ = stderr_reader.join();
            return Err("媒体波形分析超时，已停止本次只读分析。".into());
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("无法检查 FFmpeg 波形状态：{error}"))?
        {
            break status;
        }
        thread::sleep(Duration::from_millis(80));
    };
    let pcm = waveform_reader
        .join()
        .map_err(|_| "读取 FFmpeg 波形数据的线程异常退出。".to_string())??;
    let log = stderr_reader.join().unwrap_or_default();
    if !status.success() {
        let message = log
            .lines()
            .rev()
            .take(5)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(if message.trim().is_empty() {
            "FFmpeg 未能完成波形分析。".into()
        } else {
            message.chars().take(900).collect()
        });
    }
    summarize_media_waveform(&pcm, media_info.duration_seconds, started.elapsed().as_millis())
}

fn run_media_detection(path: String, kind: &str) -> Result<MediaDetectionReport, String> {
    let input = validated_media_input_path(&path)?;
    require_media_engine()?;
    let media_info = probe_media_file(input.clone())?;
    let (required_track, filter, prefix, detail) = match kind {
        "silence" => ("audio", "-af", "silence", "静音检测"),
        "black" => ("video", "-vf", "black", "黑场检测"),
        _ => return Err("不支持的媒体检测类型。".into()),
    };
    let has_required_track = match required_track {
        "audio" => media_info.audio_codec.is_some(),
        _ => media_info.video_codec.is_some(),
    };
    if !has_required_track {
        return Err(if required_track == "audio" {
            "当前文件没有可检测的音轨。"
        } else {
            "当前文件没有可检测的视频轨。"
        }
        .into());
    }

    let filter_value = if prefix == "silence" {
        "silencedetect=noise=-35dB:d=0.35"
    } else {
        "blackdetect=d=0.40:pix_th=0.10"
    };
    let map = if prefix == "silence" {
        "0:a:0"
    } else {
        "0:v:0"
    };
    let started = Instant::now();
    let mut command = Command::new("ffmpeg");
    command
        .args(["-hide_banner", "-loglevel", "info", "-nostdin"])
        .arg("-i")
        .arg(&input)
        .args(["-map", map, filter, filter_value, "-f", "null", "-"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 FFmpeg 进行{detail}：{error}"))?;
    let stderr = child.stderr.take().ok_or("无法读取 FFmpeg 检测日志。")?;
    let stderr_reader = thread::spawn(move || read_media_log(stderr));
    let status = loop {
        if started.elapsed() >= MEDIA_DETECTION_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stderr_reader.join();
            return Err(format!("{detail}超时，已停止本次只读分析。"));
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("无法检查 FFmpeg {detail}状态：{error}"))?
        {
            break status;
        }
        thread::sleep(Duration::from_millis(80));
    };
    let log = stderr_reader.join().unwrap_or_default();
    if !status.success() {
        let message = log
            .lines()
            .rev()
            .take(5)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(if message.trim().is_empty() {
            format!("FFmpeg 未能完成{detail}。")
        } else {
            message.chars().take(900).collect()
        });
    }

    let (segments, truncated) = parse_detection_segments(&log, prefix, media_info.duration_seconds);
    Ok(MediaDetectionReport {
        kind: prefix.into(),
        segments,
        truncated,
        elapsed_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
async fn analyze_media_silence(path: String) -> Result<MediaDetectionReport, String> {
    tauri::async_runtime::spawn_blocking(move || run_media_detection(path, "silence"))
        .await
        .map_err(|error| format!("静音检测任务失败：{error}"))?
}

#[tauri::command]
async fn analyze_media_black(path: String) -> Result<MediaDetectionReport, String> {
    tauri::async_runtime::spawn_blocking(move || run_media_detection(path, "black"))
        .await
        .map_err(|error| format!("黑场检测任务失败：{error}"))?
}

#[tauri::command]
async fn analyze_media_waveform(path: String) -> Result<MediaWaveformReport, String> {
    tauri::async_runtime::spawn_blocking(move || run_media_waveform(path))
        .await
        .map_err(|error| format!("波形分析任务失败：{error}"))?
}

fn required_media_track(operation: &str) -> Option<&'static str> {
    match operation {
        "extract-mp3" | "transcode-m4a" | "transcode-wav" | "normalize-audio" | "denoise-audio" => Some("audio"),
        "transcode-mp4" | "mute-video" | "remux-mp4" | "extract-cover" => Some("video"),
        "extract-subtitle" => Some("subtitle"),
        "remove-audio" => Some("video"),
        "remove-subtitles" | "add-subtitle" | "edit-chapters" => Some("media"),
        "burn-subtitle" => Some("video"),
        "clean-metadata" => Some("media"),
        "trim-clip" | "lossless-clip" => Some("media"),
        _ => None,
    }
}

fn transcode_media(
    app: tauri::AppHandle,
    request: MediaTranscodeRequest,
    state: MediaTranscodeState,
) -> Result<MediaOutput, String> {
    require_media_engine()?;
    let input = validated_media_input_path(&request.input_path)?;
    let output_dir = PathBuf::from(&request.output_dir);
    if !output_dir.is_dir() {
        return Err("输出目录不存在。请选择有效的本地文件夹。".into());
    }
    let media_info = probe_media_file(input.clone()).ok();
    let source_duration = media_info.as_ref().and_then(|info| info.duration_seconds);
    if let (Some(required), Some(info)) = (
        required_media_track(&request.operation),
        media_info.as_ref(),
    ) {
        let available = match required {
            "audio" => info.audio_codec.is_some(),
            "video" => info.video_codec.is_some(),
            "subtitle" => info.tracks.iter().any(|track| track.kind == "subtitle"),
            _ => info.audio_codec.is_some() || info.video_codec.is_some(),
        };
        if !available {
            return Err(match required {
                "video" => "当前文件没有可处理的视频轨。",
                "audio" => "当前文件没有可处理的音轨。",
                "subtitle" => "当前文件没有可处理的文字字幕轨。",
                _ => "当前文件没有可处理的媒体轨道。",
            }
            .into());
        }
    }
    let subtitle_input = if matches!(request.operation.as_str(), "add-subtitle" | "burn-subtitle") {
        let raw = request
            .subtitle_path
            .as_deref()
            .ok_or("请选择要加入的字幕文件。")?;
        let subtitle = validated_subtitle_input_path(raw)?;
        let canonical_input = fs::canonicalize(&input)
            .map_err(|error| format!("无法定位媒体文件：{error}"))?;
        if subtitle == canonical_input {
            return Err("字幕文件不能与输入媒体文件相同。".into());
        }
        Some(subtitle)
    } else {
        None
    };
    let subtitle_filter = if request.operation == "burn-subtitle" {
        Some(subtitle_burn_filter(
            subtitle_input
                .as_ref()
                .ok_or("请选择要烧录的字幕文件。")?,
        )?)
    } else {
        None
    };
    let chapter_metadata = if request.operation == "edit-chapters" {
        let raw = request
            .chapters_json
            .as_deref()
            .ok_or("请输入章节 JSON 数组。")?;
        Some(create_media_chapter_metadata(raw, source_duration)?)
    } else {
        None
    };
    let mut input_arguments = Vec::new();
    let (suffix, extension, arguments, progress_duration): (
        &str,
        String,
        Vec<String>,
        Option<f64>,
    ) = match request.operation.as_str() {
        "extract-mp3" => (
            "audio",
            "mp3".into(),
            ["-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-q:a", "2"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            source_duration,
        ),
        "transcode-m4a" => (
            "audio",
            "m4a".into(),
            ["-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "192k"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            source_duration,
        ),
        "transcode-wav" => (
            "speech",
            "wav".into(),
            [
                "-map",
                "0:a:0",
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            source_duration,
        ),
        "normalize-audio" => {
            let has_video = media_info
                .as_ref()
                .is_some_and(|info| info.video_codec.is_some());
            let arguments = if has_video {
                vec![
                    "-map".into(),
                    "0:v?".into(),
                    "-map".into(),
                    "0:a:0".into(),
                    "-map".into(),
                    "0:s?".into(),
                    "-c:v".into(),
                    "copy".into(),
                    "-c:s".into(),
                    "copy".into(),
                    "-c:a".into(),
                    "aac".into(),
                    "-b:a".into(),
                    "192k".into(),
                    "-af".into(),
                    "loudnorm=I=-16:TP=-1.5:LRA=11".into(),
                    "-map_metadata".into(),
                    "0".into(),
                ]
            } else {
                vec![
                    "-map".into(),
                    "0:a:0".into(),
                    "-vn".into(),
                    "-c:a".into(),
                    "aac".into(),
                    "-b:a".into(),
                    "192k".into(),
                    "-af".into(),
                    "loudnorm=I=-16:TP=-1.5:LRA=11".into(),
                    "-map_metadata".into(),
                    "0".into(),
                ]
            };
            (
                "audio-normalized",
                if has_video { "mkv".into() } else { "m4a".into() },
                arguments,
                source_duration,
            )
        }
        "denoise-audio" => {
            let has_video = media_info
                .as_ref()
                .is_some_and(|info| info.video_codec.is_some());
            let arguments = if has_video {
                vec![
                    "-map".into(),
                    "0:v?".into(),
                    "-map".into(),
                    "0:a:0".into(),
                    "-map".into(),
                    "0:s?".into(),
                    "-c:v".into(),
                    "copy".into(),
                    "-c:s".into(),
                    "copy".into(),
                    "-c:a".into(),
                    "aac".into(),
                    "-b:a".into(),
                    "192k".into(),
                    "-af".into(),
                    "afftdn=nr=12:nf=-45:tn=1".into(),
                    "-map_metadata".into(),
                    "0".into(),
                ]
            } else {
                vec![
                    "-map".into(),
                    "0:a:0".into(),
                    "-vn".into(),
                    "-c:a".into(),
                    "aac".into(),
                    "-b:a".into(),
                    "192k".into(),
                    "-af".into(),
                    "afftdn=nr=12:nf=-45:tn=1".into(),
                    "-map_metadata".into(),
                    "0".into(),
                ]
            };
            (
                "audio-denoised",
                if has_video { "mkv".into() } else { "m4a".into() },
                arguments,
                source_duration,
            )
        }
        "transcode-mp4" => (
            "video",
            "mp4".into(),
            [
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-movflags",
                "+faststart",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            source_duration,
        ),
        "mute-video" => (
            "muted",
            "mp4".into(),
            [
                "-map",
                "0:v:0",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "23",
                "-movflags",
                "+faststart",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            source_duration,
        ),
        "remove-audio" => (
            "no-audio",
            input
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("mkv")
                .to_ascii_lowercase(),
            [
                "-map", "0:v?", "-map", "0:s?", "-map", "0:d?", "-map", "0:t?", "-c", "copy",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            source_duration,
        ),
        "remove-subtitles" => (
            "no-subtitles",
            input
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("mkv")
                .to_ascii_lowercase(),
            [
                "-map", "0:v?", "-map", "0:a?", "-map", "0:d?", "-map", "0:t?", "-c", "copy",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            source_duration,
        ),
        "add-subtitle" => (
            "subtitle-added",
            "mkv".into(),
            [
                "-map",
                "0",
                "-map",
                "1:0",
                "-c",
                "copy",
                "-c:s",
                "srt",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            source_duration,
        ),
        "burn-subtitle" => (
            "subtitle-burned",
            "mp4".into(),
            vec![
                "-map".into(),
                "0:v:0".into(),
                "-map".into(),
                "0:a?".into(),
                "-vf".into(),
                subtitle_filter
                    .clone()
                    .ok_or("请选择要烧录的字幕文件。")?,
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "medium".into(),
                "-crf".into(),
                "23".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "160k".into(),
                "-movflags".into(),
                "+faststart".into(),
            ],
            source_duration,
        ),
        "trim-clip" | "lossless-clip" => {
            let clip_info = media_info
                .as_ref()
                .ok_or("无法读取媒体轨道，不能安全截取。")?;
            if clip_info.video_codec.is_none() && clip_info.audio_codec.is_none() {
                return Err("没有检测到可截取的音轨或视频轨。".into());
            }
            let (start, duration) = validated_media_clip_range(
                request.start_seconds,
                request.duration_seconds,
                source_duration,
            )?;
            let start = format!("{start:.3}");
            let duration_label = format!("{duration:.3}");
            let has_video = clip_info.video_codec.is_some();
            let arguments = if request.operation == "lossless-clip" {
                input_arguments = vec!["-ss".to_owned(), start.clone()];
                vec![
                    "-t",
                    &duration_label,
                    "-map",
                    "0",
                    "-c",
                    "copy",
                    "-avoid_negative_ts",
                    "make_zero",
                ]
            } else if has_video {
                vec![
                    "-ss", &start, "-t", &duration_label, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
                ]
            } else {
                vec![
                    "-ss", &start, "-t", &duration_label, "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "192k",
                ]
            };
            (
                if request.operation == "lossless-clip" { "clip-lossless" } else { "clip" },
                if request.operation == "lossless-clip" {
                    input.extension().and_then(|value| value.to_str()).unwrap_or("mkv").to_ascii_lowercase()
                } else if has_video {
                    "mp4".into()
                } else {
                    "m4a".into()
                },
                arguments.into_iter().map(str::to_owned).collect(),
                Some(duration),
            )
        }
        "remux-mp4" => (
            "remux",
            "mp4".into(),
            ["-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-movflags", "+faststart"]
                .into_iter()
            .map(str::to_owned)
            .collect(),
            source_duration,
        ),
        "extract-subtitle" => (
            "subtitle",
            "srt".into(),
            ["-map", "0:s:0", "-c:s", "srt"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            None,
        ),
        "extract-cover" => (
            "cover",
            "jpg".into(),
            ["-map", "0:v:0", "-frames:v", "1", "-q:v", "2"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            None,
        ),
        "clean-metadata" => (
            "metadata-clean",
            input
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("mkv")
                .to_ascii_lowercase(),
            ["-map", "0", "-map_metadata", "-1", "-map_chapters", "-1", "-c", "copy"]
                .into_iter()
                .map(str::to_owned)
            .collect(),
            source_duration,
        ),
        "edit-chapters" => (
            "chapters",
            input
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("mkv")
                .to_ascii_lowercase(),
            ["-map", "0", "-map_metadata", "0", "-map_chapters", "1", "-c", "copy"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            source_duration,
        ),
        _ => return Err("不支持的媒体操作。".into()),
    };
    let output = next_media_output_path(&input, &output_dir, suffix, &extension);
    let temporary_output = media_temporary_output_path(&output);
    let started = Instant::now();
    emit_media_progress(
        &app,
        &request.run_id,
        5,
        "正在启动本机 FFmpeg；媒体不会进入页面内存。",
    );
    let mut command = Command::new("ffmpeg");
    command
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-progress",
            "pipe:1",
            "-nostats",
        ])
        .args(input_arguments)
        .arg("-i")
        .arg(&input);
    if request.operation == "add-subtitle" {
        let subtitle = subtitle_input
            .as_ref()
            .ok_or("请选择要加入的字幕文件。")?;
        command.arg("-i").arg(subtitle);
    }
    if let Some(metadata) = chapter_metadata.as_ref() {
        command
            .args(["-f", "ffmetadata"])
            .arg("-i")
            .arg(&metadata.path);
    }
    let mut child = command
        .args(arguments)
        .arg("-n")
        .arg(&temporary_output)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 FFmpeg：{error}"))?;
    let stdout = child.stdout.take().ok_or("无法读取 FFmpeg 进度输出")?;
    let stderr = child.stderr.take().ok_or("无法读取 FFmpeg 错误输出")?;
    let (progress_sender, progress_receiver) = mpsc::channel();
    let stdout_reader = thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if progress_sender.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let stderr_reader = thread::spawn(move || read_media_log(stderr));
    let mut last_progress = 5_u8;
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let status = loop {
        if state.is_cancelled(&request.run_id) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            let _ = fs::remove_file(&temporary_output);
            return Err("任务已停止，未完成的临时输出已删除。".into());
        }
        while let Ok(line) = progress_receiver.try_recv() {
            if let Some(seconds) = media_progress_seconds(&line) {
                if let Some(next) = media_progress_percent(seconds, progress_duration) {
                    if next > last_progress
                        && (last_emit.elapsed() >= Duration::from_millis(220) || next >= 99)
                    {
                        last_progress = next;
                        last_emit = Instant::now();
                        emit_media_progress(
                            &app,
                            &request.run_id,
                            next,
                            format!("FFmpeg 正在转换：{next}%（可随时停止）"),
                        );
                    }
                }
            }
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("无法检查 FFmpeg 状态：{error}"))?
        {
            break status;
        }
        thread::sleep(Duration::from_millis(60));
    };
    let _ = stdout_reader.join();
    let stderr = stderr_reader.join().unwrap_or_default();
    if state.is_cancelled(&request.run_id) {
        let _ = fs::remove_file(&temporary_output);
        return Err("任务已停止，未完成的临时输出已删除。".into());
    }
    if !status.success() {
        let _ = fs::remove_file(&temporary_output);
        let detail = stderr
            .lines()
            .rev()
            .take(5)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(if detail.trim().is_empty() {
            "FFmpeg 未能生成输出文件。".into()
        } else {
            detail.chars().take(900).collect()
        });
    }
    fs::rename(&temporary_output, &output).map_err(|error| {
        let _ = fs::remove_file(&temporary_output);
        format!("媒体已生成，但输出位置出现同名文件或无法完成安全写入：{error}")
    })?;
    let metadata =
        fs::metadata(&output).map_err(|error| format!("媒体任务结束但未找到输出：{error}"))?;
    Ok(MediaOutput {
        path: output.to_string_lossy().into_owned(),
        name: output
            .file_name()
            .and_then(|item| item.to_str())
            .unwrap_or("knitspace-media")
            .to_owned(),
        size: metadata.len(),
        elapsed_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
async fn transcode_media_file(
    app: tauri::AppHandle,
    request: MediaTranscodeRequest,
    state: tauri::State<'_, MediaTranscodeState>,
) -> Result<MediaOutput, String> {
    let state = state.inner().clone();
    let run_id = request.run_id.clone();
    state.begin(&run_id)?;
    let worker_state = state.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || transcode_media(app, request, worker_state))
            .await
            .map_err(|error| format!("媒体转换任务失败：{error}"));
    state.finish(&run_id);
    result?
}

#[tauri::command]
fn cancel_media_transcode(
    run_id: String,
    state: tauri::State<'_, MediaTranscodeState>,
) -> Result<(), String> {
    state.cancel(&run_id)
}

#[derive(Clone, Default)]
struct ClipboardMonitorState {
    enabled: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    skip_sequence: Arc<AtomicU32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardPayload {
    kind: String,
    content: Option<String>,
    asset_path: Option<String>,
    hash: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    published_at: Option<String>,
    name: Option<String>,
    body: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InputFilePayload {
    name: String,
    path: String,
    mime: String,
    size: u64,
    data: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InputFileMetadataPayload {
    name: String,
    path: String,
    mime: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalMarkdownState {
    hash: String,
    modified_at: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalMarkdownPayload {
    path: String,
    name: String,
    content: String,
    hash: String,
    modified_at: String,
    size: u64,
}

const MAX_EXTERNAL_MARKDOWN_DIRECTORY_ENTRIES: usize = 500;
const MAX_EXTERNAL_MARKDOWN_DIRECTORY_SCAN: usize = 5_000;
const MAX_EXTERNAL_MARKDOWN_SEARCH_SCAN: usize = 25_000;
const MAX_EXTERNAL_MARKDOWN_SEARCH_RESULTS: usize = 80;
const MAX_EXTERNAL_MARKDOWN_SEARCH_CANDIDATES: usize = 240;
const MAX_EXTERNAL_MARKDOWN_CONTENT_SEARCH_FILES: usize = 5_000;
const MAX_EXTERNAL_MARKDOWN_CONTENT_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_EXTERNAL_MARKDOWN_CONTENT_SEARCH_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
const MAX_EXTERNAL_MARKDOWN_CONTENT_SEARCH_CANDIDATES: usize = 120;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalMarkdownDirectoryEntry {
    name: String,
    path: String,
    relative_path: String,
    kind: String,
    size: Option<u64>,
    modified_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalMarkdownDirectory {
    root: String,
    relative_path: String,
    entries: Vec<ExternalMarkdownDirectoryEntry>,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalMarkdownWorkspaceSearch {
    root: String,
    query: String,
    entries: Vec<ExternalMarkdownDirectoryEntry>,
    scanned: usize,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalMarkdownContentMatch {
    #[serde(flatten)]
    entry: ExternalMarkdownDirectoryEntry,
    line: usize,
    preview: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalMarkdownContentSearch {
    root: String,
    query: String,
    matches: Vec<ExternalMarkdownContentMatch>,
    scanned: usize,
    scanned_bytes: u64,
    skipped_large: usize,
    truncated: bool,
}

#[derive(Default)]
struct ExternalMarkdownWatchState {
    // Keep the native watcher alive for the duration of an open document.
    // The renderer is intentionally not responsible for a polling loop while
    // the desktop OS can tell us exactly when the file changes.
    watchers: Mutex<HashMap<String, notify::RecommendedWatcher>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalMarkdownChange {
    path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedVaultMarkdownChange {
    document_id: String,
    kind: String,
    change: String,
}

fn managed_vault_markdown_identity(root: &Path, path: &Path) -> Option<(String, String)> {
    let relative = path.strip_prefix(root).ok()?;
    let mut components = relative.components();
    let folder = match components.next()? {
        Component::Normal(value) if value == "notes" => "note",
        Component::Normal(value) if value == "questions" => "question",
        _ => return None,
    };
    let file = match components.next()? {
        Component::Normal(value) => Path::new(value),
        _ => return None,
    };
    if components.next().is_some()
        || file.extension().and_then(|value| value.to_str()) != Some("md")
    {
        return None;
    }
    let id = file.file_stem()?.to_str()?;
    uuid::Uuid::parse_str(id).ok()?;
    Some((id.to_owned(), folder.to_owned()))
}

const MAX_EXTERNAL_MARKDOWN_WORKSPACE_CHANGE_PATHS: usize = 64;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalMarkdownWorkspaceChange {
    root: String,
    relative_paths: Vec<String>,
    overflow: bool,
}

fn external_markdown_workspace_change_paths(root: &Path, paths: &[PathBuf]) -> (Vec<String>, bool) {
    let mut seen = HashSet::new();
    let mut relative_paths = Vec::new();
    let mut overflow = false;
    for path in paths {
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        if relative.components().any(|component| {
            matches!(component, Component::Normal(name) if name.to_string_lossy().starts_with('.'))
        }) {
            continue;
        }
        let label = external_markdown_relative_label(relative);
        if !seen.insert(label.clone()) {
            continue;
        }
        if relative_paths.len() >= MAX_EXTERNAL_MARKDOWN_WORKSPACE_CHANGE_PATHS {
            overflow = true;
            break;
        }
        relative_paths.push(label);
    }
    (relative_paths, overflow)
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn is_supported_markdown_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("md") | Some("mdx") | Some("markdown") | Some("mkd")
    )
}

fn validated_markdown_path(path: String, must_exist: bool) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !is_supported_markdown_path(&path) {
        return Err("只支持 Markdown 文件（.md、.mdx、.markdown 或 .mkd）".into());
    }
    if must_exist {
        if !path.is_file() {
            return Err("Markdown 文件不存在或不是普通文件".into());
        }
    } else if !path.parent().is_some_and(|parent| parent.is_dir()) {
        return Err("目标目录不存在".into());
    }
    Ok(path)
}

fn external_markdown_state(path: &Path) -> Result<ExternalMarkdownState, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified = metadata.modified().map_err(|error| error.to_string())?;
    let modified_at = chrono::DateTime::<chrono::Utc>::from(modified).to_rfc3339();
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(ExternalMarkdownState {
        hash: digest(&bytes),
        modified_at,
        size: metadata.len(),
    })
}

#[tauri::command]
fn read_external_markdown(path: String) -> Result<ExternalMarkdownPayload, String> {
    let path = validated_markdown_path(path, true)?;
    let content =
        fs::read_to_string(&path).map_err(|error| format!("无法读取 UTF-8 Markdown：{error}"))?;
    let state = external_markdown_state(&path)?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("未命名.md")
        .to_owned();
    Ok(ExternalMarkdownPayload {
        path: path.to_string_lossy().into_owned(),
        name,
        content,
        hash: state.hash,
        modified_at: state.modified_at,
        size: state.size,
    })
}

fn safe_external_markdown_relative_path(relative_path: Option<String>) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(relative_path.unwrap_or_default());
    for component in candidate.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(name) => {
                let name = name.to_string_lossy();
                if name.starts_with('.') || name.contains('\0') {
                    return Err("不能打开隐藏资料夹或无效路径".into());
                }
            }
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("资料夹路径不能离开已选择的工作区".into());
            }
        }
    }
    Ok(candidate)
}

fn external_markdown_relative_label(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn validated_external_markdown_directory(
    root: String,
    relative_path: Option<String>,
) -> Result<(PathBuf, PathBuf, String), String> {
    let root = fs::canonicalize(PathBuf::from(root))
        .map_err(|error| format!("无法打开 Markdown 工作区：{error}"))?;
    if !root.is_dir() {
        return Err("Markdown 工作区不是资料夹".into());
    }
    let relative = safe_external_markdown_relative_path(relative_path)?;
    let requested = fs::canonicalize(root.join(&relative))
        .map_err(|error| format!("无法打开工作区子资料夹：{error}"))?;
    if !requested.starts_with(&root) || !requested.is_dir() {
        return Err("资料夹路径不能离开已选择的工作区".into());
    }
    Ok((root, requested, external_markdown_relative_label(&relative)))
}

fn normalized_external_markdown_entry_name(name: String, kind: &str) -> Result<String, String> {
    if !matches!(kind, "markdown" | "directory") {
        return Err("工作区项目类型无效".into());
    }
    let mut name = name.trim().to_owned();
    if kind == "markdown" && Path::new(&name).extension().is_none() {
        name.push_str(".md");
    }
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || name.chars().any(|character| {
            matches!(
                character,
                '\0' | '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*'
            )
        })
    {
        return Err("名称不能包含路径、隐藏前缀或 Windows 不支持的字符".into());
    }
    let reserved_stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let windows_reserved = matches!(reserved_stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || reserved_stem
            .strip_prefix("COM")
            .or_else(|| reserved_stem.strip_prefix("LPT"))
            .is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            });
    if windows_reserved {
        return Err("该名称是 Windows 保留名称，请换一个名称".into());
    }
    if kind == "markdown" && !is_supported_markdown_path(Path::new(&name)) {
        return Err("Markdown 文件应使用 .md、.mdx、.markdown 或 .mkd 扩展名".into());
    }
    Ok(name)
}

fn external_markdown_directory_entry(
    path: PathBuf,
    relative_path: String,
    kind: &str,
) -> Result<ExternalMarkdownDirectoryEntry, String> {
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("工作区不操作符号链接".into());
    }
    let modified_at = metadata
        .modified()
        .ok()
        .map(|modified| chrono::DateTime::<chrono::Utc>::from(modified).to_rfc3339());
    Ok(ExternalMarkdownDirectoryEntry {
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or("工作区项目名称不是有效的 UTF-8")?
            .to_owned(),
        path: path.to_string_lossy().into_owned(),
        relative_path,
        kind: kind.into(),
        size: (kind == "markdown").then_some(metadata.len()),
        modified_at,
    })
}

#[tauri::command]
fn list_external_markdown_directory(
    root: String,
    relative_path: Option<String>,
) -> Result<ExternalMarkdownDirectory, String> {
    let (root, requested, current_relative) =
        validated_external_markdown_directory(root, relative_path)?;
    let mut entries = Vec::with_capacity(MAX_EXTERNAL_MARKDOWN_DIRECTORY_ENTRIES + 1);
    let mut inspected = 0usize;
    let mut scan_truncated = false;
    for item in fs::read_dir(&requested).map_err(|error| error.to_string())? {
        inspected += 1;
        if inspected > MAX_EXTERNAL_MARKDOWN_DIRECTORY_SCAN {
            scan_truncated = true;
            break;
        }
        let item = item.map_err(|error| error.to_string())?;
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let metadata = fs::symlink_metadata(item.path()).map_err(|error| error.to_string())?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() || (!file_type.is_dir() && !file_type.is_file()) {
            continue;
        }
        let is_directory = file_type.is_dir();
        if !is_directory && !is_supported_markdown_path(&item.path()) {
            continue;
        }
        let child_relative = if current_relative.is_empty() {
            name.clone()
        } else {
            format!("{current_relative}/{name}")
        };
        let modified_at = metadata
            .modified()
            .ok()
            .map(|modified| chrono::DateTime::<chrono::Utc>::from(modified).to_rfc3339());
        entries.push(ExternalMarkdownDirectoryEntry {
            name,
            path: item.path().to_string_lossy().into_owned(),
            relative_path: child_relative,
            kind: if is_directory {
                "directory"
            } else {
                "markdown"
            }
            .into(),
            size: (!is_directory).then_some(metadata.len()),
            modified_at,
        });
        if entries.len() > MAX_EXTERNAL_MARKDOWN_DIRECTORY_ENTRIES {
            break;
        }
    }
    let truncated = scan_truncated || entries.len() > MAX_EXTERNAL_MARKDOWN_DIRECTORY_ENTRIES;
    entries.sort_by(|left, right| {
        let left_directory = left.kind == "directory";
        let right_directory = right.kind == "directory";
        right_directory
            .cmp(&left_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    entries.truncate(MAX_EXTERNAL_MARKDOWN_DIRECTORY_ENTRIES);

    Ok(ExternalMarkdownDirectory {
        root: root.to_string_lossy().into_owned(),
        relative_path: current_relative,
        entries,
        truncated,
    })
}

fn search_external_markdown_workspace_bounded(
    root: PathBuf,
    query: String,
    limit: usize,
) -> Result<ExternalMarkdownWorkspaceSearch, String> {
    let query = query.trim().to_owned();
    if query.is_empty() {
        return Err("请输入要查找的 Markdown 文件名".into());
    }
    if query.chars().count() > 160 {
        return Err("搜索文字过长，请缩短后重试".into());
    }
    let terms = query
        .to_lowercase()
        .split_whitespace()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let limit = limit.clamp(1, MAX_EXTERNAL_MARKDOWN_SEARCH_RESULTS);
    let mut candidates = Vec::with_capacity(limit.min(MAX_EXTERNAL_MARKDOWN_SEARCH_CANDIDATES));
    let mut scanned = 0usize;
    let mut truncated = false;

    let walker = walkdir::WalkDir::new(&root)
        .follow_links(false)
        .max_depth(64)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0
                || (!entry.file_name().to_string_lossy().starts_with('.')
                    && !entry.file_type().is_symlink())
        });
    for item in walker.skip(1) {
        scanned += 1;
        if scanned > MAX_EXTERNAL_MARKDOWN_SEARCH_SCAN {
            scanned = MAX_EXTERNAL_MARKDOWN_SEARCH_SCAN;
            truncated = true;
            break;
        }
        let Ok(item) = item else { continue };
        if !item.file_type().is_file() || !is_supported_markdown_path(item.path()) {
            continue;
        }
        let Ok(relative) = item.path().strip_prefix(&root) else {
            continue;
        };
        let relative_label = external_markdown_relative_label(relative);
        let haystack = relative_label.to_lowercase();
        if !terms.iter().all(|term| haystack.contains(term)) {
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        let name_lower = name.to_lowercase();
        let stem_lower = item
            .path()
            .file_stem()
            .map(|value| value.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let query_lower = query.to_lowercase();
        let rank = if stem_lower == query_lower {
            0
        } else if stem_lower.starts_with(&query_lower) {
            1
        } else if name_lower.starts_with(&query_lower) {
            2
        } else {
            3
        };
        let Ok(entry) = external_markdown_directory_entry(
            item.path().to_path_buf(),
            relative_label,
            "markdown",
        ) else {
            continue;
        };
        candidates.push((rank, entry));
        if candidates.len() >= MAX_EXTERNAL_MARKDOWN_SEARCH_CANDIDATES {
            truncated = true;
            break;
        }
    }

    candidates.sort_by(|(left_rank, left), (right_rank, right)| {
        left_rank
            .cmp(right_rank)
            .then_with(|| left.relative_path.len().cmp(&right.relative_path.len()))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    if candidates.len() > limit {
        truncated = true;
    }
    let entries = candidates
        .into_iter()
        .take(limit)
        .map(|(_, entry)| entry)
        .collect();
    Ok(ExternalMarkdownWorkspaceSearch {
        root: root.to_string_lossy().into_owned(),
        query,
        entries,
        scanned,
        truncated,
    })
}

#[tauri::command]
async fn search_external_markdown_workspace(
    root: String,
    query: String,
    limit: usize,
) -> Result<ExternalMarkdownWorkspaceSearch, String> {
    let (root, _, _) = validated_external_markdown_directory(root, None)?;
    tauri::async_runtime::spawn_blocking(move || {
        search_external_markdown_workspace_bounded(root, query, limit)
    })
    .await
    .map_err(|error| format!("Markdown 工作区搜索线程异常：{error}"))?
}

fn external_markdown_content_preview(line: &str, terms: &[String]) -> String {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let lower = trimmed.to_lowercase();
    let center = terms
        .iter()
        .filter_map(|term| lower.find(term).map(|byte| lower[..byte].chars().count()))
        .min()
        .unwrap_or(0);
    let characters = trimmed.chars().collect::<Vec<_>>();
    let start = center.saturating_sub(48).min(characters.len());
    let end = (start + 180).min(characters.len());
    let mut preview = characters[start..end].iter().collect::<String>();
    if start > 0 {
        preview.insert(0, '…');
    }
    if end < characters.len() {
        preview.push('…');
    }
    preview
}

fn search_external_markdown_content_bounded(
    root: PathBuf,
    query: String,
    limit: usize,
) -> Result<ExternalMarkdownContentSearch, String> {
    let query = query.trim().to_owned();
    if query.is_empty() {
        return Err("请输入要查找的 Markdown 正文".into());
    }
    if query.chars().count() > 160 {
        return Err("搜索文字过长，请缩短后重试".into());
    }
    let terms = query
        .to_lowercase()
        .split_whitespace()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let limit = limit.clamp(1, MAX_EXTERNAL_MARKDOWN_SEARCH_RESULTS);
    let mut candidates =
        Vec::with_capacity(limit.min(MAX_EXTERNAL_MARKDOWN_CONTENT_SEARCH_CANDIDATES));
    let mut scanned = 0usize;
    let mut scanned_bytes = 0u64;
    let mut skipped_large = 0usize;
    let mut truncated = false;

    let walker = walkdir::WalkDir::new(&root)
        .follow_links(false)
        .max_depth(64)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0
                || (!entry.file_name().to_string_lossy().starts_with('.')
                    && !entry.file_type().is_symlink())
        });
    for item in walker.skip(1) {
        let Ok(item) = item else { continue };
        if !item.file_type().is_file() || !is_supported_markdown_path(item.path()) {
            continue;
        }
        scanned += 1;
        if scanned > MAX_EXTERNAL_MARKDOWN_CONTENT_SEARCH_FILES {
            scanned = MAX_EXTERNAL_MARKDOWN_CONTENT_SEARCH_FILES;
            truncated = true;
            break;
        }
        let Ok(metadata) = item.metadata() else {
            continue;
        };
        if metadata.len() > MAX_EXTERNAL_MARKDOWN_CONTENT_SEARCH_FILE_BYTES {
            skipped_large += 1;
            continue;
        }
        if scanned_bytes.saturating_add(metadata.len())
            > MAX_EXTERNAL_MARKDOWN_CONTENT_SEARCH_TOTAL_BYTES
        {
            truncated = true;
            break;
        }
        let Ok(content) = fs::read_to_string(item.path()) else {
            continue;
        };
        scanned_bytes = scanned_bytes.saturating_add(metadata.len());
        let Ok(relative) = item.path().strip_prefix(&root) else {
            continue;
        };
        let relative_label = external_markdown_relative_label(relative);
        let relative_lower = relative_label.to_lowercase();
        let content_lower = content.to_lowercase();
        if !terms
            .iter()
            .all(|term| relative_lower.contains(term) || content_lower.contains(term))
        {
            continue;
        }
        let (line, preview) = content
            .lines()
            .enumerate()
            .find(|(_, line)| {
                let lower = line.to_lowercase();
                terms.iter().any(|term| lower.contains(term))
            })
            .map(|(index, line)| (index + 1, external_markdown_content_preview(line, &terms)))
            .unwrap_or((1, String::new()));
        let path_rank = usize::from(!terms.iter().all(|term| relative_lower.contains(term)));
        let Ok(entry) = external_markdown_directory_entry(
            item.path().to_path_buf(),
            relative_label,
            "markdown",
        ) else {
            continue;
        };
        candidates.push((
            path_rank,
            ExternalMarkdownContentMatch {
                entry,
                line,
                preview,
            },
        ));
        if candidates.len() >= MAX_EXTERNAL_MARKDOWN_CONTENT_SEARCH_CANDIDATES {
            truncated = true;
            break;
        }
    }

    candidates.sort_by(|(left_rank, left), (right_rank, right)| {
        left_rank
            .cmp(right_rank)
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| {
                left.entry
                    .relative_path
                    .len()
                    .cmp(&right.entry.relative_path.len())
            })
            .then_with(|| left.entry.relative_path.cmp(&right.entry.relative_path))
    });
    if candidates.len() > limit {
        truncated = true;
    }
    let matches = candidates
        .into_iter()
        .take(limit)
        .map(|(_, entry)| entry)
        .collect();
    Ok(ExternalMarkdownContentSearch {
        root: root.to_string_lossy().into_owned(),
        query,
        matches,
        scanned,
        scanned_bytes,
        skipped_large,
        truncated,
    })
}

#[tauri::command]
async fn search_external_markdown_content(
    root: String,
    query: String,
    limit: usize,
) -> Result<ExternalMarkdownContentSearch, String> {
    let (root, _, _) = validated_external_markdown_directory(root, None)?;
    tauri::async_runtime::spawn_blocking(move || {
        search_external_markdown_content_bounded(root, query, limit)
    })
    .await
    .map_err(|error| format!("Markdown 正文搜索线程异常：{error}"))?
}

#[tauri::command]
fn create_external_markdown_entry(
    root: String,
    parent_relative_path: Option<String>,
    name: String,
    kind: String,
) -> Result<ExternalMarkdownDirectoryEntry, String> {
    let (_root, parent, parent_relative) =
        validated_external_markdown_directory(root, parent_relative_path)?;
    let name = normalized_external_markdown_entry_name(name, &kind)?;
    let target = parent.join(&name);
    if target.exists() {
        return Err("同名文件或资料夹已经存在".into());
    }
    if kind == "directory" {
        fs::create_dir(&target).map_err(|error| format!("无法新建资料夹：{error}"))?;
    } else {
        fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&target)
            .map_err(|error| format!("无法新建 Markdown：{error}"))?
            .sync_all()
            .map_err(|error| error.to_string())?;
    }
    let relative_path = if parent_relative.is_empty() {
        name
    } else {
        format!("{parent_relative}/{name}")
    };
    external_markdown_directory_entry(target, relative_path, &kind)
}

#[tauri::command]
fn rename_external_markdown_entry(
    root: String,
    relative_path: String,
    name: String,
) -> Result<ExternalMarkdownDirectoryEntry, String> {
    let (root, _requested, _) = validated_external_markdown_directory(root.clone(), None)?;
    let relative = safe_external_markdown_relative_path(Some(relative_path))?;
    if relative.as_os_str().is_empty() {
        return Err("不能重命名工作区根目录".into());
    }
    let source = fs::canonicalize(root.join(&relative))
        .map_err(|error| format!("无法找到要重命名的项目：{error}"))?;
    if !source.starts_with(&root) || source == root {
        return Err("项目路径不能离开已选择的工作区".into());
    }
    let metadata = fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("工作区不操作符号链接".into());
    }
    let kind = if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() && is_supported_markdown_path(&source) {
        "markdown"
    } else {
        return Err("只支持重命名资料夹或 Markdown 文件".into());
    };
    let name = normalized_external_markdown_entry_name(name, kind)?;
    let parent = source.parent().ok_or("工作区项目没有父资料夹")?;
    let target = parent.join(&name);
    if target == source {
        return external_markdown_directory_entry(
            source,
            external_markdown_relative_label(&relative),
            kind,
        );
    }
    if target.exists() {
        return Err("同名文件或资料夹已经存在".into());
    }
    fs::rename(&source, &target).map_err(|error| format!("无法重命名工作区项目：{error}"))?;
    let parent_relative = relative
        .parent()
        .map(external_markdown_relative_label)
        .unwrap_or_default();
    let target_relative = if parent_relative.is_empty() {
        name
    } else {
        format!("{parent_relative}/{name}")
    };
    external_markdown_directory_entry(target, target_relative, kind)
}

#[tauri::command]
fn move_external_markdown_entry(
    root: String,
    relative_path: String,
    target_parent_relative_path: Option<String>,
) -> Result<ExternalMarkdownDirectoryEntry, String> {
    let (root, target_parent, target_parent_relative) =
        validated_external_markdown_directory(root, target_parent_relative_path)?;
    let relative = safe_external_markdown_relative_path(Some(relative_path))?;
    if relative.as_os_str().is_empty() {
        return Err("不能移动工作区根目录".into());
    }
    let source = fs::canonicalize(root.join(&relative))
        .map_err(|error| format!("无法找到要移动的项目：{error}"))?;
    if !source.starts_with(&root) || source == root {
        return Err("项目路径不能离开已选择的工作区".into());
    }
    let metadata = fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("工作区不操作符号链接".into());
    }
    let kind = if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() && is_supported_markdown_path(&source) {
        "markdown"
    } else {
        return Err("只支持移动资料夹或 Markdown 文件".into());
    };
    if kind == "directory" && target_parent.starts_with(&source) {
        return Err("不能把资料夹移动到自身或其子资料夹中".into());
    }
    if source.parent() == Some(target_parent.as_path()) {
        return external_markdown_directory_entry(
            source,
            external_markdown_relative_label(&relative),
            kind,
        );
    }
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("工作区项目名称不是有效的 UTF-8")?
        .to_owned();
    let target = target_parent.join(&name);
    if target.exists() {
        return Err("目标资料夹中已有同名文件或资料夹".into());
    }
    fs::rename(&source, &target).map_err(|error| format!("无法移动工作区项目：{error}"))?;
    let target_relative = if target_parent_relative.is_empty() {
        name
    } else {
        format!("{target_parent_relative}/{name}")
    };
    external_markdown_directory_entry(target, target_relative, kind)
}

#[tauri::command]
fn duplicate_external_markdown_entry(
    root: String,
    relative_path: String,
) -> Result<ExternalMarkdownDirectoryEntry, String> {
    let (root, _requested, _) = validated_external_markdown_directory(root, None)?;
    let relative = safe_external_markdown_relative_path(Some(relative_path))?;
    if relative.as_os_str().is_empty() {
        return Err("不能复制工作区根目录".into());
    }
    let source = fs::canonicalize(root.join(&relative))
        .map_err(|error| format!("无法找到要复制的文件：{error}"))?;
    if !source.starts_with(&root) || source == root {
        return Err("文件路径不能离开已选择的工作区".into());
    }
    let metadata = fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("工作区不操作符号链接".into());
    }
    if !metadata.is_file() || !is_supported_markdown_path(&source) {
        return Err("只支持复制单个 Markdown 文件".into());
    }
    let parent = source.parent().ok_or("Markdown 文件没有父资料夹")?;
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("Markdown 文件名不是有效的 UTF-8")?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .ok_or("Markdown 文件缺少扩展名")?;
    let mut target = parent.join(format!("{stem} 副本.{extension}"));
    for index in 2..=999 {
        if !target.exists() {
            break;
        }
        target = parent.join(format!("{stem} 副本 {index}.{extension}"));
    }
    if target.exists() {
        return Err("同目录中的副本数量过多，请先整理后再复制".into());
    }
    fs::copy(&source, &target).map_err(|error| format!("无法复制 Markdown：{error}"))?;
    fs::OpenOptions::new()
        .write(true)
        .open(&target)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("无法完成 Markdown 副本写入：{error}"))?;
    let parent_relative = relative
        .parent()
        .map(external_markdown_relative_label)
        .unwrap_or_default();
    let target_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("副本名称不是有效的 UTF-8")?
        .to_owned();
    let target_relative = if parent_relative.is_empty() {
        target_name
    } else {
        format!("{parent_relative}/{target_name}")
    };
    external_markdown_directory_entry(target, target_relative, "markdown")
}

#[cfg(target_os = "windows")]
pub(crate) fn recycle_external_workspace_path(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{
        SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
        FOF_WANTNUKEWARNING, FO_DELETE, SHFILEOPSTRUCTW,
    };

    // SHFileOperation expects a double-null-terminated path list. Knitspace
    // passes exactly one validated absolute path and owns the confirmation UI.
    // `std::fs::canonicalize` returns a verbatim (`\\?\`) path on Windows.
    // The legacy Shell operation rejects that prefix with ERROR_INVALID_LEVEL,
    // so pass the equivalent normal absolute path after the boundary check.
    let raw_path = path.to_string_lossy();
    let shell_path = raw_path
        .strip_prefix(r"\\?\UNC\")
        .map(|value| format!(r"\\{value}"))
        .or_else(|| raw_path.strip_prefix(r"\\?\").map(str::to_owned))
        .unwrap_or_else(|| raw_path.into_owned());
    let mut encoded = std::ffi::OsStr::new(&shell_path)
        .encode_wide()
        .collect::<Vec<_>>();
    encoded.extend([0, 0]);
    let mut operation = SHFILEOPSTRUCTW {
        hwnd: std::ptr::null_mut(),
        wFunc: FO_DELETE,
        pFrom: encoded.as_ptr(),
        pTo: std::ptr::null(),
        // If a volume cannot recycle the item, Windows must warn before it
        // falls back to permanent deletion.
        fFlags: (FOF_ALLOWUNDO
            | FOF_NOCONFIRMATION
            | FOF_NOERRORUI
            | FOF_SILENT
            | FOF_WANTNUKEWARNING) as u16,
        fAnyOperationsAborted: 0,
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: std::ptr::null(),
    };
    let result = unsafe { SHFileOperationW(&mut operation) };
    if result != 0 {
        return Err(format!("Windows 回收站操作失败（代码 {result}）"));
    }
    if operation.fAnyOperationsAborted != 0 {
        return Err("已取消移入回收站".into());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn recycle_external_workspace_path(_path: &Path) -> Result<(), String> {
    Err("当前平台尚未接入系统回收站".into())
}

#[tauri::command]
fn trash_external_markdown_entry(root: String, relative_path: String) -> Result<(), String> {
    let (root, _requested, _) = validated_external_markdown_directory(root, None)?;
    let relative = safe_external_markdown_relative_path(Some(relative_path))?;
    if relative.as_os_str().is_empty() {
        return Err("不能删除工作区根目录".into());
    }
    let source = fs::canonicalize(root.join(&relative))
        .map_err(|error| format!("无法找到要删除的项目：{error}"))?;
    if !source.starts_with(&root) || source == root {
        return Err("项目路径不能离开已选择的工作区".into());
    }
    let metadata = fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("工作区不操作符号链接".into());
    }
    if !metadata.is_dir() && (!metadata.is_file() || !is_supported_markdown_path(&source)) {
        return Err("只支持将资料夹或 Markdown 文件移入回收站".into());
    }
    recycle_external_workspace_path(&source)
}

#[tauri::command]
fn inspect_external_markdown(path: String) -> Result<ExternalMarkdownState, String> {
    let path = validated_markdown_path(path, true)?;
    // This command deliberately checks only metadata: DocumentsView polls it
    // while a file is open, so a 5 MB note never gets reread on a timer.
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified = metadata.modified().map_err(|error| error.to_string())?;
    Ok(ExternalMarkdownState {
        hash: String::new(),
        modified_at: chrono::DateTime::<chrono::Utc>::from(modified).to_rfc3339(),
        size: metadata.len(),
    })
}

#[tauri::command]
fn watch_external_markdown(
    app: tauri::AppHandle,
    path: String,
    state: tauri::State<'_, ExternalMarkdownWatchState>,
) -> Result<(), String> {
    let path = validated_markdown_path(path, true)?;
    let key = path.to_string_lossy().into_owned();
    let directory = path
        .parent()
        .ok_or("Markdown 文件没有可监听的目录")?
        .to_path_buf();
    let file_name = path.file_name().ok_or("Markdown 文件名无效")?.to_owned();
    let mut watchers = state
        .watchers
        .lock()
        .map_err(|_| "外部文件监听器暂不可用")?;
    if watchers.contains_key(&key) {
        return Ok(());
    }

    let event_path = key.clone();
    let event_app = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        if !matches!(
            event.kind,
            notify::EventKind::Create(_)
                | notify::EventKind::Modify(_)
                | notify::EventKind::Remove(_)
        ) {
            return;
        }
        if event.paths.iter().any(|changed| {
            changed
                .file_name()
                .is_some_and(|name| name == file_name.as_os_str())
        }) {
            let _ = event_app.emit(
                "toolknit://external-markdown-change",
                ExternalMarkdownChange {
                    path: event_path.clone(),
                },
            );
        }
    })
    .map_err(|error| format!("无法启动外部文件监听：{error}"))?;
    watcher
        .watch(&directory, RecursiveMode::NonRecursive)
        .map_err(|error| format!("无法监听 Markdown 所在目录：{error}"))?;
    watchers.insert(key, watcher);
    Ok(())
}

#[tauri::command]
fn unwatch_external_markdown(
    path: String,
    state: tauri::State<'_, ExternalMarkdownWatchState>,
) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !is_supported_markdown_path(&path) {
        return Err("只支持 Markdown 文件（.md、.mdx、.markdown 或 .mkd）".into());
    }
    let key = path.to_string_lossy().into_owned();
    state
        .watchers
        .lock()
        .map_err(|_| "外部文件监听器暂不可用")?
        .remove(&key);
    Ok(())
}

#[tauri::command]
fn watch_external_markdown_workspace(
    app: tauri::AppHandle,
    root: String,
    state: tauri::State<'_, ExternalMarkdownWatchState>,
) -> Result<(), String> {
    let requested_root = root.clone();
    let (root, _, _) = validated_external_markdown_directory(root, None)?;
    let root_label = root.to_string_lossy().into_owned();
    let key = format!("workspace:{root_label}");
    let mut watchers = state
        .watchers
        .lock()
        .map_err(|_| "外部工作区监听器暂不可用")?;
    if watchers.contains_key(&key) {
        return Ok(());
    }

    let event_root = root.clone();
    let event_root_label = requested_root;
    let event_app = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        if !matches!(
            event.kind,
            notify::EventKind::Create(_)
                | notify::EventKind::Modify(_)
                | notify::EventKind::Remove(_)
        ) {
            return;
        }
        let (relative_paths, overflow) =
            external_markdown_workspace_change_paths(&event_root, &event.paths);
        if relative_paths.is_empty() && !overflow {
            return;
        }
        let _ = event_app.emit(
            "knitspace://external-markdown-workspace-change",
            ExternalMarkdownWorkspaceChange {
                root: event_root_label.clone(),
                relative_paths,
                overflow,
            },
        );
    })
    .map_err(|error| format!("无法启动 Markdown 工作区监听：{error}"))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| format!("无法递归监听 Markdown 工作区：{error}"))?;
    watchers.insert(key, watcher);
    Ok(())
}

#[tauri::command]
fn unwatch_external_markdown_workspace(
    root: String,
    state: tauri::State<'_, ExternalMarkdownWatchState>,
) -> Result<(), String> {
    let requested = PathBuf::from(root);
    let root = fs::canonicalize(&requested).unwrap_or(requested);
    let key = format!("workspace:{}", root.to_string_lossy());
    state
        .watchers
        .lock()
        .map_err(|_| "外部工作区监听器暂不可用")?
        .remove(&key);
    Ok(())
}

/// Watches only the two managed Markdown directories. SQLite, assets and
/// temporary write siblings are intentionally outside this surface, keeping
/// event traffic bounded even for a large Vault.
#[tauri::command]
fn watch_default_vault_markdown(
    app: tauri::AppHandle,
    state: tauri::State<'_, ExternalMarkdownWatchState>,
) -> Result<(), String> {
    let root = default_vault_path(&app)?;
    VaultService::open(root.clone()).map_err(|error| error.to_string())?;
    let root = fs::canonicalize(root).map_err(|error| format!("无法定位 Vault：{error}"))?;
    let notes = root.join("notes");
    let questions = root.join("questions");
    let mut watchers = state
        .watchers
        .lock()
        .map_err(|_| "Vault Markdown 监听器暂不可用")?;
    // A renderer reload after restore must rebuild native directory handles;
    // retaining an old watcher could leave the new Vault tree unobserved.
    watchers.remove("managed-vault");

    let event_root = root.clone();
    let event_app = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        let change = match event.kind {
            notify::EventKind::Create(_) | notify::EventKind::Modify(_) => "modified",
            notify::EventKind::Remove(_) => "removed",
            _ => return,
        };
        let mut emitted = HashSet::new();
        for path in &event.paths {
            let Some((document_id, kind)) = managed_vault_markdown_identity(&event_root, path)
            else {
                continue;
            };
            if !emitted.insert(document_id.clone()) {
                continue;
            }
            let _ = event_app.emit(
                "knitspace://vault-markdown-change",
                ManagedVaultMarkdownChange {
                    document_id,
                    kind,
                    change: change.into(),
                },
            );
        }
    })
    .map_err(|error| format!("无法启动 Vault Markdown 监听：{error}"))?;
    watcher
        .watch(&notes, RecursiveMode::NonRecursive)
        .map_err(|error| format!("无法监听 Vault 笔记目录：{error}"))?;
    watcher
        .watch(&questions, RecursiveMode::NonRecursive)
        .map_err(|error| format!("无法监听 Vault 题目目录：{error}"))?;
    watchers.insert("managed-vault".into(), watcher);
    Ok(())
}

#[tauri::command]
fn write_external_markdown(
    path: String,
    markdown: String,
    expected_hash: Option<String>,
    force: bool,
) -> Result<ExternalMarkdownState, String> {
    let path = validated_markdown_path(path, false)?;
    if path.is_file() {
        let existing = fs::read(&path).map_err(|error| error.to_string())?;
        if !force
            && expected_hash
                .as_deref()
                .is_some_and(|expected| expected != digest(&existing))
        {
            return Err("外部文件已被其他程序修改；请重新载入或确认覆盖。".into());
        }
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    file.write_all(markdown.as_bytes())
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    external_markdown_state(&path)
}

const MAX_EXTERNAL_MARKDOWN_IMAGE_BYTES: u64 = 12 * 1024 * 1024;
const MAX_MARKDOWN_CLIPBOARD_PIXELS: usize = 24_000_000;

fn external_image_mime(path: &Path) -> Result<&'static str, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    match extension.as_deref() {
        Some("png") => Ok("image/png"),
        Some("jpg") | Some("jpeg") => Ok("image/jpeg"),
        Some("gif") => Ok("image/gif"),
        Some("webp") => Ok("image/webp"),
        Some("bmp") => Ok("image/bmp"),
        Some("avif") => Ok("image/avif"),
        Some("ico") => Ok("image/x-icon"),
        // SVG is intentionally excluded. Passing an arbitrary SVG through a
        // data URL gives it a different execution surface than a normal image.
        _ => Err("Markdown 相对图片仅支持 PNG、JPG、GIF、WebP、BMP、AVIF 或 ICO".into()),
    }
}

fn is_external_resource_reference(source: &str) -> bool {
    let source = source.trim();
    if source.starts_with("//") {
        return true;
    }
    let mut characters = source.chars();
    if !matches!(characters.next(), Some(character) if character.is_ascii_alphabetic()) {
        return false;
    }
    for character in characters {
        match character {
            ':' => return true,
            character
                if character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.') => {}
            _ => return false,
        }
    }
    false
}

fn resolve_external_markdown_image(markdown_path: &Path, source: &str) -> Result<PathBuf, String> {
    let source = source.trim();
    if source.is_empty() || source.starts_with('#') || is_external_resource_reference(source) {
        return Err("只接受 Markdown 文件旁的相对图片路径".into());
    }
    // Markdown URLs may carry a display fragment/query and encode spaces. Both
    // need to be removed/decoded before resolving the real local resource.
    let source = source.split(['?', '#']).next().unwrap_or_default();
    let decoded = percent_decode_str(source)
        .decode_utf8()
        .map_err(|_| "图片路径不是有效的 UTF-8 URL 编码")?;
    let relative = Path::new(decoded.as_ref());
    if relative.as_os_str().is_empty() || relative.is_absolute() {
        return Err("只接受 Markdown 文件旁的相对图片路径".into());
    }
    let parent = markdown_path.parent().ok_or("Markdown 文件没有可用目录")?;
    let image_path = parent.join(relative);
    if !image_path.is_file() {
        return Err("相对图片不存在或不是普通文件".into());
    }
    Ok(image_path)
}

#[tauri::command]
fn read_external_markdown_image(path: String, source: String) -> Result<String, String> {
    let markdown_path = validated_markdown_path(path, true)?;
    let image_path = resolve_external_markdown_image(&markdown_path, &source)?;
    let metadata = fs::metadata(&image_path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_EXTERNAL_MARKDOWN_IMAGE_BYTES {
        return Err("相对图片超过 12 MB；为保持阅读流畅，未载入预览".into());
    }
    let mime = external_image_mime(&image_path)?;
    // The renderer only asks for images that are about to become visible, so a
    // document with dozens of screenshots does not inflate startup memory.
    let bytes = fs::read(image_path).map_err(|error| error.to_string())?;
    Ok(format!("data:{mime};base64,{}", BASE64.encode(bytes)))
}

fn persist_external_markdown_clipboard_image(
    markdown_path: &Path,
    image: &arboard::ImageData<'_>,
) -> Result<VaultMarkdownAttachment, String> {
    let pixels = image
        .width
        .checked_mul(image.height)
        .ok_or("剪贴板图片尺寸无效")?;
    if image.width == 0
        || image.height == 0
        || pixels > MAX_MARKDOWN_CLIPBOARD_PIXELS
        || image.bytes.len() != pixels.saturating_mul(4)
    {
        return Err("剪贴板图片尺寸无效或过大".into());
    }
    let parent = markdown_path.parent().ok_or("Markdown 文件没有可用目录")?;
    let directory = parent.join("assets");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let hash = digest(image.bytes.as_ref());
    let filename = format!("knitspace-clipboard-{}.png", &hash[..16]);
    let path = directory.join(&filename);
    if !path.is_file() {
        let staging = directory.join(format!(".{filename}.{}.staging", uuid::Uuid::now_v7()));
        let mut encoded = Vec::new();
        image::codecs::png::PngEncoder::new(&mut encoded)
            .write_image(
                image.bytes.as_ref(),
                image.width as u32,
                image.height as u32,
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|error| error.to_string())?;
        if encoded.len() as u64 > MAX_EXTERNAL_MARKDOWN_IMAGE_BYTES {
            return Err("图片编码后超过 12 MB；请先压缩或裁剪".into());
        }
        let mut staging_file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&staging)
            .map_err(|error| error.to_string())?;
        let write_result = staging_file
            .write_all(&encoded)
            .and_then(|_| staging_file.sync_all());
        drop(staging_file);
        if let Err(error) = write_result {
            let _ = fs::remove_file(&staging);
            return Err(error.to_string());
        }
        let mut rename_error = None;
        for attempt in 0..4 {
            match fs::rename(&staging, &path) {
                Ok(()) => {
                    rename_error = None;
                    break;
                }
                Err(_) if path.is_file() => {
                    rename_error = None;
                    break;
                }
                Err(error) => {
                    rename_error = Some(error);
                    if attempt < 3 {
                        thread::sleep(Duration::from_millis(18));
                    }
                }
            }
        }
        if let Some(error) = rename_error {
            let _ = fs::remove_file(&staging);
            return Err(error.to_string());
        }
        let _ = fs::remove_file(&staging);
    }
    let size = fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();
    Ok(VaultMarkdownAttachment {
        source: format!("assets/{filename}"),
        filename,
        size,
    })
}

fn persist_external_markdown_file_image(
    markdown_path: &Path,
    source_path: &Path,
) -> Result<VaultMarkdownAttachment, String> {
    let source = source_path
        .canonicalize()
        .map_err(|_| "选择的图片已经不存在".to_string())?;
    if !source.is_file() {
        return Err("选择的图片不是普通文件".into());
    }
    external_image_mime(&source)?;
    let metadata = fs::metadata(&source).map_err(|error| error.to_string())?;
    if metadata.len() == 0 || metadata.len() > MAX_EXTERNAL_MARKDOWN_IMAGE_BYTES {
        return Err("本地图片为空或超过 12 MB；请先压缩或裁剪".into());
    }
    let (width, height) =
        image::image_dimensions(&source).map_err(|error| format!("无法读取图片尺寸：{error}"))?;
    let pixels = (width as usize)
        .checked_mul(height as usize)
        .ok_or("图片尺寸无效")?;
    if width == 0 || height == 0 || pixels > MAX_MARKDOWN_CLIPBOARD_PIXELS {
        return Err("图片尺寸无效或超过 2400 万像素；请先缩小".into());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or("图片缺少受支持的扩展名")?;
    let bytes = fs::read(&source).map_err(|error| error.to_string())?;
    let hash = digest(&bytes);
    let filename = format!("knitspace-import-{}.{}", &hash[..16], extension);
    let parent = markdown_path.parent().ok_or("Markdown 文件没有可用目录")?;
    let directory = parent.join("assets");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let target = directory.join(&filename);
    if !target.is_file() {
        let staging = directory.join(format!(".{filename}.{}.staging", uuid::Uuid::now_v7()));
        let mut staging_file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&staging)
            .map_err(|error| error.to_string())?;
        let write_result = staging_file
            .write_all(&bytes)
            .and_then(|_| staging_file.sync_all());
        drop(staging_file);
        if let Err(error) = write_result {
            let _ = fs::remove_file(&staging);
            return Err(error.to_string());
        }
        match fs::rename(&staging, &target) {
            Ok(()) => {}
            Err(_) if target.is_file() => {}
            Err(error) => {
                let _ = fs::remove_file(&staging);
                return Err(error.to_string());
            }
        }
        let _ = fs::remove_file(&staging);
    }
    Ok(VaultMarkdownAttachment {
        source: format!("assets/{filename}"),
        filename,
        size: metadata.len(),
    })
}

#[tauri::command]
fn import_markdown_image(
    app: tauri::AppHandle,
    document_id: String,
    external_markdown_path: Option<String>,
    source_path: String,
) -> Result<VaultMarkdownAttachment, String> {
    if let Some(path) = external_markdown_path.filter(|path| !path.trim().is_empty()) {
        let markdown_path = validated_markdown_path(path, true)?;
        return persist_external_markdown_file_image(&markdown_path, Path::new(&source_path));
    }
    let vault_path = default_vault_path(&app)?;
    VaultService::open(vault_path)
        .and_then(|service| service.import_document_image(&document_id, &source_path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn paste_markdown_clipboard_image(
    app: tauri::AppHandle,
    document_id: String,
    external_markdown_path: Option<String>,
) -> Result<VaultMarkdownAttachment, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    let image = clipboard
        .get_image()
        .map_err(|_| "剪贴板中没有可粘贴的图片".to_string())?;
    if let Some(path) = external_markdown_path.filter(|path| !path.trim().is_empty()) {
        let markdown_path = validated_markdown_path(path, true)?;
        return persist_external_markdown_clipboard_image(&markdown_path, &image);
    }
    let vault_path = default_vault_path(&app)?;
    VaultService::open(vault_path)
        .and_then(|service| {
            service.save_document_image(
                &document_id,
                image.width,
                image.height,
                image.bytes.as_ref(),
            )
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn read_default_vault_markdown_image(
    app: tauri::AppHandle,
    document_id: String,
    source: String,
) -> Result<String, String> {
    let source = source.split(['?', '#']).next().unwrap_or_default();
    let decoded = percent_decode_str(source)
        .decode_utf8()
        .map_err(|_| "图片路径不是有效的 UTF-8 URL 编码")?;
    let vault_path = default_vault_path(&app)?;
    let image_path = VaultService::open(vault_path)
        .and_then(|service| service.document_image_path(&document_id, decoded.as_ref()))
        .map_err(|error| error.to_string())?;
    let metadata = fs::metadata(&image_path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_EXTERNAL_MARKDOWN_IMAGE_BYTES {
        return Err("Markdown 图片超过 12 MB；为保持阅读流畅，未载入预览".into());
    }
    let mime = external_image_mime(&image_path)?;
    let bytes = fs::read(image_path).map_err(|error| error.to_string())?;
    Ok(format!("data:{mime};base64,{}", BASE64.encode(bytes)))
}

#[cfg(test)]
mod external_markdown_tests {
    use super::*;

    #[test]
    fn workspace_change_batch_is_relative_hidden_filtered_and_bounded() {
        let root = PathBuf::from("workspace-root");
        let mut paths = vec![
            root.join("README.md"),
            root.join("算法").join("二分.md"),
            root.join(".obsidian").join("workspace.json"),
            PathBuf::from("outside").join("ignore.md"),
        ];
        let (relative, overflow) = external_markdown_workspace_change_paths(&root, &paths);
        assert_eq!(relative, vec!["README.md", "算法/二分.md"]);
        assert!(!overflow);

        paths = (0..=MAX_EXTERNAL_MARKDOWN_WORKSPACE_CHANGE_PATHS)
            .map(|index| root.join(format!("note-{index}.md")))
            .collect();
        let (relative, overflow) = external_markdown_workspace_change_paths(&root, &paths);
        assert_eq!(relative.len(), MAX_EXTERNAL_MARKDOWN_WORKSPACE_CHANGE_PATHS);
        assert!(overflow);
    }

    #[test]
    fn managed_vault_change_accepts_only_uuid_markdown_in_owned_folders() {
        let root = PathBuf::from("KnitspaceVault");
        let id = uuid::Uuid::now_v7().to_string();
        assert_eq!(
            managed_vault_markdown_identity(&root, &root.join("notes").join(format!("{id}.md"))),
            Some((id.clone(), "note".into()))
        );
        assert_eq!(
            managed_vault_markdown_identity(
                &root,
                &root.join("questions").join(format!("{id}.md"))
            ),
            Some((id.clone(), "question".into()))
        );
        assert!(
            managed_vault_markdown_identity(&root, &root.join("notes").join("title.md")).is_none()
        );
        assert!(managed_vault_markdown_identity(
            &root,
            &root.join("assets").join(format!("{id}.md"))
        )
        .is_none());
        assert!(managed_vault_markdown_identity(
            &root,
            &root.join("notes").join(format!("{id}.md.knitspace-prev"))
        )
        .is_none());
    }

    #[test]
    fn workspace_search_is_recursive_ranked_hidden_filtered_and_bounded() {
        let folder = std::env::temp_dir().join(format!(
            "knitspace-workspace-search-{}",
            uuid::Uuid::now_v7()
        ));
        let algorithms = folder.join("算法");
        fs::create_dir_all(algorithms.join("进阶")).unwrap();
        fs::create_dir_all(folder.join(".obsidian")).unwrap();
        fs::write(folder.join("二分.md"), "# exact").unwrap();
        fs::write(algorithms.join("二分边界.md"), "# prefix").unwrap();
        fs::write(algorithms.join("进阶").join("深入二分.md"), "# contains").unwrap();
        fs::write(folder.join(".obsidian").join("二分秘密.md"), "# hidden").unwrap();
        fs::write(folder.join("二分.txt"), "not markdown").unwrap();

        let result =
            search_external_markdown_workspace_bounded(folder.clone(), "二分".into(), 2).unwrap();
        assert_eq!(result.entries.len(), 2);
        assert_eq!(result.entries[0].relative_path, "二分.md");
        assert_eq!(result.entries[1].relative_path, "算法/二分边界.md");
        assert!(result.truncated);
        assert!(result.scanned >= 5);
        assert!(result
            .entries
            .iter()
            .all(|entry| !entry.relative_path.starts_with('.')));

        let multi =
            search_external_markdown_workspace_bounded(folder.clone(), "算法 边界".into(), 10)
                .unwrap();
        assert_eq!(multi.entries.len(), 1);
        assert_eq!(multi.entries[0].relative_path, "算法/二分边界.md");
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn workspace_content_search_is_recursive_excerpted_and_byte_bounded() {
        let folder = std::env::temp_dir().join(format!(
            "knitspace-workspace-content-search-{}",
            uuid::Uuid::now_v7()
        ));
        let algorithms = folder.join("算法").join("最短路");
        fs::create_dir_all(&algorithms).unwrap();
        fs::create_dir_all(folder.join(".obsidian")).unwrap();
        fs::write(
            algorithms.join("Dijkstra.md"),
            "# Dijkstra\n\n每轮执行松弛操作，并更新当前最短距离。\n",
        )
        .unwrap();
        fs::write(folder.join("普通笔记.md"), "# 普通\n\n没有目标内容。\n").unwrap();
        fs::write(
            folder.join(".obsidian").join("秘密.md"),
            "# 隐藏\n\n松弛操作不应被找到。\n",
        )
        .unwrap();
        fs::write(
            folder.join("zz-large.md"),
            vec![b'x'; MAX_EXTERNAL_MARKDOWN_CONTENT_SEARCH_FILE_BYTES as usize + 1],
        )
        .unwrap();

        let result =
            search_external_markdown_content_bounded(folder.clone(), "松弛 操作".into(), 10)
                .unwrap();
        assert_eq!(result.matches.len(), 1);
        assert_eq!(
            result.matches[0].entry.relative_path,
            "算法/最短路/Dijkstra.md"
        );
        assert_eq!(result.matches[0].line, 3);
        assert!(result.matches[0].preview.contains("松弛操作"));
        assert_eq!(result.skipped_large, 1);
        assert!(result.scanned_bytes < MAX_EXTERNAL_MARKDOWN_CONTENT_SEARCH_TOTAL_BYTES);
        assert!(result
            .matches
            .iter()
            .all(|item| !item.entry.relative_path.starts_with('.')));

        let mixed =
            search_external_markdown_content_bounded(folder.clone(), "算法 Dijkstra".into(), 10)
                .unwrap();
        assert_eq!(mixed.matches.len(), 1);
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn workspace_native_watcher_observes_nested_markdown_change() {
        let folder = std::env::temp_dir().join(format!(
            "knitspace-workspace-watch-{}",
            uuid::Uuid::now_v7()
        ));
        let nested = folder.join("算法");
        fs::create_dir_all(&nested).unwrap();
        let expected = nested.join("二分.md");
        let (sender, receiver) = std::sync::mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |result| {
            if let Ok(event) = result {
                let _ = sender.send(event);
            }
        })
        .unwrap();
        watcher.watch(&folder, RecursiveMode::Recursive).unwrap();
        fs::write(&expected, "# 二分边界").unwrap();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut observed = false;
        while std::time::Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            let Ok(event) = receiver.recv_timeout(remaining) else {
                break;
            };
            if event.paths.iter().any(|path| path == &expected) {
                observed = true;
                break;
            }
        }
        drop(watcher);
        fs::remove_dir_all(folder).unwrap();
        assert!(observed, "recursive watcher did not report nested Markdown");
    }

    #[test]
    fn external_markdown_directory_is_lazy_filtered_and_bounded() {
        let folder = std::env::temp_dir().join(format!(
            "knitspace-external-workspace-{}",
            uuid::Uuid::now_v7()
        ));
        let nested = folder.join("算法");
        fs::create_dir_all(&nested).unwrap();
        fs::create_dir_all(folder.join(".obsidian")).unwrap();
        fs::write(folder.join("README.md"), "# 首页").unwrap();
        fs::write(folder.join("ignore.txt"), "不是 Markdown").unwrap();
        fs::write(nested.join("binary-search.markdown"), "# 二分").unwrap();

        let root =
            list_external_markdown_directory(folder.to_string_lossy().into_owned(), None).unwrap();
        assert_eq!(root.entries.len(), 2);
        assert_eq!(root.entries[0].kind, "directory");
        assert_eq!(root.entries[0].relative_path, "算法");
        assert_eq!(root.entries[1].name, "README.md");
        assert!(!root.truncated);

        let child = list_external_markdown_directory(
            folder.to_string_lossy().into_owned(),
            Some("算法".into()),
        )
        .unwrap();
        assert_eq!(child.entries.len(), 1);
        assert_eq!(
            child.entries[0].relative_path,
            "算法/binary-search.markdown"
        );
        assert!(list_external_markdown_directory(
            folder.to_string_lossy().into_owned(),
            Some("../".into())
        )
        .is_err());
        assert!(list_external_markdown_directory(
            folder.to_string_lossy().into_owned(),
            Some(".obsidian".into())
        )
        .is_err());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn external_markdown_directory_caps_dense_root_folders() {
        let folder = std::env::temp_dir().join(format!(
            "knitspace-external-workspace-bound-{}",
            uuid::Uuid::now_v7()
        ));
        fs::create_dir_all(&folder).unwrap();
        for index in 0..=MAX_EXTERNAL_MARKDOWN_DIRECTORY_ENTRIES {
            fs::write(folder.join(format!("note-{index:04}.md")), "").unwrap();
        }
        let listed =
            list_external_markdown_directory(folder.to_string_lossy().into_owned(), None).unwrap();
        assert_eq!(
            listed.entries.len(),
            MAX_EXTERNAL_MARKDOWN_DIRECTORY_ENTRIES
        );
        assert!(listed.truncated);
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn external_markdown_workspace_creates_and_renames_safe_entries() {
        let folder = std::env::temp_dir().join(format!(
            "knitspace-external-workspace-mutation-{}",
            uuid::Uuid::now_v7()
        ));
        fs::create_dir_all(&folder).unwrap();
        let root = folder.to_string_lossy().into_owned();

        let directory =
            create_external_markdown_entry(root.clone(), None, "算法".into(), "directory".into())
                .unwrap();
        assert_eq!(directory.relative_path, "算法");
        assert!(folder.join("算法").is_dir());

        let markdown = create_external_markdown_entry(
            root.clone(),
            Some("算法".into()),
            "二分查找".into(),
            "markdown".into(),
        )
        .unwrap();
        assert_eq!(markdown.name, "二分查找.md");
        assert!(folder.join("算法").join("二分查找.md").is_file());

        let renamed = rename_external_markdown_entry(
            root.clone(),
            markdown.relative_path,
            "二分边界.md".into(),
        )
        .unwrap();
        assert_eq!(renamed.relative_path, "算法/二分边界.md");
        assert!(!folder.join("算法").join("二分查找.md").exists());
        assert!(folder.join("算法").join("二分边界.md").is_file());

        fs::write(folder.join("算法").join("二分边界.md"), "# 不丢正文").unwrap();
        let duplicate =
            duplicate_external_markdown_entry(root.clone(), "算法/二分边界.md".into()).unwrap();
        assert_eq!(duplicate.relative_path, "算法/二分边界 副本.md");
        assert_eq!(fs::read_to_string(&duplicate.path).unwrap(), "# 不丢正文");
        let second_duplicate =
            duplicate_external_markdown_entry(root.clone(), "算法/二分边界.md".into()).unwrap();
        assert_eq!(second_duplicate.relative_path, "算法/二分边界 副本 2.md");
        assert!(duplicate_external_markdown_entry(root.clone(), "算法".into()).is_err());

        create_external_markdown_entry(root.clone(), None, "归档".into(), "directory".into())
            .unwrap();
        let moved = move_external_markdown_entry(
            root.clone(),
            duplicate.relative_path.clone(),
            Some("归档".into()),
        )
        .unwrap();
        assert_eq!(moved.relative_path, "归档/二分边界 副本.md");
        assert_eq!(fs::read_to_string(&moved.path).unwrap(), "# 不丢正文");
        assert!(!folder.join("算法").join("二分边界 副本.md").exists());
        assert_eq!(
            move_external_markdown_entry(
                root.clone(),
                second_duplicate.relative_path.clone(),
                Some("算法".into()),
            )
            .unwrap()
            .relative_path,
            second_duplicate.relative_path
        );
        create_external_markdown_entry(
            root.clone(),
            Some("算法".into()),
            "二分边界 副本.md".into(),
            "markdown".into(),
        )
        .unwrap();
        assert!(move_external_markdown_entry(
            root.clone(),
            "算法/二分边界 副本.md".into(),
            Some("归档".into())
        )
        .is_err());
        create_external_markdown_entry(
            root.clone(),
            Some("算法".into()),
            "子目录".into(),
            "directory".into(),
        )
        .unwrap();
        assert!(move_external_markdown_entry(
            root.clone(),
            "算法".into(),
            Some("算法/子目录".into())
        )
        .is_err());
        assert!(move_external_markdown_entry(
            root.clone(),
            "算法/二分边界.md".into(),
            Some("../".into())
        )
        .is_err());

        assert!(create_external_markdown_entry(
            root.clone(),
            None,
            "../越界".into(),
            "markdown".into()
        )
        .is_err());
        assert!(create_external_markdown_entry(
            root.clone(),
            None,
            "CON".into(),
            "directory".into()
        )
        .is_err());
        assert!(
            rename_external_markdown_entry(root, "算法/二分边界.md".into(), "错误.txt".into())
                .is_err()
        );
        fs::remove_dir_all(folder).unwrap();
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "moves a generated QA file into the Windows recycle bin"]
    fn external_markdown_workspace_uses_windows_recycle_bin() {
        let folder = std::env::temp_dir().join(format!(
            "knitspace-external-workspace-recycle-{}",
            uuid::Uuid::now_v7()
        ));
        fs::create_dir_all(&folder).unwrap();
        let markdown = folder.join("recycle-qa.md");
        fs::write(&markdown, "# recoverable QA file").unwrap();
        trash_external_markdown_entry(
            folder.to_string_lossy().into_owned(),
            "recycle-qa.md".into(),
        )
        .unwrap();
        assert!(!markdown.exists());
        fs::remove_dir(folder).unwrap();
    }

    #[test]
    fn external_markdown_detects_conflicts_and_returns_state() {
        let folder = std::env::temp_dir().join(format!(
            "knitspace-external-markdown-{}",
            uuid::Uuid::now_v7()
        ));
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join("note.md").to_string_lossy().into_owned();

        let initial =
            write_external_markdown(path.clone(), "# 第一版".into(), None, false).unwrap();
        let loaded = read_external_markdown(path.clone()).unwrap();
        assert_eq!(loaded.content, "# 第一版");
        assert_eq!(loaded.hash, initial.hash);
        assert!(loaded.size > 0);

        fs::write(&path, "# 外部版本").unwrap();
        assert!(write_external_markdown(
            path.clone(),
            "# 编辑器版本".into(),
            Some(initial.hash.clone()),
            false
        )
        .is_err());
        let final_state = write_external_markdown(
            path.clone(),
            "# 编辑器版本".into(),
            Some(initial.hash.clone()),
            true,
        )
        .unwrap();
        assert_ne!(final_state.hash, initial.hash);
        assert_eq!(fs::read_to_string(&path).unwrap(), "# 编辑器版本");
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn external_markdown_loads_standard_relative_images_only_on_request() {
        let folder =
            std::env::temp_dir().join(format!("knitspace-external-image-{}", uuid::Uuid::now_v7()));
        let notes = folder.join("notes");
        let assets = folder.join("assets");
        fs::create_dir_all(&notes).unwrap();
        fs::create_dir_all(&assets).unwrap();
        let markdown = notes.join("note.md");
        let image = assets.join("diagram one.png");
        fs::write(&markdown, "![图](../assets/diagram%20one.png)").unwrap();
        fs::write(&image, [137, 80, 78, 71]).unwrap();

        let loaded = read_external_markdown_image(
            markdown.to_string_lossy().into_owned(),
            "../assets/diagram%20one.png?width=640#figure".into(),
        )
        .unwrap();
        assert_eq!(loaded, "data:image/png;base64,iVBORw==");
        assert!(read_external_markdown_image(
            markdown.to_string_lossy().into_owned(),
            "https://example.com/image.png".into()
        )
        .is_err());
        assert!(read_external_markdown_image(
            markdown.to_string_lossy().into_owned(),
            markdown.to_string_lossy().into_owned()
        )
        .is_err());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn external_markdown_clipboard_images_stay_portable_and_deduplicated() {
        let folder = std::env::temp_dir().join(format!(
            "knitspace-external-image-paste-{}",
            uuid::Uuid::now_v7()
        ));
        fs::create_dir_all(&folder).unwrap();
        let markdown = folder.join("note.md");
        fs::write(&markdown, "# 外部笔记").unwrap();
        let image = arboard::ImageData {
            width: 2,
            height: 1,
            bytes: Cow::Owned(vec![36, 118, 95, 255, 244, 240, 231, 255]),
        };

        let first = persist_external_markdown_clipboard_image(&markdown, &image).unwrap();
        let second = persist_external_markdown_clipboard_image(&markdown, &image).unwrap();
        assert_eq!(first.source, second.source);
        assert_eq!(first.filename, second.filename);
        assert!(first.source.starts_with("assets/knitspace-clipboard-"));
        assert_eq!(
            fs::metadata(folder.join(&first.source)).unwrap().len(),
            first.size
        );

        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn external_markdown_selected_images_stay_portable_and_preserve_bytes() {
        let folder = std::env::temp_dir().join(format!(
            "knitspace-external-image-import-{}",
            uuid::Uuid::now_v7()
        ));
        fs::create_dir_all(&folder).unwrap();
        let markdown = folder.join("note.md");
        let selected = folder.join("selected.png");
        fs::write(&markdown, "# 外部笔记").unwrap();
        image::save_buffer(
            &selected,
            &[36, 118, 95, 255, 244, 240, 231, 255],
            2,
            1,
            image::ColorType::Rgba8,
        )
        .unwrap();
        let original = fs::read(&selected).unwrap();

        let first = persist_external_markdown_file_image(&markdown, &selected).unwrap();
        let second = persist_external_markdown_file_image(&markdown, &selected).unwrap();
        assert_eq!(first.source, second.source);
        assert!(first.source.starts_with("assets/knitspace-import-"));
        assert_eq!(fs::read(folder.join(&first.source)).unwrap(), original);

        fs::write(folder.join("fake.png"), b"not an image").unwrap();
        assert!(persist_external_markdown_file_image(&markdown, &folder.join("fake.png")).is_err());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn media_output_paths_are_new_files_in_the_requested_directory() {
        let folder =
            std::env::temp_dir().join(format!("knitspace-media-output-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&folder).unwrap();
        let input = folder.join("lecture.recording.mp4");
        fs::write(&input, []).unwrap();

        let first = next_media_output_path(&input, &folder, "audio", "mp3");
        assert_eq!(first.parent(), Some(folder.as_path()));
        assert_eq!(
            first.file_name().and_then(|item| item.to_str()),
            Some("lecture-recording-knitspace-audio.mp3")
        );

        fs::write(&first, []).unwrap();
        let second = next_media_output_path(&input, &folder, "audio", "mp3");
        assert_eq!(
            second.file_name().and_then(|item| item.to_str()),
            Some("lecture-recording-knitspace-audio-2.mp3")
        );
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn media_input_validation_rejects_non_media_files() {
        let folder =
            std::env::temp_dir().join(format!("knitspace-media-input-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&folder).unwrap();
        let text = folder.join("notes.md");
        fs::write(&text, "not a media file").unwrap();
        assert!(validated_media_input_path(&text.to_string_lossy()).is_err());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn subtitle_input_validation_requires_a_small_supported_file() {
        let folder = std::env::temp_dir().join(format!(
            "knitspace-subtitle-input-{}",
            uuid::Uuid::now_v7()
        ));
        fs::create_dir_all(&folder).unwrap();
        let valid = folder.join("captions.SRT");
        fs::write(&valid, "1\n00:00:00,000 --> 00:00:01,000\nHello\n").unwrap();
        let canonical = validated_subtitle_input_path(&valid.to_string_lossy()).unwrap();
        assert!(canonical.is_absolute());

        let unsupported = folder.join("captions.md");
        fs::write(&unsupported, "not subtitles").unwrap();
        assert!(validated_subtitle_input_path(&unsupported.to_string_lossy()).is_err());

        let oversized = folder.join("too-large.vtt");
        fs::write(&oversized, vec![b'x'; (MAX_SUBTITLE_FILE_BYTES + 1) as usize]).unwrap();
        assert!(validated_subtitle_input_path(&oversized.to_string_lossy()).is_err());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn subtitle_burn_filter_escapes_filter_syntax_and_windows_drive_letters() {
        let path = Path::new(r"C:\Captions\lesson, [final]; 'v1'.srt");
        let filter = subtitle_burn_filter(path).unwrap();
        assert_eq!(
            filter,
            r"subtitles=filename='C\:\\Captions\\lesson\, \[final\]\; \'v1\'.srt'"
        );
    }

    #[test]
    fn media_progress_uses_ffmpeg_time_without_claiming_completion_early() {
        assert_eq!(media_progress_seconds("out_time_us=3000000"), Some(3.0));
        assert_eq!(media_progress_percent(3.0, Some(6.0)), Some(50));
        assert_eq!(media_progress_percent(9.0, Some(6.0)), Some(99));
        assert_eq!(media_progress_percent(3.0, None), None);
        assert_eq!(media_progress_seconds("progress=continue"), None);
    }

    #[test]
    fn media_detection_parser_handles_closed_and_trailing_segments() {
        let log = "[silencedetect] silence_start: 1.250\n[silencedetect] silence_end: 2.500 | silence_duration: 1.250\n[silencedetect] silence_start: 8.000";
        let (segments, truncated) = parse_detection_segments(log, "silence", Some(10.0));
        assert!(!truncated);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].start_seconds, 1.25);
        assert_eq!(segments[0].end_seconds, Some(2.5));
        assert_eq!(segments[0].duration_seconds, Some(1.25));
        assert!(segments[0].closed);
        assert_eq!(segments[1].end_seconds, Some(10.0));
        assert_eq!(segments[1].duration_seconds, Some(2.0));
        assert!(!segments[1].closed);
    }

    #[test]
    fn media_detection_parser_reads_blackdetect_markers_on_one_line() {
        let log = "[blackdetect] black_start:0 black_end:1.75 black_duration:1.75 black_ratio:0.5";
        let (segments, truncated) = parse_detection_segments(log, "black", None);
        assert!(!truncated);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].start_seconds, 0.0);
        assert_eq!(segments[0].end_seconds, Some(1.75));
        assert!(segments[0].closed);
    }

    #[test]
    fn media_waveform_summary_is_bounded_and_marks_limited_sources() {
        let pcm = [0_u8, 0, 0, 64, 0, 128, 0, 32];
        let report = summarize_media_waveform(&pcm, Some(10.0), 7).unwrap();
        assert_eq!(report.sample_rate, MEDIA_WAVEFORM_SAMPLE_RATE);
        assert_eq!(report.peaks.len(), 4);
        assert_eq!(report.sampled_duration_seconds, 0.004);
        assert!(report.limited);
        assert_eq!(report.elapsed_ms, 7);
        assert!(summarize_media_waveform(&[], None, 0).is_err());
    }

    #[test]
    fn media_chapter_json_is_bounded_and_escaped_for_ffmetadata() {
        let chapters = parse_media_chapter_json(
            r#"[{"startSeconds":0,"endSeconds":12.345,"title":"开场 = 100%; #1"}]"#,
            Some(30.0),
        )
        .unwrap();
        let metadata = render_media_ffmetadata(&chapters);
        assert!(metadata.starts_with(";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=12345\n"));
        assert!(metadata.contains(r#"title=开场 \= 100%\; \#1"#));
        assert!(parse_media_chapter_json(
            r#"[{"startSeconds":10,"endSeconds":12,"title":"后"},{"startSeconds":11,"endSeconds":14,"title":"重叠"}]"#,
            Some(30.0),
        )
        .is_err());
        assert!(parse_media_chapter_json("[]", Some(30.0)).unwrap().is_empty());
    }

    #[test]
    fn media_clip_ranges_reject_invalid_or_out_of_bounds_requests() {
        assert_eq!(
            validated_media_clip_range(Some(12.0), Some(18.0), Some(60.0)).unwrap(),
            (12.0, 18.0)
        );
        assert!(validated_media_clip_range(Some(-1.0), Some(3.0), Some(60.0)).is_err());
        assert!(validated_media_clip_range(Some(58.0), Some(3.0), Some(60.0)).is_err());
        assert!(validated_media_clip_range(Some(5.0), Some(0.01), Some(60.0)).is_err());
        assert!(validated_media_clip_range(Some(0.0), Some(86_401.0), None).is_err());
    }

    #[test]
    fn media_operations_require_the_track_their_ffmpeg_plan_consumes() {
        assert_eq!(required_media_track("transcode-wav"), Some("audio"));
        assert_eq!(required_media_track("mute-video"), Some("video"));
        assert_eq!(required_media_track("normalize-audio"), Some("audio"));
        assert_eq!(required_media_track("denoise-audio"), Some("audio"));
        assert_eq!(required_media_track("trim-clip"), Some("media"));
        assert_eq!(required_media_track("lossless-clip"), Some("media"));
        assert_eq!(required_media_track("remux-mp4"), Some("video"));
        assert_eq!(required_media_track("extract-subtitle"), Some("subtitle"));
        assert_eq!(required_media_track("extract-cover"), Some("video"));
        assert_eq!(required_media_track("remove-audio"), Some("video"));
        assert_eq!(required_media_track("remove-subtitles"), Some("media"));
        assert_eq!(required_media_track("add-subtitle"), Some("media"));
        assert_eq!(required_media_track("burn-subtitle"), Some("video"));
        assert_eq!(required_media_track("clean-metadata"), Some("media"));
        assert_eq!(required_media_track("edit-chapters"), Some("media"));
        assert_eq!(required_media_track("unsupported"), None);
    }

    #[test]
    #[cfg(windows)]
    fn storage_probe_reports_bounded_space_without_opening_sqlite() {
        let (available, total) = storage_space_for_path(Path::new(env!("CARGO_MANIFEST_DIR")))
            .expect("project volume should expose storage information");
        assert!(total > 0);
        assert!(available <= total);
    }

    #[test]
    fn media_run_state_serializes_work_and_records_cancellation() {
        let state = MediaTranscodeState::default();
        state.begin("run-one").unwrap();
        assert!(state.begin("run-two").is_err());
        state.cancel("run-one").unwrap();
        assert!(state.is_cancelled("run-one"));
        state.finish("run-one");
        assert!(!state.is_cancelled("run-one"));
        state.begin("run-two").unwrap();
        state.finish("run-two");
    }
}

#[cfg(target_os = "windows")]
fn clipboard_sequence() -> u32 {
    clipboard_win::raw::seq_num()
        .map(|value| value.get())
        .unwrap_or(0)
}

#[cfg(not(target_os = "windows"))]
fn clipboard_sequence() -> u32 {
    0
}

fn skip_current_clipboard_change(state: &ClipboardMonitorState) {
    state
        .skip_sequence
        .store(clipboard_sequence(), Ordering::SeqCst);
}

fn persist_clipboard_image(
    app: &tauri::AppHandle,
    image: arboard::ImageData<'_>,
) -> Result<ClipboardPayload, String> {
    let mut fingerprint = Sha256::new();
    fingerprint.update(image.width.to_le_bytes());
    fingerprint.update(image.height.to_le_bytes());
    fingerprint.update(image.bytes.as_ref());
    let hash = format!("{:x}", fingerprint.finalize());
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("clipboard");
    let path = directory.join(format!("{}.png", hash));
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    if !path.is_file() {
        image::save_buffer(
            &path,
            image.bytes.as_ref(),
            image.width as u32,
            image.height as u32,
            image::ColorType::Rgba8,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(ClipboardPayload {
        kind: "image".into(),
        content: None,
        asset_path: Some(path.to_string_lossy().into_owned()),
        hash,
    })
}

fn start_clipboard_monitor(app: tauri::AppHandle, state: ClipboardMonitorState) {
    thread::spawn(move || {
        let mut last_sequence = clipboard_sequence();
        loop {
            if state.enabled.load(Ordering::Relaxed) && !state.paused.load(Ordering::Relaxed) {
                let sequence = clipboard_sequence();
                if sequence != 0 && sequence != last_sequence {
                    // Let the source application finish publishing all clipboard formats.
                    thread::sleep(Duration::from_millis(70));
                    if sequence == state.skip_sequence.load(Ordering::SeqCst) {
                        last_sequence = sequence;
                    } else {
                        if let Ok(mut clipboard) = arboard::Clipboard::new() {
                            if let Ok(image) = clipboard.get_image() {
                                if let Ok(payload) = persist_clipboard_image(&app, image) {
                                    let _ = app.emit("toolknit://clipboard", payload);
                                }
                            } else if let Ok(text) = clipboard.get_text() {
                                if !text.trim().is_empty() {
                                    let hash = digest(text.as_bytes());
                                    let _ = app.emit(
                                        "toolknit://clipboard",
                                        ClipboardPayload {
                                            kind: "text".into(),
                                            content: Some(text),
                                            asset_path: None,
                                            hash,
                                        },
                                    );
                                }
                            }
                        }
                        last_sequence = sequence;
                    }
                }
            }
            thread::sleep(Duration::from_millis(180));
        }
    });
}

#[tauri::command]
fn set_clipboard_monitor(
    enabled: bool,
    paused: bool,
    state: tauri::State<'_, ClipboardMonitorState>,
) {
    state.enabled.store(enabled, Ordering::Relaxed);
    state.paused.store(paused, Ordering::Relaxed);
    if !paused {
        skip_current_clipboard_change(state.inner());
    }
}

#[tauri::command]
fn read_clipboard_current(app: tauri::AppHandle) -> Result<ClipboardPayload, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    if let Ok(image) = clipboard.get_image() {
        return persist_clipboard_image(&app, image);
    }
    if let Ok(text) = clipboard.get_text() {
        if !text.trim().is_empty() {
            let hash = digest(text.as_bytes());
            return Ok(ClipboardPayload {
                kind: "text".into(),
                content: Some(text),
                asset_path: None,
                hash,
            });
        }
    }
    Err("剪贴板中没有可读取的文本或图片".into())
}

#[tauri::command]
async fn copy_clipboard(
    kind: String,
    content: Option<String>,
    asset_path: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, ClipboardMonitorState>,
) -> Result<(), String> {
    let monitor = state.inner().clone();
    let was_paused = monitor.paused.swap(true, Ordering::SeqCst);
    let task = tauri::async_runtime::spawn_blocking(move || {
        // Give an in-flight monitor read time to release the Windows clipboard.
        thread::sleep(Duration::from_millis(30));
        if kind == "image" {
            let path = asset_path.ok_or("这张图片的本地资源已经不存在")?;
            let app_clipboard_root = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("clipboard");
            let candidate = Path::new(&path)
                .canonicalize()
                .map_err(|_| "这张图片的本地资源已经不存在".to_string())?;
            // Fresh desktop captures live in the app-data cache. A one-time
            // browser-history migration instead writes legacy Data URLs into
            // the active Vault, so both roots are explicitly allow-listed.
            let vault_clipboard_root = default_vault_path(&app)
                .ok()
                .map(PathBuf::from)
                .map(|root| root.join(".toolknit/clipboard"));
            let allowed = [Some(app_clipboard_root), vault_clipboard_root]
                .into_iter()
                .flatten()
                .filter_map(|root| root.canonicalize().ok())
                .any(|root| candidate.starts_with(root));
            if !allowed || !candidate.is_file() {
                return Err("剪贴板图片路径无效".into());
            }
            let image = image::open(candidate)
                .map_err(|error| format!("无法读取历史图片：{}", error))?
                .to_rgba8();
            let (width, height) = image.dimensions();
            let pixels = image.into_raw();
            let mut last_error = String::from("系统剪贴板暂时不可用");
            for attempt in 0..10 {
                let write = arboard::Clipboard::new().and_then(|mut clipboard| {
                    clipboard.set_image(arboard::ImageData {
                        width: width as usize,
                        height: height as usize,
                        bytes: Cow::Borrowed(pixels.as_slice()),
                    })
                });
                match write {
                    Ok(()) => return Ok(()),
                    Err(error) => last_error = error.to_string(),
                }
                thread::sleep(Duration::from_millis(25 + attempt * 20));
            }
            Err(format!("系统剪贴板正被其他程序占用：{}", last_error))
        } else {
            let text = content.unwrap_or_default();
            let mut last_error = String::from("系统剪贴板暂时不可用");
            for attempt in 0..10 {
                let write = arboard::Clipboard::new()
                    .and_then(|mut clipboard| clipboard.set_text(text.clone()));
                match write {
                    Ok(()) => return Ok(()),
                    Err(error) => last_error = error.to_string(),
                }
                thread::sleep(Duration::from_millis(25 + attempt * 20));
            }
            Err(format!("系统剪贴板正被其他程序占用：{}", last_error))
        }
    })
    .await;
    skip_current_clipboard_change(&monitor);
    monitor.paused.store(was_paused, Ordering::SeqCst);
    task.map_err(|error| format!("剪贴板后台任务失败：{}", error))?
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn copy_png_bytes(
    request: tauri::ipc::Request<'_>,
    app: tauri::AppHandle,
    state: tauri::State<'_, ClipboardMonitorState>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("图片传输格式无效，请重新复制".into());
    };
    let bytes = data.to_vec();
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if !bytes.starts_with(PNG_SIGNATURE) {
        return Err("生成的 PNG 无效".into());
    }
    let monitor = state.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        use clipboard_win::{formats, Clipboard, Setter};
        use image::{GenericImageView, ImageFormat};

        let staged_path = stage_cached_clipboard_file(&app, "Knitspace-image.png", &bytes)?;
        let clipboard_path = windows_clipboard_path(&staged_path);
        // Publish a DIB only while its decoded working set stays reasonable. PNG and
        // CF_HDROP remain available for very tall captures without allocating hundreds of MB.
        let dib = image::load_from_memory_with_format(&bytes, ImageFormat::Png)
            .ok()
            .and_then(|decoded| {
                let (width, height) = decoded.dimensions();
                if u64::from(width) * u64::from(height) > 16_000_000 {
                    return None;
                }
                let mut bmp = Vec::new();
                decoded
                    .write_to(&mut Cursor::new(&mut bmp), ImageFormat::Bmp)
                    .ok()?;
                (bmp.len() > 14).then(|| bmp.split_off(14))
            });
        let png_format = clipboard_win::register_format("PNG")
            .ok_or_else(|| "Windows 无法注册 PNG 剪贴板格式".to_string())?;
        let mut last_error = String::from("系统剪贴板暂时不可用");
        for attempt in 0..8 {
            match Clipboard::new_attempts(3) {
                Ok(_clipboard) => match clipboard_win::empty()
                    .and_then(|_| formats::FileList.write_clipboard(&[clipboard_path.as_str()]))
                {
                    Ok(()) => {
                        if let Some(format) = clipboard_win::register_format("Preferred DropEffect")
                        {
                            let _ = clipboard_win::raw::set_without_clear(
                                format.get(),
                                &1_u32.to_le_bytes(),
                            );
                        }
                        if let Err(error) =
                            clipboard_win::raw::set_without_clear(png_format.get(), &bytes)
                        {
                            last_error = error.to_string();
                            continue;
                        }
                        if let Some(dib_bytes) = dib.as_ref() {
                            let _ =
                                clipboard_win::raw::set_without_clear(formats::CF_DIB, dib_bytes);
                        }
                        return Ok(());
                    }
                    Err(error) => last_error = error.to_string(),
                },
                Err(error) => last_error = error.to_string(),
            }
            thread::sleep(Duration::from_millis(30 + attempt * 20));
        }
        Err(format!("系统剪贴板正被占用：{}", last_error))
    })
    .await
    .map_err(|error| format!("图片复制后台任务失败：{}", error))?;
    if result.is_ok() {
        skip_current_clipboard_change(&monitor);
    }
    result
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
async fn copy_png_bytes(
    request: tauri::ipc::Request<'_>,
    _app: tauri::AppHandle,
    state: tauri::State<'_, ClipboardMonitorState>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("图片传输格式无效，请重新复制".into());
    };
    let bytes = data.to_vec();
    let monitor = state.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
            .map_err(|error| error.to_string())?
            .to_rgba8();
        let (width, height) = image.dimensions();
        let pixels = image.into_raw();
        arboard::Clipboard::new()
            .and_then(|mut clipboard| {
                clipboard.set_image(arboard::ImageData {
                    width: width as usize,
                    height: height as usize,
                    bytes: Cow::Borrowed(pixels.as_slice()),
                })
            })
            .map_err(|error| format!("系统剪贴板正被占用：{}", error))
    })
    .await
    .map_err(|error| format!("图片复制后台任务失败：{}", error))?;
    if result.is_ok() {
        skip_current_clipboard_change(&monitor);
    }
    result
}

fn safe_png_name(name: &str, index: usize) -> String {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("code-snapshot")
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches(['-', '.'])
        .to_string();
    if stem.is_empty() {
        format!("code-snapshot-{:02}.png", index + 1)
    } else {
        format!("{}.png", stem)
    }
}

static CLIPBOARD_FILE_CLEANUP: Once = Once::new();

fn clipboard_cache_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("clipboard-files");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    CLIPBOARD_FILE_CLEANUP.call_once(|| {
        if let Ok(entries) = fs::read_dir(&directory) {
            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                let expired = entry
                    .metadata()
                    .ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .and_then(|modified| modified.elapsed().ok())
                    .map(|age| age > Duration::from_secs(7 * 24 * 60 * 60))
                    .unwrap_or(false);
                if expired {
                    if path.is_dir() {
                        let _ = fs::remove_dir_all(path);
                    } else if path.is_file() {
                        let _ = fs::remove_file(path);
                    }
                }
            }
        }
    });
    Ok(directory)
}

fn safe_source_name(name: &str) -> String {
    let decoded = url::form_urlencoded::parse(name.as_bytes())
        .map(|(key, value)| format!("{}{}", key, value))
        .collect::<String>();
    let source = if decoded.is_empty() {
        name
    } else {
        decoded.as_str()
    };
    let cleaned = Path::new(source)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("image-file")
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let cleaned = cleaned.trim_matches(['-', '.']);
    if cleaned.is_empty() {
        "image-file".into()
    } else {
        cleaned.chars().take(120).collect()
    }
}

fn stage_cached_clipboard_file(
    app: &tauri::AppHandle,
    name: &str,
    data: &[u8],
) -> Result<PathBuf, String> {
    // Keep the hash in a parent directory so Explorer sees a clean, useful
    // filename instead of exposing an internal cache identifier on paste.
    let directory = clipboard_cache_directory(app)?.join(digest(data));
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(safe_source_name(name));
    if !path.is_file() {
        fs::write(&path, data).map_err(|error| error.to_string())?;
    }
    Ok(path)
}

fn request_number(request: &tauri::ipc::Request<'_>, name: &str, default: f64) -> f64 {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

#[tauri::command]
async fn process_gif_bytes(
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    use image::{metadata::LoopCount, AnimationDecoder};

    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("GIF 传输格式无效".into());
    };
    if data.is_empty() || data.len() > 256 * 1024 * 1024 {
        return Err("GIF 为空或超过 256 MB".into());
    }
    let bytes = data.to_vec();
    let quality = request_number(&request, "x-toolknit-quality", 100.0).clamp(20.0, 100.0);
    let mode = request
        .headers()
        .get("x-toolknit-mode")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("convert")
        .to_string();
    let max_width =
        request_number(&request, "x-toolknit-max-width", 1920.0).clamp(100.0, 7680.0) as u32;
    let rotation = request_number(&request, "x-toolknit-rotation", 0.0) as i32;
    let crop_left = request_number(&request, "x-toolknit-crop-left", 0.0).clamp(0.0, 100.0);
    let crop_top = request_number(&request, "x-toolknit-crop-top", 0.0).clamp(0.0, 100.0);
    let crop_width =
        request_number(&request, "x-toolknit-crop-width", 100.0).clamp(1.0, 100.0 - crop_left);
    let crop_height =
        request_number(&request, "x-toolknit-crop-height", 100.0).clamp(1.0, 100.0 - crop_top);
    let output = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        use image::codecs::gif::{GifDecoder, GifEncoder, Repeat};
        use image::imageops::{crop_imm, resize, rotate180, rotate270, rotate90, FilterType};

        let decoder = GifDecoder::new(Cursor::new(bytes))
            .map_err(|error| format!("无法读取 GIF：{}", error))?;
        let repeat = match decoder.loop_count() {
            LoopCount::Infinite => Repeat::Infinite,
            LoopCount::Finite(count) => Repeat::Finite(count.get().min(u16::MAX.into()) as u16),
        };
        // gif-rs uses 1..=30: lower is slower and higher-quality. Map the UI's
        // 100..=20 quality range onto that documented quantization range.
        let speed = 1 + (((100.0 - quality) / 80.0) * 29.0).round() as i32;
        let mut output = Vec::new();
        let mut encoder = GifEncoder::new_with_speed(&mut output, speed.clamp(1, 30));
        encoder
            .set_repeat(repeat)
            .map_err(|error| format!("无法设置 GIF 循环：{}", error))?;
        let mut frame_count = 0_usize;
        let mut total_pixels = 0_u64;
        for frame in decoder.into_frames() {
            let frame = frame.map_err(|error| format!("无法解析 GIF 动画帧：{}", error))?;
            frame_count += 1;
            if frame_count > 1200 {
                return Err("GIF 超过 1200 帧，为避免内存不足已停止处理".into());
            }
            let delay = frame.delay();
            let buffer = frame.into_buffer();
            let (width, height) = buffer.dimensions();
            total_pixels = total_pixels.saturating_add(u64::from(width) * u64::from(height));
            if total_pixels > 240_000_000 {
                return Err("GIF 总像素量过大，请先降低尺寸或帧数".into());
            }
            let (left, top, crop_w, crop_h) = if mode == "crop" {
                let left = ((f64::from(width) * crop_left / 100.0).round() as u32).min(width - 1);
                let top = ((f64::from(height) * crop_top / 100.0).round() as u32).min(height - 1);
                let crop_w = (f64::from(width) * crop_width / 100.0).round().max(1.0) as u32;
                let crop_h = (f64::from(height) * crop_height / 100.0).round().max(1.0) as u32;
                (
                    left,
                    top,
                    crop_w.min(width - left).max(1),
                    crop_h.min(height - top).max(1),
                )
            } else {
                (0, 0, width, height)
            };
            let mut image = crop_imm(&buffer, left, top, crop_w, crop_h).to_image();
            if mode == "resize" && image.width() > max_width {
                let target_height = (u64::from(image.height()) * u64::from(max_width)
                    / u64::from(image.width()))
                .max(1) as u32;
                image = resize(&image, max_width, target_height, FilterType::Lanczos3);
            }
            if mode == "rotate" {
                image = match rotation.rem_euclid(360) {
                    90 => rotate90(&image),
                    180 => rotate180(&image),
                    270 => rotate270(&image),
                    _ => image,
                };
            }
            if image.width() > u16::MAX.into() || image.height() > u16::MAX.into() {
                return Err("GIF 输出尺寸超过格式上限".into());
            }
            encoder
                .encode_frame(image::Frame::from_parts(image, 0, 0, delay))
                .map_err(|error| format!("无法编码 GIF：{}", error))?;
        }
        if frame_count == 0 {
            return Err("GIF 中没有可处理的动画帧".into());
        }
        drop(encoder);
        Ok(output)
    })
    .await
    .map_err(|error| format!("GIF 后台处理失败：{}", error))??;
    Ok(tauri::ipc::Response::new(output))
}

#[cfg(target_os = "windows")]
fn windows_clipboard_path(path: &Path) -> String {
    let canonical = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned();
    if let Some(value) = canonical.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", value)
    } else {
        canonical
            .strip_prefix(r"\\?\")
            .unwrap_or(&canonical)
            .to_string()
    }
}

#[tauri::command]
fn stage_clipboard_png(
    request: tauri::ipc::Request<'_>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("图片传输格式无效，请重新复制".into());
    };
    let name = request
        .headers()
        .get("x-toolknit-file-name")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("code-snapshot.png");
    // The app's canvas already encoded these bytes as PNG. Decoding every page
    // again here made multi-file copy unnecessarily expensive.
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if !data.starts_with(PNG_SIGNATURE) {
        return Err("生成的 PNG 无效".into());
    }
    let path = stage_cached_clipboard_file(&app, &safe_png_name(name, 0), data)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn stage_clipboard_file(
    request: tauri::ipc::Request<'_>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("文件传输格式无效，请重新复制".into());
    };
    if data.is_empty() || data.len() > 256 * 1024 * 1024 {
        return Err("源文件为空或超过 256 MB，无法写入剪贴板".into());
    }
    let name = request
        .headers()
        .get("x-toolknit-file-name")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image-file");
    let safe_name = safe_source_name(name);
    let allowed = Path::new(&safe_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "svg"
            )
        })
        .unwrap_or(false);
    if !allowed {
        return Err("只允许暂存常见图片源文件".into());
    }
    let path = stage_cached_clipboard_file(&app, &safe_name, data)?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn copy_staged_png_files(paths: Vec<String>, app: tauri::AppHandle) -> Result<(), String> {
    use clipboard_win::{formats, Clipboard, Getter, Setter};

    if paths.is_empty() {
        return Err("没有可复制的图片".into());
    }
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("clipboard-files");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let mut verified = Vec::with_capacity(paths.len());
    for path in paths {
        let candidate = Path::new(&path)
            .canonicalize()
            .map_err(|_| "暂存图片已不存在，请重新复制".to_string())?;
        if !candidate.starts_with(&canonical_root)
            || !candidate.is_file()
            || candidate
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| {
                    !matches!(
                        value.to_ascii_lowercase().as_str(),
                        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "svg"
                    )
                })
                .unwrap_or(true)
        {
            return Err("检测到无效的图片暂存路径".into());
        }
        let canonical = candidate.to_string_lossy();
        let clipboard_path = if let Some(path) = canonical.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{}", path)
        } else {
            canonical
                .strip_prefix(r"\\?\")
                .unwrap_or(&canonical)
                .to_string()
        };
        verified.push(clipboard_path);
    }
    // A single staged PNG is used by continuous-code capture. Publish both a
    // normal Explorer-style file and the registered PNG payload: chat clients
    // that ignore Windows' PNG format can consume CF_HDROP, while editors that
    // understand PNG can still paste it directly as an image.
    let single_png = if verified.len() == 1
        && Path::new(&verified[0])
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("png"))
            .unwrap_or(false)
    {
        fs::read(&verified[0]).ok()
    } else {
        None
    };
    let mut last_error = String::from("Windows 剪贴板正被其他程序占用");
    for attempt in 0..10 {
        match Clipboard::new_attempts(5) {
            Ok(_clipboard) => match clipboard_win::empty()
                .and_then(|_| formats::FileList.write_clipboard(verified.as_slice()))
            {
                Ok(()) => {
                    // Match Explorer's Ctrl+C file clipboard: CF_HDROP plus a copy drop effect.
                    // Without clearing first, a stale bitmap from the previous single-image copy
                    // remains available and chat clients may prefer it over the new file list.
                    if let Some(format) = clipboard_win::register_format("Preferred DropEffect") {
                        let _ = clipboard_win::raw::set_without_clear(
                            format.get(),
                            &1_u32.to_le_bytes(),
                        );
                    }
                    if let (Some(format), Some(png)) =
                        (clipboard_win::register_format("PNG"), single_png.as_ref())
                    {
                        let _ = clipboard_win::raw::set_without_clear(format.get(), png);
                    }
                    let mut copied = Vec::<String>::with_capacity(verified.len());
                    match formats::FileList.read_clipboard(&mut copied) {
                        Ok(count) if count == verified.len() => return Ok(()),
                        Ok(count) => {
                            last_error =
                                format!("写入 {} 个文件后只读取到 {} 个", verified.len(), count)
                        }
                        Err(error) => last_error = format!("无法校验文件列表：{}", error),
                    }
                }
                Err(error) => last_error = error.to_string(),
            },
            Err(error) => last_error = error.to_string(),
        }
        thread::sleep(Duration::from_millis(40 + attempt * 25));
    }
    Err(format!(
        "多张图片未能写入系统剪贴板：{}。请关闭正在读取剪贴板的软件后重试",
        last_error
    ))
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn copy_staged_png_files(_paths: Vec<String>, _app: tauri::AppHandle) -> Result<(), String> {
    Err("多张独立图片复制目前仅支持 Windows 桌面端".into())
}

#[tauri::command]
fn cleanup_clipboard_assets(
    active_paths: Vec<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("clipboard");
    if !directory.exists() {
        return Ok(());
    }
    let active: std::collections::HashSet<String> = active_paths.into_iter().collect();
    for entry in fs::read_dir(&directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if path.is_file() && !active.contains(&path.to_string_lossy().into_owned()) {
            let _ = fs::remove_file(path);
        }
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
    if !input.is_file() {
        return Err("原输出文件已不存在".into());
    }
    let output = Path::new(&destination);
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(input, output).map_err(|error| error.to_string())?;
    Ok(output.to_string_lossy().into_owned())
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

#[tauri::command]
fn inspect_input_file(path: String) -> Result<InputFileMetadataPayload, String> {
    let file = Path::new(&path);
    if !file.is_file() {
        return Err("选择的路径不是文件".into());
    }
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    let name = file
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file")
        .to_string();
    let mime = mime_guess::from_path(file)
        .first_or_octet_stream()
        .to_string();
    Ok(InputFileMetadataPayload {
        name,
        path,
        mime,
        size: metadata.len(),
    })
}

#[tauri::command]
fn read_input_file(path: String) -> Result<InputFilePayload, String> {
    let file = Path::new(&path);
    if !file.is_file() {
        return Err("拖入的路径不是文件".into());
    }
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if metadata.len() > 250 * 1024 * 1024 {
        return Err("单个文件不能超过 250 MB".into());
    }
    Ok(InputFilePayload {
        name: file
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
            .to_string(),
        path: path.clone(),
        mime: mime_guess::from_path(file)
            .first_or_octet_stream()
            .to_string(),
        size: metadata.len(),
        data: fs::read(file).map_err(|error| error.to_string())?,
    })
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("文件已不存在".into());
    }
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer.exe")
        .arg("/select,")
        .arg(&path)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn check_github_update() -> Result<GitHubRelease, String> {
    reqwest::Client::new()
        .get("https://api.github.com/repos/longtiandragon/ToolKnit/releases/latest")
        .header("User-Agent", "ToolKnit")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[derive(Default)]
struct PendingOpenFiles(Mutex<Vec<String>>);

fn collect_markdown_open_paths(args: &[String], cwd: &Path) -> Vec<String> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();
    for argument in args {
        if paths.len() >= 8 {
            break;
        }
        let candidate = Path::new(argument);
        let supported = candidate
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| {
                matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "md" | "mdx" | "markdown" | "mkd"
                )
            })
            .unwrap_or(false);
        if !supported {
            continue;
        }
        let absolute = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            cwd.join(candidate)
        };
        let Ok(canonical) = absolute.canonicalize() else {
            continue;
        };
        if !canonical.is_file() {
            continue;
        }
        let display = canonical.to_string_lossy().into_owned();
        let identity = if cfg!(target_os = "windows") {
            display.to_ascii_lowercase()
        } else {
            display.clone()
        };
        if seen.insert(identity) {
            paths.push(display);
        }
    }
    paths
}

fn queue_pending_open_files(state: &PendingOpenFiles, paths: &[String]) {
    if paths.is_empty() {
        return;
    }
    let Ok(mut pending) = state.0.lock() else {
        return;
    };
    for path in paths {
        let already_pending = pending.iter().any(|current| {
            if cfg!(target_os = "windows") {
                current.eq_ignore_ascii_case(path)
            } else {
                current == path
            }
        });
        if !already_pending && pending.len() < 8 {
            pending.push(path.clone());
        }
    }
}

#[tauri::command]
fn take_pending_open_files(state: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}

#[cfg(test)]
mod desktop_open_tests {
    use super::collect_markdown_open_paths;
    use std::{fs, path::Path};

    #[test]
    fn accepts_existing_markdown_and_rejects_other_launch_arguments() {
        let root =
            std::env::temp_dir().join(format!("knitspace-open-test-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&root).expect("create test directory");
        fs::write(root.join("note.md"), "# note").expect("write markdown fixture");
        fs::write(root.join("image.png"), "not an image").expect("write ignored fixture");
        let arguments = vec![
            "knitspace.exe".to_string(),
            "note.md".to_string(),
            "note.md".to_string(),
            "image.png".to_string(),
            "missing.markdown".to_string(),
        ];
        let paths = collect_markdown_open_paths(&arguments, Path::new(&root));
        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("note.md"));
        fs::remove_dir_all(root).expect("remove test directory");
    }
}

pub fn run() {
    let launch_args = std::env::args().collect::<Vec<_>>();
    let launch_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let launch_paths = collect_markdown_open_paths(&launch_args, &launch_cwd);

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = collect_markdown_open_paths(&args, Path::new(&cwd));
            queue_pending_open_files(app.state::<PendingOpenFiles>().inner(), &paths);
            if !paths.is_empty() {
                let _ = app.emit("knitspace://open-markdown", ());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(ClipboardMonitorState::default());
    #[cfg(not(feature = "public-core"))]
    let builder = builder.manage(PrivateToolRunState::default());
    builder
        .manage(MediaTranscodeState::default())
        .manage(TranscriptionState::default())
        .manage(ExternalMarkdownWatchState::default())
        .manage(PendingOpenFiles(Mutex::new(launch_paths)))
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<ClipboardMonitorState>().inner().clone();
            start_clipboard_monitor(handle, state);
            let show = MenuItem::with_id(app, "show", "显示 Knitspace", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "隐藏到托盘", true, None::<&str>)?;
            let clipboard =
                MenuItem::with_id(app, "clipboard", "暂停 / 继续剪贴板", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "彻底退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &clipboard, &settings, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "clipboard" => {
                        let _ = app.emit("toolknit://tray-clipboard", ());
                    }
                    "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("toolknit://tray-settings", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_vault,
            get_default_vault_health,
            get_default_vault_storage_space,
            import_source,
            save_markdown,
            hydrate_default_vault,
            hydrate_default_sources,
            hydrate_default_content_favorites,
            set_default_content_favorite,
            replace_default_content_favorites,
            hydrate_default_content_recents,
            touch_default_content_recent,
            remove_default_content_recent,
            clear_default_content_recents,
            replace_default_content_recents,
            import_default_source,
            automatic_default_vault_backup,
            create_default_vault_backup,
            inspect_default_vault_backup,
            restore_default_vault_backup,
            create_zip_archive,
            list_zip_archive,
            extract_zip_archive,
            create_tar_archive,
            list_tar_archive,
            extract_tar_archive,
            seven_zip_engine_status,
            engine_registry_status,
            image_metadata::inspect_image_metadata,
            pdf_tools::optimize_pdf_bytes,
            pdf_tools::protect_pdf_bytes,
            pdf_tools::decrypt_pdf_bytes,
            create_seven_zip_archive,
            list_seven_zip_archive,
            extract_seven_zip_archive,
            save_default_source,
            get_default_source,
            touch_default_source,
            save_default_source_tags,
            save_default_source_crops,
            get_default_source_crop,
            save_default_vault_document,
            save_default_question_batch,
            get_default_vault_document,
            reconcile_default_vault_markdown,
            list_default_document_versions,
            get_default_document_version,
            preserve_default_document_version,
            save_default_editor_crash_draft,
            get_default_editor_crash_draft,
            delete_default_editor_crash_draft,
            export_default_vault_documents,
            export_default_vocabulary,
            delete_default_vault_document,
            list_default_question_attachments,
            import_default_question_attachment,
            resolve_default_question_attachment,
            delete_default_question_attachment,
            stage_default_visual_project_image,
            save_default_visual_project,
            list_default_visual_projects,
            get_default_visual_project,
            delete_default_visual_project,
            replace_default_vault_documents,
            search_default_vault_documents,
            search_default_vocabulary,
            find_default_wiki_backlinks,
            list_default_wiki_links,
            save_default_vocabulary,
            save_default_vocabulary_batch,
            get_default_vocabulary,
            list_default_due_review_cards,
            get_default_review_queue_summary,
            grade_default_review_card,
            undo_default_review_grade,
            list_default_review_history,
            get_default_review_analytics,
            delete_default_vocabulary,
            replace_default_vocabulary,
            save_default_relation,
            delete_default_relation,
            replace_default_relations,
            list_default_events,
            list_default_personal_events,
            list_default_focus_events,
            get_default_focus_analytics,
            list_default_activity_events,
            save_default_event,
            import_default_legacy_events,
            replace_default_activity_events,
            delete_default_event,
            hydrate_default_processing_jobs,
            list_default_processing_jobs,
            get_default_processing_job,
            save_default_processing_job,
            delete_default_processing_job,
            delete_default_processing_jobs,
            clear_default_finished_processing_jobs,
            hydrate_default_clipboard,
            get_default_clipboard_item,
            save_default_clipboard_item,
            set_default_clipboard_item_pinned,
            delete_default_clipboard_item,
            clear_default_clipboard_items,
            list_external_markdown_directory,
            search_external_markdown_workspace,
            search_external_markdown_content,
            create_external_markdown_entry,
            rename_external_markdown_entry,
            move_external_markdown_entry,
            duplicate_external_markdown_entry,
            trash_external_markdown_entry,
            read_external_markdown,
            inspect_external_markdown,
            watch_external_markdown,
            unwatch_external_markdown,
            watch_external_markdown_workspace,
            unwatch_external_markdown_workspace,
            watch_default_vault_markdown,
            write_external_markdown,
            read_external_markdown_image,
            import_markdown_image,
            paste_markdown_clipboard_image,
            read_default_vault_markdown_image,
            write_api_key,
            has_api_key,
            delete_api_key,
            run_ai_action,
            cancel_ai_action,
            #[cfg(not(feature = "public-core"))]
            load_private_tools,
            #[cfg(not(feature = "public-core"))]
            run_private_tool,
            #[cfg(not(feature = "public-core"))]
            cancel_private_tool_run,
            media_engine_status,
            inspect_media_file,
            analyze_media_silence,
            analyze_media_black,
            analyze_media_waveform,
            transcode_media_file,
            cancel_media_transcode,
            probe_transcription_engine,
            transcribe_media_file,
            cancel_transcription,
            set_clipboard_monitor,
            read_clipboard_current,
            copy_clipboard,
            copy_png_bytes,
            process_gif_bytes,
            stage_clipboard_png,
            stage_clipboard_file,
            copy_staged_png_files,
            cleanup_clipboard_assets,
            save_output,
            copy_output_file,
            file_exists,
            read_input_file,
            inspect_input_file,
            capture_foreground_window,
            windows_ocr::probe_windows_ocr,
            windows_ocr::read_ocr_font,
            windows_ocr::recognize_image_text,
            windows_ocr::recognize_image_bytes,
            file_health::scan_file_health,
            file_health::compare_directories,
            file_health::create_file_manifest,
            file_health::recycle_file_health_paths,
            reveal_in_folder,
            check_github_update,
            take_pending_open_files,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Knitspace");
}
