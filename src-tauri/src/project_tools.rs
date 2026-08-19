use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use walkdir::{DirEntry, WalkDir};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const DELIVERY_MAX_FILES: usize = 20_000;
const DELIVERY_MAX_BYTES: u64 = 32 * 1024 * 1024 * 1024;
const DELIVERY_PREVIEW_FILES: usize = 500;
const SNAPSHOT_MAX_FILES: usize = 5_000;
const SNAPSHOT_MAX_BYTES: u64 = 8 * 1024 * 1024;
const SNAPSHOT_KEEP_COUNT: usize = 100;
const DIFF_PREVIEW_LIMIT: usize = 1_000;
const EXCLUDED_DIRECTORIES: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".cache",
    ".parcel-cache",
    ".turbo",
    "coverage",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".venv",
    "venv",
    ".idea",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryPackScanRequest {
    pub source_root: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryPackFilePreview {
    pub relative_path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryPackPlan {
    pub plan_id: String,
    pub project_name: String,
    pub file_count: usize,
    pub total_bytes: u64,
    pub excluded_count: usize,
    pub skipped_link_count: usize,
    pub fingerprint: String,
    pub truncated: bool,
    pub preview_truncated: bool,
    pub extension_counts: BTreeMap<String, usize>,
    pub files: Vec<DeliveryPackFilePreview>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryPackCreateRequest {
    pub source_root: String,
    pub output_path: String,
    pub project_name: String,
    pub expected_fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryPackReport {
    pub output_path: String,
    pub archive_name: String,
    pub archive_size: u64,
    pub file_count: usize,
    pub total_bytes: u64,
    pub fingerprint: String,
}

#[derive(Debug, Clone)]
struct DeliveryFile {
    relative_path: String,
    path: PathBuf,
    size: u64,
    modified_ms: u64,
    sha256: String,
}

#[derive(Debug, Clone)]
struct DeliveryScan {
    root: PathBuf,
    project_name: String,
    files: Vec<DeliveryFile>,
    total_bytes: u64,
    excluded_count: usize,
    skipped_link_count: usize,
    fingerprint: String,
    truncated: bool,
    extension_counts: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSnapshotRequest {
    pub source_root: String,
    pub label: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotEntry {
    relative_path: String,
    size: u64,
    modified_ms: u64,
    sha256: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderSnapshot {
    version: u32,
    snapshot_id: String,
    label: String,
    source_root: String,
    created_at: String,
    fingerprint: String,
    total_bytes: u64,
    entries: Vec<SnapshotEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSnapshotSummary {
    pub snapshot_id: String,
    pub label: String,
    pub root_name: String,
    pub created_at: String,
    pub file_count: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSnapshotDiffItem {
    pub relative_path: String,
    pub status: String,
    pub before_size: Option<u64>,
    pub after_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSnapshotDiff {
    pub snapshot_id: String,
    pub label: String,
    pub compared_at: String,
    pub added_count: usize,
    pub modified_count: usize,
    pub missing_count: usize,
    pub anomalous_count: usize,
    pub unchanged_count: usize,
    pub truncated: bool,
    pub items: Vec<FolderSnapshotDiffItem>,
}

fn canonical_directory(raw: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(format!("{label}必须是本地绝对路径。"));
    }
    let link = fs::symlink_metadata(&path).map_err(|_| format!("{label}不存在或无法读取。"))?;
    if link.file_type().is_symlink() || !link.is_dir() {
        return Err(format!("{label}不能是符号链接且必须是文件夹。"));
    }
    fs::canonicalize(path).map_err(|_| format!("无法定位{label}。"))
}

fn modified_ms(metadata: &fs::Metadata) -> Result<u64, String> {
    Ok(metadata
        .modified()
        .map_err(|_| "无法读取文件修改时间。")?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "文件修改时间无效。")?
        .as_millis()
        .min(u128::from(u64::MAX)) as u64)
}

fn normalized_relative(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|_| "无法读取项目文件。")?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|_| "项目文件读取失败。")?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn excluded_entry(entry: &DirEntry) -> bool {
    if entry.depth() == 0 || !entry.file_type().is_dir() {
        return false;
    }
    let name = entry.file_name().to_string_lossy();
    EXCLUDED_DIRECTORIES
        .iter()
        .any(|candidate| name.eq_ignore_ascii_case(candidate))
}

fn safe_project_name(raw: &str) -> Result<String, String> {
    let value = raw.trim();
    if value.is_empty()
        || value.len() > 120
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
        return Err("项目名称包含 Windows 不支持的字符。".into());
    }
    Ok(value.to_owned())
}

fn scan_delivery(root: &Path, max_files: usize) -> Result<DeliveryScan, String> {
    let project_name = safe_project_name(
        &root
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("project")
            .replace(['[', ']'], ""),
    )?;
    let mut files = Vec::new();
    let mut total_bytes = 0_u64;
    let mut excluded_count = 0;
    let mut skipped_link_count = 0;
    let mut truncated = false;
    let mut extension_counts = BTreeMap::<String, usize>::new();
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let excluded = excluded_entry(entry);
            if excluded {
                excluded_count += 1;
            }
            !excluded
        });
    for entry in walker.filter_map(Result::ok) {
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
        if files.len() >= max_files {
            truncated = true;
            break;
        }
        let link = fs::symlink_metadata(entry.path()).map_err(|_| "无法检查项目文件。")?;
        if link.file_type().is_symlink() || !link.is_file() {
            skipped_link_count += 1;
            continue;
        }
        total_bytes = total_bytes
            .checked_add(link.len())
            .ok_or("项目总大小溢出。")?;
        if total_bytes > DELIVERY_MAX_BYTES {
            return Err("项目交付内容超过 32 GB 安全上限。".into());
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|_| "项目文件超出来源目录。")?;
        if relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err("项目包含不安全的相对路径。".into());
        }
        let extension = entry
            .path()
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("无扩展名")
            .to_ascii_lowercase();
        *extension_counts.entry(extension).or_default() += 1;
        files.push(DeliveryFile {
            relative_path: normalized_relative(relative),
            path: entry.path().to_path_buf(),
            size: link.len(),
            modified_ms: modified_ms(&link)?,
            sha256: hash_file(entry.path())?,
        });
    }
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let mut fingerprint = Sha256::new();
    for file in &files {
        fingerprint.update(file.relative_path.as_bytes());
        fingerprint.update([0]);
        fingerprint.update(file.size.to_le_bytes());
        fingerprint.update(file.modified_ms.to_le_bytes());
        fingerprint.update(file.sha256.as_bytes());
    }
    Ok(DeliveryScan {
        root: root.to_path_buf(),
        project_name,
        files,
        total_bytes,
        excluded_count,
        skipped_link_count,
        fingerprint: format!("{:x}", fingerprint.finalize()),
        truncated,
        extension_counts,
    })
}

fn delivery_plan(request: DeliveryPackScanRequest) -> Result<DeliveryPackPlan, String> {
    let root = canonical_directory(&request.source_root, "项目来源目录")?;
    let scan = scan_delivery(&root, DELIVERY_MAX_FILES)?;
    let mut warnings = vec![
        "默认排除版本库、依赖、缓存、测试覆盖率与常见构建产物。".into(),
        "交付包会生成 README、相对文件清单与 SHA-256 清单；不会修改来源目录。".into(),
    ];
    if scan.truncated {
        warnings.push("项目超过 20,000 个文件，当前预览不完整，已禁止生成。".into());
    }
    if scan.skipped_link_count > 0 {
        warnings.push(format!(
            "已跳过 {} 个符号链接或重解析项。",
            scan.skipped_link_count
        ));
    }
    Ok(DeliveryPackPlan {
        plan_id: Uuid::now_v7().to_string(),
        project_name: scan.project_name,
        file_count: scan.files.len(),
        total_bytes: scan.total_bytes,
        excluded_count: scan.excluded_count,
        skipped_link_count: scan.skipped_link_count,
        fingerprint: scan.fingerprint,
        truncated: scan.truncated,
        preview_truncated: scan.files.len() > DELIVERY_PREVIEW_FILES,
        extension_counts: scan.extension_counts,
        files: scan
            .files
            .iter()
            .take(DELIVERY_PREVIEW_FILES)
            .map(|file| DeliveryPackFilePreview {
                relative_path: file.relative_path.clone(),
                size: file.size,
                sha256: file.sha256.clone(),
            })
            .collect(),
        warnings,
    })
}

fn readme(scan: &DeliveryScan, name: &str) -> String {
    let extensions = scan
        .extension_counts
        .iter()
        .map(|(extension, count)| format!("- `{extension}`: {count}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "# {name}\n\n此交付包由 Knitspace 在本机从用户明确选择的目录生成。\n\n## 内容\n\n- 文件数：{}\n- 原始总大小：{} bytes\n- 项目指纹：`{}`\n\n## 文件类型\n\n{}\n\n## 校验\n\n使用 `SHA256SUMS.txt` 验证每个相对路径的内容。`FILE-MANIFEST.json` 可供自动化程序读取。\n",
        scan.files.len(),
        scan.total_bytes,
        scan.fingerprint,
        if extensions.is_empty() {
            "- 无文件".into()
        } else {
            extensions
        }
    )
}

fn create_delivery_pack(request: DeliveryPackCreateRequest) -> Result<DeliveryPackReport, String> {
    let root = canonical_directory(&request.source_root, "项目来源目录")?;
    let scan = scan_delivery(&root, DELIVERY_MAX_FILES)?;
    if scan.truncated {
        return Err("项目文件数超过上限，不能生成不完整交付包。".into());
    }
    if request.expected_fingerprint.len() != 64 || scan.fingerprint != request.expected_fingerprint
    {
        return Err("项目在预览后发生变化，请重新扫描。".into());
    }
    let project_name = safe_project_name(&request.project_name)?;
    let output = PathBuf::from(&request.output_path);
    if !output.is_absolute()
        || !output
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("zip"))
    {
        return Err("交付包输出必须是本地 .zip 绝对路径。".into());
    }
    if output.exists() {
        return Err("输出文件已经存在；不会覆盖，请选择新名称。".into());
    }
    let parent = output.parent().ok_or("交付包输出目录无效。")?;
    let canonical_parent = fs::canonicalize(parent).map_err(|_| "交付包输出目录不存在。")?;
    if canonical_parent.starts_with(&scan.root) {
        return Err("交付包必须输出到项目来源目录之外，避免下次扫描把它打包进去。".into());
    }
    let staging = canonical_parent.join(format!(".knitspace-delivery-{}.partial", Uuid::now_v7()));
    let file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&staging)
        .map_err(|_| "无法创建交付包临时文件。")?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let result = (|| -> Result<(), String> {
        for item in &scan.files {
            let link = fs::symlink_metadata(&item.path).map_err(|_| "交付文件已不可读。")?;
            if link.file_type().is_symlink()
                || !link.is_file()
                || link.len() != item.size
                || modified_ms(&link)? != item.modified_ms
                || hash_file(&item.path)? != item.sha256
            {
                return Err("项目文件在打包期间发生变化；已停止且不会留下不完整 ZIP。".into());
            }
            zip.start_file(format!("{project_name}/{}", item.relative_path), options)
                .map_err(|_| "无法写入交付包文件条目。")?;
            let mut source = fs::File::open(&item.path).map_err(|_| "无法读取交付文件。")?;
            std::io::copy(&mut source, &mut zip).map_err(|_| "无法复制交付文件到 ZIP。")?;
        }
        let manifest = serde_json::to_vec_pretty(&serde_json::json!({
            "version": 1,
            "project": project_name,
            "fingerprint": scan.fingerprint,
            "generatedAt": Utc::now().to_rfc3339(),
            "files": scan.files.iter().map(|file| serde_json::json!({
                "path": file.relative_path,
                "size": file.size,
                "sha256": file.sha256,
            })).collect::<Vec<_>>()
        }))
        .map_err(|_| "无法生成交付文件清单。")?;
        zip.start_file(format!("{project_name}/FILE-MANIFEST.json"), options)
            .map_err(|_| "无法写入交付文件清单。")?;
        zip.write_all(&manifest)
            .map_err(|_| "无法写入交付文件清单。")?;
        let sums = scan
            .files
            .iter()
            .map(|file| format!("{}  {}", file.sha256, file.relative_path))
            .collect::<Vec<_>>()
            .join("\n");
        zip.start_file(format!("{project_name}/SHA256SUMS.txt"), options)
            .map_err(|_| "无法写入 SHA-256 清单。")?;
        zip.write_all(sums.as_bytes())
            .map_err(|_| "无法写入 SHA-256 清单。")?;
        zip.start_file(format!("{project_name}/README.md"), options)
            .map_err(|_| "无法写入 README。")?;
        zip.write_all(readme(&scan, &project_name).as_bytes())
            .map_err(|_| "无法写入 README。")?;
        let file = zip.finish().map_err(|_| "无法完成交付包。")?;
        file.sync_all().map_err(|_| "无法同步交付包。")?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&staging);
        return Err(error);
    }
    fs::rename(&staging, &output).map_err(|_| {
        let _ = fs::remove_file(&staging);
        "无法完成交付包输出。".to_string()
    })?;
    let metadata = fs::metadata(&output).map_err(|_| "交付包已生成但无法读取结果。")?;
    Ok(DeliveryPackReport {
        output_path: output.to_string_lossy().into_owned(),
        archive_name: output
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("delivery.zip")
            .to_owned(),
        archive_size: metadata.len(),
        file_count: scan.files.len(),
        total_bytes: scan.total_bytes,
        fingerprint: scan.fingerprint,
    })
}

fn snapshot_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("folder-snapshots"))
        .map_err(|_| "无法定位文件夹时间切片目录。".into())
}

