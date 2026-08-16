use anyhow::{bail, Context, Result};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
};
use tar::Builder as TarBuilder;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

pub const MAX_ARCHIVE_ENTRIES: usize = 10_000;
pub const MAX_ARCHIVE_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_7Z_OUTPUT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub name: String,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
    pub is_directory: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveListing {
    pub archive_name: String,
    pub archive_size: u64,
    pub entries: Vec<ArchiveEntry>,
    pub uncompressed_size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveOperationSummary {
    pub archive_name: String,
    pub archive_size: u64,
    pub entry_count: usize,
    pub file_count: usize,
    pub directory_count: usize,
    pub uncompressed_size: u64,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SevenZipEngineStatus {
    pub available: bool,
    pub executable: Option<String>,
    pub version: Option<String>,
}

fn canonical_input(path: &str) -> Result<PathBuf> {
    let candidate = PathBuf::from(path);
    if !candidate.exists() {
        bail!("找不到输入路径：{}", candidate.display());
    }
    fs::canonicalize(&candidate).with_context(|| format!("无法读取输入路径：{}", candidate.display()))
}

fn canonical_output(path: &str) -> Result<(PathBuf, PathBuf)> {
    let candidate = PathBuf::from(path);
    if candidate.as_os_str().is_empty() {
        bail!("归档输出路径不能为空。")
    }
    if candidate.exists() {
        bail!("目标归档已存在，为避免覆盖请换一个文件名：{}", candidate.display())
    }
    let parent = candidate
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = fs::canonicalize(parent)
        .with_context(|| format!("无法访问归档输出目录：{}", parent.display()))?;
    let output = parent.join(candidate.file_name().context("归档文件名不能为空")?);
    Ok((output, parent))
}

fn seven_zip_candidates() -> &'static [&'static str] {
    if cfg!(windows) {
        &["7z.exe", "7zz.exe", "7z", "7zz"]
    } else {
        &["7z", "7zz", "7z.exe", "7zz.exe"]
    }
}

fn find_seven_zip() -> Option<String> {
    seven_zip_candidates().iter().find_map(|candidate| {
        let output = Command::new(candidate)
            .args(["-h"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        output.status.success().then(|| (*candidate).to_owned())
    })
}

pub fn seven_zip_engine_status() -> SevenZipEngineStatus {
    let Some(executable) = find_seven_zip() else {
        return SevenZipEngineStatus { available: false, executable: None, version: None };
    };
    let version = Command::new(&executable)
        .arg("-version")
        .stdin(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            let text = String::from_utf8_lossy(&output.stdout);
            text.lines()
                .chain(String::from_utf8_lossy(&output.stderr).lines())
                .find(|line| line.to_ascii_lowercase().contains("7-zip"))
                .map(|line| line.trim().chars().take(160).collect())
        });
    SevenZipEngineStatus { available: true, executable: Some(executable), version }
}

fn require_seven_zip() -> Result<String> {
    find_seven_zip().context("未检测到 7-Zip。请安装 7-Zip 或 7-Zip ZS，并将 7z 加入系统 PATH。")
}

fn seven_zip_compatible_path(path: &Path) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{unc}"));
    }
    value.strip_prefix(r"\\?\").map(PathBuf::from).unwrap_or_else(|| path.to_path_buf())
}

fn bounded_command_output(output: std::process::Output) -> Result<String> {
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    if text.len() > MAX_7Z_OUTPUT_BYTES {
        bail!("7-Zip 输出超过安全上限，无法继续处理。")
    }
    if !output.status.success() {
        let detail = [String::from_utf8_lossy(&output.stderr).trim().to_owned(), String::from_utf8_lossy(&output.stdout).trim().to_owned()]
            .into_iter()
            .find(|item| !item.is_empty())
            .unwrap_or_default()
            .chars()
            .take(900)
            .collect::<String>();
        bail!(if detail.is_empty() { "7-Zip 操作失败。".to_owned() } else { detail })
    }
    text.shrink_to_fit();
    Ok(text)
}

#[derive(Debug, Default)]
struct SevenZipEntryRecord {
    name: String,
    compressed_size: u64,
    uncompressed_size: u64,
    is_directory: bool,
    is_link: bool,
    is_archive_header: bool,
}

fn parse_seven_zip_number(value: &str) -> Result<u64> {
    value.trim().parse::<u64>().with_context(|| format!("7-Zip 条目大小无效：{value}"))
}

fn parse_seven_zip_listing(text: &str) -> Result<Vec<SevenZipEntryRecord>> {
    let mut entries = Vec::new();
    let mut record = SevenZipEntryRecord::default();
    let mut has_path = false;
    let flush = |record: &mut SevenZipEntryRecord, has_path: &mut bool, entries: &mut Vec<SevenZipEntryRecord>| -> Result<()> {
        if !*has_path {
            return Ok(());
        }
        if record.is_archive_header {
            *record = SevenZipEntryRecord::default();
            *has_path = false;
            return Ok(());
        }
        let name = safe_archive_name(&record.name)?;
        if record.is_link {
            bail!("7z 归档包含链接或特殊条目，已拒绝：{name}")
        }
        entries.push(SevenZipEntryRecord { name, ..std::mem::take(record) });
        *has_path = false;
        Ok(())
    };
    for line in text.lines() {
        if line.trim().is_empty() {
            flush(&mut record, &mut has_path, &mut entries)?;
            continue;
        }
        let Some((key, value)) = line.split_once(" = ") else { continue };
        match key.trim() {
            "Path" => {
                if has_path {
                    flush(&mut record, &mut has_path, &mut entries)?;
                }
                record.name = value.trim().to_owned();
                has_path = !record.name.is_empty();
            }
            "Size" if has_path => record.uncompressed_size = parse_seven_zip_number(value)?,
            "Packed Size" if has_path => {
                record.compressed_size = if value.trim().is_empty() { 0 } else { parse_seven_zip_number(value)? };
            }
            "Folder" if has_path => record.is_directory = value.trim() == "+",
            "Attributes" if has_path => {
                let attributes = value.trim();
                record.is_directory |= attributes.contains('D');
                record.is_link |= attributes.contains('L') || attributes.contains('l') || attributes.to_ascii_lowercase().contains("reparse");
            }
            "Type" if has_path => {
                let kind = value.trim().to_ascii_lowercase();
                record.is_archive_header |= kind == "7z" || kind == "zip" || kind == "tar";
                record.is_link |= kind.contains("link");
            }
            _ => {}
        }
        if entries.len() > MAX_ARCHIVE_ENTRIES {
            bail!("归档文件超过 {MAX_ARCHIVE_ENTRIES} 个，已停止处理。")
        }
    }
    flush(&mut record, &mut has_path, &mut entries)?;
    if entries.is_empty() {
        bail!("7z 归档没有可读取的普通文件或文件夹。")
    }
    let mut names = HashSet::with_capacity(entries.len());
    let mut total = 0_u64;
    for entry in &entries {
        if !names.insert(entry.name.clone()) {
            bail!("归档包含重名条目，无法安全处理：{}", entry.name)
        }
        total = total.checked_add(entry.uncompressed_size).context("归档展开大小超出安全范围")?;
        if total > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
            bail!("归档展开大小超过 2 GB，无法安全处理。")
        }
    }
    Ok(entries)
}

