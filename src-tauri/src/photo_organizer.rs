use chrono::{Datelike, Local, NaiveDateTime, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const MAX_PHOTOS: usize = 5_000;
const MAX_EXIF_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_RECEIPT_BYTES: u64 = 8 * 1024 * 1024;
const EXIF_TIMEOUT: Duration = Duration::from_secs(60);
const RECEIPT_KEEP_COUNT: usize = 50;
const PHOTO_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif", "avif",
];

#[derive(Clone, Default)]
pub struct PhotoOrganizerRunState {
    active: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl PhotoOrganizerRunState {
    fn begin(&self, run_id: &str) -> Result<Arc<AtomicBool>, String> {
        validate_id(run_id, "运行标识")?;
        let mut active = self.active.lock().map_err(|_| "照片整理任务状态不可用。")?;
        if active.contains_key(run_id) {
            return Err("相同的照片整理任务已在运行。".into());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        active.insert(run_id.to_owned(), cancelled.clone());
        Ok(cancelled)
    }

    fn finish(&self, run_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(run_id);
        }
    }

    fn cancel(&self, run_id: &str) -> Result<bool, String> {
        validate_id(run_id, "运行标识")?;
        let active = self.active.lock().map_err(|_| "照片整理任务状态不可用。")?;
        Ok(active.get(run_id).is_some_and(|flag| {
            flag.store(true, Ordering::SeqCst);
            true
        }))
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoOrganizationScanRequest {
    pub source_root: String,
    pub destination_root: String,
    pub naming: String,
    #[serde(default)]
    pub fallback_to_file_modified: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoOrganizationPlanItem {
    pub source_path: String,
    pub source_relative_path: String,
    pub target_path: Option<String>,
    pub target_relative_path: Option<String>,
    pub captured_at: Option<String>,
    pub date_source: Option<String>,
    pub size: u64,
    pub modified_ms: u64,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoOrganizationPlan {
    pub plan_id: String,
    pub source_root: String,
    pub destination_root: String,
    pub scanned_count: usize,
    pub move_count: usize,
    pub same_count: usize,
    pub conflict_count: usize,
    pub skipped_count: usize,
    pub fallback_count: usize,
    pub truncated: bool,
    pub warnings: Vec<String>,
    pub items: Vec<PhotoOrganizationPlanItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoOrganizationMoveInput {
    pub source_relative_path: String,
    pub target_relative_path: String,
    pub expected_size: u64,
    pub expected_modified_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoOrganizationExecuteRequest {
    pub plan_id: String,
    pub source_root: String,
    pub destination_root: String,
    pub moves: Vec<PhotoOrganizationMoveInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoOrganizationExecutionReport {
    pub receipt_id: String,
    pub moved_count: usize,
    pub moved_bytes: u64,
    pub output_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoOrganizationReceiptSummary {
    pub receipt_id: String,
    pub created_at: String,
    pub source_root: String,
    pub destination_root: String,
    pub moved_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoOrganizationUndoReport {
    pub receipt_id: String,
    pub restored_count: usize,
}

#[derive(Debug, Clone)]
struct PhotoCandidate {
    source_path: PathBuf,
    source_relative_path: String,
    captured_at: Option<NaiveDateTime>,
    date_source: Option<String>,
    size: u64,
    modified_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhotoMoveReceiptItem {
    source_relative_path: String,
    target_relative_path: String,
    size: u64,
    modified_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhotoMoveReceipt {
    version: u32,
    receipt_id: String,
    created_at: String,
    source_root: String,
    destination_root: String,
    moves: Vec<PhotoMoveReceiptItem>,
}

fn validate_id(value: &str, label: &str) -> Result<(), String> {
    Uuid::parse_str(value).map_err(|_| format!("{label}格式无效。"))?;
    Ok(())
}

fn canonical_directory(raw: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(format!("{label}必须是本地绝对路径。"));
    }
    let metadata = fs::metadata(&path).map_err(|_| format!("{label}不存在或无法读取。"))?;
    if !metadata.is_dir() {
        return Err(format!("{label}不是文件夹。"));
    }
    fs::canonicalize(path).map_err(|error| format!("无法定位{label}：{error}"))
}

fn ensure_same_storage_root(source: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(windows)]
    if source.components().next() != destination.components().next() {
        return Err("源目录和目标目录不在同一磁盘；当前版本不会执行跨磁盘移动。".into());
    }
    #[cfg(not(windows))]
    let _ = (source, destination);
    Ok(())
}

fn safe_relative_path(raw: &str) -> Result<PathBuf, String> {
    let normalized = raw.replace('\\', "/");
    if normalized.is_empty() || normalized.starts_with('/') || normalized.starts_with("//") {
        return Err("照片整理计划包含不安全的相对路径。".into());
    }
    let mut path = PathBuf::new();
    for segment in normalized.split('/') {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.contains(':')
            || segment.contains('\0')
        {
            return Err("照片整理计划包含不安全的相对路径。".into());
        }
        path.push(segment);
    }
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("照片整理计划包含不安全的相对路径。".into());
    }
    Ok(path)
}

fn modified_ms(metadata: &fs::Metadata) -> Result<u64, String> {
    let duration = metadata
        .modified()
        .map_err(|error| format!("无法读取文件修改时间：{error}"))?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "文件修改时间早于系统时间起点。".to_string())?;
    Ok(duration.as_millis().min(u128::from(u64::MAX)) as u64)
}

fn read_bounded(mut reader: impl Read + Send + 'static) -> Result<(Vec<u8>, bool), String> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 16 * 1024];
    let mut truncated = false;
    loop {
        let length = reader
            .read(&mut buffer)
            .map_err(|error| format!("读取 ExifTool 输出失败：{error}"))?;
        if length == 0 {
            break;
        }
        let remaining = MAX_EXIF_OUTPUT_BYTES.saturating_sub(bytes.len());
        if remaining > 0 {
            bytes.extend_from_slice(&buffer[..length.min(remaining)]);
        }
        truncated |= length > remaining;
    }
    Ok((bytes, truncated))
}

fn wait_with_timeout(mut child: Child) -> Result<(ExitStatus, Vec<u8>, Vec<u8>, bool), String> {
    let stdout = child.stdout.take().ok_or("无法读取 ExifTool 标准输出。")?;
    let stderr = child.stderr.take().ok_or("无法读取 ExifTool 错误输出。")?;
    let stdout_thread = thread::spawn(|| read_bounded(stdout));
    let stderr_thread = thread::spawn(|| read_bounded(stderr));
    let deadline = Instant::now() + EXIF_TIMEOUT;
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("无法检查 ExifTool 状态：{error}"))?
        {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();
            return Err("ExifTool 批量扫描超时，已停止该进程。".into());
        }
        thread::sleep(Duration::from_millis(30));
    };
    let (stdout, stdout_truncated) = stdout_thread
        .join()
        .map_err(|_| "ExifTool 标准输出线程异常退出。")??;
    let (stderr, stderr_truncated) = stderr_thread
        .join()
        .map_err(|_| "ExifTool 错误输出线程异常退出。")??;
    Ok((status, stdout, stderr, stdout_truncated || stderr_truncated))
}

fn run_exiftool(root: &Path) -> Result<(Vec<u8>, bool), String> {
    let mut last_error = None;
    for candidate in ["exiftool.exe", "exiftool"] {
        let mut command = Command::new(candidate);
        command.args([
            "-json",
            "-G1",
            "-s",
            "-a",
            "-d",
            "%Y-%m-%dT%H:%M:%S",
            "-DateTimeOriginal",
            "-CreateDate",
            "-ModifyDate",
            "-r",
        ]);
        for extension in PHOTO_EXTENSIONS {
            command.arg("-ext").arg(extension);
        }
        let child = match command
            .arg("--")
            .arg(root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => {
                last_error = Some(error.to_string());
                continue;
            }
        };
        let (status, stdout, stderr, truncated) = wait_with_timeout(child)?;
        if truncated {
            return Err("ExifTool 扫描结果超过 16 MB 安全上限；请缩小源目录后重试。".into());
        }
        if !status.success() {
            let detail = String::from_utf8_lossy(&stderr)
                .trim()
                .chars()
                .take(500)
                .collect::<String>();
            return Err(if detail.is_empty() {
                "ExifTool 无法扫描该目录。".into()
            } else {
                detail
            });
        }
        return Ok((stdout, false));
    }
    Err(format!(
        "未检测到 ExifTool。请安装 ExifTool 并加入系统 PATH 后重试。{}",
        last_error
            .map(|error| format!(
                " 最近一次启动错误：{}",
                error.chars().take(180).collect::<String>()
            ))
            .unwrap_or_default()
    ))
}

fn parse_date(value: &Value) -> Option<NaiveDateTime> {
    let raw = value.as_str()?.trim();
    let prefix = raw.get(..19)?;
    NaiveDateTime::parse_from_str(prefix, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(prefix, "%Y:%m:%d %H:%M:%S"))
        .ok()
        .filter(|date| (1900..=2200).contains(&date.year()))
}

fn metadata_date(object: &serde_json::Map<String, Value>) -> Option<(NaiveDateTime, String)> {
    for tag in ["DateTimeOriginal", "CreateDate", "ModifyDate"] {
        if let Some((key, date)) = object.iter().find_map(|(key, value)| {
            (key.rsplit(':').next() == Some(tag))
                .then(|| parse_date(value).map(|date| (key, date)))
                .flatten()
        }) {
            return Some((date, key.clone()));
        }
    }
    None
}

fn file_modified_date(metadata: &fs::Metadata) -> Option<NaiveDateTime> {
    let modified = metadata.modified().ok()?;
    let date: chrono::DateTime<Local> = modified.into();
    Some(date.naive_local())
}

fn parse_candidates(
    root: &Path,
    stdout: &[u8],
    fallback: bool,
) -> Result<(Vec<PhotoCandidate>, bool), String> {
    let values: Vec<Value> = serde_json::from_slice(stdout)
        .map_err(|error| format!("无法解析 ExifTool 扫描结果：{error}"))?;
    let mut candidates = Vec::new();
    let mut truncated = false;
    let mut seen = HashSet::new();
    for value in values {
        if candidates.len() >= MAX_PHOTOS {
            truncated = true;
            break;
        }
        let Some(object) = value.as_object() else {
            continue;
        };
        let Some(raw_path) = object.get("SourceFile").and_then(Value::as_str) else {
            continue;
        };
        let path = match fs::canonicalize(raw_path) {
            Ok(path) if path.starts_with(root) => path,
            _ => continue,
        };
        if !seen.insert(path.clone()) {
            continue;
        }
        let link_metadata =
            fs::symlink_metadata(&path).map_err(|error| format!("无法检查照片路径：{error}"))?;
        if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
            continue;
        }
        let metadata = fs::metadata(&path).map_err(|error| format!("无法读取照片信息：{error}"))?;
        let source_relative_path = path
            .strip_prefix(root)
            .map_err(|_| "照片路径超出源目录。")?
            .to_string_lossy()
            .replace('\\', "/");
        let (captured_at, date_source) = metadata_date(object)
            .map(|(date, source)| (Some(date), Some(source)))
            .unwrap_or_else(|| {
                if fallback {
                    (file_modified_date(&metadata), Some("FileModifyDate".into()))
                } else {
                    (None, None)
                }
            });
        candidates.push(PhotoCandidate {
            source_path: path,
            source_relative_path,
            captured_at,
            date_source,
            size: metadata.len(),
            modified_ms: modified_ms(&metadata)?,
        });
    }
    candidates.sort_by(|left, right| left.source_relative_path.cmp(&right.source_relative_path));
    Ok((candidates, truncated))
}

fn target_name(
    candidate: &PhotoCandidate,
    naming: &str,
    occurrence: usize,
) -> Result<String, String> {
    let date = candidate.captured_at.ok_or("照片没有可用日期。")?;
    let original = candidate
        .source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("photo");
    let extension = candidate
        .source_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("jpg");
    let base = match naming {
        "keep" => original.to_owned(),
        "datetime" => format!(
            "{:04}{:02}{:02}-{:02}{:02}{:02}",
            date.year(),
            date.month(),
            date.day(),
            date.hour(),
            date.minute(),
            date.second()
        ),
        "datetime-original" => format!(
            "{:04}{:02}{:02}-{:02}{:02}{:02}-{original}",
            date.year(),
            date.month(),
            date.day(),
            date.hour(),
            date.minute(),
            date.second()
        ),
        _ => return Err("照片命名方式无效。".into()),
    };
    Ok(if occurrence > 1 {
        format!("{base}-{occurrence:02}.{extension}")
    } else {
        format!("{base}.{extension}")
    })
}

fn build_plan(
    source_root: &Path,
    destination_root: &Path,
    candidates: Vec<PhotoCandidate>,
    naming: &str,
    truncated: bool,
) -> Result<PhotoOrganizationPlan, String> {
    if !matches!(naming, "keep" | "datetime" | "datetime-original") {
        return Err("照片命名方式无效。".into());
    }
    let mut occurrences = HashMap::<String, usize>::new();
    let mut items = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        let Some(date) = candidate.captured_at else {
            items.push(PhotoOrganizationPlanItem {
                source_path: candidate.source_path.to_string_lossy().into_owned(),
                source_relative_path: candidate.source_relative_path,
                target_path: None,
                target_relative_path: None,
                captured_at: None,
                date_source: None,
                size: candidate.size,
                modified_ms: candidate.modified_ms,
                status: "skipped".into(),
                detail: "没有找到拍摄日期；未启用文件修改时间回退。".into(),
            });
            continue;
        };
        let first_name = target_name(&candidate, naming, 1)?;
        let date_key =
            format!("{:04}/{:02}/{first_name}", date.year(), date.month()).to_lowercase();
        let occurrence = occurrences
            .entry(date_key)
            .and_modify(|value| *value += 1)
            .or_insert(1);
        let name = target_name(&candidate, naming, *occurrence)?;
        let relative = PathBuf::from(format!("{:04}", date.year()))
            .join(format!("{:02}", date.month()))
            .join(name);
        let target = destination_root.join(&relative);
        let same = target == candidate.source_path;
        let conflict = !same && target.exists();
        let (status, detail) = if same {
            ("same", "照片已经位于目标年月目录，无需移动。")
        } else if conflict {
            ("conflict", "目标文件已经存在；不会覆盖，请先处理冲突。")
        } else {
            ("move", "执行后移动到目标年月目录；失败或取消会自动回滚。")
        };
        items.push(PhotoOrganizationPlanItem {
            source_path: candidate.source_path.to_string_lossy().into_owned(),
            source_relative_path: candidate.source_relative_path,
            target_path: Some(target.to_string_lossy().into_owned()),
            target_relative_path: Some(relative.to_string_lossy().replace('\\', "/")),
            captured_at: Some(date.format("%Y-%m-%d %H:%M:%S").to_string()),
            date_source: candidate.date_source,
            size: candidate.size,
            modified_ms: candidate.modified_ms,
            status: status.into(),
            detail: detail.into(),
        });
    }
    let move_count = items.iter().filter(|item| item.status == "move").count();
    let same_count = items.iter().filter(|item| item.status == "same").count();
    let conflict_count = items
        .iter()
        .filter(|item| item.status == "conflict")
        .count();
    let skipped_count = items.iter().filter(|item| item.status == "skipped").count();
    let fallback_count = items
        .iter()
        .filter(|item| item.date_source.as_deref() == Some("FileModifyDate"))
        .count();
    let mut warnings = vec![
        "这是移动计划预览：执行前会再次校验源文件，绝不会覆盖已有目标文件。".into(),
        "当前执行器使用同卷原子移动；跨磁盘移动会失败并回滚已经完成的步骤。".into(),
        "回滚凭据保存在 Knitspace 应用数据目录，最多保留最近 50 次成功整理。".into(),
    ];
    if truncated {
        warnings
            .push("扫描触及 5,000 张照片上限；当前计划不完整，已禁止执行，请缩小源目录。".into());
    }
    Ok(PhotoOrganizationPlan {
        plan_id: Uuid::now_v7().to_string(),
        source_root: source_root.to_string_lossy().into_owned(),
        destination_root: destination_root.to_string_lossy().into_owned(),
        scanned_count: items.len(),
        move_count,
        same_count,
        conflict_count,
        skipped_count,
        fallback_count,
        truncated,
        warnings,
        items,
    })
}

fn scan_blocking(request: PhotoOrganizationScanRequest) -> Result<PhotoOrganizationPlan, String> {
    let source_root = canonical_directory(&request.source_root, "源目录")?;
    let destination_root = canonical_directory(&request.destination_root, "目标目录")?;
    ensure_same_storage_root(&source_root, &destination_root)?;
    let (stdout, _) = run_exiftool(&source_root)?;
    let (candidates, truncated) =
        parse_candidates(&source_root, &stdout, request.fallback_to_file_modified)?;
    build_plan(
        &source_root,
        &destination_root,
        candidates,
        &request.naming,
        truncated,
    )
}

fn receipt_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("photo-organizer-runs"))
        .map_err(|error| format!("无法定位照片整理回滚目录：{error}"))
}

fn receipt_path(directory: &Path, receipt_id: &str) -> Result<PathBuf, String> {
    validate_id(receipt_id, "回滚凭据")?;
    Ok(directory.join(format!("{receipt_id}.json")))
}

fn write_receipt(directory: &Path, receipt: &PhotoMoveReceipt) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| format!("无法创建照片整理回滚目录：{error}"))?;
    let path = receipt_path(directory, &receipt.receipt_id)?;
    let staging = directory.join(format!(".{}.tmp", receipt.receipt_id));
    let bytes =
        serde_json::to_vec_pretty(receipt).map_err(|error| format!("无法生成回滚凭据：{error}"))?;
    if bytes.len() as u64 > MAX_RECEIPT_BYTES {
        return Err("回滚凭据超过安全上限。".into());
    }
    fs::write(&staging, bytes).map_err(|error| format!("无法写入回滚凭据：{error}"))?;
    fs::rename(&staging, &path).map_err(|error| {
        let _ = fs::remove_file(&staging);
        format!("无法保存回滚凭据：{error}")
    })?;
    prune_receipts(directory, RECEIPT_KEEP_COUNT);
    Ok(())
}

