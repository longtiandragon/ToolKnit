use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Instant, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use walkdir::{DirEntry, WalkDir};

const MAX_SCAN_FILES: usize = 5_000;
const MAX_AI_FILES: usize = 100;
const MAX_EXCERPT_BYTES: usize = 4 * 1024;
const MAX_ANALYSIS_FILE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_RECEIPT_BYTES: u64 = 8 * 1024 * 1024;
const RECEIPT_KEEP_COUNT: usize = 50;
const SESSION_KEEP_COUNT: usize = 8;
const SESSION_MAX_AGE_SECONDS: u64 = 2 * 60 * 60;
const MAX_BINDINGS: usize = 256;
const MAX_BINDING_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Default)]
pub struct SmartOrganizerState {
    sessions: Arc<Mutex<HashMap<String, ScanSession>>>,
    active: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

#[derive(Clone)]
struct ScanSession {
    source_root: PathBuf,
    archive_root: PathBuf,
    candidates: HashMap<String, StoredCandidate>,
    same_volume: bool,
    created_at: Instant,
}

#[derive(Clone, Debug)]
struct StoredCandidate {
    file_id: String,
    name: String,
    relative_path: String,
    path: PathBuf,
    extension: String,
    mime: String,
    kind: String,
    size: u64,
    modified_ms: u64,
    signature: String,
    duplicate_hash: Option<String>,
    duplicate_count: usize,
    excerpt_mode: String,
}

impl SmartOrganizerState {
    fn save_session(&self, scan_id: String, session: ScanSession) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "智能整理扫描状态暂时不可用。")?;
        sessions.retain(|_, value| value.created_at.elapsed().as_secs() <= SESSION_MAX_AGE_SECONDS);
        if sessions.len() >= SESSION_KEEP_COUNT {
            let oldest = sessions
                .iter()
                .min_by_key(|(_, value)| value.created_at)
                .map(|(id, _)| id.clone());
            if let Some(id) = oldest {
                sessions.remove(&id);
            }
        }
        sessions.insert(scan_id, session);
        Ok(())
    }

    fn session(&self, scan_id: &str) -> Result<ScanSession, String> {
        validate_uuid(scan_id, "扫描标识")?;
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "智能整理扫描状态暂时不可用。")?;
        let session = sessions
            .get(scan_id)
            .cloned()
            .ok_or("扫描预览已过期，请重新扫描。")?;
        if session.created_at.elapsed().as_secs() > SESSION_MAX_AGE_SECONDS {
            return Err("扫描预览已过期，请重新扫描。".into());
        }
        Ok(session)
    }

    fn begin(&self, run_id: &str) -> Result<Arc<AtomicBool>, String> {
        validate_uuid(run_id, "运行标识")?;
        let mut active = self
            .active
            .lock()
            .map_err(|_| "智能整理执行状态暂时不可用。")?;
        if active.contains_key(run_id) {
            return Err("相同的智能整理任务已在运行。".into());
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
        validate_uuid(run_id, "运行标识")?;
        let active = self
            .active
            .lock()
            .map_err(|_| "智能整理执行状态暂时不可用。")?;
        Ok(active.get(run_id).is_some_and(|flag| {
            flag.store(true, Ordering::SeqCst);
            true
        }))
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerScanRequest {
    pub source_root: String,
    pub archive_root: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerCandidate {
    pub file_id: String,
    pub name: String,
    pub relative_path: String,
    pub extension: String,
    pub mime: String,
    pub kind: String,
    pub size: u64,
    pub modified_ms: u64,
    pub signature: String,
    pub duplicate_hash: Option<String>,
    pub duplicate_count: usize,
    pub excerpt_mode: String,
}

impl From<&StoredCandidate> for OrganizerCandidate {
    fn from(value: &StoredCandidate) -> Self {
        Self {
            file_id: value.file_id.clone(),
            name: value.name.clone(),
            relative_path: value.relative_path.clone(),
            extension: value.extension.clone(),
            mime: value.mime.clone(),
            kind: value.kind.clone(),
            size: value.size,
            modified_ms: value.modified_ms,
            signature: value.signature.clone(),
            duplicate_hash: value.duplicate_hash.clone(),
            duplicate_count: value.duplicate_count,
            excerpt_mode: value.excerpt_mode.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerScanResult {
    pub scan_id: String,
    pub scanned_count: usize,
    pub duplicate_count: usize,
    pub skipped_link_count: usize,
    pub unreadable_count: usize,
    pub truncated: bool,
    pub same_volume: bool,
    pub duration_ms: u64,
    pub warnings: Vec<String>,
    pub candidates: Vec<OrganizerCandidate>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerExcerptRequest {
    pub scan_id: String,
    pub file_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerLocalExcerpt {
    pub file_id: String,
    pub excerpt: String,
    pub source: String,
    pub truncated: bool,
    pub byte_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerAnalysisFileRequest {
    pub scan_id: String,
    pub file_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerPlanItem {
    pub file_id: String,
    pub category: String,
    pub target_relative_dir: String,
    pub target_base_name: String,
    pub confidence: f64,
    pub conflict_policy: String,
}

// These sentinels exist only in the isolated desktop E2E binary. They let the
// native workflow exercise rollback and startup recovery without exposing a
// production command or accepting arbitrary failure instructions.
#[cfg(feature = "e2e")]
const E2E_FAIL_BEFORE_OPERATION_CATEGORY: &str = "__knitspace_e2e_fail_before_operation__";
#[cfg(feature = "e2e")]
const E2E_ABORT_AFTER_OPERATION_CATEGORY: &str = "__knitspace_e2e_abort_after_operation__";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerExecuteRequest {
    pub scan_id: String,
    pub trust_level: String,
    pub rule_id: Option<String>,
    pub items: Vec<OrganizerPlanItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerExecutionOutput {
    pub file_id: String,
    pub name: String,
    pub relative_path: String,
    pub operation: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerExecutionReport {
    pub receipt_id: String,
    pub moved_count: usize,
    pub copied_count: usize,
    pub processed_bytes: u64,
    pub outputs: Vec<OrganizerExecutionOutput>,
    #[cfg(feature = "e2e")]
    pub e2e_process_id: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerReceiptSummary {
    pub receipt_id: String,
    pub created_at: String,
    pub moved_count: usize,
    pub copied_count: usize,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerUndoReport {
    pub receipt_id: String,
    pub restored_count: usize,
    pub removed_copy_count: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerRuleBinding {
    pub rule_id: String,
    pub source_root: String,
    pub archive_root: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OrganizerRuleBindingFile {
    version: u32,
    bindings: Vec<OrganizerRuleBinding>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OrganizerReceiptItem {
    file_id: String,
    source_relative_path: String,
    target_relative_path: String,
    operation: String,
    size: u64,
    modified_ms: u64,
    sha256: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OrganizerReceipt {
    version: u32,
    receipt_id: String,
    created_at: String,
    source_root: String,
    archive_root: String,
    items: Vec<OrganizerReceiptItem>,
}

#[derive(Debug, Clone)]
struct ResolvedPlanItem {
    candidate: StoredCandidate,
    target_relative_path: String,
    operation: String,
    sha256: String,
    #[cfg(feature = "e2e")]
    e2e_category: String,
}

fn validate_uuid(value: &str, label: &str) -> Result<(), String> {
    Uuid::parse_str(value).map_err(|_| format!("{label}格式无效。"))?;
    Ok(())
}

fn canonical_directory(raw: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(format!("{label}必须是本地绝对路径。"));
    }
    let link = fs::symlink_metadata(&path).map_err(|_| format!("{label}不存在或无法读取。"))?;
    if link.file_type().is_symlink() {
        return Err(format!("{label}不能是符号链接。"));
    }
    if !link.is_dir() {
        return Err(format!("{label}不是文件夹。"));
    }
    fs::canonicalize(path).map_err(|error| format!("无法定位{label}：{error}"))
}

fn modified_ms(metadata: &fs::Metadata) -> Result<u64, String> {
    let duration = metadata
        .modified()
        .map_err(|_| "无法读取文件修改时间。".to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "文件修改时间早于系统时间起点。".to_string())?;
    Ok(duration.as_millis().min(u128::from(u64::MAX)) as u64)
}

#[cfg(windows)]
fn same_volume(left: &Path, right: &Path) -> bool {
    left.components()
        .next()
        .zip(right.components().next())
        .is_some_and(|(left, right)| {
            left.as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
        })
}

#[cfg(unix)]
fn same_volume(left: &Path, right: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(left)
        .ok()
        .zip(fs::metadata(right).ok())
        .is_some_and(|(left, right)| left.dev() == right.dev())
}

#[cfg(not(any(windows, unix)))]
fn same_volume(_left: &Path, _right: &Path) -> bool {
    true
}

fn normalized_relative(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("未命名文件")
        .chars()
        .filter(|character| !character.is_control())
        .take(512)
        .collect()
}

fn file_kind(extension: &str) -> (&'static str, &'static str) {
    match extension {
        "txt" | "md" | "markdown" | "csv" | "tsv" | "json" | "jsonl" | "yaml" | "yml" | "toml"
        | "xml" | "html" | "htm" | "css" | "scss" | "less" | "js" | "jsx" | "ts" | "tsx"
        | "vue" | "svelte" | "py" | "rs" | "go" | "java" | "kt" | "kts" | "c" | "h" | "cc"
        | "cpp" | "hpp" | "cs" | "swift" | "sql" | "log" | "ini" | "cfg" | "conf" => {
            ("text", "text")
        }
        "pdf" => ("pdf", "pdf"),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tif" | "tiff" | "heic" | "heif"
        | "avif" => ("image", "ocr"),
        "zip" | "tar" | "tgz" | "gz" | "7z" | "rar" => ("archive", "archive"),
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "mp4" | "mov" | "mkv" | "avi" | "webm" => {
            ("media", "metadata")
        }
        _ => ("binary", "metadata"),
    }
}

fn file_signature(path: &Path) -> String {
    let mut bytes = [0_u8; 16];
    let count = fs::File::open(path)
        .and_then(|mut file| file.read(&mut bytes))
        .unwrap_or_default();
    let header = &bytes[..count];
    if header.starts_with(b"%PDF-") {
        "PDF".into()
    } else if header.starts_with(b"PK\x03\x04") {
        "ZIP".into()
    } else if header.starts_with(b"\x89PNG\r\n\x1a\n") {
        "PNG".into()
    } else if header.starts_with(b"\xff\xd8\xff") {
        "JPEG".into()
    } else if header.starts_with(b"GIF87a") || header.starts_with(b"GIF89a") {
        "GIF".into()
    } else if header.starts_with(b"RIFF") && header.get(8..12) == Some(b"WEBP") {
        "WEBP".into()
    } else if header.is_empty() {
        "EMPTY".into()
    } else {
        header
            .iter()
            .take(8)
            .map(|byte| format!("{byte:02X}"))
            .collect::<Vec<_>>()
            .join("")
    }
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|_| "无法读取文件以计算校验值。")?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "计算文件校验值时读取失败。")?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn candidate_id(relative: &str, size: u64, modified: u64) -> String {
    let mut digest = Sha256::new();
    digest.update(relative.as_bytes());
    digest.update([0]);
    digest.update(size.to_le_bytes());
    digest.update(modified.to_le_bytes());
    let hex = format!("{:x}", digest.finalize());
    format!("file-{}", &hex[..32])
}

fn archive_is_inside_source(entry: &DirEntry, source: &Path, archive: &Path) -> bool {
    archive != source && archive.starts_with(source) && entry.path().starts_with(archive)
}

fn scan_blocking(
    request: OrganizerScanRequest,
) -> Result<(OrganizerScanResult, ScanSession), String> {
    let started = Instant::now();
    let source_root = canonical_directory(&request.source_root, "来源目录")?;
    let archive_root = canonical_directory(&request.archive_root, "归档根目录")?;
    if source_root == archive_root {
        return Err("来源目录和归档根目录不能是同一个文件夹。".into());
    }
    let on_same_volume = same_volume(&source_root, &archive_root);
    let mut stored = Vec::<StoredCandidate>::new();
    let mut skipped_link_count = 0;
    let mut unreadable_count = 0;
    let mut truncated = false;
    let walker = WalkDir::new(&source_root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !archive_is_inside_source(entry, &source_root, &archive_root));
    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                unreadable_count += 1;
                continue;
            }
        };
        if entry.depth() == 0 || entry.file_type().is_dir() {
            continue;
        }
        if entry.file_type().is_symlink() {
            skipped_link_count += 1;
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        if stored.len() >= MAX_SCAN_FILES {
            truncated = true;
            break;
        }
        let path = entry.path().to_path_buf();
        let link_metadata = match fs::symlink_metadata(&path) {
            Ok(value) if value.is_file() && !value.file_type().is_symlink() => value,
            _ => {
                skipped_link_count += 1;
                continue;
            }
        };
        let relative = match path.strip_prefix(&source_root) {
            Ok(value) => normalized_relative(value),
            Err(_) => {
                unreadable_count += 1;
                continue;
            }
        };
        let modified = match modified_ms(&link_metadata) {
            Ok(value) => value,
            Err(_) => {
                unreadable_count += 1;
                continue;
            }
        };
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let (kind, excerpt_mode) = file_kind(&extension);
        let mime = mime_guess::from_path(&path)
            .first_or_octet_stream()
            .to_string();
        stored.push(StoredCandidate {
            file_id: candidate_id(&relative, link_metadata.len(), modified),
            name: display_name(&path),
            relative_path: relative,
            path: path.clone(),
            extension,
            mime,
            kind: kind.into(),
            size: link_metadata.len(),
            modified_ms: modified,
            signature: file_signature(&path),
            duplicate_hash: None,
            duplicate_count: 0,
            excerpt_mode: excerpt_mode.into(),
        });
    }

    // Hash only same-size groups. A unique size cannot be an exact duplicate,
    // which keeps a 5,000-file scan fast without weakening duplicate evidence.
    let mut size_groups = HashMap::<u64, Vec<usize>>::new();
    for (index, candidate) in stored.iter().enumerate() {
        size_groups.entry(candidate.size).or_default().push(index);
    }
    for indexes in size_groups.values().filter(|indexes| indexes.len() > 1) {
        let mut hashes = HashMap::<String, Vec<usize>>::new();
        for index in indexes {
            if let Ok(hash) = hash_file(&stored[*index].path) {
                hashes.entry(hash).or_default().push(*index);
            }
        }
        for (hash, indexes) in hashes.into_iter().filter(|(_, indexes)| indexes.len() > 1) {
            for index in &indexes {
                stored[*index].duplicate_hash = Some(hash.clone());
                stored[*index].duplicate_count = indexes.len();
            }
        }
    }
    stored.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let duplicate_count = stored
        .iter()
        .filter(|candidate| candidate.duplicate_count > 1)
        .count();
    let scan_id = Uuid::now_v7().to_string();
    let candidates = stored
        .iter()
        .map(OrganizerCandidate::from)
        .collect::<Vec<_>>();
    let mut warnings = vec![
        "扫描只读取元数据与必要的重复校验值；确认执行前不会改动文件。".into(),
        if on_same_volume {
            "来源与归档位于同一卷：确认后使用移动或重命名。".into()
        } else {
            "来源与归档位于不同卷：确认后只复制到归档，原件会保留。".into()
        },
    ];
    if duplicate_count > 0 {
        warnings.push("精确重复项不会静默处理，请转到文件健康页面复核。".into());
    }
    if truncated {
        warnings.push("目录超过 5,000 个普通文件，本次只建立前 5,000 项预览。".into());
    }
    if skipped_link_count > 0 {
        warnings.push(format!(
            "已跳过 {skipped_link_count} 个符号链接或重解析项。"
        ));
    }
    let session = ScanSession {
        source_root,
        archive_root,
        candidates: stored
            .into_iter()
            .map(|candidate| (candidate.file_id.clone(), candidate))
            .collect(),
        same_volume: on_same_volume,
        created_at: Instant::now(),
    };
    Ok((
        OrganizerScanResult {
            scan_id,
            scanned_count: candidates.len(),
            duplicate_count,
            skipped_link_count,
            unreadable_count,
            truncated,
            same_volume: on_same_volume,
            duration_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            warnings,
            candidates,
        },
        session,
    ))
}

fn validate_candidate_file(
    session: &ScanSession,
    candidate: &StoredCandidate,
) -> Result<(), String> {
    let link = fs::symlink_metadata(&candidate.path)
        .map_err(|_| format!("“{}”已不存在，请重新扫描。", candidate.name))?;
    if link.file_type().is_symlink() || !link.is_file() {
        return Err(format!("“{}”不再是普通文件，请重新扫描。", candidate.name));
    }
    if link.len() != candidate.size || modified_ms(&link)? != candidate.modified_ms {
        return Err(format!(
            "“{}”在预览后发生变化，请重新扫描。",
            candidate.name
        ));
    }
    let canonical = fs::canonicalize(&candidate.path)
        .map_err(|_| format!("无法重新定位“{}”。", candidate.name))?;
    if !canonical.starts_with(&session.source_root) {
        return Err(format!("“{}”已超出来源目录。", candidate.name));
    }
    Ok(())
}

fn truncate_utf8(mut value: String, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value, false);
    }
    let mut boundary = max_bytes;
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
    (value, true)
}

fn sanitize_excerpt(value: String) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .chars()
        .filter(|character| *character == '\n' || *character == '\t' || !character.is_control())
        .collect::<String>()
        .trim()
        .to_owned()
}

fn read_text_excerpt(path: &Path) -> Result<(String, bool), String> {
    let file = fs::File::open(path).map_err(|_| "无法读取文本摘要。")?;
    let mut bytes = Vec::with_capacity(MAX_EXCERPT_BYTES + 1);
    file.take((MAX_EXCERPT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取文本摘要。")?;
    let over_limit = bytes.len() > MAX_EXCERPT_BYTES;
    bytes.truncate(MAX_EXCERPT_BYTES);
    let (text, utf8_truncated) = truncate_utf8(
        sanitize_excerpt(String::from_utf8_lossy(&bytes).into_owned()),
        MAX_EXCERPT_BYTES,
    );
    Ok((text, over_limit || utf8_truncated))
}

fn list_zip_excerpt(path: &Path) -> Result<(String, bool), String> {
    const MAX_ENTRIES: usize = 80;
    let file = fs::File::open(path).map_err(|_| "无法读取 ZIP 目录。")?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| "ZIP 目录无法读取或已加密。")?;
    let total = archive.len();
    let mut names = Vec::new();
    for index in 0..total.min(MAX_ENTRIES) {
        let entry = archive.by_index(index).map_err(|_| "ZIP 条目无法读取。")?;
        names.push(entry.name().replace('\\', "/"));
    }
    let (text, clipped) = truncate_utf8(names.join("\n"), MAX_EXCERPT_BYTES);
    Ok((text, total > MAX_ENTRIES || clipped))
}

fn list_tar_excerpt(path: &Path) -> Result<(String, bool), String> {
    const MAX_ENTRIES: usize = 80;
    let file = fs::File::open(path).map_err(|_| "无法读取 TAR 目录。")?;
    let mut archive = tar::Archive::new(file);
    let mut names = Vec::new();
    let mut truncated = false;
    for entry in archive.entries().map_err(|_| "TAR 目录无法读取。")? {
        if names.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
        let entry = entry.map_err(|_| "TAR 条目无法读取。")?;
        names.push(normalized_relative(
            &entry.path().map_err(|_| "TAR 条目名称无效。")?,
        ));
    }
    let (text, clipped) = truncate_utf8(names.join("\n"), MAX_EXCERPT_BYTES);
    Ok((text, truncated || clipped))
}

fn local_excerpt(candidate: &StoredCandidate) -> Result<OrganizerLocalExcerpt, String> {
    let (excerpt, source, truncated) = match candidate.excerpt_mode.as_str() {
        "text" => {
            let (text, truncated) = read_text_excerpt(&candidate.path)?;
            (text, "text".to_string(), truncated)
        }
        "archive" if candidate.extension == "zip" => {
            let (text, truncated) = list_zip_excerpt(&candidate.path)?;
            (text, "archive-list".to_string(), truncated)
        }
        "archive" if candidate.extension == "tar" => {
            let (text, truncated) = list_tar_excerpt(&candidate.path)?;
            (text, "archive-list".to_string(), truncated)
        }
        "pdf" => (String::new(), "pdf-worker-required".to_string(), false),
        "ocr" => (String::new(), "windows-ocr-required".to_string(), false),
        "archive" => (String::new(), "archive-metadata".to_string(), false),
        _ => (String::new(), "metadata".to_string(), false),
    };
    Ok(OrganizerLocalExcerpt {
        file_id: candidate.file_id.clone(),
        byte_count: excerpt.len(),
        excerpt,
        source,
        truncated,
    })
}

fn safe_component(raw: &str, label: &str) -> Result<String, String> {
    let value = raw.trim();
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.ends_with('.')
        || value.ends_with(' ')
        || value.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        })
    {
        return Err(format!("{label}包含 Windows 不支持的名称。"));
    }
    // Windows measures a component in UTF-16 code units. A byte limit would
    // incorrectly reject otherwise valid long Chinese file names.
    if value.encode_utf16().count() > 255 {
        return Err(format!("{label}过长。"));
    }
    let stem = value
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"))
            .is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            });
    if reserved {
        return Err(format!("{label}使用了 Windows 保留名称。"));
    }
    Ok(value.to_owned())
}

fn safe_relative_directory(raw: &str) -> Result<PathBuf, String> {
    let normalized = raw.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Ok(PathBuf::new());
    }
    if normalized.starts_with('/') || normalized.starts_with("//") {
        return Err("目标目录必须是归档根内的相对目录。".into());
    }
    let mut result = PathBuf::new();
    for segment in normalized.split('/') {
        result.push(safe_component(segment, "目标目录")?);
    }
    if result
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("目标目录包含路径穿越。".into());
    }
    Ok(result)
}

fn safe_relative_path(raw: &str) -> Result<PathBuf, String> {
    let normalized = raw.replace('\\', "/");
    let mut components = normalized.rsplitn(2, '/');
    let name = safe_component(components.next().unwrap_or_default(), "目标文件名")?;
    let directory = safe_relative_directory(components.next().unwrap_or_default())?;
    Ok(directory.join(name))
}

fn target_name(candidate: &StoredCandidate, requested: &str) -> Result<String, String> {
    let mut name = safe_component(requested, "目标文件名")?;
    if !candidate.extension.is_empty() {
        let extension = Path::new(&name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if extension.is_empty() {
            name.push('.');
            name.push_str(&candidate.extension);
        } else if !extension.eq_ignore_ascii_case(&candidate.extension) {
            return Err(format!(
                "“{}”不能在整理时改变扩展名；请先使用格式转换工具。",
                candidate.name
            ));
        }
    }
    safe_component(&name, "目标文件名")
}

fn keep_both_path(archive_root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    let name = relative
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("目标文件名无效。")?;
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("文件");
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 2..=9999 {
        let candidate_name = match extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = parent.join(safe_component(&candidate_name, "保留两者文件名")?);
        if !archive_root.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Err("同名文件过多，无法生成确定性的保留两者名称。".into())
}

fn remove_empty_directories(paths: &[PathBuf], archive_root: &Path) {
    let mut values = Vec::new();
    for path in paths {
        let mut current = path.as_path();
        while current != archive_root && current.starts_with(archive_root) {
            values.push(current.to_path_buf());
            let Some(parent) = current.parent() else {
                break;
            };
            current = parent;
        }
    }
    values.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    values.dedup();
    for path in values {
        if path != archive_root && path.starts_with(archive_root) {
            // remove_dir succeeds only for an empty directory, so a folder
            // created or populated by somebody else is never removed.
            let _ = fs::remove_dir(path);
        }
    }
}

fn ensure_target_parent(
    archive_root: &Path,
    relative: &Path,
) -> Result<(PathBuf, Vec<PathBuf>), String> {
    let parent_relative = relative.parent().unwrap_or_else(|| Path::new(""));
    let mut current = archive_root.to_path_buf();
    let mut created = Vec::new();
    for component in parent_relative.components() {
        let Component::Normal(name) = component else {
            remove_empty_directories(&created, archive_root);
            return Err("目标路径包含路径穿越。".into());
        };
        current.push(name);
        if current.exists() {
            let link = match fs::symlink_metadata(&current) {
                Ok(value) => value,
                Err(_) => {
                    remove_empty_directories(&created, archive_root);
                    return Err("无法检查目标目录。".into());
                }
            };
            if link.file_type().is_symlink() || !link.is_dir() {
                remove_empty_directories(&created, archive_root);
                return Err("目标目录包含符号链接或非目录项。".into());
            }
        } else {
            if fs::create_dir(&current).is_err() {
                remove_empty_directories(&created, archive_root);
                return Err("无法创建目标子目录。".into());
            }
            created.push(current.clone());
        }
    }
    let canonical = match fs::canonicalize(&current) {
        Ok(value) => value,
        Err(_) => {
            remove_empty_directories(&created, archive_root);
            return Err("无法验证目标目录。".into());
        }
    };
    if !canonical.starts_with(archive_root) {
        remove_empty_directories(&created, archive_root);
        return Err("目标目录超出选定归档根。".into());
    }
    Ok((canonical, created))
}

fn validate_execute_request(
    session: &ScanSession,
    request: &OrganizerExecuteRequest,
) -> Result<Vec<ResolvedPlanItem>, String> {
    if request.items.is_empty() || request.items.len() > MAX_SCAN_FILES {
        return Err("请选择 1 到 5,000 个计划项目。".into());
    }
    if !matches!(
        request.trust_level.as_str(),
        "preview" | "confirmed" | "trusted"
    ) {
        return Err("规则信任等级无效。".into());
    }
    if request.trust_level == "preview" {
        return Err("仅预览规则不能执行文件变更；请先提升信任等级。".into());
    }
    if let Some(rule_id) = request.rule_id.as_deref() {
        validate_uuid(rule_id, "规则标识")?;
    }
    let mut file_ids = HashSet::new();
    let mut target_keys = HashSet::new();
    let mut resolved = Vec::with_capacity(request.items.len());
    for item in &request.items {
        if !file_ids.insert(item.file_id.clone()) {
            return Err("变更计划包含重复文件。".into());
        }
        if !item.confidence.is_finite() || !(0.0..=1.0).contains(&item.confidence) {
            return Err("计划置信度必须在 0 到 1 之间。".into());
        }
        if item.category.trim().is_empty() || item.category.len() > 120 {
            return Err("计划分类无效。".into());
        }
        if !matches!(item.conflict_policy.as_str(), "block" | "keep-both") {
            return Err("重名处理策略无效。".into());
        }
        let candidate = session
            .candidates
            .get(&item.file_id)
            .cloned()
            .ok_or("计划引用了不属于本次扫描的文件。")?;
        if candidate.duplicate_count > 1 {
            return Err(format!(
                "“{}”属于精确重复组，请先在文件健康页面复核。",
                candidate.name
            ));
        }
        validate_candidate_file(session, &candidate)?;
        let directory = safe_relative_directory(&item.target_relative_dir)?;
        let name = target_name(&candidate, &item.target_base_name)?;
        let mut relative = directory.join(name);
        let mut target = session.archive_root.join(&relative);
        if target == candidate.path {
            return Err(format!("“{}”已经位于计划目标。", candidate.name));
        }
        if target.exists() {
            if item.conflict_policy == "keep-both" {
                relative = keep_both_path(&session.archive_root, &relative)?;
                target = session.archive_root.join(&relative);
            } else {
                return Err(format!("“{}”的目标已存在，不会覆盖。", candidate.name));
            }
        }
        let target_key = target.to_string_lossy().to_lowercase();
        if !target_keys.insert(target_key) {
            return Err("变更计划包含重复目标；请选择保留两者或修改文件名。".into());
        }
        let sha256 = hash_file(&candidate.path)?;
        resolved.push(ResolvedPlanItem {
            candidate,
            target_relative_path: normalized_relative(&relative),
            operation: if session.same_volume { "move" } else { "copy" }.into(),
            sha256,
            #[cfg(feature = "e2e")]
            e2e_category: item.category.clone(),
        });
    }
    Ok(resolved)
}

fn receipt_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("smart-organizer-runs"))
        .map_err(|_| "无法定位智能整理回滚目录。".into())
}

fn binding_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("organizer-rule-bindings.json"))
        .map_err(|_| "无法定位整理规则绑定配置。".into())
}

fn read_bindings(app: &AppHandle) -> Result<Vec<OrganizerRuleBinding>, String> {
    let path = binding_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let metadata = fs::metadata(&path).map_err(|_| "无法读取整理规则绑定配置。")?;
    if !metadata.is_file() || metadata.len() > MAX_BINDING_FILE_BYTES {
        return Err("整理规则绑定配置无效或超过安全上限。".into());
    }
    let file: OrganizerRuleBindingFile =
        serde_json::from_slice(&fs::read(&path).map_err(|_| "无法读取整理规则绑定配置。")?)
            .map_err(|_| "整理规则绑定配置无法解析。")?;
    if file.version != 1 || file.bindings.len() > MAX_BINDINGS {
        return Err("整理规则绑定配置版本或内容无效。".into());
    }
    let mut seen = HashSet::new();
    for binding in &file.bindings {
        validate_uuid(&binding.rule_id, "规则标识")?;
        if !seen.insert(&binding.rule_id) {
            return Err("整理规则绑定配置包含重复规则。".into());
        }
    }
    Ok(file.bindings)
}

fn write_bindings(app: &AppHandle, bindings: &[OrganizerRuleBinding]) -> Result<(), String> {
    if bindings.len() > MAX_BINDINGS {
        return Err("本机最多绑定 256 条整理规则。".into());
    }
    let path = binding_path(app)?;
    let parent = path.parent().ok_or("整理规则绑定目录无效。")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建整理规则绑定目录。")?;
    let bytes = serde_json::to_vec_pretty(&OrganizerRuleBindingFile {
        version: 1,
        bindings: bindings.to_vec(),
    })
    .map_err(|_| "无法生成整理规则绑定配置。")?;
    if bytes.len() as u64 > MAX_BINDING_FILE_BYTES {
        return Err("整理规则绑定配置超过安全上限。".into());
    }
    let staging = parent.join(".organizer-rule-bindings.tmp");
    if staging.exists() {
        fs::remove_file(&staging).map_err(|_| "无法清理旧的绑定配置临时文件。")?;
    }
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&staging)
        .map_err(|_| "无法创建整理规则绑定临时文件。")?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&staging);
        return Err(format!("无法保存整理规则绑定配置：{error}"));
    }
    drop(file);
    if path.exists() {
        fs::remove_file(&path).map_err(|_| "无法替换整理规则绑定配置。")?;
    }
    fs::rename(&staging, &path).map_err(|_| {
        let _ = fs::remove_file(&staging);
        "无法完成整理规则绑定配置。".to_string()
    })
}

pub fn clear_rule_bindings(app: &AppHandle) -> Result<(), String> {
    let path = binding_path(app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|_| "Vault 已恢复，但无法清除旧机器目录绑定。")?;
    }
    Ok(())
}