fn seven_zip_listing(path: &Path) -> Result<(PathBuf, u64, Vec<SevenZipEntryRecord>)> {
    let path = canonical_input(&path.to_string_lossy())?;
    if !path.is_file() {
        bail!("7z 归档路径不是文件：{}", path.display())
    }
    let archive_size = fs::metadata(&path)?.len();
    let executable = require_seven_zip()?;
    let output = Command::new(executable)
        .args(["l", "-slt", "-bd"])
        .arg(seven_zip_compatible_path(&path))
        .stdin(Stdio::null())
        .output()
        .with_context(|| "无法启动 7-Zip。")?;
    let text = bounded_command_output(output)?;
    Ok((path, archive_size, parse_seven_zip_listing(&text)?))
}

fn safe_archive_name(value: &str) -> Result<String> {
    let normalized = value.replace('\\', "/");
    if normalized.is_empty() || normalized.starts_with('/') || normalized.contains('\0') {
        bail!("归档条目名称不安全：{value}")
    }
    let path = Path::new(&normalized);
    if path.components().any(|component| matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))) {
        bail!("归档条目包含不安全路径：{value}")
    }
    if path.components().any(|component| matches!(component, Component::Normal(part) if part.to_string_lossy().contains(':'))) {
        bail!("归档条目包含不安全文件名：{value}")
    }
    Ok(normalized)
}

