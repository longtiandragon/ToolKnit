use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

pub const MAX_ARCHIVE_ENTRIES: usize = 10_000;
pub const MAX_ARCHIVE_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024 * 1024;

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
}