fn receipt_path(directory: &Path, receipt_id: &str, pending: bool) -> Result<PathBuf, String> {
    validate_uuid(
        receipt_id,
        if pending {
            "恢复日志"
        } else {
            "回滚凭据"
        },
    )?;
    Ok(directory.join(format!(
        "{receipt_id}.{}",
        if pending { "pending" } else { "json" }
    )))
}

fn receipt_bytes(receipt: &OrganizerReceipt) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec_pretty(receipt).map_err(|_| "无法生成回滚凭据。")?;
    if bytes.len() as u64 > MAX_RECEIPT_BYTES {
        return Err("回滚凭据超过安全上限。".into());
    }
    Ok(bytes)
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|_| "相同的恢复日志已经存在，请重新扫描。")?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(format!("无法持久化恢复日志：{error}"));
    }
    Ok(())
}

fn write_pending_receipt(directory: &Path, receipt: &OrganizerReceipt) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|_| "无法创建智能整理回滚目录。")?;
    let pending = receipt_path(directory, &receipt.receipt_id, true)?;
    let final_path = receipt_path(directory, &receipt.receipt_id, false)?;
    if pending.exists() || final_path.exists() {
        return Err("相同的恢复日志已经存在，请重新扫描。".into());
    }
    let staging = directory.join(format!(".{}.pending.tmp", receipt.receipt_id));
    write_new_file(&staging, &receipt_bytes(receipt)?)?;
    fs::rename(&staging, &pending).map_err(|_| {
        let _ = fs::remove_file(&staging);
        "无法保存智能整理恢复日志。".to_string()
    })
}