fn add_file(input: &Path, archive_name: &str, writer: &mut ZipWriter<File>, names: &mut HashSet<String>, total: &mut u64, files: &mut usize) -> Result<()> {
    let archive_name = safe_archive_name(archive_name)?;
    if !names.insert(archive_name.clone()) {
        bail!("归档条目重名，无法安全合并：{archive_name}")
    }
    let metadata = fs::metadata(input).with_context(|| format!("无法读取文件：{}", input.display()))?;
    let next_total = total.checked_add(metadata.len()).context("归档总大小超出安全范围")?;
    if next_total > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
        bail!("归档展开大小超过 2 GB，已停止处理。")
    }
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    writer.start_file(archive_name, options)?;
    let mut source = File::open(input).with_context(|| format!("无法打开文件：{}", input.display()))?;
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let read = source.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read])?;
    }
    *total = next_total;
    *files += 1;
    Ok(())
}

fn collect_files(inputs: &[String], output: &Path) -> Result<Vec<(PathBuf, String)>> {
    if inputs.is_empty() {
        bail!("至少选择一个要归档的文件或文件夹。")
    }
    let mut files = Vec::new();
    let mut names = HashSet::new();
    for raw in inputs {
        let root = canonical_input(raw)?;
        if root == output {
            continue;
        }
        if root.is_file() {
            let name = root.file_name().context("输入文件缺少文件名")?.to_string_lossy().into_owned();
            if !names.insert(name.clone()) {
                bail!("输入文件名重复，无法安全归档：{name}")
            }
            files.push((root, name));
            continue;
        }
        let prefix = root.file_name().context("输入文件夹缺少名称")?.to_string_lossy().into_owned();
        let mut found = false;
        for entry in WalkDir::new(&root).follow_links(false).into_iter().filter_map(Result::ok) {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path().to_path_buf();
            if path == output {
                continue;
            }
            let relative = path.strip_prefix(&root).context("无法计算归档相对路径")?;
            let name = format!("{prefix}/{}", relative.to_string_lossy().replace('\\', "/"));
            if !names.insert(name.clone()) {
                bail!("输入文件名重复，无法安全归档：{name}")
            }
            files.push((path, name));
            found = true;
            if files.len() > MAX_ARCHIVE_ENTRIES {
                bail!("归档文件超过 {MAX_ARCHIVE_ENTRIES} 个，已停止处理。")
            }
        }
        if !found {
            // Empty folders are represented as a valid input but do not create
            // a fake file. The UI can still tell the user that nothing was added.
        }
    }
    if files.is_empty() {
        bail!("所选文件夹没有可归档的普通文件。")
    }
    Ok(files)
}

pub fn create_zip(input_paths: Vec<String>, output_path: String) -> Result<ArchiveOperationSummary> {
    let (output, _parent) = canonical_output(&output_path)?;
    let files = collect_files(&input_paths, &output)?;
    let file = File::create(&output).with_context(|| format!("无法创建归档：{}", output.display()))?;
    let mut writer = ZipWriter::new(file);
    let mut names = HashSet::with_capacity(files.len());
    let mut total = 0_u64;
    let mut file_count = 0_usize;
    for (path, name) in files {
        add_file(&path, &name, &mut writer, &mut names, &mut total, &mut file_count)?;
    }
    writer.finish()?;
    let archive_size = fs::metadata(&output)?.len();
    Ok(ArchiveOperationSummary {
        archive_name: output.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        archive_size,
        entry_count: file_count,
        file_count,
        directory_count: 0,
        uncompressed_size: total,
        output_path: output.to_string_lossy().into_owned(),
    })
}