fn read_receipt(directory: &Path, receipt_id: &str) -> Result<PhotoMoveReceipt, String> {
    let path = receipt_path(directory, receipt_id)?;
    let metadata = fs::metadata(&path).map_err(|_| "没有找到该照片整理回滚凭据。".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_RECEIPT_BYTES {
        return Err("照片整理回滚凭据无效或超过安全上限。".into());
    }
    let receipt: PhotoMoveReceipt = serde_json::from_slice(
        &fs::read(path).map_err(|error| format!("无法读取回滚凭据：{error}"))?,
    )
    .map_err(|error| format!("无法解析回滚凭据：{error}"))?;
    if receipt.version != 1 || receipt.receipt_id != receipt_id || receipt.moves.len() > MAX_PHOTOS
    {
        return Err("照片整理回滚凭据版本或内容无效。".into());
    }
    Ok(receipt)
}

fn prune_receipts(directory: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut receipts = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let valid = path.extension().and_then(|value| value.to_str()) == Some("json");
            valid
                .then(|| {
                    entry
                        .metadata()
                        .ok()?
                        .modified()
                        .ok()
                        .map(|modified| (modified, path))
                })
                .flatten()
        })
        .collect::<Vec<_>>();
    receipts.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    for (_, path) in receipts.into_iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
}