fn promote_receipt(directory: &Path, receipt_id: &str) -> Result<(), String> {
    let pending = receipt_path(directory, receipt_id, true)?;
    let final_path = receipt_path(directory, receipt_id, false)?;
    if final_path.exists() {
        return Err("回滚凭据已经存在。".into());
    }
    fs::rename(pending, final_path).map_err(|_| "无法完成回滚凭据。".to_string())?;
    prune_receipts(directory);
    Ok(())
}

fn read_receipt_file(path: &Path) -> Result<OrganizerReceipt, String> {
    let metadata = fs::metadata(path).map_err(|_| "没有找到该回滚凭据。")?;
    if !metadata.is_file() || metadata.len() > MAX_RECEIPT_BYTES {
        return Err("回滚凭据无效或超过安全上限。".into());
    }
    let receipt: OrganizerReceipt =
        serde_json::from_slice(&fs::read(path).map_err(|_| "无法读取回滚凭据。")?)
            .map_err(|_| "无法解析回滚凭据。")?;
    if receipt.version != 1
        || Uuid::parse_str(&receipt.receipt_id).is_err()
        || receipt.items.is_empty()
        || receipt.items.len() > MAX_SCAN_FILES
    {
        return Err("回滚凭据版本或内容无效。".into());
    }
    Ok(receipt)
}