fn append_tar_entries<W: Write>(writer: W, files: &[(PathBuf, String)]) -> Result<(W, usize, u64)> {
    let mut builder = TarBuilder::new(writer);
    let mut total = 0_u64;
    for (path, name) in files {
        let metadata = fs::metadata(path).with_context(|| format!("无法读取文件：{}", path.display()))?;
        let next_total = total.checked_add(metadata.len()).context("归档总大小超出安全范围")?;
        if next_total > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
            bail!("归档展开大小超过 2 GB，已停止处理。")
        }
        builder.append_path_with_name(path, name)?;
        total = next_total;
    }
    Ok((builder.into_inner()?, files.len(), total))
}

fn is_gzip_archive(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|value| {
            let lower = value.to_ascii_lowercase();
            lower.ends_with(".tar.gz") || lower.ends_with(".tgz")
        })
        .unwrap_or(false)
}

pub fn create_tar(input_paths: Vec<String>, output_path: String, gzip: bool) -> Result<ArchiveOperationSummary> {
    let (output, _parent) = canonical_output(&output_path)?;
    let files = collect_files(&input_paths, &output)?;
    let file = File::create(&output).with_context(|| format!("无法创建归档：{}", output.display()))?;
    let (file_count, total) = if gzip {
        let encoder = GzEncoder::new(file, Compression::default());
        let (encoder, count, total) = append_tar_entries(encoder, &files)?;
        encoder.finish()?;
        (count, total)
    } else {
        let (_file, count, total) = append_tar_entries(file, &files)?;
        (count, total)
    };
    let archive_size = fs::metadata(&output)?.len();
    Ok(ArchiveOperationSummary {
        archive_name: output.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        archive_size,
        entry_count: file_count,
        file_count,
        directory_count: 0,
        uncompressed_size: total,
        output_path: output.to_string_lossy().into_owned(),
    })
}

fn list_tar_reader<R: Read>(reader: R, archive_name: String, archive_size: u64) -> Result<ArchiveListing> {
    let mut archive = tar::Archive::new(reader);
    let mut entries = Vec::new();
    let mut names = HashSet::new();
    let mut uncompressed_size = 0_u64;
    for entry_result in archive.entries()? {
        let entry = entry_result?;
        let entry_type = entry.header().entry_type();
        if !entry_type.is_file() && !entry_type.is_dir() {
            bail!("TAR 只支持普通文件和目录，已拒绝链接或特殊条目。")
        }
        let name = safe_archive_name(entry.path()?.to_string_lossy().as_ref())?;
        if !names.insert(name.clone()) {
            bail!("归档包含重名条目，无法安全预览。")
        }
        let size = entry.header().size()?;
        uncompressed_size = uncompressed_size.checked_add(size).context("归档展开大小超出安全范围")?;
        if uncompressed_size > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
            bail!("归档展开大小超过 2 GB，无法安全检查。")
        }
        entries.push(ArchiveEntry { name, compressed_size: 0, uncompressed_size: size, is_directory: entry_type.is_dir() });
        if entries.len() > MAX_ARCHIVE_ENTRIES {
            bail!("归档包含过多文件，无法安全检查。")
        }
    }
    Ok(ArchiveListing { archive_name, archive_size, entries, uncompressed_size })
}

pub fn list_tar(archive_path: String) -> Result<ArchiveListing> {
    let path = canonical_input(&archive_path)?;
    if !path.is_file() {
        bail!("归档路径不是文件：{}", path.display())
    }
    let archive_size = fs::metadata(&path)?.len();
    let archive_name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let file = File::open(&path)?;
    if is_gzip_archive(&path) {
        list_tar_reader(GzDecoder::new(file), archive_name, archive_size)
    } else {
        list_tar_reader(file, archive_name, archive_size)
    }
}