fn rollback_moves(
    source_root: &Path,
    destination_root: &Path,
    moves: &[PhotoMoveReceiptItem],
) -> Vec<PhotoMoveReceiptItem> {
    let mut remaining = Vec::new();
    for item in moves.iter().rev() {
        let source = source_root.join(&item.source_relative_path);
        let target = destination_root.join(&item.target_relative_path);
        if source.exists()
            || !target.exists()
            || fs::create_dir_all(source.parent().unwrap_or(source_root)).is_err()
            || fs::rename(&target, &source).is_err()
        {
            remaining.push(item.clone());
        }
    }
    remaining.reverse();
    remaining
}

fn validate_move_inputs(
    request: &PhotoOrganizationExecuteRequest,
) -> Result<(PathBuf, PathBuf, Vec<PhotoMoveReceiptItem>), String> {
    validate_id(&request.plan_id, "计划标识")?;
    if request.moves.is_empty() || request.moves.len() > MAX_PHOTOS {
        return Err("请选择 1 到 5,000 个可移动项目。".into());
    }
    let source_root = canonical_directory(&request.source_root, "源目录")?;
    let destination_root = canonical_directory(&request.destination_root, "目标目录")?;
    ensure_same_storage_root(&source_root, &destination_root)?;
    let mut targets = HashSet::new();
    let mut moves = Vec::with_capacity(request.moves.len());
    for input in &request.moves {
        let source_relative = safe_relative_path(&input.source_relative_path)?;
        let target_relative = safe_relative_path(&input.target_relative_path)?;
        let source = fs::canonicalize(source_root.join(&source_relative))
            .map_err(|_| format!("源照片已不存在：{}", input.source_relative_path))?;
        if !source.starts_with(&source_root) {
            return Err("源照片超出已确认的源目录。".into());
        }
        let link_metadata =
            fs::symlink_metadata(&source).map_err(|_| "无法检查源照片。".to_string())?;
        if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
            return Err("源照片不是可安全移动的普通文件。".into());
        }
        let metadata = fs::metadata(&source).map_err(|_| "无法读取源照片。".to_string())?;
        if metadata.len() != input.expected_size
            || modified_ms(&metadata)? != input.expected_modified_ms
        {
            return Err(format!(
                "源照片在预览后发生变化，请重新扫描：{}",
                input.source_relative_path
            ));
        }
        let target = destination_root.join(&target_relative);
        if target.exists() {
            return Err(format!(
                "目标文件已经存在，不会覆盖：{}",
                input.target_relative_path
            ));
        }
        let target_key = target.to_string_lossy().to_lowercase();
        if !targets.insert(target_key) {
            return Err("照片整理计划包含重复目标路径。".into());
        }
        moves.push(PhotoMoveReceiptItem {
            source_relative_path: source_relative.to_string_lossy().replace('\\', "/"),
            target_relative_path: target_relative.to_string_lossy().replace('\\', "/"),
            size: input.expected_size,
            modified_ms: input.expected_modified_ms,
        });
    }
    Ok((source_root, destination_root, moves))
}