fn read_receipt(
    directory: &Path,
    receipt_id: &str,
    pending: bool,
) -> Result<OrganizerReceipt, String> {
    let path = receipt_path(directory, receipt_id, pending)?;
    let receipt = read_receipt_file(&path)?;
    if receipt.receipt_id != receipt_id {
        return Err("回滚凭据标识不匹配。".into());
    }
    Ok(receipt)
}

fn prune_receipts(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut receipts = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            (path.extension().and_then(|value| value.to_str()) == Some("json"))
                .then(|| {
                    entry
                        .metadata()
                        .ok()?
                        .modified()
                        .ok()
                        .map(|time| (time, path))
                })
                .flatten()
        })
        .collect::<Vec<_>>();
    receipts.sort_by_key(|(time, _)| std::cmp::Reverse(*time));
    for (_, path) in receipts.into_iter().skip(RECEIPT_KEEP_COUNT) {
        let _ = fs::remove_file(path);
    }
}

fn copy_verified(
    source: &Path,
    target: &Path,
    expected_hash: &str,
    staging: &Path,
) -> Result<(), String> {
    let mut input = fs::File::open(source).map_err(|_| "无法读取来源文件。")?;
    let mut output = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(staging)
        .map_err(|_| "无法创建跨盘复制临时文件。")?;
    if let Err(error) = std::io::copy(&mut input, &mut output).and_then(|_| output.sync_all()) {
        drop(output);
        let _ = fs::remove_file(staging);
        return Err(format!("复制文件失败：{error}"));
    }
    drop(output);
    if hash_file(staging)? != expected_hash {
        let _ = fs::remove_file(staging);
        return Err("跨盘复制校验失败；未生成目标文件。".into());
    }
    fs::rename(staging, target).map_err(|_| {
        let _ = fs::remove_file(staging);
        "无法完成跨盘复制。".to_string()
    })
}

