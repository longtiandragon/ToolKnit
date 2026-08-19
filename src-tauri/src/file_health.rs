use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use walkdir::WalkDir;

pub const MAX_SCAN_ENTRIES: usize = 50_000;
pub const MAX_SCAN_FILES: usize = 40_000;
pub const MAX_HASH_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const DEFAULT_LARGE_FILE_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_COMPARE_ITEMS: usize = 20_000;
pub const MAX_MANIFEST_FILES: usize = 40_000;
const MAX_SIMILAR_IMAGE_GROUPS: usize = 500;
const MAX_SIMILAR_IMAGE_FILES: usize = 4_000;
const MAX_CZKAWKA_JSON_BYTES: u64 = 32 * 1024 * 1024;
const MAX_MANIFEST_JSON_BYTES: u64 = 32 * 1024 * 1024;
const CZKAWKA_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHealthPath {
    pub path: String,
    pub relative_path: String,
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHealthFinding {
    pub id: String,
    pub kind: String,
    pub path: String,
    pub relative_path: String,
    pub name: String,
    pub size: u64,
    pub detail: String,
    pub safe_to_recycle: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHealthDuplicateGroup {
    pub id: String,
    pub hash: String,
    pub size: u64,
    pub files: Vec<FileHealthPath>,
    pub suggested_keep: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHealthSimilarImage {
    pub path: String,
    pub relative_path: String,
    pub name: String,
    pub size: u64,
    pub width: u32,
    pub height: u32,
    pub difference: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHealthSimilarImageGroup {
    pub id: String,
    pub files: Vec<FileHealthSimilarImage>,
    pub suggested_keep: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHealthDirectory {
    pub path: String,
    pub relative_path: String,
    pub size: u64,
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHealthReport {
    pub root: String,
    pub scanned_entries: usize,
    pub scanned_files: usize,
    pub scanned_directories: usize,
    pub total_bytes: u64,
    pub large_file_bytes: u64,
    pub hash_bytes: u64,
    pub truncated: bool,
    pub warnings: Vec<String>,
    pub empty_files: Vec<FileHealthFinding>,
    pub empty_directories: Vec<FileHealthFinding>,
    pub large_files: Vec<FileHealthFinding>,
    pub extension_mismatches: Vec<FileHealthFinding>,
    pub duplicate_groups: Vec<FileHealthDuplicateGroup>,
    pub similar_image_groups: Vec<FileHealthSimilarImageGroup>,
    pub largest_directories: Vec<FileHealthDirectory>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryCompareItem {
    pub relative_path: String,
    pub name: String,
    pub status: String,
    pub left_size: Option<u64>,
    pub right_size: Option<u64>,
    pub left_hash: Option<String>,
    pub right_hash: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryCompareReport {
    pub left_root: String,
    pub right_root: String,
    pub scanned_left_files: usize,
    pub scanned_right_files: usize,
    pub total_left_bytes: u64,
    pub total_right_bytes: u64,
    pub hashed_bytes: u64,
    pub same_count: usize,
    pub added_count: usize,
    pub removed_count: usize,
    pub changed_count: usize,
    pub unverified_count: usize,
    pub truncated: bool,
    pub warnings: Vec<String>,
    pub items: Vec<DirectoryCompareItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManifestEntry {
    pub relative_path: String,
    pub name: String,
    pub size: u64,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManifestReport {
    pub root: String,
    pub scanned_entries: usize,
    pub scanned_files: usize,
    pub total_bytes: u64,
    pub hash_bytes: u64,
    pub hashed_files: usize,
    pub truncated: bool,
    pub warnings: Vec<String>,
    pub files: Vec<FileManifestEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportedManifestEntry {
    relative_path: String,
    size: u64,
    sha256: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportedManifest {
    #[serde(default)]
    truncated: bool,
    files: Vec<ImportedManifestEntry>,
}

#[derive(Debug)]
struct ManifestRecord {
    relative_path: String,
    relative_path_buf: PathBuf,
    expected_size: u64,
    expected_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManifestVerificationItem {
    pub relative_path: String,
    pub name: String,
    pub status: String,
    pub expected_size: Option<u64>,
    pub actual_size: Option<u64>,
    pub expected_hash: Option<String>,
    pub actual_hash: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManifestVerificationReport {
    pub root: String,
    pub manifest_path: String,
    pub scanned_files: usize,
    pub hashed_bytes: u64,
    pub match_count: usize,
    pub missing_count: usize,
    pub size_mismatch_count: usize,
    pub hash_mismatch_count: usize,
    pub unverified_count: usize,
    pub unreadable_count: usize,
    pub extra_count: usize,
    pub truncated: bool,
    pub warnings: Vec<String>,
    pub items: Vec<FileManifestVerificationItem>,
}

#[derive(Debug)]
struct FileRecord {
    path: PathBuf,
    relative_path: String,
    name: String,
    size: u64,
}

#[derive(Debug)]
struct CompareRecord {
    path: PathBuf,
    relative_path: String,
    name: String,
    size: u64,
}

fn canonical_directory(path: &str) -> Result<PathBuf> {
    let candidate = PathBuf::from(path);
    if candidate.as_os_str().is_empty() {
        bail!("请选择要扫描的文件夹。")
    }
    let root = fs::canonicalize(&candidate)
        .with_context(|| format!("无法访问扫描目录：{}", candidate.display()))?;
    if !root.is_dir() {
        bail!("扫描路径不是文件夹：{}", root.display())
    }
    Ok(root)
}

fn relative_label(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_owned()
}

fn compare_key(relative_path: &str) -> String {
    #[cfg(windows)]
    {
        relative_path.to_ascii_lowercase()
    }
    #[cfg(not(windows))]
    {
        relative_path.to_owned()
    }
}

fn collect_compare_records(
    root: &Path,
) -> Result<(
    HashMap<String, CompareRecord>,
    usize,
    u64,
    bool,
    Vec<String>,
)> {
    let mut records = HashMap::new();
    let mut scanned_entries = 0_usize;
    let mut total_bytes = 0_u64;
    let mut truncated = false;
    let mut warnings = Vec::new();
    for entry in WalkDir::new(root).follow_links(false).into_iter() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                warnings.push(format!("部分路径无法读取：{error}"));
                continue;
            }
        };
        scanned_entries += 1;
        if scanned_entries > MAX_SCAN_ENTRIES || records.len() >= MAX_SCAN_FILES {
            truncated = true;
            warnings.push(format!(
                "目录对比已达到上限（最多 {MAX_SCAN_ENTRIES} 个条目、{MAX_SCAN_FILES} 个文件）。"
            ));
            break;
        }
        let path = entry.path().to_path_buf();
        if entry.file_type().is_symlink() || !entry.file_type().is_file() {
            if entry.file_type().is_symlink() {
                warnings.push(format!("已跳过符号链接：{}", relative_label(root, &path)));
            }
            continue;
        }
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                warnings.push(format!("无法读取 {}：{error}", relative_label(root, &path)));
                continue;
            }
        };
        let relative_path = relative_label(root, &path);
        let size = metadata.len();
        total_bytes = total_bytes.saturating_add(size);
        records.insert(
            compare_key(&relative_path),
            CompareRecord {
                path,
                relative_path,
                name: file_name(entry.path()),
                size,
            },
        );
    }
    Ok((records, scanned_entries, total_bytes, truncated, warnings))
}

fn compare_folders(left_root: &Path, right_root: &Path) -> Result<DirectoryCompareReport> {
    let (left, left_entries, total_left_bytes, left_truncated, mut warnings) =
        collect_compare_records(left_root)?;
    let (right, right_entries, total_right_bytes, right_truncated, right_warnings) =
        collect_compare_records(right_root)?;
    warnings.extend(right_warnings);
    let mut keys = left.keys().chain(right.keys()).cloned().collect::<Vec<_>>();
    keys.sort();
    keys.dedup();

    let mut hashed_bytes = 0_u64;
    let mut same_count = 0_usize;
    let mut added_count = 0_usize;
    let mut removed_count = 0_usize;
    let mut changed_count = 0_usize;
    let mut unverified_count = 0_usize;
    let mut items = Vec::with_capacity(keys.len().min(MAX_COMPARE_ITEMS));
    let mut truncated = left_truncated || right_truncated;

    for key in keys {
        let left_record = left.get(&key);
        let right_record = right.get(&key);
        let record = left_record
            .or(right_record)
            .expect("compare key has a record");
        let mut item = DirectoryCompareItem {
            relative_path: record.relative_path.clone(),
            name: record.name.clone(),
            status: String::new(),
            left_size: left_record.map(|value| value.size),
            right_size: right_record.map(|value| value.size),
            left_hash: None,
            right_hash: None,
            detail: String::new(),
        };
        match (left_record, right_record) {
            (None, Some(value)) => {
                added_count += 1;
                item.status = "added".into();
                item.detail = format!("右侧新增 · {}", value.size);
            }
            (Some(value), None) => {
                removed_count += 1;
                item.status = "removed".into();
                item.detail = format!("右侧缺少 · {}", value.size);
            }
            (Some(left_value), Some(right_value)) if left_value.size != right_value.size => {
                changed_count += 1;
                item.status = "changed".into();
                item.detail = format!("大小变化：{} → {}", left_value.size, right_value.size);
            }
            (Some(left_value), Some(_right_value)) if left_value.size == 0 => {
                same_count += 1;
                item.status = "same".into();
                item.detail = "两侧均为空文件。".into();
            }
            (Some(left_value), Some(right_value)) => {
                let required = left_value.size.saturating_add(right_value.size);
                if hashed_bytes.saturating_add(required) > MAX_HASH_BYTES {
                    unverified_count += 1;
                    truncated = true;
                    item.status = "unverified".into();
                    item.detail = format!(
                        "内容相同大小，但未计算哈希（已达到 {} 字节上限）。",
                        MAX_HASH_BYTES
                    );
                } else {
                    let left_hash = sha256_file(&left_value.path);
                    let right_hash = sha256_file(&right_value.path);
                    hashed_bytes = hashed_bytes.saturating_add(required);
                    match (left_hash, right_hash) {
                        (Ok(left_hash), Ok(right_hash)) if left_hash == right_hash => {
                            same_count += 1;
                            item.status = "same".into();
                            item.detail = "两侧内容完全相同。".into();
                            item.left_hash = Some(left_hash);
                            item.right_hash = Some(right_hash);
                        }
                        (Ok(left_hash), Ok(right_hash)) => {
                            changed_count += 1;
                            item.status = "changed".into();
                            item.detail = "文件大小相同，但内容不同。".into();
                            item.left_hash = Some(left_hash);
                            item.right_hash = Some(right_hash);
                        }
                        (left_result, right_result) => {
                            unverified_count += 1;
                            item.status = "unverified".into();
                            item.detail = "无法读取一侧文件并完成内容校验。".into();
                            if let Ok(hash) = left_result {
                                item.left_hash = Some(hash);
                            }
                            if let Ok(hash) = right_result {
                                item.right_hash = Some(hash);
                            }
                            warnings.push(format!("无法完成内容校验：{}", item.relative_path));
                        }
                    }
                }
            }
            _ => unreachable!("matched records must have a status"),
        }
        if items.len() < MAX_COMPARE_ITEMS {
            items.push(item);
        } else if !truncated {
            truncated = true;
            warnings.push(format!("对比结果已收起，最多展示 {MAX_COMPARE_ITEMS} 项。"));
        }
    }
    items.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    Ok(DirectoryCompareReport {
        left_root: left_root.to_string_lossy().into_owned(),
        right_root: right_root.to_string_lossy().into_owned(),
        scanned_left_files: left.len().min(left_entries),
        scanned_right_files: right.len().min(right_entries),
        total_left_bytes,
        total_right_bytes,
        hashed_bytes,
        same_count,
        added_count,
        removed_count,
        changed_count,
        unverified_count,
        truncated,
        warnings,
        items,
    })
}

fn create_manifest(root: &Path, include_hash: bool) -> Result<FileManifestReport> {
    let mut scanned_entries = 0_usize;
    let mut scanned_files = 0_usize;
    let mut total_bytes = 0_u64;
    let mut hash_bytes = 0_u64;
    let mut hashed_files = 0_usize;
    let mut truncated = false;
    let mut warnings = Vec::new();
    let mut files = Vec::new();

    for entry in WalkDir::new(root).follow_links(false).into_iter() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                warnings.push(format!("部分路径无法读取：{error}"));
                continue;
            }
        };
        scanned_entries += 1;
        if scanned_entries > MAX_SCAN_ENTRIES || scanned_files >= MAX_MANIFEST_FILES {
            truncated = true;
            warnings.push(format!(
                "校验清单已达到上限（最多 {MAX_SCAN_ENTRIES} 个条目、{MAX_MANIFEST_FILES} 个文件）。"
            ));
            break;
        }
        let path = entry.path().to_path_buf();
        if entry.file_type().is_symlink() {
            warnings.push(format!("已跳过符号链接：{}", relative_label(root, &path)));
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                warnings.push(format!("无法读取 {}：{error}", relative_label(root, &path)));
                continue;
            }
        };
        let size = metadata.len();
        scanned_files += 1;
        total_bytes = total_bytes.saturating_add(size);
        let relative_path = relative_label(root, &path);
        let mut sha256 = None;
        if include_hash {
            if hash_bytes.saturating_add(size) > MAX_HASH_BYTES {
                truncated = true;
                warnings.push(format!(
                    "未计算 {} 的 SHA-256：累计哈希内容已达到 {} 字节上限。",
                    relative_path, MAX_HASH_BYTES
                ));
            } else {
                match sha256_file(&path) {
                    Ok(hash) => {
                        hash_bytes = hash_bytes.saturating_add(size);
                        hashed_files += 1;
                        sha256 = Some(hash);
                    }
                    Err(error) => {
                        warnings.push(format!("无法计算 {} 的哈希：{error}", relative_path))
                    }
                }
            }
        }
        files.push(FileManifestEntry {
            relative_path,
            name: file_name(&path),
            size,
            sha256,
        });
    }
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(FileManifestReport {
        root: root.to_string_lossy().into_owned(),
        scanned_entries,
        scanned_files,
        total_bytes,
        hash_bytes,
        hashed_files,
        truncated,
        warnings,
        files,
    })
}

fn imported_manifest_relative_path(value: &str) -> Result<(String, PathBuf)> {
    let normalized = value.replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.starts_with("//")
        || normalized.as_bytes().get(1) == Some(&b':')
    {
        bail!("校验清单包含不安全的相对路径：{value}")
    }
    let mut path = PathBuf::new();
    for segment in normalized.split('/') {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.contains(':')
            || segment.contains('\0')
        {
            bail!("校验清单包含不安全的相对路径：{value}")
        }
        path.push(segment);
    }
    Ok((normalized, path))
}

fn imported_manifest_hash(value: &str, relative_path: &str) -> Result<String> {
    if value.len() != 64 || !value.as_bytes().iter().all(u8::is_ascii_hexdigit) {
        bail!("校验清单中的 SHA-256 无效：{relative_path}")
    }
    Ok(value.to_ascii_lowercase())
}

fn read_imported_manifest(path: &str) -> Result<(PathBuf, ImportedManifest)> {
    let candidate = PathBuf::from(path);
    if candidate.as_os_str().is_empty() {
        bail!("请选择要验证的 JSON 校验清单。")
    }
    let metadata = fs::symlink_metadata(&candidate)
        .with_context(|| format!("无法读取校验清单：{}", candidate.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("校验清单必须是普通 JSON 文件。")
    }
    if metadata.len() > MAX_MANIFEST_JSON_BYTES {
        bail!(
            "校验清单超过 {} MB 安全上限。",
            MAX_MANIFEST_JSON_BYTES / 1024 / 1024
        )
    }
    let path = fs::canonicalize(&candidate)
        .with_context(|| format!("无法解析校验清单路径：{}", candidate.display()))?;
    let bytes = fs::read(&path).with_context(|| format!("无法读取校验清单：{}", path.display()))?;
    let manifest = serde_json::from_slice::<ImportedManifest>(&bytes)
        .context("校验清单不是 Knitspace 可识别的 JSON 格式")?;
    if manifest.files.len() > MAX_MANIFEST_FILES {
        bail!("校验清单文件数超过 {MAX_MANIFEST_FILES} 项安全上限。")
    }
    Ok((path, manifest))
}

fn push_manifest_verification_item(
    items: &mut Vec<FileManifestVerificationItem>,
    item: FileManifestVerificationItem,
    truncated: &mut bool,
    item_limit_noted: &mut bool,
    warnings: &mut Vec<String>,
) {
    if items.len() < MAX_COMPARE_ITEMS {
        items.push(item);
    } else {
        *truncated = true;
        if !*item_limit_noted {
            *item_limit_noted = true;
            warnings.push(format!("校验结果已收起，最多展示 {MAX_COMPARE_ITEMS} 项。"));
        }
    }
}

fn verification_item(
    relative_path: String,
    status: &str,
    expected_size: Option<u64>,
    actual_size: Option<u64>,
    expected_hash: Option<String>,
    actual_hash: Option<String>,
    detail: impl Into<String>,
) -> FileManifestVerificationItem {
    FileManifestVerificationItem {
        name: Path::new(&relative_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_owned(),
        relative_path,
        status: status.to_owned(),
        expected_size,
        actual_size,
        expected_hash,
        actual_hash,
        detail: detail.into(),
    }
}

fn verify_manifest(root: &Path, manifest_path: &str) -> Result<FileManifestVerificationReport> {
    let root = fs::canonicalize(root)
        .with_context(|| format!("无法访问要验证的文件夹：{}", root.display()))?;
    let (manifest_path, imported) = read_imported_manifest(manifest_path)?;
    let mut records = HashMap::<String, ManifestRecord>::new();
    for entry in imported.files {
        let (relative_path, relative_path_buf) =
            imported_manifest_relative_path(&entry.relative_path)?;
        let expected_hash = entry
            .sha256
            .as_deref()
            .map(|value| imported_manifest_hash(value, &relative_path))
            .transpose()?;
        let key = compare_key(&relative_path);
        if records.contains_key(&key) {
            bail!("校验清单包含重复路径：{relative_path}")
        }
        records.insert(
            key,
            ManifestRecord {
                relative_path,
                relative_path_buf,
                expected_size: entry.size,
                expected_hash,
            },
        );
    }

    let mut warnings = Vec::new();
    let mut truncated = imported.truncated;
    if imported.truncated {
        warnings.push(
            "该校验清单标记为不完整；已列出的文件仍会验证，但无法证明目录没有其他变化。".into(),
        );
    }
    let mut items = Vec::new();
    let mut item_limit_noted = false;
    let mut hashed_bytes = 0_u64;
    let mut hash_limit_noted = false;
    let mut match_count = 0_usize;
    let mut missing_count = 0_usize;
    let mut size_mismatch_count = 0_usize;
    let mut hash_mismatch_count = 0_usize;
    let mut unverified_count = 0_usize;
    let mut unreadable_count = 0_usize;
    let mut extra_count = 0_usize;

    let mut record_keys = records.keys().cloned().collect::<Vec<_>>();
    record_keys.sort();
    for key in record_keys {
        let record = records.get(&key).expect("manifest key has a record");
        let expected_hash = record.expected_hash.clone();
        let candidate = root.join(&record.relative_path_buf);
        let metadata = match fs::symlink_metadata(&candidate) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                missing_count += 1;
                push_manifest_verification_item(
                    &mut items,
                    verification_item(
                        record.relative_path.clone(),
                        "missing",
                        Some(record.expected_size),
                        None,
                        expected_hash,
                        None,
                        "清单中存在，但当前目录中找不到该文件。",
                    ),
                    &mut truncated,
                    &mut item_limit_noted,
                    &mut warnings,
                );
                continue;
            }
            Err(error) => {
                unreadable_count += 1;
                push_manifest_verification_item(
                    &mut items,
                    verification_item(
                        record.relative_path.clone(),
                        "unreadable",
                        Some(record.expected_size),
                        None,
                        expected_hash,
                        None,
                        format!("无法读取当前文件：{error}"),
                    ),
                    &mut truncated,
                    &mut item_limit_noted,
                    &mut warnings,
                );
                continue;
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            unreadable_count += 1;
            push_manifest_verification_item(
                &mut items,
                verification_item(
                    record.relative_path.clone(),
                    "unreadable",
                    Some(record.expected_size),
                    None,
                    expected_hash,
                    None,
                    "当前路径不是可安全校验的普通文件。",
                ),
                &mut truncated,
                &mut item_limit_noted,
                &mut warnings,
            );
            continue;
        }
        let canonical = match fs::canonicalize(&candidate) {
            Ok(path) if path.starts_with(&root) => path,
            Ok(_) => {
                unreadable_count += 1;
                push_manifest_verification_item(
                    &mut items,
                    verification_item(
                        record.relative_path.clone(),
                        "unreadable",
                        Some(record.expected_size),
                        None,
                        expected_hash,
                        None,
                        "当前路径解析到了所选目录之外，已拒绝校验。",
                    ),
                    &mut truncated,
                    &mut item_limit_noted,
                    &mut warnings,
                );
                continue;
            }
            Err(error) => {
                unreadable_count += 1;
                push_manifest_verification_item(
                    &mut items,
                    verification_item(
                        record.relative_path.clone(),
                        "unreadable",
                        Some(record.expected_size),
                        None,
                        expected_hash,
                        None,
                        format!("无法解析当前文件路径：{error}"),
                    ),
                    &mut truncated,
                    &mut item_limit_noted,
                    &mut warnings,
                );
                continue;
            }
        };
        let actual_size = metadata.len();
        if actual_size != record.expected_size {
            size_mismatch_count += 1;
            push_manifest_verification_item(
                &mut items,
                verification_item(
                    record.relative_path.clone(),
                    "size-mismatch",
                    Some(record.expected_size),
                    Some(actual_size),
                    expected_hash,
                    None,
                    "文件大小与校验清单不一致。",
                ),
                &mut truncated,
                &mut item_limit_noted,
                &mut warnings,
            );
            continue;
        }
        let Some(expected_hash) = expected_hash else {
            unverified_count += 1;
            push_manifest_verification_item(
                &mut items,
                verification_item(
                    record.relative_path.clone(),
                    "unverified",
                    Some(record.expected_size),
                    Some(actual_size),
                    None,
                    None,
                    "清单未提供 SHA-256；大小相同，但不能证明内容未变化。",
                ),
                &mut truncated,
                &mut item_limit_noted,
                &mut warnings,
            );
            continue;
        };
        if hashed_bytes.saturating_add(actual_size) > MAX_HASH_BYTES {
            truncated = true;
            unverified_count += 1;
            if !hash_limit_noted {
                hash_limit_noted = true;
                warnings.push(format!(
                    "累计哈希内容已达到 {} 字节上限，剩余文件只报告为未验证。",
                    MAX_HASH_BYTES
                ));
            }
            push_manifest_verification_item(
                &mut items,
                verification_item(
                    record.relative_path.clone(),
                    "unverified",
                    Some(record.expected_size),
                    Some(actual_size),
                    Some(expected_hash),
                    None,
                    "文件大小相同，但已达到哈希上限，未重新计算内容指纹。",
                ),
                &mut truncated,
                &mut item_limit_noted,
                &mut warnings,
            );
            continue;
        }
        match sha256_file(&canonical) {
            Ok(actual_hash) => {
                hashed_bytes = hashed_bytes.saturating_add(actual_size);
                if actual_hash == expected_hash {
                    match_count += 1;
                    push_manifest_verification_item(
                        &mut items,
                        verification_item(
                            record.relative_path.clone(),
                            "match",
                            Some(record.expected_size),
                            Some(actual_size),
                            Some(expected_hash),
                            Some(actual_hash),
                            "大小和 SHA-256 都与校验清单一致。",
                        ),
                        &mut truncated,
                        &mut item_limit_noted,
                        &mut warnings,
                    );
                } else {
                    hash_mismatch_count += 1;
                    push_manifest_verification_item(
                        &mut items,
                        verification_item(
                            record.relative_path.clone(),
                            "hash-mismatch",
                            Some(record.expected_size),
                            Some(actual_size),
                            Some(expected_hash),
                            Some(actual_hash),
                            "文件大小相同，但 SHA-256 与校验清单不一致。",
                        ),
                        &mut truncated,
                        &mut item_limit_noted,
                        &mut warnings,
                    );
                }
            }
            Err(error) => {
                unreadable_count += 1;
                push_manifest_verification_item(
                    &mut items,
                    verification_item(
                        record.relative_path.clone(),
                        "unreadable",
                        Some(record.expected_size),
                        Some(actual_size),
                        Some(expected_hash),
                        None,
                        format!("无法计算当前文件的 SHA-256：{error}"),
                    ),
                    &mut truncated,
                    &mut item_limit_noted,
                    &mut warnings,
                );
            }
        }
    }

    let known_paths = records.keys().cloned().collect::<HashSet<_>>();
    let mut scanned_entries = 0_usize;
    let mut scanned_files = 0_usize;
    for entry in WalkDir::new(&root).follow_links(false).into_iter() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                warnings.push(format!("部分路径无法读取：{error}"));
                continue;
            }
        };
        scanned_entries += 1;
        if scanned_entries > MAX_SCAN_ENTRIES || scanned_files >= MAX_MANIFEST_FILES {
            truncated = true;
            warnings.push(format!("额外文件检查已达到上限（最多 {MAX_SCAN_ENTRIES} 个条目、{MAX_MANIFEST_FILES} 个文件）。"));
            break;
        }
        if entry.file_type().is_symlink() || !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let metadata = match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) => {
                warnings.push(format!("无法读取 {}：{error}", relative_label(&root, path)));
                continue;
            }
        };
        scanned_files += 1;
        let relative_path = relative_label(&root, path);
        if known_paths.contains(&compare_key(&relative_path)) {
            continue;
        }
        extra_count += 1;
        push_manifest_verification_item(
            &mut items,
            verification_item(
                relative_path,
                "extra",
                None,
                Some(metadata.len()),
                None,
                None,
                "当前目录中存在，但校验清单未列出该文件。",
            ),
            &mut truncated,
            &mut item_limit_noted,
            &mut warnings,
        );
    }

    items.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(FileManifestVerificationReport {
        root: root.to_string_lossy().into_owned(),
        manifest_path: manifest_path.to_string_lossy().into_owned(),
        scanned_files,
        hashed_bytes,
        match_count,
        missing_count,
        size_mismatch_count,
        hash_mismatch_count,
        unverified_count,
        unreadable_count,
        extra_count,
        truncated,
        warnings,
        items,
    })
}

fn path_payload(record: &FileRecord) -> FileHealthPath {
    FileHealthPath {
        path: record.path.to_string_lossy().into_owned(),
        relative_path: record.relative_path.clone(),
        name: record.name.clone(),
        size: record.size,
    }
}

fn finding(
    root: &Path,
    record: &FileRecord,
    kind: &str,
    detail: impl Into<String>,
) -> FileHealthFinding {
    FileHealthFinding {
        id: format!("{kind}:{}", record.relative_path),
        kind: kind.to_owned(),
        path: record.path.to_string_lossy().into_owned(),
        relative_path: relative_label(root, &record.path),
        name: record.name.clone(),
        size: record.size,
        detail: detail.into(),
        safe_to_recycle: true,
    }
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path).with_context(|| format!("无法读取文件：{}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn read_signature(path: &Path) -> Option<Vec<u8>> {
    let mut file = File::open(path).ok()?;
    let mut bytes = vec![0_u8; 32];
    let read = file.read(&mut bytes).ok()?;
    bytes.truncate(read);
    Some(bytes)
}

fn detected_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("png");
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Some("jpg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.starts_with(b"RIFF") && bytes.len() >= 12 && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.starts_with(b"%PDF-") {
        return Some("pdf");
    }
    if bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08")
    {
        return Some("zip");
    }
    if bytes.starts_with(b"ID3")
        || bytes.starts_with(&[0xff, 0xfb])
        || bytes.starts_with(&[0xff, 0xf3])
    {
        return Some("mp3");
    }
    if bytes.starts_with(b"RIFF") && bytes.len() >= 12 && &bytes[8..12] == b"WAVE" {
        return Some("wav");
    }
    if bytes.starts_with(b"fLaC") {
        return Some("flac");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        return Some("mp4");
    }
    None
}

fn extension_matches(path: &Path, detected: &str) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension.is_empty() {
        return false;
    }
    match detected {
        "jpg" => matches!(extension.as_str(), "jpg" | "jpeg" | "jpe"),
        "mp3" => matches!(extension.as_str(), "mp3" | "mpeg"),
        "wav" => matches!(extension.as_str(), "wav" | "wave"),
        "mp4" => matches!(extension.as_str(), "mp4" | "m4v" | "m4a" | "mov"),
        expected => extension == expected,
    }
}