fn execute_blocking(
    request: PhotoOrganizationExecuteRequest,
    cancelled: Arc<AtomicBool>,
    receipts: &Path,
) -> Result<PhotoOrganizationExecutionReport, String> {
    let (source_root, destination_root, moves) = validate_move_inputs(&request)?;
    let mut completed = Vec::new();
    let result = (|| -> Result<(), String> {
        for item in &moves {
            if cancelled.load(Ordering::SeqCst) {
                return Err("照片整理已取消。".into());
            }
            let source = source_root.join(&item.source_relative_path);
            let target = destination_root.join(&item.target_relative_path);
            let parent = target.parent().ok_or("目标路径没有父目录。")?;
            fs::create_dir_all(parent).map_err(|error| format!("无法创建目标年月目录：{error}"))?;
            let canonical_parent = fs::canonicalize(parent)
                .map_err(|error| format!("无法验证目标年月目录：{error}"))?;
            if !canonical_parent.starts_with(&destination_root) {
                return Err("目标年月目录超出已确认的目标目录。".into());
            }
            fs::rename(&source, &target)
                .map_err(|error| format!("无法移动“{}”：{error}", item.source_relative_path))?;
            completed.push(item.clone());
        }
        Ok(())
    })();
    if let Err(error) = result {
        let remaining = rollback_moves(&source_root, &destination_root, &completed);
        if remaining.is_empty() {
            return Err(format!("{error} 已回滚本次已完成的移动。"));
        }
        let emergency = PhotoMoveReceipt {
            version: 1,
            receipt_id: request.plan_id.clone(),
            created_at: Utc::now().to_rfc3339(),
            source_root: source_root.to_string_lossy().into_owned(),
            destination_root: destination_root.to_string_lossy().into_owned(),
            moves: remaining,
        };
        let saved = write_receipt(receipts, &emergency).is_ok();
        return Err(format!(
            "{error} 部分文件无法自动回滚。{}",
            if saved {
                format!("已保存回滚凭据 {}。", emergency.receipt_id)
            } else {
                "回滚凭据也未能保存，请不要继续移动相关文件。".into()
            }
        ));
    }
    let receipt = PhotoMoveReceipt {
        version: 1,
        receipt_id: request.plan_id,
        created_at: Utc::now().to_rfc3339(),
        source_root: source_root.to_string_lossy().into_owned(),
        destination_root: destination_root.to_string_lossy().into_owned(),
        moves: completed.clone(),
    };
    if let Err(error) = write_receipt(receipts, &receipt) {
        let remaining = rollback_moves(&source_root, &destination_root, &completed);
        return Err(if remaining.is_empty() {
            format!("{error} 已回滚全部移动。")
        } else {
            format!("{error} 且有 {} 个文件无法自动回滚。", remaining.len())
        });
    }
    Ok(PhotoOrganizationExecutionReport {
        receipt_id: receipt.receipt_id,
        moved_count: completed.len(),
        moved_bytes: completed.iter().map(|item| item.size).sum(),
        output_paths: completed
            .iter()
            .map(|item| {
                destination_root
                    .join(&item.target_relative_path)
                    .to_string_lossy()
                    .into_owned()
            })
            .collect(),
    })
}