fn target_matches(path: &Path, item: &OrganizerReceiptItem) -> bool {
    let Ok(link) = fs::symlink_metadata(path) else {
        return false;
    };
    !link.file_type().is_symlink()
        && link.is_file()
        && link.len() == item.size
        && hash_file(path).is_ok_and(|hash| hash == item.sha256)
}

fn rollback_completed(
    source_root: &Path,
    archive_root: &Path,
    items: &[OrganizerReceiptItem],
) -> usize {
    let mut unresolved = 0;
    for item in items.iter().rev() {
        let source = source_root.join(&item.source_relative_path);
        let target = archive_root.join(&item.target_relative_path);
        let result = if item.operation == "move" {
            if source.exists() || !target_matches(&target, item) {
                Err(())
            } else {
                fs::create_dir_all(source.parent().unwrap_or(source_root))
                    .and_then(|_| fs::rename(&target, &source))
                    .map_err(|_| ())
            }
        } else if source.exists() && target_matches(&target, item) {
            fs::remove_file(&target).map_err(|_| ())
        } else {
            Err(())
        };
        if result.is_err() {
            unresolved += 1;
        }
    }
    let directories = items
        .iter()
        .filter_map(|item| {
            archive_root
                .join(&item.target_relative_path)
                .parent()
                .map(Path::to_path_buf)
        })
        .collect::<Vec<_>>();
    remove_empty_directories(&directories, archive_root);
    unresolved
}

fn execute_blocking(
    session: ScanSession,
    request: OrganizerExecuteRequest,
    cancelled: Arc<AtomicBool>,
    receipts: &Path,
) -> Result<OrganizerExecutionReport, String> {
    let resolved = validate_execute_request(&session, &request)?;
    let receipt_id = Uuid::now_v7().to_string();
    let receipt = OrganizerReceipt {
        version: 1,
        receipt_id: receipt_id.clone(),
        created_at: Utc::now().to_rfc3339(),
        source_root: session.source_root.to_string_lossy().into_owned(),
        archive_root: session.archive_root.to_string_lossy().into_owned(),
        items: resolved
            .iter()
            .map(|item| OrganizerReceiptItem {
                file_id: item.candidate.file_id.clone(),
                source_relative_path: item.candidate.relative_path.clone(),
                target_relative_path: item.target_relative_path.clone(),
                operation: item.operation.clone(),
                size: item.candidate.size,
                modified_ms: item.candidate.modified_ms,
                sha256: item.sha256.clone(),
            })
            .collect(),
    };
    write_pending_receipt(receipts, &receipt)?;
    let mut completed = Vec::<OrganizerReceiptItem>::new();
    let mut created_directories = Vec::<PathBuf>::new();
    let mut outputs = Vec::new();
    #[cfg(feature = "e2e")]
    let mut e2e_leave_pending_for_crash = false;
    let result = (|| -> Result<(), String> {
        for (index, (item, journal)) in resolved.iter().zip(&receipt.items).enumerate() {
            if cancelled.load(Ordering::SeqCst) {
                return Err("智能整理已取消。".into());
            }
            #[cfg(feature = "e2e")]
            if item.e2e_category == E2E_FAIL_BEFORE_OPERATION_CATEGORY {
                return Err("E2E 故障注入：执行前失败。".into());
            }
            validate_candidate_file(&session, &item.candidate)?;
            if hash_file(&item.candidate.path)? != item.sha256 {
                return Err(format!("“{}”内容在预览后发生变化。", item.candidate.name));
            }
            let relative = safe_relative_path(&item.target_relative_path)?;
            let target = session.archive_root.join(&relative);
            if target.exists() {
                return Err(format!(
                    "“{}”的目标刚刚被占用，不会覆盖。",
                    item.candidate.name
                ));
            }
            let (parent, created) = ensure_target_parent(&session.archive_root, &relative)?;
            created_directories.extend(created);
            if item.operation == "move" {
                fs::rename(&item.candidate.path, &target).map_err(|_| {
                    format!("无法移动“{}”；文件可能正被占用。", item.candidate.name)
                })?;
            } else {
                let staging = parent.join(format!(".knitspace-{}-{index}.tmp", receipt.receipt_id));
                copy_verified(&item.candidate.path, &target, &item.sha256, &staging)
                    .map_err(|error| format!("无法复制“{}”：{error}", item.candidate.name))?;
            }
            completed.push(journal.clone());
            #[cfg(feature = "e2e")]
            if item.e2e_category == E2E_ABORT_AFTER_OPERATION_CATEGORY {
                // Return through IPC so WebDriver can close its session cleanly.
                // The launcher then kills this exact process before the next
                // worker, leaving the pending receipt for startup recovery.
                e2e_leave_pending_for_crash = true;
            }
            outputs.push(OrganizerExecutionOutput {
                file_id: item.candidate.file_id.clone(),
                name: display_name(&target),
                relative_path: item.target_relative_path.clone(),
                operation: item.operation.clone(),
            });
        }
        Ok(())
    })();
    if let Err(error) = result {
        let unresolved =
            rollback_completed(&session.source_root, &session.archive_root, &completed);
        remove_empty_directories(&created_directories, &session.archive_root);
        if unresolved == 0 {
            let _ = fs::remove_file(receipt_path(receipts, &receipt.receipt_id, true)?);
            return Err(format!("{error} 已回滚本次已完成的变更。"));
        }
        return Err(format!(
            "{error} 有 {unresolved} 项无法安全回滚；已保留恢复日志，请人工复核。"
        ));
    }
    let report = OrganizerExecutionReport {
        receipt_id,
        moved_count: completed
            .iter()
            .filter(|item| item.operation == "move")
            .count(),
        copied_count: completed
            .iter()
            .filter(|item| item.operation == "copy")
            .count(),
        processed_bytes: completed.iter().map(|item| item.size).sum(),
        outputs,
        #[cfg(feature = "e2e")]
        e2e_process_id: std::process::id(),
    };
    #[cfg(feature = "e2e")]
    if e2e_leave_pending_for_crash {
        return Ok(report);
    }
    if let Err(error) = promote_receipt(receipts, &receipt.receipt_id) {
        let unresolved =
            rollback_completed(&session.source_root, &session.archive_root, &completed);
        remove_empty_directories(&created_directories, &session.archive_root);
        if unresolved == 0 {
            let _ = fs::remove_file(receipt_path(receipts, &receipt.receipt_id, true)?);
            return Err(format!("{error} 已回滚全部文件变更。"));
        }
        return Err(format!(
            "{error} 且有 {unresolved} 项无法安全回滚；已保留恢复日志。"
        ));
    }
    Ok(report)
}