fn looks_like_image(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "jpg"
            | "jpeg"
            | "jpe"
            | "jfif"
            | "png"
            | "gif"
            | "bmp"
            | "tif"
            | "tiff"
            | "webp"
            | "avif"
            | "heic"
            | "heif"
            | "jxl"
            | "tga"
            | "qoi"
            | "exr"
    )
}

fn normalized_similar_path(root: &Path, raw: &str) -> Result<PathBuf> {
    let candidate = PathBuf::from(raw);
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        root.join(candidate)
    };
    let canonical = fs::canonicalize(&candidate)
        .with_context(|| format!("无法定位 Czkawka 返回的图片：{}", candidate.display()))?;
    if !canonical.starts_with(root) {
        bail!("Czkawka 返回了扫描目录之外的路径。")
    }
    let metadata = fs::symlink_metadata(&canonical)?;
    if !metadata.is_file() {
        bail!("Czkawka 返回的路径不是文件：{}", canonical.display())
    }
    Ok(canonical)
}

fn parse_czkawka_similar_images(
    root: &Path,
    bytes: &[u8],
) -> Result<Vec<FileHealthSimilarImageGroup>> {
    let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let value: serde_json::Value =
        serde_json::from_slice(bytes).context("Czkawka 相似图片结果不是有效 JSON")?;
    let groups = value
        .as_array()
        .or_else(|| {
            value
                .get("similar_vectors")
                .and_then(serde_json::Value::as_array)
        })
        .or_else(|| value.get("groups").and_then(serde_json::Value::as_array))
        .context("Czkawka 相似图片结果缺少分组列表")?;
    let mut result = Vec::new();
    let mut total_files = 0_usize;
    for (group_index, group) in groups.iter().enumerate() {
        if result.len() >= MAX_SIMILAR_IMAGE_GROUPS || total_files >= MAX_SIMILAR_IMAGE_FILES {
            break;
        }
        let Some(entries) = group.as_array() else {
            continue;
        };
        let mut files = Vec::new();
        for entry in entries {
            if total_files >= MAX_SIMILAR_IMAGE_FILES {
                break;
            }
            let Some(raw_path) = entry.get("path").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let path = match normalized_similar_path(&root, raw_path) {
                Ok(path) => path,
                Err(_) => continue,
            };
            let metadata = match fs::metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            let width = entry
                .get("width")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or_default()
                .min(u32::MAX as u64) as u32;
            let height = entry
                .get("height")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or_default()
                .min(u32::MAX as u64) as u32;
            let difference = entry
                .get("difference")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or_default()
                .min(u32::MAX as u64) as u32;
            files.push(FileHealthSimilarImage {
                path: path.to_string_lossy().into_owned(),
                relative_path: relative_label(&root, &path),
                name: file_name(&path),
                size: metadata.len(),
                width,
                height,
                difference,
            });
        }
        if files.len() < 2 {
            continue;
        }
        files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        let suggested_keep = files
            .first()
            .map(|file| file.path.clone())
            .unwrap_or_default();
        total_files += files.len();
        result.push(FileHealthSimilarImageGroup {
            id: format!("similar-image-{group_index}"),
            files,
            suggested_keep,
        });
    }
    Ok(result)
}