fn snapshot_path(directory: &Path, snapshot_id: &str) -> Result<PathBuf, String> {
    Uuid::parse_str(snapshot_id).map_err(|_| "时间切片 ID 无效。")?;
    Ok(directory.join(format!("{snapshot_id}.json")))
}

fn scan_snapshot(root: &Path) -> Result<(Vec<SnapshotEntry>, u64, String), String> {
    let scan = scan_delivery(root, SNAPSHOT_MAX_FILES)?;
    if scan.truncated {
        return Err("文件夹超过 5,000 个普通文件，不能保存不完整时间切片。".into());
    }
    Ok((
        scan.files
            .into_iter()
            .map(|file| SnapshotEntry {
                relative_path: file.relative_path,
                size: file.size,
                modified_ms: file.modified_ms,
                sha256: file.sha256,
            })
            .collect(),
        scan.total_bytes,
        scan.fingerprint,
    ))
}

fn snapshot_bytes(snapshot: &FolderSnapshot) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec_pretty(snapshot).map_err(|_| "无法生成文件夹时间切片。")?;
    if bytes.len() as u64 > SNAPSHOT_MAX_BYTES {
        return Err("文件夹时间切片超过 8 MB 安全上限。".into());
    }
    Ok(bytes)
}

fn read_snapshot(directory: &Path, snapshot_id: &str) -> Result<FolderSnapshot, String> {
    let path = snapshot_path(directory, snapshot_id)?;
    let metadata = fs::metadata(&path).map_err(|_| "没有找到该文件夹时间切片。")?;
    if !metadata.is_file() || metadata.len() > SNAPSHOT_MAX_BYTES {
        return Err("文件夹时间切片无效或过大。".into());
    }
    let snapshot: FolderSnapshot =
        serde_json::from_slice(&fs::read(path).map_err(|_| "无法读取文件夹时间切片。")?)
            .map_err(|_| "文件夹时间切片无法解析。")?;
    if snapshot.version != 1
        || snapshot.snapshot_id != snapshot_id
        || snapshot.entries.len() > SNAPSHOT_MAX_FILES
    {
        return Err("文件夹时间切片版本或内容无效。".into());
    }
    Ok(snapshot)
}