fn undo_blocking(receipts: &Path, receipt_id: &str) -> Result<PhotoOrganizationUndoReport, String> {
    let receipt = read_receipt(receipts, receipt_id)?;
    let source_root = canonical_directory(&receipt.source_root, "原源目录")?;
    let destination_root = canonical_directory(&receipt.destination_root, "原目标目录")?;
    for item in &receipt.moves {
        let source = source_root.join(safe_relative_path(&item.source_relative_path)?);
        let target = destination_root.join(safe_relative_path(&item.target_relative_path)?);
        if source.exists() {
            return Err(format!(
                "原位置已有同名文件，无法回滚且不会覆盖：{}",
                item.source_relative_path
            ));
        }
        let link_metadata = fs::symlink_metadata(&target)
            .map_err(|_| format!("整理后的文件已不存在：{}", item.target_relative_path))?;
        if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
            return Err(format!(
                "整理后的路径不再是原来的普通文件：{}",
                item.target_relative_path
            ));
        }
        let metadata = fs::metadata(&target)
            .map_err(|_| format!("无法读取整理后的文件：{}", item.target_relative_path))?;
        if !metadata.is_file()
            || metadata.len() != item.size
            || modified_ms(&metadata)? != item.modified_ms
        {
            return Err(format!(
                "整理后的文件已变化，请人工复核：{}",
                item.target_relative_path
            ));
        }
    }
    let mut restored: Vec<PhotoMoveReceiptItem> = Vec::new();
    for item in receipt.moves.iter().rev() {
        let source = source_root.join(&item.source_relative_path);
        let target = destination_root.join(&item.target_relative_path);
        let source_parent = source.parent().unwrap_or(&source_root);
        let restore_result = fs::create_dir_all(source_parent).and_then(|_| {
            let canonical_parent = fs::canonicalize(source_parent)?;
            if !canonical_parent.starts_with(&source_root) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "原目录已被重定向到照片源目录之外",
                ));
            }
            fs::rename(&target, &source)
        });
        if let Err(error) = restore_result {
            for previous in restored.iter().rev() {
                let previous_source = source_root.join(&previous.source_relative_path);
                let previous_target = destination_root.join(&previous.target_relative_path);
                let _ = fs::create_dir_all(previous_target.parent().unwrap_or(&destination_root));
                let _ = fs::rename(previous_source, previous_target);
            }
            return Err(format!("回滚失败，已尝试恢复到整理后的状态：{error}"));
        }
        restored.push(item.clone());
    }
    fs::remove_file(receipt_path(receipts, receipt_id)?)
        .map_err(|error| format!("文件已恢复，但无法删除已用回滚凭据：{error}"))?;
    Ok(PhotoOrganizationUndoReport {
        receipt_id: receipt_id.into(),
        restored_count: restored.len(),
    })
}