fn extract_tar_reader<R: Read>(reader: R, archive_path: &Path, output_root: &Path, archive_size: u64) -> Result<ArchiveOperationSummary> {
    let mut archive = tar::Archive::new(reader);
    let mut names = HashSet::new();
    let mut total = 0_u64;
    let mut file_count = 0_usize;
    let mut directory_count = 0_usize;
    for entry_result in archive.entries()? {
        let mut entry = entry_result?;
        let entry_type = entry.header().entry_type();
        if !entry_type.is_file() && !entry_type.is_dir() {
            bail!("TAR 只支持普通文件和目录，已拒绝链接或特殊条目。")
        }
        let name = safe_archive_name(entry.path()?.to_string_lossy().as_ref())?;
        if !names.insert(name.clone()) {
            bail!("归档包含重名条目，无法安全解压：{name}")
        }
        let target = output_root.join(&name);
        if !target.starts_with(output_root) {
            bail!("归档条目越过了解压目录，已拒绝。")
        }
        if entry_type.is_dir() {
            if target.exists() && !target.is_dir() {
                bail!("解压目标已存在且不是文件夹：{}", target.display())
            }
            fs::create_dir_all(&target)?;
            directory_count += 1;
            continue;
        }
        let next_total = total.checked_add(entry.header().size()?).context("归档展开大小超出安全范围")?;
        if next_total > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
            bail!("归档展开大小超过 2 GB，已停止解压。")
        }
        if target.exists() {
            bail!("解压目标已存在，为避免覆盖请换一个空目录：{}", target.display())
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = File::create(&target)?;
        std::io::copy(&mut entry, &mut file)?;
        total = next_total;
        file_count += 1;
    }
    Ok(ArchiveOperationSummary { archive_name: archive_path.file_name().unwrap_or_default().to_string_lossy().into_owned(), archive_size, entry_count: names.len(), file_count, directory_count, uncompressed_size: total, output_path: output_root.to_string_lossy().into_owned() })
}

pub fn extract_tar(archive_path: String, output_directory: String) -> Result<ArchiveOperationSummary> {
    let archive_path = canonical_input(&archive_path)?;
    if !archive_path.is_file() {
        bail!("归档路径不是文件：{}", archive_path.display())
    }
    let output_root = PathBuf::from(&output_directory);
    fs::create_dir_all(&output_root).with_context(|| format!("无法创建解压目录：{}", output_root.display()))?;
    let output_root = fs::canonicalize(&output_root)?;
    let archive_size = fs::metadata(&archive_path)?.len();
    let file = File::open(&archive_path)?;
    if is_gzip_archive(&archive_path) {
        extract_tar_reader(GzDecoder::new(file), &archive_path, &output_root, archive_size)
    } else {
        extract_tar_reader(file, &archive_path, &output_root, archive_size)
    }
}

pub fn list_zip(archive_path: String) -> Result<ArchiveListing> {
    let path = canonical_input(&archive_path)?;
    if !path.is_file() {
        bail!("归档路径不是文件：{}", path.display())
    }
    let archive_size = fs::metadata(&path)?.len();
    let mut archive = ZipArchive::new(File::open(&path)?).context("ZIP 归档无法读取")?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        bail!("归档包含过多文件，无法安全检查。")
    }
    let mut names = HashSet::with_capacity(archive.len());
    let mut entries = Vec::with_capacity(archive.len());
    let mut uncompressed_size = 0_u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        let name = safe_archive_name(entry.name())?;
        if !names.insert(name.clone()) {
            bail!("归档包含重名条目，无法安全预览。")
        }
        uncompressed_size = uncompressed_size.checked_add(entry.size()).context("归档展开大小超出安全范围")?;
        if uncompressed_size > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
            bail!("归档展开大小超过 2 GB，无法安全检查。")
        }
        entries.push(ArchiveEntry { name, compressed_size: entry.compressed_size(), uncompressed_size: entry.size(), is_directory: entry.is_dir() });
    }
    Ok(ArchiveListing { archive_name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(), archive_size, entries, uncompressed_size })
}