fn write_snapshot(directory: &Path, snapshot: &FolderSnapshot) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|_| "无法创建文件夹时间切片目录。")?;
    let final_path = snapshot_path(directory, &snapshot.snapshot_id)?;
    let staging = directory.join(format!(".{}.tmp", snapshot.snapshot_id));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&staging)
        .map_err(|_| "无法创建文件夹时间切片临时文件。")?;
    if let Err(error) = file
        .write_all(&snapshot_bytes(snapshot)?)
        .and_then(|_| file.sync_all())
    {
        drop(file);
        let _ = fs::remove_file(&staging);
        return Err(format!("无法保存文件夹时间切片：{error}"));
    }
    drop(file);
    fs::rename(&staging, &final_path).map_err(|_| {
        let _ = fs::remove_file(&staging);
        "无法完成文件夹时间切片。".to_string()
    })?;
    prune_snapshots(directory);
    Ok(())
}

fn prune_snapshots(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut values = entries
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
    values.sort_by_key(|(time, _)| std::cmp::Reverse(*time));
    for (_, path) in values.into_iter().skip(SNAPSHOT_KEEP_COUNT) {
        let _ = fs::remove_file(path);
    }
}

fn snapshot_summary(snapshot: FolderSnapshot) -> FolderSnapshotSummary {
    FolderSnapshotSummary {
        snapshot_id: snapshot.snapshot_id,
        label: snapshot.label,
        root_name: Path::new(&snapshot.source_root)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("文件夹")
            .to_owned(),
        created_at: snapshot.created_at,
        file_count: snapshot.entries.len(),
        total_bytes: snapshot.total_bytes,
    }
}