#[tauri::command]
pub async fn scan_photo_organization(
    request: PhotoOrganizationScanRequest,
) -> Result<PhotoOrganizationPlan, String> {
    tauri::async_runtime::spawn_blocking(move || scan_blocking(request))
        .await
        .map_err(|error| format!("照片整理扫描任务失败：{error}"))?
}

#[tauri::command]
pub async fn execute_photo_organization(
    app: AppHandle,
    run_id: String,
    request: PhotoOrganizationExecuteRequest,
    state: tauri::State<'_, PhotoOrganizerRunState>,
) -> Result<PhotoOrganizationExecutionReport, String> {
    let receipts = receipt_directory(&app)?;
    let cancelled = state.begin(&run_id)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        execute_blocking(request, cancelled, &receipts)
    })
    .await;
    state.finish(&run_id);
    result.map_err(|error| format!("照片整理后台任务失败：{error}"))?
}

#[tauri::command]
pub fn cancel_photo_organization(
    run_id: String,
    state: tauri::State<'_, PhotoOrganizerRunState>,
) -> Result<bool, String> {
    state.cancel(&run_id)
}

#[tauri::command]
pub async fn undo_photo_organization(
    app: AppHandle,
    receipt_id: String,
) -> Result<PhotoOrganizationUndoReport, String> {
    let receipts = receipt_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || undo_blocking(&receipts, &receipt_id))
        .await
        .map_err(|error| format!("照片整理回滚任务失败：{error}"))?
}

