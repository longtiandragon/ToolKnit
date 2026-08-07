use anyhow::{bail, Context, Result};
use chrono::Utc;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, path::PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, ZipWriter};

#[derive(Clone)]
pub struct VaultService { root: PathBuf }

#[derive(Serialize)]
pub struct VaultInfo { pub root: String, pub source_count: usize, pub initialized_at: String }

#[derive(Serialize)]
pub struct ImportedSource { pub id: String, pub managed_path: String, pub sha256: String, pub duplicate: bool }

#[derive(Deserialize)]
pub struct AiProfileInput { pub id: String, pub api_key: String }

impl VaultService {
    pub fn open(path: String) -> Result<Self> {
        let root = PathBuf::from(path);
        if !root.is_absolute() { bail!("资料库必须使用绝对路径") }
        for folder in ["sources", "assets/crops", "questions", "notes", "exports", ".toolknit"] { fs::create_dir_all(root.join(folder))?; }
        let db = root.join(".toolknit/index.sqlite3");
        let connection = rusqlite::Connection::open(db)?;
        connection.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, sha256 TEXT UNIQUE NOT NULL, original_name TEXT NOT NULL, managed_path TEXT NOT NULL, imported_at TEXT NOT NULL);")?;
        Ok(Self { root })
    }

    pub fn info(&self) -> Result<VaultInfo> {
        let count = fs::read_dir(self.root.join("sources"))?.filter_map(|entry| entry.ok()).count();
        Ok(VaultInfo { root: self.root.display().to_string(), source_count: count, initialized_at: Utc::now().to_rfc3339() })
    }

    pub fn import_source(&self, source_path: String) -> Result<ImportedSource> {
        let source = PathBuf::from(source_path);
        if !source.is_file() { bail!("只可导入普通文件") }
        let mut file = fs::File::open(&source)?; let mut hash = Sha256::new(); let mut buffer = [0u8; 64 * 1024];
        loop { let count = file.read(&mut buffer)?; if count == 0 { break; } hash.update(&buffer[..count]); }
        let digest = format!("{:x}", hash.finalize());
        let db_path = self.root.join(".toolknit/index.sqlite3"); let connection = rusqlite::Connection::open(db_path)?;
        let existing: Option<(String, String)> = connection.query_row("SELECT id, managed_path FROM sources WHERE sha256 = ?1", [&digest], |row| Ok((row.get(0)?, row.get(1)?))).ok();
        if let Some((id, managed_path)) = existing { return Ok(ImportedSource { id, managed_path, sha256: digest, duplicate: true }); }
        let id = Uuid::now_v7().to_string(); let filename = source.file_name().context("文件名无效")?; let destination_dir = self.root.join("sources").join(&id); fs::create_dir_all(&destination_dir)?;
        let destination = destination_dir.join(filename); fs::copy(&source, &destination)?;
        fs::write(destination_dir.join("source.json"), serde_json::to_vec_pretty(&serde_json::json!({"id": id, "sha256": digest, "original_name": filename, "imported_at": Utc::now().to_rfc3339()}))?)?;
        let managed_path = destination.display().to_string();
        connection.execute("INSERT INTO sources (id, sha256, original_name, managed_path, imported_at) VALUES (?1, ?2, ?3, ?4, ?5)", (&id, &digest, filename.to_string_lossy().as_ref(), &managed_path, Utc::now().to_rfc3339()))?;
        Ok(ImportedSource { id, managed_path, sha256: digest, duplicate: false })
    }

    pub fn save_markdown(&self, id: String, kind: String, markdown: String) -> Result<()> {
        if !id.chars().all(|char| char.is_ascii_hexdigit() || char == '-') { bail!("文档 ID 无效") }
        let folder = match kind.as_str() { "question" => "questions", "note" => "notes", _ => bail!("未知文档类型") };
        let path = self.root.join(folder).join(format!("{id}.md"));
        fs::write(path, markdown)?; Ok(())
    }

    pub fn write_api_key(profile: AiProfileInput) -> Result<()> {
        if profile.id.is_empty() || profile.api_key.is_empty() { bail!("配置或 API Key 不能为空") }
        Entry::new("ToolKnit", &format!("ai-profile:{}", profile.id))?.set_password(&profile.api_key)?;
        Ok(())
    }

    pub fn backup(&self, output_path: String) -> Result<()> {
        let output = PathBuf::from(output_path);
        let output_file = fs::File::create(&output)?; let mut zip = ZipWriter::new(output_file);
        for entry in WalkDir::new(&self.root).into_iter().filter_map(|entry| entry.ok()).filter(|entry| entry.file_type().is_file()) {
            let relative = entry.path().strip_prefix(&self.root)?;
            zip.start_file(relative.to_string_lossy(), SimpleFileOptions::default())?;
            let mut input = fs::File::open(entry.path())?; let mut bytes = Vec::new(); input.read_to_end(&mut bytes)?; zip.write_all(&bytes)?;
        }
        zip.finish()?; Ok(())
    }
}