fn compare_snapshot(directory: &Path, snapshot_id: &str) -> Result<FolderSnapshotDiff, String> {
    let snapshot = read_snapshot(directory, snapshot_id)?;
    let root = canonical_directory(&snapshot.source_root, "原时间切片文件夹")?;
    let (current, _, _) = scan_snapshot(&root)?;
    let previous = snapshot
        .entries
        .iter()
        .map(|entry| (entry.relative_path.as_str(), entry))
        .collect::<HashMap<_, _>>();
    let current_map = current
        .iter()
        .map(|entry| (entry.relative_path.as_str(), entry))
        .collect::<HashMap<_, _>>();
    let mut keys = previous
        .keys()
        .chain(current_map.keys())
        .copied()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    keys.sort();
    let mut items = Vec::new();
    let mut added_count = 0;
    let mut modified_count = 0;
    let mut missing_count = 0;
    let mut anomalous_count = 0;
    let mut unchanged_count = 0;
    for key in keys {
        let (status, before_size, after_size) = match (previous.get(key), current_map.get(key)) {
            (None, Some(after)) => {
                added_count += 1;
                ("added", None, Some(after.size))
            }
            (Some(before), None) => {
                missing_count += 1;
                ("missing", Some(before.size), None)
            }
            (Some(before), Some(after)) if before.sha256 == after.sha256 => {
                unchanged_count += 1;
                continue;
            }
            (Some(before), Some(after)) => {
                let same_metadata =
                    before.size == after.size && before.modified_ms == after.modified_ms;
                let ratio =
                    before.size.max(after.size) as f64 / before.size.min(after.size).max(1) as f64;
                if same_metadata || ratio >= 10.0 {
                    anomalous_count += 1;
                    ("anomalous", Some(before.size), Some(after.size))
                } else {
                    modified_count += 1;
                    ("modified", Some(before.size), Some(after.size))
                }
            }
            (None, None) => continue,
        };
        if items.len() < DIFF_PREVIEW_LIMIT {
            items.push(FolderSnapshotDiffItem {
                relative_path: key.to_owned(),
                status: status.into(),
                before_size,
                after_size,
            });
        }
    }
    Ok(FolderSnapshotDiff {
        snapshot_id: snapshot.snapshot_id,
        label: snapshot.label,
        compared_at: Utc::now().to_rfc3339(),
        added_count,
        modified_count,
        missing_count,
        anomalous_count,
        unchanged_count,
        truncated: added_count + modified_count + missing_count + anomalous_count > items.len(),
        items,
    })
}