fn recover_receipt(directory: &Path, receipt: &OrganizerReceipt) -> Result<bool, String> {
    let source_root = canonical_directory(&receipt.source_root, "原来源目录")?;
    let archive_root = canonical_directory(&receipt.archive_root, "原归档根目录")?;
    let unresolved = rollback_completed(&source_root, &archive_root, &receipt.items);
    if unresolved == 0 {
        fs::remove_file(receipt_path(directory, &receipt.receipt_id, true)?)
            .map_err(|_| "文件已恢复，但无法删除恢复日志。")?;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn recover_pending_directory(directory: &Path) -> Result<(usize, usize), String> {
    if !directory.exists() {
        return Ok((0, 0));
    }
    let mut recovered = 0;
    let mut unresolved = 0;
    for entry in fs::read_dir(directory)
        .map_err(|_| "无法读取智能整理恢复目录。")?
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("pending") {
            continue;
        }
        match read_receipt_file(&path).and_then(|receipt| recover_receipt(directory, &receipt)) {
            Ok(true) => recovered += 1,
            Ok(false) | Err(_) => unresolved += 1,
        }
    }
    Ok((recovered, unresolved))
}

pub fn recover_pending_runs(app: &AppHandle) -> Result<(usize, usize), String> {
    recover_pending_directory(&receipt_directory(app)?)
}

fn undo_blocking(receipts: &Path, receipt_id: &str) -> Result<OrganizerUndoReport, String> {
    let receipt = read_receipt(receipts, receipt_id, false)?;
    let source_root = canonical_directory(&receipt.source_root, "原来源目录")?;
    let archive_root = canonical_directory(&receipt.archive_root, "原归档根目录")?;
    for item in &receipt.items {
        let source = source_root.join(safe_relative_path(&item.source_relative_path)?);
        let target = archive_root.join(safe_relative_path(&item.target_relative_path)?);
        if !target_matches(&target, item) {
            return Err("归档后的文件已变化或不存在，请人工复核。".into());
        }
        if item.operation == "move" && source.exists() {
            return Err("原位置已有同名文件，无法撤销且不会覆盖。".into());
        }
        if item.operation == "copy"
            && (!source.exists() || !matches!(hash_file(&source), Ok(hash) if hash == item.sha256))
        {
            return Err("跨盘复制的原件已变化或不存在，已停止撤销以免丢失唯一副本。".into());
        }
    }
    let mut completed = Vec::<OrganizerReceiptItem>::new();
    for item in receipt.items.iter().rev() {
        let source = source_root.join(&item.source_relative_path);
        let target = archive_root.join(&item.target_relative_path);
        let result = if item.operation == "move" {
            fs::create_dir_all(source.parent().unwrap_or(&source_root))
                .and_then(|_| fs::rename(&target, &source))
        } else {
            fs::remove_file(&target)
        };
        if let Err(error) = result {
            // Return already-undone items to the post-organization state.
            for previous in completed.iter().rev() {
                let previous_source = source_root.join(&previous.source_relative_path);
                let previous_target = archive_root.join(&previous.target_relative_path);
                let _ = fs::create_dir_all(previous_target.parent().unwrap_or(&archive_root));
                if previous.operation == "move" {
                    let _ = fs::rename(&previous_source, &previous_target);
                } else {
                    let staging = previous_target.with_extension("knitspace-undo.tmp");
                    let _ = copy_verified(
                        &previous_source,
                        &previous_target,
                        &previous.sha256,
                        &staging,
                    );
                }
            }
            return Err(format!("撤销失败，已尝试恢复到整理后的状态：{error}"));
        }
        completed.push(item.clone());
    }
    let directories = receipt
        .items
        .iter()
        .filter_map(|item| {
            archive_root
                .join(&item.target_relative_path)
                .parent()
                .map(Path::to_path_buf)
        })
        .collect::<Vec<_>>();
    remove_empty_directories(&directories, &archive_root);
    fs::remove_file(receipt_path(receipts, receipt_id, false)?)
        .map_err(|_| "文件已撤销，但无法删除已用回滚凭据。")?;
    Ok(OrganizerUndoReport {
        receipt_id: receipt_id.into(),
        restored_count: completed
            .iter()
            .filter(|item| item.operation == "move")
            .count(),
        removed_copy_count: completed
            .iter()
            .filter(|item| item.operation == "copy")
            .count(),
    })
}

#[tauri::command]
pub async fn scan_smart_organizer(
    request: OrganizerScanRequest,
    state: tauri::State<'_, SmartOrganizerState>,
) -> Result<OrganizerScanResult, String> {
    let result = tauri::async_runtime::spawn_blocking(move || scan_blocking(request))
        .await
        .map_err(|_| "智能整理扫描任务异常退出。")??;
    let (response, session) = result;
    state.save_session(response.scan_id.clone(), session)?;
    Ok(response)
}

#[tauri::command]
pub async fn read_smart_organizer_excerpts(
    request: OrganizerExcerptRequest,
    state: tauri::State<'_, SmartOrganizerState>,
) -> Result<Vec<OrganizerLocalExcerpt>, String> {
    if request.file_ids.is_empty() || request.file_ids.len() > MAX_AI_FILES {
        return Err("每批请选择 1 到 100 个待分析文件。".into());
    }
    let session = state.session(&request.scan_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut seen = HashSet::new();
        let mut results = Vec::with_capacity(request.file_ids.len());
        for file_id in request.file_ids {
            if !seen.insert(file_id.clone()) {
                return Err("待分析文件列表包含重复项。".into());
            }
            let candidate = session
                .candidates
                .get(&file_id)
                .ok_or("待分析文件不属于本次扫描。")?;
            validate_candidate_file(&session, candidate)?;
            results.push(local_excerpt(candidate)?);
        }
        Ok(results)
    })
    .await
    .map_err(|_| "本地摘要任务异常退出。")?
}