fn scan_similar_images_with_czkawka(
    root: &Path,
) -> Result<Option<Vec<FileHealthSimilarImageGroup>>> {
    let directory = std::env::temp_dir().join(format!(
        "knitspace-czkawka-similar-{}",
        uuid::Uuid::now_v7()
    ));
    fs::create_dir_all(&directory).context("无法创建 Czkawka 临时目录")?;
    let output = directory.join("similar-images.json");
    let result = (|| {
        let root_arg = root.to_string_lossy().into_owned();
        let output_arg = output.to_string_lossy().into_owned();
        let args = [
            "image",
            "-d",
            root_arg.as_str(),
            "-p",
            output_arg.as_str(),
            "-s",
            "8",
            "-g",
            "Gradient",
            "-c",
            "16",
            "-z",
            "Nearest",
            "-m",
            "16384",
            "-x",
            "IMAGE",
            "-N",
            "-M",
            "-W",
        ];
        let candidates = ["czkawka_cli.exe", "czkawka_cli", "czkawka.exe", "czkawka"];
        let mut child = None;
        let mut last_error = None;
        for candidate in candidates {
            match Command::new(candidate)
                .args(args)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                Ok(process) => {
                    child = Some(process);
                    break;
                }
                Err(error) => last_error = Some(error.to_string()),
            }
        }
        let Some(mut child) = child else {
            return Err(anyhow::anyhow!(
                "未检测到 Czkawka CLI{}",
                last_error
                    .map(|error| format!("：{error}"))
                    .unwrap_or_default()
            ));
        };
        let started = Instant::now();
        let status = loop {
            if let Some(status) = child.try_wait().context("无法检查 Czkawka 状态")? {
                break status;
            }
            if started.elapsed() >= CZKAWKA_TIMEOUT {
                let _ = child.kill();
                let _ = child.wait();
                return Err(anyhow::anyhow!(
                    "Czkawka 相似图片扫描超过 {} 秒，已停止。",
                    CZKAWKA_TIMEOUT.as_secs()
                ));
            }
            thread::sleep(Duration::from_millis(100));
        };
        if !status.success() && status.code() != Some(11) {
            return Err(anyhow::anyhow!(
                "Czkawka 相似图片扫描失败（退出状态：{status}）。"
            ));
        }
        let metadata = fs::metadata(&output).context("Czkawka 未生成相似图片结果")?;
        if metadata.len() == 0 || metadata.len() > MAX_CZKAWKA_JSON_BYTES {
            return Err(anyhow::anyhow!("Czkawka 结果超过 32 MB 安全上限。"));
        }
        let bytes = fs::read(&output).context("无法读取 Czkawka 相似图片结果")?;
        parse_czkawka_similar_images(root, &bytes)
            .map(Some)
            .map_err(|error| error.context("无法解析 Czkawka 相似图片结果"))
    })();
    let _ = fs::remove_dir_all(&directory);
    result
}