#[tauri::command]
pub async fn scan_project_delivery_pack(
    request: DeliveryPackScanRequest,
) -> Result<DeliveryPackPlan, String> {
    tauri::async_runtime::spawn_blocking(move || delivery_plan(request))
        .await
        .map_err(|_| "项目交付包扫描任务异常退出。")?
}

#[tauri::command]
pub async fn create_project_delivery_pack(
    request: DeliveryPackCreateRequest,
) -> Result<DeliveryPackReport, String> {
    tauri::async_runtime::spawn_blocking(move || create_delivery_pack(request))
        .await
        .map_err(|_| "项目交付包生成任务异常退出。")?
}

#[tauri::command]
pub async fn create_folder_snapshot(
    app: AppHandle,
    request: FolderSnapshotRequest,
) -> Result<FolderSnapshotSummary, String> {
    let directory = snapshot_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_directory(&request.source_root, "时间切片文件夹")?;
        let label = request.label.trim();
        if label.is_empty() || label.len() > 120 || label.chars().any(char::is_control) {
            return Err("时间切片名称无效。".into());
        }
        let (entries, total_bytes, fingerprint) = scan_snapshot(&root)?;
        let snapshot = FolderSnapshot {
            version: 1,
            snapshot_id: Uuid::now_v7().to_string(),
            label: label.into(),
            source_root: root.to_string_lossy().into_owned(),
            created_at: Utc::now().to_rfc3339(),
            fingerprint,
            total_bytes,
            entries,
        };
        write_snapshot(&directory, &snapshot)?;
        Ok(snapshot_summary(snapshot))
    })
    .await
    .map_err(|_| "文件夹时间切片任务异常退出。")?
}