pub fn extract_zip(archive_path: String, output_directory: String) -> Result<ArchiveOperationSummary> {
    let archive_path = canonical_input(&archive_path)?;
    if !archive_path.is_file() {
        bail!("归档路径不是文件：{}", archive_path.display())
    }
    let output_root = PathBuf::from(&output_directory);
    fs::create_dir_all(&output_root).with_context(|| format!("无法创建解压目录：{}", output_root.display()))?;
    let output_root = fs::canonicalize(&output_root)?;
    let archive_size = fs::metadata(&archive_path)?.len();
    let mut archive = ZipArchive::new(File::open(&archive_path)?).context("ZIP 归档无法读取")?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        bail!("归档包含过多文件，无法安全解压。")
    }
    let mut names = HashSet::with_capacity(archive.len());
    let mut total = 0_u64;
    let mut file_count = 0_usize;
    let mut directory_count = 0_usize;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let name = safe_archive_name(entry.name())?;
        if !names.insert(name.clone()) {
            bail!("归档包含重名条目，无法安全解压：{name}")
        }
        let target = output_root.join(&name);
        if !target.starts_with(&output_root) {
            bail!("归档条目越过了解压目录，已拒绝。")
        }
        if entry.is_dir() {
            if target.exists() {
                bail!("解压目标已存在，为避免覆盖请换一个空目录：{}", target.display())
            }
            fs::create_dir_all(&target)?;
            directory_count += 1;
            continue;
        }
        let next_total = total.checked_add(entry.size()).context("归档展开大小超出安全范围")?;
        if next_total > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
            bail!("归档展开大小超过 2 GB，已停止解压。")
        }
        if target.exists() {
            bail!("解压目标已存在，为避免覆盖请换一个空目录：{}", target.display())
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = File::create(&target)?;
        std::io::copy(&mut entry, &mut file)?;
        total = next_total;
        file_count += 1;
    }
    Ok(ArchiveOperationSummary { archive_name: archive_path.file_name().unwrap_or_default().to_string_lossy().into_owned(), archive_size, entry_count: archive.len(), file_count, directory_count, uncompressed_size: total, output_path: output_root.to_string_lossy().into_owned() })
}

fn seven_zip_common_base(inputs: &[PathBuf]) -> Result<PathBuf> {
    let mut base = inputs
        .first()
        .and_then(|path| path.parent())
        .map(Path::to_path_buf)
        .context("归档输入缺少父目录")?;
    for input in inputs.iter().skip(1) {
        while !input.starts_with(&base) {
            let Some(parent) = base.parent() else { bail!("归档输入不在同一文件系统路径下。") };
            if parent == base {
                bail!("归档输入不在同一文件系统路径下。")
            }
            base = parent.to_path_buf();
        }
    }
    Ok(base)
}

fn ensure_seven_zip_output_is_safe(output: &Path, inputs: &[PathBuf]) -> Result<()> {
    for input in inputs {
        if output == input || output.starts_with(input) {
            bail!("7z 输出文件不能位于输入文件夹内，以免把归档自身再次加入归档。")
        }
    }
    Ok(())
}

pub fn create_seven_zip(input_paths: Vec<String>, output_path: String) -> Result<ArchiveOperationSummary> {
    let (output, _parent) = canonical_output(&output_path)?;
    let input_roots = input_paths.iter().map(|path| canonical_input(path)).collect::<Result<Vec<_>>>()?;
    if input_roots.is_empty() {
        bail!("至少选择一个要归档的文件或文件夹。")
    }
    ensure_seven_zip_output_is_safe(&output, &input_roots)?;
    let _files = collect_files(&input_paths, &output)?;
    let base = seven_zip_common_base(&input_roots)?;
    let relative_inputs = input_roots
        .iter()
        .map(|input| {
            let relative = input.strip_prefix(&base).map_err(|_| anyhow::anyhow!("无法计算 7z 归档相对路径。"))?;
            safe_archive_name(&relative.to_string_lossy())
        })
        .collect::<Result<Vec<_>>>()?;
    let executable = require_seven_zip()?;
    let output = Command::new(executable)
        .args(["a", "-t7z", "-mx=5", "-bd", "-y"])
        .arg(seven_zip_compatible_path(&output))
        .args(&relative_inputs)
        .current_dir(seven_zip_compatible_path(&base))
        .stdin(Stdio::null())
        .output()
        .with_context(|| "无法启动 7-Zip。")?;
    let _ = bounded_command_output(output)?;
    let (archive_path, archive_size, entries) = seven_zip_listing(Path::new(&output_path))?;
    if entries.iter().any(|entry| entry.is_link) {
        let _ = fs::remove_file(&archive_path);
        bail!("7z 归档包含链接或特殊条目，已删除不安全输出。")
    }
    let file_count = entries.iter().filter(|entry| !entry.is_directory).count();
    let directory_count = entries.iter().filter(|entry| entry.is_directory).count();
    let uncompressed_size = entries.iter().map(|entry| entry.uncompressed_size).sum();
    if file_count == 0 {
        let _ = fs::remove_file(&archive_path);
        bail!("7z 输出条目与输入不一致，已删除异常输出。")
    }
    Ok(ArchiveOperationSummary {
        archive_name: archive_path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        archive_size,
        entry_count: entries.len(),
        file_count,
        directory_count,
        uncompressed_size,
        output_path: archive_path.to_string_lossy().into_owned(),
    })
}