fn scan_folder(root: &Path, large_file_bytes: u64) -> Result<FileHealthReport> {
    let threshold = large_file_bytes.clamp(1 * 1024 * 1024, 4 * 1024 * 1024 * 1024);
    let mut scanned_entries = 0_usize;
    let mut scanned_files = 0_usize;
    let mut scanned_directories = 0_usize;
    let mut total_bytes = 0_u64;
    let mut truncated = false;
    let mut warnings = Vec::new();
    let mut records = Vec::new();
    let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
    let mut directory_sizes: HashMap<PathBuf, (u64, usize)> = HashMap::new();
    directory_sizes.insert(root.to_path_buf(), (0, 0));
    let mut empty_directories = Vec::new();
    let mut empty_files = Vec::new();
    let mut large_files = Vec::new();
    let mut extension_mismatches = Vec::new();

    for entry in WalkDir::new(root).follow_links(false).into_iter() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                warnings.push(format!("部分路径无法读取：{error}"));
                continue;
            }
        };
        scanned_entries += 1;
        if scanned_entries > MAX_SCAN_ENTRIES || scanned_files >= MAX_SCAN_FILES {
            truncated = true;
            warnings.push(format!(
                "扫描已达到上限（最多 {MAX_SCAN_ENTRIES} 个条目、{MAX_SCAN_FILES} 个文件）。"
            ));
            break;
        }
        let path = entry.path().to_path_buf();
        if entry.file_type().is_symlink() {
            warnings.push(format!("已跳过符号链接：{}", relative_label(root, &path)));
            continue;
        }
        if entry.file_type().is_dir() {
            scanned_directories += 1;
            if fs::read_dir(&path)
                .ok()
                .and_then(|mut entries| entries.next())
                .is_none()
            {
                let record = FileRecord {
                    path: path.clone(),
                    relative_path: relative_label(root, &path),
                    name: file_name(&path),
                    size: 0,
                };
                empty_directories.push(finding(
                    root,
                    &record,
                    "empty-directory",
                    "空文件夹；未发现任何子项目。",
                ));
            }
            directory_sizes.entry(path).or_insert((0, 0));
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                warnings.push(format!("无法读取 {}：{error}", relative_label(root, &path)));
                continue;
            }
        };
        let size = metadata.len();
        let record = FileRecord {
            path: path.clone(),
            relative_path: relative_label(root, &path),
            name: file_name(&path),
            size,
        };
        let record_index = records.len();
        records.push(record);
        by_size.entry(size).or_default().push(record_index);
        scanned_files += 1;
        total_bytes = total_bytes.saturating_add(size);
        if size == 0 {
            empty_files.push(finding(
                root,
                records.last().expect("record inserted"),
                "empty-file",
                "空文件；内容长度为 0 字节。",
            ));
        }
        if size >= threshold {
            large_files.push(finding(
                root,
                records.last().expect("record inserted"),
                "large-file",
                format!("文件大小 {}，超过当前阈值 {}。", size, threshold),
            ));
        }
        if let Some(detected) = read_signature(&path)
            .as_deref()
            .and_then(detected_extension)
        {
            if !extension_matches(&path, detected) {
                extension_mismatches.push(finding(
                    root,
                    records.last().expect("record inserted"),
                    "extension-mismatch",
                    format!(
                        "内容看起来是 .{detected}，但文件扩展名为 .{}。",
                        path.extension()
                            .and_then(|value| value.to_str())
                            .unwrap_or("无")
                    ),
                ));
            }
        }
        let mut parent = path.parent();
        while let Some(directory) = parent {
            let value = directory_sizes
                .entry(directory.to_path_buf())
                .or_insert((0, 0));
            value.0 = value.0.saturating_add(size);
            value.1 += 1;
            if directory == root {
                break;
            }
            parent = directory.parent();
        }
    }

    let mut hash_bytes = 0_u64;
    let mut duplicate_groups = Vec::new();
    for (size, indexes) in by_size.into_iter().filter(|(_, indexes)| indexes.len() > 1) {
        if size > 0
            && hash_bytes.saturating_add(size.saturating_mul(indexes.len() as u64)) > MAX_HASH_BYTES
        {
            truncated = true;
            warnings.push(format!(
                "部分重复候选未计算哈希：累计内容超过 {}。",
                MAX_HASH_BYTES
            ));
            continue;
        }
        let mut by_hash: HashMap<String, Vec<usize>> = HashMap::new();
        for index in indexes {
            let record = &records[index];
            match sha256_file(&record.path) {
                Ok(hash) => {
                    hash_bytes = hash_bytes.saturating_add(size);
                    by_hash.entry(hash).or_default().push(index);
                }
                Err(error) => {
                    warnings.push(format!("无法计算 {} 的哈希：{error}", record.relative_path))
                }
            }
        }
        for (hash, indexes) in by_hash.into_iter().filter(|(_, indexes)| indexes.len() > 1) {
            let mut files = indexes
                .iter()
                .map(|index| path_payload(&records[*index]))
                .collect::<Vec<_>>();
            files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
            let suggested_keep = files
                .first()
                .map(|file| file.path.clone())
                .unwrap_or_default();
            duplicate_groups.push(FileHealthDuplicateGroup {
                id: format!("duplicate-{hash}"),
                hash,
                size,
                files,
                suggested_keep,
            });
        }
    }
    duplicate_groups.sort_by(|left, right| {
        right
            .files
            .len()
            .cmp(&left.files.len())
            .then_with(|| right.size.cmp(&left.size))
    });

    let mut similar_image_groups = Vec::new();
    if records.iter().any(|record| looks_like_image(&record.path)) {
        match scan_similar_images_with_czkawka(root) {
            Ok(Some(groups)) => similar_image_groups = groups,
            Ok(None) => {}
            Err(error) => warnings.push(format!(
                "未完成相似图片扫描：{}。精确重复、空文件和其他检查仍已完成。",
                error
            )),
        }
    }

    let mut largest_directories = directory_sizes
        .into_iter()
        .filter(|(path, (_, count))| *path != root && *count > 0)
        .map(|(path, (size, file_count))| FileHealthDirectory {
            path: path.to_string_lossy().into_owned(),
            relative_path: relative_label(root, &path),
            size,
            file_count,
        })
        .collect::<Vec<_>>();
    largest_directories.sort_by(|left, right| right.size.cmp(&left.size));
    largest_directories.truncate(20);

    Ok(FileHealthReport {
        root: root.to_string_lossy().into_owned(),
        scanned_entries,
        scanned_files,
        scanned_directories,
        total_bytes,
        large_file_bytes: threshold,
        hash_bytes,
        truncated,
        warnings,
        empty_files,
        empty_directories,
        large_files,
        extension_mismatches,
        duplicate_groups,
        similar_image_groups,
        largest_directories,
    })
}