#[tauri::command]
pub fn list_folder_snapshots(app: AppHandle) -> Result<Vec<FolderSnapshotSummary>, String> {
    let directory = snapshot_directory(&app)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut summaries = fs::read_dir(&directory)
        .map_err(|_| "无法读取文件夹时间切片目录。")?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let id = entry.path().file_stem()?.to_str()?.to_owned();
            read_snapshot(&directory, &id).ok().map(snapshot_summary)
        })
        .collect::<Vec<_>>();
    summaries.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    summaries.truncate(SNAPSHOT_KEEP_COUNT);
    Ok(summaries)
}

#[tauri::command]
pub async fn compare_folder_snapshot(
    app: AppHandle,
    snapshot_id: String,
) -> Result<FolderSnapshotDiff, String> {
    let directory = snapshot_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || compare_snapshot(&directory, &snapshot_id))
        .await
        .map_err(|_| "文件夹时间切片比较任务异常退出。")?
}

#[tauri::command]
pub fn delete_folder_snapshot(app: AppHandle, snapshot_id: String) -> Result<bool, String> {
    let directory = snapshot_directory(&app)?;
    let path = snapshot_path(&directory, &snapshot_id)?;
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_file(path).map_err(|_| "无法删除文件夹时间切片。")?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::ZipArchive;

    fn roots(label: &str) -> (PathBuf, PathBuf) {
        let base =
            std::env::temp_dir().join(format!("knitspace-project-{label}-{}", Uuid::now_v7()));
        let source = base.join("course-project");
        fs::create_dir_all(&source).unwrap();
        (base, source)
    }

    #[test]
    fn delivery_scan_excludes_dependencies_and_build_outputs() {
        let (base, source) = roots("scan");
        fs::write(source.join("main.rs"), "fn main() {}\n").unwrap();
        fs::create_dir_all(source.join("target/debug")).unwrap();
        fs::write(source.join("target/debug/app.exe"), "binary").unwrap();
        fs::create_dir_all(source.join("node_modules/pkg")).unwrap();
        fs::write(source.join("node_modules/pkg/index.js"), "dependency").unwrap();
        let scan = scan_delivery(&fs::canonicalize(&source).unwrap(), DELIVERY_MAX_FILES).unwrap();
        assert_eq!(scan.files.len(), 1);
        assert_eq!(scan.files[0].relative_path, "main.rs");
        assert_eq!(scan.excluded_count, 2);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn delivery_pack_contains_readme_manifest_and_checksums_without_absolute_paths() {
        let (base, source) = roots("pack");
        let output_dir = base.join("output");
        fs::create_dir_all(&output_dir).unwrap();
        fs::write(source.join("报告.md"), "# 课程报告\n").unwrap();
        let root = fs::canonicalize(&source).unwrap();
        let scan = scan_delivery(&root, DELIVERY_MAX_FILES).unwrap();
        let output = output_dir.join("delivery.zip");
        create_delivery_pack(DeliveryPackCreateRequest {
            source_root: root.to_string_lossy().into_owned(),
            output_path: output.to_string_lossy().into_owned(),
            project_name: "课程项目".into(),
            expected_fingerprint: scan.fingerprint,
        })
        .unwrap();
        let mut archive = ZipArchive::new(fs::File::open(&output).unwrap()).unwrap();
        assert!(archive.by_name("课程项目/README.md").is_ok());
        let mut manifest = String::new();
        archive
            .by_name("课程项目/FILE-MANIFEST.json")
            .unwrap()
            .read_to_string(&mut manifest)
            .unwrap();
        assert!(manifest.contains("报告.md"));
        assert!(!manifest.contains(&root.to_string_lossy().to_string()));
        assert!(archive.by_name("课程项目/SHA256SUMS.txt").is_ok());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn folder_snapshot_reports_added_modified_missing_and_anomalous_files() {
        let (base, source) = roots("snapshot");
        fs::write(source.join("keep.txt"), "same").unwrap();
        fs::write(source.join("modify.txt"), "old").unwrap();
        fs::write(source.join("missing.txt"), "gone").unwrap();
        let root = fs::canonicalize(&source).unwrap();
        let (entries, total_bytes, fingerprint) = scan_snapshot(&root).unwrap();
        let snapshot = FolderSnapshot {
            version: 1,
            snapshot_id: Uuid::now_v7().to_string(),
            label: "基线".into(),
            source_root: root.to_string_lossy().into_owned(),
            created_at: Utc::now().to_rfc3339(),
            fingerprint,
            total_bytes,
            entries,
        };
        let directory = base.join("snapshots");
        write_snapshot(&directory, &snapshot).unwrap();
        fs::write(source.join("modify.txt"), "new content").unwrap();
        fs::remove_file(source.join("missing.txt")).unwrap();
        fs::write(source.join("added.txt"), "added").unwrap();
        let diff = compare_snapshot(&directory, &snapshot.snapshot_id).unwrap();
        assert_eq!(diff.added_count, 1);
        assert_eq!(diff.missing_count, 1);
        assert_eq!(diff.modified_count + diff.anomalous_count, 1);
        assert_eq!(diff.unchanged_count, 1);
        fs::remove_dir_all(base).unwrap();
    }
}
