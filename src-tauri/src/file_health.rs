use anyhow::{bail, Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

pub const MAX_SCAN_ENTRIES: usize = 50_000;
pub const MAX_SCAN_FILES: usize = 40_000;
pub const MAX_HASH_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const DEFAULT_LARGE_FILE_BYTES: u64 = 512 * 1024 * 1024;

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
    pub largest_directories: Vec<FileHealthDirectory>,
}

#[derive(Debug)]
struct FileRecord {
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
}