#[tauri::command]
pub fn list_photo_organization_receipts(
    app: AppHandle,
) -> Result<Vec<PhotoOrganizationReceiptSummary>, String> {
    let directory = receipt_directory(&app)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut summaries = fs::read_dir(&directory)
        .map_err(|error| format!("无法读取照片整理回滚目录：{error}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let id = entry.path().file_stem()?.to_str()?.to_owned();
            let receipt = read_receipt(&directory, &id).ok()?;
            Some(PhotoOrganizationReceiptSummary {
                receipt_id: receipt.receipt_id,
                created_at: receipt.created_at,
                source_root: receipt.source_root,
                destination_root: receipt.destination_root,
                moved_count: receipt.moves.len(),
            })
        })
        .collect::<Vec<_>>();
    summaries.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    summaries.truncate(RECEIPT_KEEP_COUNT);
    Ok(summaries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_candidate(
        root: &Path,
        relative: &str,
        date: Option<&str>,
        source: Option<&str>,
    ) -> PhotoCandidate {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, relative).unwrap();
        let metadata = fs::metadata(&path).unwrap();
        PhotoCandidate {
            source_path: fs::canonicalize(&path).unwrap(),
            source_relative_path: relative.replace('\\', "/"),
            captured_at: date
                .map(|value| NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S").unwrap()),
            date_source: source.map(str::to_owned),
            size: metadata.len(),
            modified_ms: modified_ms(&metadata).unwrap(),
        }
    }

    #[test]
    fn date_parser_prefers_original_and_rejects_invalid_years() {
        let object = serde_json::json!({
            "EXIF:CreateDate": "2024-02-03T04:05:06",
            "EXIF:DateTimeOriginal": "2023-01-02T03:04:05"
        });
        let (date, source) = metadata_date(object.as_object().unwrap()).unwrap();
        assert_eq!(
            date.format("%Y-%m-%d %H:%M:%S").to_string(),
            "2023-01-02 03:04:05"
        );
        assert_eq!(source, "EXIF:DateTimeOriginal");
        assert!(parse_date(&Value::String("0000:00:00 00:00:00".into())).is_none());
    }

    #[test]
    fn exiftool_json_contract_builds_a_bounded_candidate() {
        let root = std::env::temp_dir().join(format!("knitspace-photo-exif-{}", Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        let photo = root.join("旅行照片.jpg");
        fs::write(&photo, "photo bytes").unwrap();
        let payload = serde_json::to_vec(&serde_json::json!([{
            "SourceFile": photo,
            "EXIF:DateTimeOriginal": "2026-08-16T09:30:12"
        }]))
        .unwrap();
        let (items, truncated) =
            parse_candidates(&fs::canonicalize(&root).unwrap(), &payload, false).unwrap();
        assert!(!truncated);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].source_relative_path, "旅行照片.jpg");
        assert_eq!(
            items[0].date_source.as_deref(),
            Some("EXIF:DateTimeOriginal")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn plan_uses_year_month_and_never_overwrites_conflicts() {
        let root = std::env::temp_dir().join(format!("knitspace-photo-plan-{}", Uuid::now_v7()));
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(destination.join("2024/08")).unwrap();
        fs::write(destination.join("2024/08/20240817-123456.jpg"), "existing").unwrap();
        let candidates = vec![fixture_candidate(
            &source,
            "a.jpg",
            Some("2024-08-17 12:34:56"),
            Some("EXIF:DateTimeOriginal"),
        )];
        let plan = build_plan(
            &fs::canonicalize(&source).unwrap(),
            &fs::canonicalize(&destination).unwrap(),
            candidates,
            "datetime",
            false,
        )
        .unwrap();
        assert_eq!(plan.conflict_count, 1);
        assert_eq!(plan.move_count, 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn successful_execution_persists_receipt_and_can_restore_moves() {
        let root = std::env::temp_dir().join(format!("knitspace-photo-execute-{}", Uuid::now_v7()));
        let source = root.join("source");
        let destination = root.join("destination");
        let receipts = root.join("receipts");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&destination).unwrap();
        fs::write(source.join("photo.jpg"), "photo bytes").unwrap();
        let metadata = fs::metadata(source.join("photo.jpg")).unwrap();
        let plan_id = Uuid::now_v7().to_string();
        let request = PhotoOrganizationExecuteRequest {
            plan_id: plan_id.clone(),
            source_root: source.to_string_lossy().into_owned(),
            destination_root: destination.to_string_lossy().into_owned(),
            moves: vec![PhotoOrganizationMoveInput {
                source_relative_path: "photo.jpg".into(),
                target_relative_path: "2024/08/photo.jpg".into(),
                expected_size: metadata.len(),
                expected_modified_ms: modified_ms(&metadata).unwrap(),
            }],
        };
        let report =
            execute_blocking(request, Arc::new(AtomicBool::new(false)), &receipts).unwrap();
        assert_eq!(report.moved_count, 1);
        assert!(!source.join("photo.jpg").exists());
        assert!(destination.join("2024/08/photo.jpg").exists());
        let undone = undo_blocking(&receipts, &plan_id).unwrap();
        assert_eq!(undone.restored_count, 1);
        assert!(source.join("photo.jpg").exists());
        assert!(!destination.join("2024/08/photo.jpg").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancellation_before_first_move_keeps_every_source() {
        let root = std::env::temp_dir().join(format!("knitspace-photo-cancel-{}", Uuid::now_v7()));
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&destination).unwrap();
        fs::write(source.join("photo.jpg"), "photo bytes").unwrap();
        let metadata = fs::metadata(source.join("photo.jpg")).unwrap();
        let cancelled = Arc::new(AtomicBool::new(true));
        let result = execute_blocking(
            PhotoOrganizationExecuteRequest {
                plan_id: Uuid::now_v7().to_string(),
                source_root: source.to_string_lossy().into_owned(),
                destination_root: destination.to_string_lossy().into_owned(),
                moves: vec![PhotoOrganizationMoveInput {
                    source_relative_path: "photo.jpg".into(),
                    target_relative_path: "2024/08/photo.jpg".into(),
                    expected_size: metadata.len(),
                    expected_modified_ms: modified_ms(&metadata).unwrap(),
                }],
            },
            cancelled,
            &root.join("receipts"),
        );
        assert!(result.unwrap_err().contains("已取消"));
        assert!(source.join("photo.jpg").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn changed_source_after_preview_is_rejected_before_move() {
        let root = std::env::temp_dir().join(format!("knitspace-photo-stale-{}", Uuid::now_v7()));
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&destination).unwrap();
        fs::write(source.join("photo.jpg"), "old").unwrap();
        let metadata = fs::metadata(source.join("photo.jpg")).unwrap();
        let request = PhotoOrganizationExecuteRequest {
            plan_id: Uuid::now_v7().to_string(),
            source_root: source.to_string_lossy().into_owned(),
            destination_root: destination.to_string_lossy().into_owned(),
            moves: vec![PhotoOrganizationMoveInput {
                source_relative_path: "photo.jpg".into(),
                target_relative_path: "2024/08/photo.jpg".into(),
                expected_size: metadata.len(),
                expected_modified_ms: modified_ms(&metadata).unwrap(),
            }],
        };
        fs::write(source.join("photo.jpg"), "changed after preview").unwrap();
        let result = execute_blocking(
            request,
            Arc::new(AtomicBool::new(false)),
            &root.join("receipts"),
        );
        assert!(result.unwrap_err().contains("预览后发生变化"));
        assert!(source.join("photo.jpg").exists());
        assert!(!destination.join("2024/08/photo.jpg").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unsafe_relative_paths_are_rejected() {
        for value in [
            "../photo.jpg",
            "C:/photo.jpg",
            "/photo.jpg",
            "folder//photo.jpg",
        ] {
            assert!(safe_relative_path(value).is_err(), "accepted {value}");
        }
    }
}