#[tauri::command]
pub async fn read_smart_organizer_analysis_file(
    request: OrganizerAnalysisFileRequest,
    state: tauri::State<'_, SmartOrganizerState>,
) -> Result<tauri::ipc::Response, String> {
    let session = state.session(&request.scan_id)?;
    let candidate = session
        .candidates
        .get(&request.file_id)
        .cloned()
        .ok_or("待分析文件不属于本次扫描。")?;
    if !matches!(candidate.excerpt_mode.as_str(), "pdf" | "ocr") {
        return Err("该文件无需读取二进制内容即可生成摘要。".into());
    }
    if candidate.size == 0 || candidate.size > MAX_ANALYSIS_FILE_BYTES {
        return Err("待分析 PDF 或图片超过 50 MB 本地读取上限。".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        validate_candidate_file(&session, &candidate)?;
        fs::read(&candidate.path).map_err(|_| "无法读取待分析文件。".to_string())
    })
    .await
    .map_err(|_| "本地分析文件读取任务异常退出。")??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn execute_smart_organizer(
    app: AppHandle,
    run_id: String,
    request: OrganizerExecuteRequest,
    state: tauri::State<'_, SmartOrganizerState>,
) -> Result<OrganizerExecutionReport, String> {
    let session = state.session(&request.scan_id)?;
    let receipts = receipt_directory(&app)?;
    let cancelled = state.begin(&run_id)?;
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        execute_blocking(session, request, cancelled, &receipts)
    })
    .await;
    state.finish(&run_id);
    outcome.map_err(|_| "智能整理执行任务异常退出。")?
}

#[tauri::command]
pub fn cancel_smart_organizer(
    run_id: String,
    state: tauri::State<'_, SmartOrganizerState>,
) -> Result<bool, String> {
    state.cancel(&run_id)
}

#[tauri::command]
pub fn list_smart_organizer_receipts(
    app: AppHandle,
) -> Result<Vec<OrganizerReceiptSummary>, String> {
    let directory = receipt_directory(&app)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut values = fs::read_dir(&directory)
        .map_err(|_| "无法读取智能整理回滚目录。")?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let extension = path.extension()?.to_str()?;
            if !matches!(extension, "json" | "pending") {
                return None;
            }
            let receipt = read_receipt_file(&path).ok()?;
            Some(OrganizerReceiptSummary {
                receipt_id: receipt.receipt_id,
                created_at: receipt.created_at,
                moved_count: receipt
                    .items
                    .iter()
                    .filter(|item| item.operation == "move")
                    .count(),
                copied_count: receipt
                    .items
                    .iter()
                    .filter(|item| item.operation == "copy")
                    .count(),
                status: if extension == "json" {
                    "ready"
                } else {
                    "manual-review"
                }
                .into(),
            })
        })
        .collect::<Vec<_>>();
    values.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    values.truncate(RECEIPT_KEEP_COUNT);
    Ok(values)
}

#[tauri::command]
pub fn list_smart_organizer_rule_bindings(
    app: AppHandle,
) -> Result<Vec<OrganizerRuleBinding>, String> {
    read_bindings(&app)
}

#[tauri::command]
pub fn bind_smart_organizer_rule(
    app: AppHandle,
    rule_id: String,
    source_root: String,
    archive_root: String,
) -> Result<OrganizerRuleBinding, String> {
    validate_uuid(&rule_id, "规则标识")?;
    let source = canonical_directory(&source_root, "规则来源目录")?;
    let archive = canonical_directory(&archive_root, "规则归档根目录")?;
    if source == archive {
        return Err("规则来源目录和归档根目录不能相同。".into());
    }
    let binding = OrganizerRuleBinding {
        rule_id: rule_id.clone(),
        source_root: source.to_string_lossy().into_owned(),
        archive_root: archive.to_string_lossy().into_owned(),
        updated_at: Utc::now().to_rfc3339(),
    };
    let mut bindings = read_bindings(&app)?;
    if let Some(existing) = bindings.iter_mut().find(|value| value.rule_id == rule_id) {
        *existing = binding.clone();
    } else {
        bindings.push(binding.clone());
    }
    bindings.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    write_bindings(&app, &bindings)?;
    Ok(binding)
}