pub fn list_seven_zip(archive_path: String) -> Result<ArchiveListing> {
    let (path, archive_size, entries) = seven_zip_listing(Path::new(&archive_path))?;
    let uncompressed_size = entries.iter().map(|entry| entry.uncompressed_size).sum();
    Ok(ArchiveListing {
        archive_name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        archive_size,
        entries: entries.into_iter().map(|entry| ArchiveEntry { name: entry.name, compressed_size: entry.compressed_size, uncompressed_size: entry.uncompressed_size, is_directory: entry.is_directory }).collect(),
        uncompressed_size,
    })
}

pub fn extract_seven_zip(archive_path: String, output_directory: String) -> Result<ArchiveOperationSummary> {
    let (archive, archive_size, entries) = seven_zip_listing(Path::new(&archive_path))?;
    let output_root = PathBuf::from(&output_directory);
    fs::create_dir_all(&output_root).with_context(|| format!("无法创建解压目录：{}", output_root.display()))?;
    let output_root = fs::canonicalize(&output_root)?;
    if fs::read_dir(&output_root)?.next().is_some() {
        bail!("7z 解压目标必须是空目录，为避免覆盖已有文件已停止。")
    }
    if archive.starts_with(&output_root) {
        bail!("7z 归档不能位于解压目标目录内。")
    }
    let executable = require_seven_zip()?;
    let output = Command::new(executable)
        .args(["x", "-y", "-aos", "-bd"])
        .arg(format!("-o{}", seven_zip_compatible_path(&output_root).to_string_lossy()))
        .arg(seven_zip_compatible_path(&archive))
        .stdin(Stdio::null())
        .output()
        .with_context(|| "无法启动 7-Zip。")?;
    let _ = bounded_command_output(output)?;
    let file_count = entries.iter().filter(|entry| !entry.is_directory).count();
    let directory_count = entries.iter().filter(|entry| entry.is_directory).count();
    let uncompressed_size = entries.iter().map(|entry| entry.uncompressed_size).sum();
    Ok(ArchiveOperationSummary {
        archive_name: archive.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        archive_size,
        entry_count: entries.len(),
        file_count,
        directory_count,
        uncompressed_size,
        output_path: output_root.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use uuid::Uuid;

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("knitspace-archive-{label}-{}", Uuid::now_v7()))
    }

    #[test]
    fn creates_lists_and_extracts_a_zip_without_overwriting() -> Result<()> {
        let root = temp_root("roundtrip");
        let source = root.join("source");
        let output = root.join("bundle.zip");
        let extracted = root.join("extracted");
        fs::create_dir_all(source.join("nested"))?;
        fs::write(source.join("hello.txt"), "你好")?;
        fs::write(source.join("nested/data.csv"), "a,b\n1,2")?;
        let summary = create_zip(vec![source.to_string_lossy().into_owned()], output.to_string_lossy().into_owned())?;
        assert_eq!(summary.file_count, 2);
        let listing = list_zip(output.to_string_lossy().into_owned())?;
        assert_eq!(listing.entries.len(), 2);
        let restored = extract_zip(output.to_string_lossy().into_owned(), extracted.to_string_lossy().into_owned())?;
        assert_eq!(restored.file_count, 2);
        assert_eq!(fs::read_to_string(extracted.join("source/hello.txt"))?, "你好");
        assert!(extract_zip(output.to_string_lossy().into_owned(), extracted.to_string_lossy().into_owned()).is_err());
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn creates_lists_and_extracts_a_tar_gz_without_overwriting() -> Result<()> {
        let root = temp_root("tar-gz-roundtrip");
        let source = root.join("source");
        let output = root.join("bundle.tar.gz");
        let extracted = root.join("extracted");
        fs::create_dir_all(source.join("nested"))?;
        fs::write(source.join("hello.txt"), "你好")?;
        fs::write(source.join("nested/data.csv"), "a,b\n1,2")?;
        let summary = create_tar(vec![source.to_string_lossy().into_owned()], output.to_string_lossy().into_owned(), true)?;
        assert_eq!(summary.file_count, 2);
        let listing = list_tar(output.to_string_lossy().into_owned())?;
        assert_eq!(listing.entries.len(), 2);
        let restored = extract_tar(output.to_string_lossy().into_owned(), extracted.to_string_lossy().into_owned())?;
        assert_eq!(restored.file_count, 2);
        assert_eq!(fs::read_to_string(extracted.join("source/hello.txt"))?, "你好");
        assert!(extract_tar(output.to_string_lossy().into_owned(), extracted.to_string_lossy().into_owned()).is_err());
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn rejects_path_traversal_entries() -> Result<()> {
        let root = temp_root("traversal");
        fs::create_dir_all(&root)?;
        let archive = root.join("bad.zip");
        let mut writer = ZipWriter::new(File::create(&archive)?);
        writer.start_file("../escape.txt", SimpleFileOptions::default())?;
        writer.write_all(b"no")?;
        writer.finish()?;
        let error = list_zip(archive.to_string_lossy().into_owned()).expect_err("unsafe names must be rejected");
        assert!(error.to_string().contains("不安全路径"));
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn parses_safe_seven_zip_listing() -> Result<()> {
        let listing = "Path = source\nSize = 0\nPacked Size = 0\nFolder = +\nAttributes = D....\n\nPath = source/hello.txt\nSize = 5\nPacked Size = 7\nFolder = -\nAttributes = ....A\n";
        let entries = parse_seven_zip_listing(listing)?;
        assert_eq!(entries.len(), 2);
        assert!(entries[0].is_directory);
        assert_eq!(entries[1].name, "source/hello.txt");
        assert_eq!(entries[1].uncompressed_size, 5);
        Ok(())
    }

    #[test]
    fn rejects_unsafe_seven_zip_listing() {
        let traversal = "Path = ../escape.txt\nSize = 1\nPacked Size = 1\nFolder = -\n";
        assert!(parse_seven_zip_listing(traversal).is_err());
        let link = "Path = link\nSize = 0\nPacked Size = 0\nFolder = -\nAttributes = L....\n";
        assert!(parse_seven_zip_listing(link).is_err());
    }

    #[test]
    fn round_trips_seven_zip_when_engine_is_installed() -> Result<()> {
        if find_seven_zip().is_none() {
            return Ok(());
        }
        let root = temp_root("seven-zip-roundtrip");
        let source = root.join("source");
        let output = root.join("bundle.7z");
        let extracted = root.join("extracted");
        fs::create_dir_all(source.join("nested"))?;
        fs::write(source.join("hello.txt"), "你好")?;
        fs::write(source.join("nested/data.csv"), "a,b\n1,2")?;
        let summary = create_seven_zip(vec![source.to_string_lossy().into_owned()], output.to_string_lossy().into_owned())?;
        assert_eq!(summary.file_count, 2);
        let listing = list_seven_zip(output.to_string_lossy().into_owned())?;
        assert_eq!(listing.entries.iter().filter(|entry| !entry.is_directory).count(), 2);
        let restored = extract_seven_zip(output.to_string_lossy().into_owned(), extracted.to_string_lossy().into_owned())?;
        assert_eq!(restored.file_count, 2);
        assert_eq!(fs::read_to_string(extracted.join("source/hello.txt"))?, "你好");
        fs::remove_dir_all(root)?;
        Ok(())
    }
}