#[tauri::command]
pub fn scan_file_health(
    root: String,
    large_file_bytes: Option<u64>,
) -> Result<FileHealthReport, String> {
    let root = canonical_directory(&root).map_err(|error| error.to_string())?;
    scan_folder(&root, large_file_bytes.unwrap_or(DEFAULT_LARGE_FILE_BYTES))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn compare_directories(
    left_root: String,
    right_root: String,
) -> Result<DirectoryCompareReport, String> {
    let left_root = canonical_directory(&left_root).map_err(|error| error.to_string())?;
    let right_root = canonical_directory(&right_root).map_err(|error| error.to_string())?;
    if left_root == right_root {
        return Err("请选择两个不同的文件夹进行对比。".into());
    }
    compare_folders(&left_root, &right_root).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_file_manifest(
    root: String,
    include_hash: Option<bool>,
) -> Result<FileManifestReport, String> {
    let root = canonical_directory(&root).map_err(|error| error.to_string())?;
    create_manifest(&root, include_hash.unwrap_or(true)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn verify_file_manifest(
    root: String,
    manifest_path: String,
) -> Result<FileManifestVerificationReport, String> {
    let root = canonical_directory(&root).map_err(|error| error.to_string())?;
    verify_manifest(&root, &manifest_path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn recycle_file_health_paths(root: String, paths: Vec<String>) -> Result<usize, String> {
    let root = canonical_directory(&root).map_err(|error| error.to_string())?;
    if paths.is_empty() {
        return Err("请先选择要移入回收站的文件。".into());
    }
    if paths.len() > 200 {
        return Err("一次最多处理 200 个文件，请分批执行。".into());
    }
    let mut validated = Vec::with_capacity(paths.len());
    for raw in paths {
        let path = fs::canonicalize(&raw).map_err(|error| format!("无法找到文件：{error}"))?;
        if path == root || !path.starts_with(&root) {
            return Err("只能处理已选择文件夹内的文件。".into());
        }
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            return Err(format!("只支持将文件移入回收站：{}", path.display()));
        }
        validated.push(path);
    }
    for path in &validated {
        crate::recycle_external_workspace_path(path)?;
    }
    Ok(validated.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use uuid::Uuid;

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("knitspace-file-health-{label}-{}", Uuid::now_v7()))
    }

    #[test]
    fn detects_common_signatures_and_extension_aliases() {
        assert_eq!(detected_extension(b"%PDF-1.7"), Some("pdf"));
        assert_eq!(detected_extension(b"\x89PNG\r\n\x1a\n"), Some("png"));
        assert!(extension_matches(Path::new("photo.jpeg"), "jpg"));
        assert!(!extension_matches(Path::new("photo.txt"), "jpg"));
    }

    #[test]
    fn scans_duplicates_empty_files_and_mismatched_extensions() -> Result<()> {
        let root = temp_root("report");
        fs::create_dir_all(root.join("empty-dir"))?;
        fs::write(root.join("one.txt"), b"same")?;
        fs::write(root.join("two.txt"), b"same")?;
        fs::write(root.join("empty.bin"), b"")?;
        let mut fake_png = File::create(root.join("wrong.txt"))?;
        fake_png.write_all(b"\x89PNG\r\n\x1a\n")?;
        let report = scan_folder(&root, DEFAULT_LARGE_FILE_BYTES)?;
        assert_eq!(report.duplicate_groups.len(), 1);
        assert_eq!(report.duplicate_groups[0].files.len(), 2);
        assert_eq!(report.empty_files.len(), 1);
        assert_eq!(report.empty_directories.len(), 1);
        assert_eq!(report.extension_mismatches.len(), 1);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn parses_and_sorts_czkawka_similar_image_groups_inside_root() -> Result<()> {
        let root = temp_root("similar-images");
        fs::create_dir_all(&root)?;
        let first = root.join("z-last.png");
        let second = root.join("a-first.png");
        fs::write(&first, b"not-an-image-but-a-bounded-fixture")?;
        fs::write(&second, b"another-bounded-fixture")?;
        let payload = serde_json::json!([[
            { "path": first.to_string_lossy(), "width": 800, "height": 600, "difference": 4 },
            { "path": second.to_string_lossy(), "width": 400, "height": 300, "difference": 4 }
        ]]);
        let payload_bytes = serde_json::to_vec(&payload)?;
        let groups = parse_czkawka_similar_images(&root, &payload_bytes)?;
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files.len(), 2);
        assert_eq!(groups[0].files[0].name, "a-first.png");
        assert_eq!(groups[0].suggested_keep, groups[0].files[0].path);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn ignores_similar_image_paths_outside_the_scan_root() -> Result<()> {
        let root = temp_root("similar-images-inside");
        let outside = temp_root("similar-images-outside");
        fs::create_dir_all(&root)?;
        fs::create_dir_all(&outside)?;
        let inside = root.join("inside.png");
        let outside_file = outside.join("outside.png");
        fs::write(&inside, b"inside")?;
        fs::write(&outside_file, b"outside")?;
        let payload = serde_json::json!([[
            { "path": inside.to_string_lossy(), "width": 10, "height": 10, "difference": 1 },
            { "path": outside_file.to_string_lossy(), "width": 10, "height": 10, "difference": 1 }
        ]]);
        let groups =
            parse_czkawka_similar_images(&root, serde_json::to_string(&payload)?.as_bytes())?;
        assert!(groups.is_empty());
        fs::remove_dir_all(root)?;
        fs::remove_dir_all(outside)?;
        Ok(())
    }

    #[test]
    fn compares_added_removed_changed_and_same_files() -> Result<()> {
        let left_root = temp_root("compare-left");
        let right_root = temp_root("compare-right");
        fs::create_dir_all(&left_root)?;
        fs::create_dir_all(&right_root)?;
        fs::write(left_root.join("same.txt"), b"same")?;
        fs::write(right_root.join("same.txt"), b"same")?;
        fs::write(left_root.join("removed.txt"), b"left")?;
        fs::write(right_root.join("added.txt"), b"right")?;
        fs::write(left_root.join("changed.txt"), b"old")?;
        fs::write(right_root.join("changed.txt"), b"new")?;
        let report = compare_folders(&left_root, &right_root)?;
        assert_eq!(report.same_count, 1);
        assert_eq!(report.added_count, 1);
        assert_eq!(report.removed_count, 1);
        assert_eq!(report.changed_count, 1);
        assert_eq!(report.unverified_count, 0);
        fs::remove_dir_all(left_root)?;
        fs::remove_dir_all(right_root)?;
        Ok(())
    }

    #[test]
    fn creates_sorted_manifest_with_optional_hashes() -> Result<()> {
        let root = temp_root("manifest");
        fs::create_dir_all(root.join("nested"))?;
        fs::write(root.join("z.txt"), b"last")?;
        fs::write(root.join("nested").join("a.txt"), b"first")?;
        let report = create_manifest(&root, true)?;
        assert_eq!(report.scanned_files, 2);
        assert_eq!(report.hashed_files, 2);
        assert_eq!(report.files[0].relative_path, "nested/a.txt");
        assert_eq!(
            report.files[0].sha256.as_deref(),
            Some("a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e")
        );
        assert_eq!(report.files[1].relative_path, "z.txt");
        let without_hash = create_manifest(&root, false)?;
        assert_eq!(without_hash.hashed_files, 0);
        assert!(without_hash.files.iter().all(|file| file.sha256.is_none()));
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn verifies_manifest_matches_mismatches_missing_and_extra_files() -> Result<()> {
        let root = temp_root("verify-root");
        let manifest_dir = temp_root("verify-manifest");
        fs::create_dir_all(&root)?;
        fs::create_dir_all(&manifest_dir)?;

        let matching = root.join("matching.txt");
        fs::write(&matching, b"match")?;
        let matching_hash = sha256_file(&matching)?;

        let hash_changed = root.join("hash-changed.txt");
        fs::write(&hash_changed, b"old!")?;
        let hash_changed_hash = sha256_file(&hash_changed)?;
        fs::write(&hash_changed, b"new!")?;

        fs::write(root.join("size-changed.txt"), b"large")?;
        fs::write(root.join("size-only.txt"), b"yes")?;
        fs::write(root.join("extra.txt"), b"extra")?;

        let manifest = manifest_dir.join("manifest.json");
        let payload = serde_json::json!({
            "truncated": false,
            "files": [
                { "relativePath": "matching.txt", "size": 5, "sha256": matching_hash },
                { "relativePath": "hash-changed.txt", "size": 4, "sha256": hash_changed_hash },
                { "relativePath": "size-changed.txt", "size": 4, "sha256": "0000000000000000000000000000000000000000000000000000000000000000" },
                { "relativePath": "missing.txt", "size": 1, "sha256": "0000000000000000000000000000000000000000000000000000000000000000" },
                { "relativePath": "size-only.txt", "size": 3 }
            ]
        });
        fs::write(&manifest, serde_json::to_vec(&payload)?)?;

        let report = verify_manifest(&root, &manifest.to_string_lossy())?;
        assert_eq!(report.match_count, 1);
        assert_eq!(report.hash_mismatch_count, 1);
        assert_eq!(report.size_mismatch_count, 1);
        assert_eq!(report.missing_count, 1);
        assert_eq!(report.unverified_count, 1);
        assert_eq!(report.extra_count, 1);
        assert_eq!(report.unreadable_count, 0);
        assert!(report
            .items
            .iter()
            .any(|item| item.relative_path == "extra.txt" && item.status == "extra"));
        assert!(
            report
                .items
                .iter()
                .any(|item| item.relative_path == "hash-changed.txt"
                    && item.status == "hash-mismatch")
        );

        fs::remove_dir_all(root)?;
        fs::remove_dir_all(manifest_dir)?;
        Ok(())
    }

    #[test]
    fn rejects_unsafe_manifest_paths_before_reading_the_directory() -> Result<()> {
        let root = temp_root("verify-unsafe-root");
        let manifest_dir = temp_root("verify-unsafe-manifest");
        fs::create_dir_all(&root)?;
        fs::create_dir_all(&manifest_dir)?;
        let manifest = manifest_dir.join("unsafe.json");
        fs::write(
            &manifest,
            r#"{"files":[{"relativePath":"../outside.txt","size":1}]}"#,
        )?;

        let error = verify_manifest(&root, &manifest.to_string_lossy()).unwrap_err();
        assert!(error.to_string().contains("不安全的相对路径"));

        fs::remove_dir_all(root)?;
        fs::remove_dir_all(manifest_dir)?;
        Ok(())
    }
}