#[tauri::command]
pub fn unbind_smart_organizer_rule(app: AppHandle, rule_id: String) -> Result<bool, String> {
    validate_uuid(&rule_id, "规则标识")?;
    let mut bindings = read_bindings(&app)?;
    let previous = bindings.len();
    bindings.retain(|binding| binding.rule_id != rule_id);
    if previous != bindings.len() {
        write_bindings(&app, &bindings)?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn undo_smart_organizer(
    app: AppHandle,
    receipt_id: String,
) -> Result<OrganizerUndoReport, String> {
    let receipts = receipt_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || undo_blocking(&receipts, &receipt_id))
        .await
        .map_err(|_| "智能整理撤销任务异常退出。")?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn single_item_request(
        scan_id: String,
        file_id: String,
        target_relative_dir: &str,
        target_base_name: &str,
    ) -> OrganizerExecuteRequest {
        OrganizerExecuteRequest {
            scan_id,
            trust_level: "confirmed".into(),
            rule_id: None,
            items: vec![OrganizerPlanItem {
                file_id,
                category: "测试".into(),
                target_relative_dir: target_relative_dir.into(),
                target_base_name: target_base_name.into(),
                confidence: 0.95,
                conflict_policy: "block".into(),
            }],
        }
    }

    fn temporary_roots(label: &str) -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("knitspace-smart-{label}-{}", Uuid::now_v7()));
        let source = root.join("source");
        let archive = root.join("archive");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&archive).unwrap();
        (root, source, archive)
    }

    #[test]
    fn rejects_traversal_reserved_names_and_changed_extensions() {
        assert!(safe_relative_directory("../outside").is_err());
        assert!(safe_relative_directory("normal/CON").is_err());
        assert!(safe_component("report. ", "文件名").is_err());
        let (_, source, _) = temporary_roots("names");
        let file = source.join("report.pdf");
        fs::write(&file, b"%PDF-1.7").unwrap();
        let metadata = fs::metadata(&file).unwrap();
        let candidate = StoredCandidate {
            file_id: "file-test".into(),
            name: "report.pdf".into(),
            relative_path: "report.pdf".into(),
            path: file,
            extension: "pdf".into(),
            mime: "application/pdf".into(),
            kind: "pdf".into(),
            size: metadata.len(),
            modified_ms: modified_ms(&metadata).unwrap(),
            signature: "PDF".into(),
            duplicate_hash: None,
            duplicate_count: 0,
            excerpt_mode: "pdf".into(),
        };
        assert!(target_name(&candidate, "report.exe").is_err());
        assert_eq!(target_name(&candidate, "report").unwrap(), "report.pdf");
        assert!(safe_component(&format!("{}.pdf", "课程资料".repeat(30)), "文件名").is_ok());
        assert!(safe_component(&"a".repeat(256), "文件名").is_err());
    }

    #[test]
    fn scan_hashes_only_actual_duplicate_groups_and_skips_links() {
        let (root, source, archive) = temporary_roots("scan");
        fs::write(source.join("甲.txt"), "same").unwrap();
        fs::write(source.join("乙.txt"), "same").unwrap();
        fs::write(source.join("独有.md"), "unique-size").unwrap();
        let (result, _) = scan_blocking(OrganizerScanRequest {
            source_root: source.to_string_lossy().into_owned(),
            archive_root: archive.to_string_lossy().into_owned(),
        })
        .unwrap();
        assert_eq!(result.scanned_count, 3);
        assert_eq!(result.duplicate_count, 2);
        assert!(result
            .candidates
            .iter()
            .filter(|item| item.name != "独有.md")
            .all(|item| item.duplicate_hash.is_some() && item.duplicate_count == 2));
        assert!(result
            .candidates
            .iter()
            .find(|item| item.name == "独有.md")
            .unwrap()
            .duplicate_hash
            .is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn same_volume_execution_never_overwrites_and_can_be_undone() {
        let (root, source, archive) = temporary_roots("execute");
        fs::write(source.join("课程报告.txt"), "deliverable").unwrap();
        let (result, session) = scan_blocking(OrganizerScanRequest {
            source_root: source.to_string_lossy().into_owned(),
            archive_root: archive.to_string_lossy().into_owned(),
        })
        .unwrap();
        let file_id = result.candidates[0].file_id.clone();
        let receipts = root.join("receipts");
        let report = execute_blocking(
            session,
            OrganizerExecuteRequest {
                scan_id: result.scan_id,
                trust_level: "confirmed".into(),
                rule_id: None,
                items: vec![OrganizerPlanItem {
                    file_id,
                    category: "课程".into(),
                    target_relative_dir: "课程/提交".into(),
                    target_base_name: "课程报告.txt".into(),
                    confidence: 0.95,
                    conflict_policy: "block".into(),
                }],
            },
            Arc::new(AtomicBool::new(false)),
            &receipts,
        )
        .unwrap();
        assert_eq!(report.moved_count, 1);
        assert!(!source.join("课程报告.txt").exists());
        assert!(archive.join("课程/提交/课程报告.txt").exists());
        let undo = undo_blocking(&receipts, &report.receipt_id).unwrap();
        assert_eq!(undo.restored_count, 1);
        assert!(source.join("课程报告.txt").exists());
        assert!(!archive.join("课程/提交/课程报告.txt").exists());
        assert!(!archive.join("课程").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cross_volume_mode_copies_retains_source_and_can_be_undone() {
        let (root, source, archive) = temporary_roots("copy");
        fs::write(source.join("交付.txt"), "keep source").unwrap();
        let (result, mut session) = scan_blocking(OrganizerScanRequest {
            source_root: source.to_string_lossy().into_owned(),
            archive_root: archive.to_string_lossy().into_owned(),
        })
        .unwrap();
        session.same_volume = false;
        let receipts = root.join("receipts");
        let report = execute_blocking(
            session,
            single_item_request(
                result.scan_id,
                result.candidates[0].file_id.clone(),
                "跨盘",
                "交付.txt",
            ),
            Arc::new(AtomicBool::new(false)),
            &receipts,
        )
        .unwrap();
        assert_eq!(report.copied_count, 1);
        assert!(source.join("交付.txt").exists());
        assert!(archive.join("跨盘/交付.txt").exists());
        let undo = undo_blocking(&receipts, &report.receipt_id).unwrap();
        assert_eq!(undo.removed_copy_count, 1);
        assert!(source.join("交付.txt").exists());
        assert!(!archive.join("跨盘/交付.txt").exists());
        assert!(!archive.join("跨盘").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn changed_input_and_occupied_target_are_rejected_without_mutation() {
        let (root, source, archive) = temporary_roots("revalidate");
        let input = source.join("draft.txt");
        fs::write(&input, "before").unwrap();
        let (result, session) = scan_blocking(OrganizerScanRequest {
            source_root: source.to_string_lossy().into_owned(),
            archive_root: archive.to_string_lossy().into_owned(),
        })
        .unwrap();
        fs::write(&input, "changed after preview").unwrap();
        let error = execute_blocking(
            session,
            single_item_request(
                result.scan_id,
                result.candidates[0].file_id.clone(),
                "done",
                "draft.txt",
            ),
            Arc::new(AtomicBool::new(false)),
            &root.join("receipts-changed"),
        )
        .unwrap_err();
        assert!(error.contains("变化"));
        assert_eq!(fs::read_to_string(&input).unwrap(), "changed after preview");
        assert!(!archive.join("done/draft.txt").exists());

        fs::write(&input, "before").unwrap();
        let (result, session) = scan_blocking(OrganizerScanRequest {
            source_root: source.to_string_lossy().into_owned(),
            archive_root: archive.to_string_lossy().into_owned(),
        })
        .unwrap();
        fs::create_dir_all(archive.join("done")).unwrap();
        fs::write(archive.join("done/draft.txt"), "existing").unwrap();
        let error = execute_blocking(
            session,
            single_item_request(
                result.scan_id,
                result.candidates[0].file_id.clone(),
                "done",
                "draft.txt",
            ),
            Arc::new(AtomicBool::new(false)),
            &root.join("receipts-conflict"),
        )
        .unwrap_err();
        assert!(error.contains("不会覆盖"));
        assert_eq!(fs::read_to_string(&input).unwrap(), "before");
        assert_eq!(
            fs::read_to_string(archive.join("done/draft.txt")).unwrap(),
            "existing"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preview_trust_level_is_enforced_by_the_native_boundary() {
        let (root, source, archive) = temporary_roots("preview-only");
        fs::write(source.join("draft.txt"), "preview").unwrap();
        let (result, session) = scan_blocking(OrganizerScanRequest {
            source_root: source.to_string_lossy().into_owned(),
            archive_root: archive.to_string_lossy().into_owned(),
        })
        .unwrap();
        let mut request = single_item_request(
            result.scan_id,
            result.candidates[0].file_id.clone(),
            "done",
            "draft.txt",
        );
        request.trust_level = "preview".into();
        assert!(execute_blocking(
            session,
            request,
            Arc::new(AtomicBool::new(false)),
            &root.join("receipts")
        )
        .unwrap_err()
        .contains("不能执行"));
        assert!(source.join("draft.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn one_hundred_ordinary_files_scan_within_the_target_budget() {
        let (root, source, archive) = temporary_roots("budget");
        for index in 1..=100 {
            fs::write(
                source.join(format!("file-{index:03}.txt")),
                vec![b'x'; index],
            )
            .unwrap();
        }
        let started = std::time::Instant::now();
        let (result, _) = scan_blocking(OrganizerScanRequest {
            source_root: source.to_string_lossy().into_owned(),
            archive_root: archive.to_string_lossy().into_owned(),
        })
        .unwrap();
        assert_eq!(result.scanned_count, 100);
        assert!(started.elapsed() < std::time::Duration::from_secs(3));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn exclusively_locked_input_is_rejected_without_moving_it() {
        use std::os::windows::fs::OpenOptionsExt;

        let (root, source, archive) = temporary_roots("locked");
        let input = source.join("locked.txt");
        fs::write(&input, "locked").unwrap();
        let (result, session) = scan_blocking(OrganizerScanRequest {
            source_root: source.to_string_lossy().into_owned(),
            archive_root: archive.to_string_lossy().into_owned(),
        })
        .unwrap();
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&input)
            .unwrap();
        let outcome = execute_blocking(
            session,
            single_item_request(
                result.scan_id,
                result.candidates[0].file_id.clone(),
                "done",
                "locked.txt",
            ),
            Arc::new(AtomicBool::new(false)),
            &root.join("receipts"),
        );
        assert!(outcome.is_err());
        assert!(input.exists());
        assert!(!archive.join("done/locked.txt").exists());
        drop(lock);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn keep_both_suffix_is_deterministic() {
        let (root, _, archive) = temporary_roots("keep-both");
        fs::write(archive.join("report.txt"), "one").unwrap();
        fs::write(archive.join("report (2).txt"), "two").unwrap();
        assert_eq!(
            normalized_relative(&keep_both_path(&archive, Path::new("report.txt")).unwrap()),
            "report (3).txt"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pending_move_is_recovered_at_startup_boundary() {
        let (root, source, archive) = temporary_roots("recover");
        let source_file = source.join("draft.txt");
        let target_file = archive.join("done/draft.txt");
        fs::write(&source_file, "draft").unwrap();
        fs::create_dir_all(target_file.parent().unwrap()).unwrap();
        let metadata = fs::metadata(&source_file).unwrap();
        let receipt = OrganizerReceipt {
            version: 1,
            receipt_id: Uuid::now_v7().to_string(),
            created_at: Utc::now().to_rfc3339(),
            source_root: source.to_string_lossy().into_owned(),
            archive_root: archive.to_string_lossy().into_owned(),
            items: vec![OrganizerReceiptItem {
                file_id: "file-one".into(),
                source_relative_path: "draft.txt".into(),
                target_relative_path: "done/draft.txt".into(),
                operation: "move".into(),
                size: metadata.len(),
                modified_ms: modified_ms(&metadata).unwrap(),
                sha256: hash_file(&source_file).unwrap(),
            }],
        };
        let receipts = root.join("receipts");
        write_pending_receipt(&receipts, &receipt).unwrap();
        fs::rename(&source_file, &target_file).unwrap();
        assert_eq!(recover_pending_directory(&receipts).unwrap(), (1, 0));
        assert!(source_file.exists());
        assert!(!target_file.exists());
        assert!(!archive.join("done").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
