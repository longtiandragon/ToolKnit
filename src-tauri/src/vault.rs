use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{NaiveDate, Utc};
use image::ImageEncoder;
use keyring::Entry;
use rusqlite::{OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

#[derive(Clone)]
pub struct VaultService {
    root: PathBuf,
}

const SCHEMA_VERSION: i64 = 18;
const DOCUMENT_VERSION_LIMIT: i64 = 40;
const DOCUMENT_VERSION_COALESCE_SECONDS: i64 = 5 * 60;
const EDITOR_CRASH_DRAFT_LIMIT: i64 = 8;
const EDITOR_CRASH_DRAFT_MAX_BYTES: usize = 8 * 1024 * 1024;
const DOCUMENT_WRITE_STAGING_SUFFIX: &str = ".knitspace-staging";
const DOCUMENT_WRITE_TEMP_SUFFIX: &str = ".knitspace-next";
const DOCUMENT_WRITE_BACKUP_SUFFIX: &str = ".knitspace-prev";
/// Startup needs enough text to identify a clipboard item, not a multi-megabyte
/// source file. Full text is requested only when the user copies that item.
const CLIPBOARD_LIST_CONTENT_LIMIT: usize = 12_000;
const CLIPBOARD_PREVIEW_MAX_BYTES: usize = 32 * 1024 * 1024;
const MARKDOWN_IMAGE_MAX_BYTES: u64 = 12 * 1024 * 1024;
const MARKDOWN_IMAGE_MAX_PIXELS: usize = 24_000_000;
const QUESTION_ATTACHMENT_LIMIT: i64 = 64;
const QUESTION_ATTACHMENT_MAX_BYTES: u64 = 250 * 1024 * 1024;
const CONTENT_FAVORITE_LIMIT: i64 = 256;
const CONTENT_RECENT_LIMIT: i64 = 128;
const VISUAL_PROJECT_IMAGE_LIMIT: usize = 4;
const VISUAL_PROJECT_IMAGE_MAX_BYTES: usize = 32 * 1024 * 1024;
const VISUAL_PROJECT_TOTAL_MAX_BYTES: usize = 96 * 1024 * 1024;
const VISUAL_PROJECT_ANNOTATION_MAX_BYTES: usize = 256 * 1024;
const VAULT_ARCHIVE_MAX_ENTRIES: usize = 250_000;
const VAULT_ARCHIVE_MAX_UNCOMPRESSED_BYTES: u64 = 4 * 1024 * 1024 * 1024 * 1024;
const VAULT_ARCHIVE_MAX_DATABASE_BYTES: u64 = 8 * 1024 * 1024 * 1024;

/// Dates embedded in automatic archive names are used for retention.  Keeping
/// this separate from manually-created and pre-restore archives is important:
/// those files are deliberately user-visible recovery points and must never be
/// evicted by the daily rotation.
fn automatic_backup_date(path: &Path) -> Option<NaiveDate> {
    let file_name = path.file_name()?.to_str()?;
    let date = file_name
        .strip_prefix("knitspace-auto-")?
        .strip_suffix(".zip")?;
    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

#[derive(Serialize)]
pub struct VaultInfo {
    pub root: String,
    pub source_count: usize,
    pub initialized_at: String,
}

/// A deliberately small, on-demand diagnostic snapshot for the settings UI.
/// It never reads Markdown bodies or binary assets into memory.  Counts and
/// SQLite's quick check make data safety observable without slowing startup.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultHealth {
    pub root: String,
    pub schema_version: i64,
    pub latest_schema_version: i64,
    pub integrity: String,
    pub database_size: u64,
    pub document_count: i64,
    pub note_count: i64,
    pub question_count: i64,
    pub vocabulary_count: i64,
    pub source_count: i64,
    pub relation_count: i64,
    pub review_card_count: i64,
    pub fts_entry_count: i64,
    pub missing_markdown_count: i64,
    pub last_automatic_backup: Option<String>,
    pub last_automatic_backup_at: Option<String>,
}

/// Read-only evidence shown before a destructive full-Vault restore. Only the
/// SQLite snapshot is copied to a temporary folder for integrity/migration
/// checks; Markdown and binary assets remain inside the ZIP until confirmed.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultBackupInspection {
    pub archive_name: String,
    pub archive_size: u64,
    pub modified_at: Option<String>,
    pub schema_version: i64,
    pub latest_schema_version: i64,
    pub integrity: String,
    pub document_count: i64,
    pub note_count: i64,
    pub question_count: i64,
    pub vocabulary_count: i64,
    pub source_count: i64,
    pub relation_count: i64,
    pub review_card_count: i64,
    pub file_count: usize,
    pub managed_file_count: usize,
    pub uncompressed_size: u64,
    pub missing_markdown_count: i64,
}

/// Result of comparing one managed Markdown file with the SQLite copy. The
/// watcher sends only an id; reconciliation reads a body only after an actual
/// filesystem event, and never rewrites the file that triggered that event.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMarkdownReconcile {
    pub document_id: String,
    pub status: String,
    pub document: Option<VaultDocument>,
}

#[derive(Serialize)]
pub struct ImportedSource {
    pub id: String,
    pub managed_path: String,
    pub sha256: String,
    pub duplicate: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMarkdownAttachment {
    pub source: String,
    pub filename: String,
    pub size: u64,
}

/// Question attachments remain ordinary files under Vault assets. The
/// renderer receives only this bounded summary and asks for an absolute path
/// only when the user explicitly chooses "show in Explorer".
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultQuestionAttachment {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
    pub created_at: String,
    pub available: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentFavorite {
    pub item_id: String,
    pub item_kind: String,
    pub added_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentRecent {
    pub item_id: String,
    pub item_kind: String,
    pub opened_at: String,
}

/// A visual project is a lightweight `diagram` entity whose source images live
/// under Vault assets. Keeping bytes out of SQLite makes list/startup reads
/// bounded, while copying the source files makes a saved canvas independent of
/// its original import location.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualProjectImageInput {
    pub name: String,
    pub mime: String,
    pub asset_path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualProjectInput {
    pub id: String,
    pub title: String,
    pub canvas_title: String,
    pub layout: String,
    pub background: String,
    pub watermark: String,
    #[serde(default)]
    pub annotations: serde_json::Value,
    pub images: Vec<VisualProjectImageInput>,
    pub created_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualProjectImage {
    pub name: String,
    pub mime: String,
    /// Absolute path is returned only for this explicit open operation. The
    /// database continues to contain the relative, validated Vault path.
    pub path: String,
    pub size: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultVisualProject {
    pub id: String,
    pub title: String,
    pub canvas_title: String,
    pub layout: String,
    pub background: String,
    pub watermark: String,
    pub annotations: serde_json::Value,
    pub images: Vec<VisualProjectImage>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualProjectSummary {
    pub id: String,
    pub title: String,
    pub image_count: usize,
    pub annotation_count: usize,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedVaultSource {
    pub source: VaultSource,
    pub duplicate: bool,
}

/// Sources are persisted separately from documents because a PDF/image
/// preview can be several megabytes. List calls return this same shape but
/// deliberately omit `content`, `preview`, and `crops`; callers request those
/// only for the selected item.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSource {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub mime: String,
    pub size: i64,
    pub sha256: Option<String>,
    pub imported_at: String,
    pub last_opened_at: Option<String>,
    pub original_path: Option<String>,
    pub managed_path: Option<String>,
    pub page_count: Option<i64>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub content: Option<String>,
    pub preview: Option<String>,
    pub crops: Option<HashMap<String, String>>,
}

/// The desktop boundary intentionally mirrors the current Vue document model.
/// Markdown remains an ordinary `.md` file; the remaining fields become
/// SQLite metadata and can evolve independently from the Markdown syntax.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionDetails {
    #[serde(default)]
    pub source: String,
    pub stem: String,
    pub answer: String,
    pub explanation: String,
    pub wrong_answer: String,
    pub error_reason: String,
}

impl Default for QuestionDetails {
    fn default() -> Self {
        Self {
            source: String::new(),
            stem: String::new(),
            answer: String::new(),
            explanation: String::new(),
            wrong_answer: String::new(),
            error_reason: String::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultDocument {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub question_type: Option<String>,
    pub subject: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub folder: Option<String>,
    pub difficulty: i64,
    pub content: String,
    pub question_details: Option<QuestionDetails>,
    pub source_anchor: Option<serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
    pub review_enabled: bool,
    pub review: Option<serde_json::Value>,
    /// `review` is the backwards-compatible answer card. Additional question
    /// directions reuse review_cards facets without changing the schema.
    #[serde(default)]
    pub review_facets: HashMap<String, serde_json::Value>,
    pub error_types: Vec<String>,
    pub ai_generated: Option<bool>,
    pub external_file: Option<serde_json::Value>,
}

/// Version lists must stay light even when the underlying Markdown is several
/// megabytes. The full snapshot is returned only after an explicit restore or
/// copy action.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultDocumentVersionSummary {
    pub id: String,
    pub document_id: String,
    pub title: String,
    pub saved_at: String,
    pub byte_size: i64,
    pub preview: String,
    pub is_current: bool,
}

/// A crash draft is deliberately separate from document history: it is a
/// short-lived journal for unfinished editor state, not a user-authored
/// version. Payloads stay opaque to Rust so document and vocabulary editors
/// can evolve without another schema migration.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorCrashDraft {
    pub kind: String,
    pub entity_id: String,
    pub base_updated_at: String,
    pub saved_at: String,
    pub byte_size: i64,
    pub payload_json: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularySense {
    pub id: String,
    pub part_of_speech: String,
    pub definition: String,
    pub examples: Vec<String>,
    #[serde(default)]
    pub collocations: Vec<String>,
    pub synonyms: Vec<String>,
    pub review_enabled: bool,
    pub review: Option<serde_json::Value>,
    /// `review` remains the stable meaning card. Supplemental directions use
    /// the existing review_cards table with facets such as spelling/example.
    #[serde(default)]
    pub review_facets: HashMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyEntry {
    pub id: String,
    pub lemma: String,
    pub language: String,
    pub pronunciation: Option<String>,
    pub forms: serde_json::Value,
    pub senses: Vec<VocabularySense>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct VaultRelation {
    pub from_id: String,
    pub to_id: String,
    pub relation_type: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultWikiLink {
    pub from_id: String,
    pub to_id: String,
    pub target_title: String,
    pub headings: Vec<String>,
    pub occurrences: usize,
    pub source_updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultWikiLinkProjection {
    pub links: Vec<VaultWikiLink>,
    pub unresolved_count: usize,
    pub ambiguous_count: usize,
    pub truncated: bool,
}

/// Time-based personal records stay structured in SQLite. `payload` carries
/// the small type-specific fields (duration, title, repeat rule) without
/// turning the event table into a collection of one-off columns.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub starts_at: String,
    #[serde(default)]
    pub payload: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

/// Clipboard records intentionally do not become generic Vault entities. They
/// are high-churn, short-lived data with their own retention policy and may
/// contain very long code snippets. List responses carry a bounded prefix;
/// `get_clipboard_item` is the explicit full-content path.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultClipboardItem {
    pub id: String,
    pub kind: String,
    pub content: Option<String>,
    pub asset_path: Option<String>,
    pub preview: Option<String>,
    pub hash: String,
    pub captured_at: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default = "clipboard_content_is_loaded")]
    pub content_loaded: bool,
}

fn clipboard_content_is_loaded() -> bool {
    true
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultHydration {
    pub root: String,
    pub documents: Vec<VaultDocument>,
    pub vocabulary: Vec<VocabularyEntry>,
    pub relations: Vec<VaultRelation>,
    pub migrated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSearchResult {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub subject: String,
    pub tags: Vec<String>,
    pub updated_at: String,
    pub snippet: String,
}

#[derive(Deserialize)]
pub struct AiProfileInput {
    pub id: String,
    pub api_key: String,
}

#[derive(Deserialize)]
pub struct AiActionRequest {
    pub profile_id: String,
    pub base_url: String,
    pub model: String,
    pub temperature: f64,
    pub messages: serde_json::Value,
}

fn ai_chat_completion_payload(
    model: &str,
    temperature: f64,
    messages: serde_json::Value,
) -> Result<serde_json::Value> {
    if !temperature.is_finite() || !(0.0..=2.0).contains(&temperature) {
        bail!("AI temperature 必须在 0 到 2 之间")
    }
    let mut payload = json!({
        "model": model,
        "temperature": temperature,
        "stream": false,
        "messages": messages,
    });
    if model
        .trim()
        .to_ascii_lowercase()
        .starts_with("deepseek-v4-")
    {
        payload["thinking"] = json!({ "type": "disabled" });
    }
    Ok(payload)
}

fn ai_chat_completion_text(body: &serde_json::Value) -> Result<String> {
    body.pointer("/choices/0/message/content")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .context("AI 服务没有返回可显示的文本；请检查模型是否启用了不兼容的思考模式。")
}

impl VaultService {
    pub fn open(path: String) -> Result<Self> {
        let root = PathBuf::from(path);
        if !root.is_absolute() {
            bail!("资料库必须使用绝对路径")
        }
        for folder in [
            "sources",
            "assets/crops",
            "assets/source-records",
            "questions",
            "notes",
            "exports",
            ".toolknit",
        ] {
            fs::create_dir_all(root.join(folder))?;
        }
        let service = Self { root };
        service.recover_document_write_artifacts()?;
        let mut connection = service.connection()?;
        service.migrate(&mut connection)?;
        Ok(service)
    }

    fn connection(&self) -> Result<rusqlite::Connection> {
        let connection = rusqlite::Connection::open(self.root.join(".toolknit/index.sqlite3"))?;
        connection.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
        )?;
        Ok(connection)
    }

    fn normalize_wiki_title(value: &str) -> String {
        value
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    }

    /// Extract only Obsidian-style target metadata. This is deliberately a
    /// small linear parser: saving already hashes and indexes the Markdown, so
    /// link extraction adds no second renderer pass and never rewrites source.
    fn parse_wiki_link_targets(source: &str) -> Vec<(String, Option<String>)> {
        let mut links = Vec::new();
        let mut cursor = 0usize;
        while cursor < source.len() {
            let Some(relative_start) = source[cursor..].find("[[") else {
                break;
            };
            let start = cursor + relative_start + 2;
            let Some(relative_end) = source[start..].find("]]") else {
                break;
            };
            let end = start + relative_end;
            let raw = &source[start..end];
            cursor = end + 2;
            if raw.len() > 1_024 || raw.contains('\n') || raw.contains('\r') {
                continue;
            }
            let target_and_heading = raw.split('|').next().unwrap_or_default().trim();
            let mut parts = target_and_heading.splitn(2, '#');
            let target = parts.next().unwrap_or_default().trim();
            if target.is_empty() || target.len() > 512 {
                continue;
            }
            let heading = parts
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.chars().take(240).collect::<String>());
            links.push((target.to_owned(), heading));
        }
        links
    }

    fn replace_document_wiki_links(
        transaction: &Transaction<'_>,
        document_id: &str,
        markdown: &str,
    ) -> Result<()> {
        transaction.execute(
            "DELETE FROM document_wiki_links WHERE from_id = ?1",
            [document_id],
        )?;
        for (ordinal, (target, heading)) in Self::parse_wiki_link_targets(markdown)
            .into_iter()
            .enumerate()
        {
            transaction.execute(
                "INSERT INTO document_wiki_links(from_id, ordinal, target_title, target_key, heading) VALUES (?1, ?2, ?3, ?4, ?5)",
                (
                    document_id,
                    ordinal as i64,
                    &target,
                    Self::normalize_wiki_title(&target),
                    heading,
                ),
            )?;
        }
        Ok(())
    }

    pub fn health(&self) -> Result<VaultHealth> {
        let connection = self.connection()?;
        let schema_version = connection.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        let integrity = connection.query_row("PRAGMA quick_check(1)", [], |row| row.get(0))?;
        let document_count =
            connection.query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))?;
        let note_count = connection.query_row(
            "SELECT COUNT(*) FROM documents WHERE kind = 'note'",
            [],
            |row| row.get(0),
        )?;
        let question_count = connection.query_row(
            "SELECT COUNT(*) FROM documents WHERE kind = 'question'",
            [],
            |row| row.get(0),
        )?;
        let vocabulary_count =
            connection.query_row("SELECT COUNT(*) FROM vocabulary_entries", [], |row| {
                row.get(0)
            })?;
        let source_count =
            connection.query_row("SELECT COUNT(*) FROM source_records", [], |row| row.get(0))?;
        let relation_count =
            connection.query_row("SELECT COUNT(*) FROM relations", [], |row| row.get(0))?;
        let review_card_count =
            connection.query_row("SELECT COUNT(*) FROM review_cards", [], |row| row.get(0))?;
        let fts_entry_count =
            connection.query_row("SELECT COUNT(*) FROM documents_fts", [], |row| row.get(0))?;
        let markdown_paths = {
            let mut statement = connection.prepare("SELECT markdown_path FROM documents")?;
            let paths = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            paths
        };
        let missing_markdown_count = markdown_paths
            .iter()
            .filter(|path| {
                self.resolve_document_path(path)
                    .map(|path| !path.is_file())
                    .unwrap_or(true)
            })
            .count() as i64;
        let database_size = fs::metadata(self.root.join(".toolknit/index.sqlite3"))
            .map(|metadata| metadata.len())
            .unwrap_or_default();

        let vault_name = self
            .root
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("KnitspaceVault");
        let backup_dir = self
            .root
            .parent()
            .unwrap_or(&self.root)
            .join(format!("{vault_name} Backups"));
        let latest_backup = fs::read_dir(backup_dir).ok().and_then(|entries| {
            entries
                .filter_map(|entry| entry.ok())
                .filter_map(|entry| {
                    automatic_backup_date(&entry.path()).map(|date| (date, entry.path()))
                })
                .max_by_key(|(date, _)| *date)
        });
        let (last_automatic_backup, last_automatic_backup_at) = latest_backup
            .map(|(_, path)| {
                let modified = fs::metadata(&path)
                    .and_then(|metadata| metadata.modified())
                    .ok()
                    .map(|value| chrono::DateTime::<Utc>::from(value).to_rfc3339());
                (Some(path.to_string_lossy().into_owned()), modified)
            })
            .unwrap_or((None, None));

        Ok(VaultHealth {
            root: self.root.to_string_lossy().into_owned(),
            schema_version,
            latest_schema_version: SCHEMA_VERSION,
            integrity,
            database_size,
            document_count,
            note_count,
            question_count,
            vocabulary_count,
            source_count,
            relation_count,
            review_card_count,
            fts_entry_count,
            missing_markdown_count,
            last_automatic_backup,
            last_automatic_backup_at,
        })
    }

    fn migrate(&self, connection: &mut rusqlite::Connection) -> Result<()> {
        connection.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);")?;
        let current_version: i64 = connection.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        if current_version >= SCHEMA_VERSION {
            return Ok(());
        }

        let transaction = connection.transaction()?;
        if current_version < 1 {
            transaction.execute_batch("\
                CREATE TABLE IF NOT EXISTS sources (
                  id TEXT PRIMARY KEY,
                  sha256 TEXT UNIQUE NOT NULL,
                  original_name TEXT NOT NULL,
                  managed_path TEXT NOT NULL,
                  imported_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS entities (
                  id TEXT PRIMARY KEY,
                  type TEXT NOT NULL CHECK(type IN ('document', 'word', 'question', 'diagram', 'event')),
                  title TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  metadata_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS entities_type_updated_idx ON entities(type, updated_at DESC);
                CREATE TABLE IF NOT EXISTS documents (
                  entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
                  kind TEXT NOT NULL CHECK(kind IN ('note', 'question')),
                  markdown_path TEXT NOT NULL,
                  content_hash TEXT NOT NULL,
                  content_text TEXT NOT NULL DEFAULT '',
                  updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS documents_kind_updated_idx ON documents(kind, updated_at DESC);
                CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
                  entity_id UNINDEXED,
                  title,
                  body,
                  tokenize='unicode61 remove_diacritics 2'
                );
                CREATE TABLE IF NOT EXISTS vocabulary_entries (
                  entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
                  lemma TEXT NOT NULL,
                  language TEXT NOT NULL,
                  pronunciation TEXT,
                  forms_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS vocabulary_senses (
                  id TEXT PRIMARY KEY,
                  word_id TEXT NOT NULL REFERENCES vocabulary_entries(entity_id) ON DELETE CASCADE,
                  part_of_speech TEXT,
                  definition TEXT NOT NULL,
                  examples_json TEXT NOT NULL DEFAULT '[]',
                  synonyms_json TEXT NOT NULL DEFAULT '[]'
                );
                CREATE INDEX IF NOT EXISTS vocabulary_senses_word_idx ON vocabulary_senses(word_id);
                CREATE TABLE IF NOT EXISTS questions (
                  entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
                  question_type TEXT,
                  answer TEXT,
                  explanation TEXT,
                  wrong_answer TEXT,
                  error_reason TEXT,
                  difficulty INTEGER
                );
                CREATE TABLE IF NOT EXISTS relations (
                  from_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
                  to_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
                  relation_type TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(from_id, to_id, relation_type)
                );
                CREATE TABLE IF NOT EXISTS review_cards (
                  id TEXT PRIMARY KEY,
                  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
                  facet TEXT NOT NULL,
                  due TEXT,
                  fsrs_state TEXT NOT NULL DEFAULT '{}',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  UNIQUE(entity_id, facet)
                );
                CREATE INDEX IF NOT EXISTS review_cards_due_idx ON review_cards(due);
                CREATE TABLE IF NOT EXISTS attachments (
                  id TEXT PRIMARY KEY,
                  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
                  path TEXT NOT NULL,
                  mime TEXT NOT NULL,
                  sha256 TEXT,
                  created_at TEXT NOT NULL,
                  UNIQUE(entity_id, path)
                );
                CREATE TABLE IF NOT EXISTS events (
                  id TEXT PRIMARY KEY,
                  type TEXT NOT NULL CHECK(type IN ('pomodoro', 'anniversary', 'activity')),
                  starts_at TEXT NOT NULL,
                  payload_json TEXT NOT NULL DEFAULT '{}',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS events_starts_at_idx ON events(starts_at);
                CREATE TRIGGER IF NOT EXISTS documents_fts_insert AFTER INSERT ON documents BEGIN
                  INSERT INTO documents_fts(entity_id, title, body)
                  SELECT NEW.entity_id, entities.title, NEW.content_text FROM entities WHERE entities.id = NEW.entity_id;
                END;
                CREATE TRIGGER IF NOT EXISTS documents_fts_update AFTER UPDATE OF content_text, updated_at ON documents BEGIN
                  DELETE FROM documents_fts WHERE entity_id = OLD.entity_id;
                  INSERT INTO documents_fts(entity_id, title, body)
                  SELECT NEW.entity_id, entities.title, NEW.content_text FROM entities WHERE entities.id = NEW.entity_id;
                END;
                CREATE TRIGGER IF NOT EXISTS entities_fts_title_update AFTER UPDATE OF title ON entities BEGIN
                  DELETE FROM documents_fts WHERE entity_id = NEW.id;
                  INSERT INTO documents_fts(entity_id, title, body)
                  SELECT documents.entity_id, NEW.title, documents.content_text FROM documents WHERE documents.entity_id = NEW.id;
                END;
                CREATE TRIGGER IF NOT EXISTS documents_fts_delete AFTER DELETE ON documents BEGIN
                  DELETE FROM documents_fts WHERE entity_id = OLD.entity_id;
                END;
            ")?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (1, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 2 {
            transaction.execute_batch(
                "\
                CREATE TABLE IF NOT EXISTS vault_meta (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
            ",
            )?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (2, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 3 {
            transaction.execute_batch("CREATE INDEX IF NOT EXISTS vocabulary_entries_lemma_idx ON vocabulary_entries(lemma COLLATE NOCASE);")?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (3, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 4 {
            transaction.execute_batch("ALTER TABLE questions ADD COLUMN question_text TEXT;")?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (4, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 5 {
            let document_rows = {
                let mut statement = transaction.prepare("\
                    SELECT entities.id, entities.title, documents.content_text,
                           COALESCE(questions.question_text, ''), COALESCE(questions.answer, ''), COALESCE(questions.explanation, ''), COALESCE(questions.wrong_answer, ''), COALESCE(questions.error_reason, '')
                    FROM documents INNER JOIN entities ON entities.id = documents.entity_id
                    LEFT JOIN questions ON questions.entity_id = documents.entity_id
                ")?;
                let rows = statement
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, String>(7)?,
                        ))
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                rows
            };
            let vocabulary_rows = {
                let mut statement = transaction.prepare("\
                    SELECT entities.id, entities.title,
                           COALESCE(GROUP_CONCAT(vocabulary_senses.definition || ' ' || vocabulary_senses.examples_json || ' ' || vocabulary_senses.synonyms_json, ' '), '')
                    FROM vocabulary_entries INNER JOIN entities ON entities.id = vocabulary_entries.entity_id
                    LEFT JOIN vocabulary_senses ON vocabulary_senses.word_id = vocabulary_entries.entity_id
                    GROUP BY entities.id, entities.title
                ")?;
                let rows = statement
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                rows
            };
            transaction.execute("DELETE FROM documents_fts", [])?;
            for (id, title, content, stem, answer, explanation, wrong_answer, error_reason) in
                document_rows
            {
                let searchable = Self::fts_body(&format!("{title}\n{content}\n{stem}\n{answer}\n{explanation}\n{wrong_answer}\n{error_reason}"));
                transaction.execute(
                    "INSERT INTO documents_fts(entity_id, title, body) VALUES (?1, ?2, ?3)",
                    (&id, &title, searchable),
                )?;
            }
            for (id, title, content) in vocabulary_rows {
                transaction.execute(
                    "INSERT INTO documents_fts(entity_id, title, body) VALUES (?1, ?2, ?3)",
                    (&id, &title, Self::fts_body(&format!("{title}\n{content}"))),
                )?;
            }
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (5, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 6 {
            transaction.execute_batch("\
                CREATE TABLE IF NOT EXISTS source_records (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  kind TEXT NOT NULL CHECK(kind IN ('image', 'pdf', 'code', 'text')),
                  mime TEXT NOT NULL,
                  size INTEGER NOT NULL DEFAULT 0,
                  sha256 TEXT UNIQUE,
                  tags_json TEXT NOT NULL DEFAULT '[]',
                  imported_at TEXT NOT NULL,
                  last_opened_at TEXT,
                  original_path TEXT,
                  managed_path TEXT,
                  page_count INTEGER,
                  content_text TEXT,
                  preview_data TEXT,
                  crops_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS source_records_opened_idx ON source_records(last_opened_at DESC, imported_at DESC);
            ")?;
            // Keep pre-existing native imports visible after the migration.
            // Those older rows have no browser-side preview payload, but their
            // managed file remains safely preserved at its original path.
            transaction.execute("\
                INSERT OR IGNORE INTO source_records(id, name, kind, mime, size, sha256, imported_at, managed_path)
                SELECT id, original_name, 'text', 'application/octet-stream', 0, sha256, imported_at, managed_path
                FROM sources
            ", [])?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (6, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 7 {
            // Large Data URLs used by the browser prototype must never make
            // the SQLite index grow with every PDF/image. Keep only an asset
            // path in the row, while retaining a one-time migration path for
            // existing local vaults.
            transaction
                .execute_batch("ALTER TABLE source_records ADD COLUMN preview_path TEXT;")?;
            let legacy_rows = {
                let mut statement = transaction.prepare("SELECT id, preview_data, crops_json FROM source_records WHERE preview_data IS NOT NULL OR crops_json != '{}'")?;
                let rows = statement
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                rows
            };
            for (id, preview, crops_json) in legacy_rows {
                let preview_path = preview
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .map(|value| self.write_source_asset(&id, "preview.data", value))
                    .transpose()?;
                let crops: HashMap<String, String> =
                    serde_json::from_str(&crops_json).unwrap_or_default();
                let crop_paths = self.write_source_crop_assets(&id, &crops)?;
                transaction.execute(
                    "UPDATE source_records SET preview_data = NULL, preview_path = ?2, crops_json = ?3 WHERE id = ?1",
                    (&id, &preview_path, serde_json::to_string(&crop_paths)?),
                )?;
            }
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (7, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 8 {
            transaction.execute_batch(
                "\
                CREATE TABLE IF NOT EXISTS clipboard_items (
                  id TEXT PRIMARY KEY,
                  kind TEXT NOT NULL CHECK(kind IN ('text', 'code', 'image')),
                  content_text TEXT,
                  asset_path TEXT,
                  hash TEXT NOT NULL UNIQUE,
                  captured_at TEXT NOT NULL,
                  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1))
                );
                CREATE INDEX IF NOT EXISTS clipboard_items_recent_idx
                  ON clipboard_items(pinned DESC, captured_at DESC);
            ",
            )?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (8, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 9 {
            // Earlier word rows indexed only definitions and examples.  This
            // made the UI promise (search by inflection or pronunciation)
            // diverge from Ctrl+K's desktop FTS. Rebuild just vocabulary rows
            // so ordinary Markdown entries keep their existing index state.
            let vocabulary_rows = {
                let mut statement = transaction.prepare("\
                    SELECT vocabulary_entries.entity_id, entities.title,
                           vocabulary_entries.language,
                           COALESCE(vocabulary_entries.pronunciation, ''),
                           vocabulary_entries.forms_json,
                           COALESCE(GROUP_CONCAT(
                             COALESCE(vocabulary_senses.part_of_speech, '') || ' ' ||
                             vocabulary_senses.definition || ' ' ||
                             vocabulary_senses.examples_json || ' ' ||
                             vocabulary_senses.synonyms_json,
                             ' '
                           ), '')
                    FROM vocabulary_entries
                    INNER JOIN entities ON entities.id = vocabulary_entries.entity_id
                    LEFT JOIN vocabulary_senses ON vocabulary_senses.word_id = vocabulary_entries.entity_id
                    GROUP BY vocabulary_entries.entity_id, entities.title,
                             vocabulary_entries.language, vocabulary_entries.pronunciation,
                             vocabulary_entries.forms_json
                ")?;
                let rows = statement
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                        ))
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                rows
            };
            for (id, title, language, pronunciation, forms_json, senses) in vocabulary_rows {
                let forms = serde_json::from_str(&forms_json).unwrap_or_else(|_| json!({}));
                transaction.execute("DELETE FROM documents_fts WHERE entity_id = ?1", [&id])?;
                transaction.execute(
                    "INSERT INTO documents_fts(entity_id, title, body) VALUES (?1, ?2, ?3)",
                    (
                        &id,
                        &title,
                        Self::vocabulary_fts_body(
                            &title,
                            &language,
                            Some(&pronunciation),
                            &forms,
                            &senses,
                        ),
                    ),
                )?;
            }
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (9, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 10 {
            transaction.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS content_favorites (
                  item_kind TEXT NOT NULL CHECK(item_kind IN ('note', 'question', 'word', 'source')),
                  item_id TEXT NOT NULL,
                  added_at TEXT NOT NULL,
                  PRIMARY KEY(item_kind, item_id)
                );
                CREATE INDEX IF NOT EXISTS content_favorites_recent_idx
                  ON content_favorites(added_at DESC);
            ",
            )?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (10, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 11 {
            transaction.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS content_recents (
                  item_kind TEXT NOT NULL CHECK(item_kind IN ('note', 'question', 'word', 'source')),
                  item_id TEXT NOT NULL,
                  opened_at TEXT NOT NULL,
                  PRIMARY KEY(item_kind, item_id)
                );
                CREATE INDEX IF NOT EXISTS content_recents_opened_idx
                  ON content_recents(opened_at DESC);
            ",
            )?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (11, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 12 {
            transaction.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS document_versions (
                  id TEXT PRIMARY KEY,
                  document_id TEXT NOT NULL REFERENCES documents(entity_id) ON DELETE CASCADE,
                  title TEXT NOT NULL,
                  saved_at TEXT NOT NULL,
                  byte_size INTEGER NOT NULL,
                  content_hash TEXT NOT NULL,
                  snapshot_hash TEXT NOT NULL,
                  preview TEXT NOT NULL DEFAULT '',
                  snapshot_json TEXT NOT NULL,
                  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1))
                );
                CREATE INDEX IF NOT EXISTS document_versions_document_saved_idx
                  ON document_versions(document_id, saved_at DESC);
            ",
            )?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (12, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 13 {
            transaction.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS editor_crash_drafts (
                  kind TEXT NOT NULL CHECK(kind IN ('document', 'vocabulary')),
                  entity_id TEXT NOT NULL,
                  base_updated_at TEXT NOT NULL,
                  saved_at TEXT NOT NULL,
                  byte_size INTEGER NOT NULL,
                  payload_json TEXT NOT NULL,
                  PRIMARY KEY(kind, entity_id)
                );
                CREATE INDEX IF NOT EXISTS editor_crash_drafts_saved_idx
                  ON editor_crash_drafts(saved_at DESC);
            ",
            )?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (13, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 14 {
            let has_collocations = transaction
                .prepare("PRAGMA table_info(vocabulary_senses)")?
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<std::result::Result<Vec<_>, _>>()?
                .iter()
                .any(|column| column == "collocations_json");
            if !has_collocations {
                transaction.execute_batch(
                    "ALTER TABLE vocabulary_senses ADD COLUMN collocations_json TEXT NOT NULL DEFAULT '[]';",
                )?;
            }
            let vocabulary_rows = {
                let mut statement = transaction.prepare("\
                    SELECT vocabulary_entries.entity_id, entities.title,
                           vocabulary_entries.language,
                           COALESCE(vocabulary_entries.pronunciation, ''),
                           vocabulary_entries.forms_json,
                           COALESCE(GROUP_CONCAT(
                             COALESCE(vocabulary_senses.part_of_speech, '') || ' ' ||
                             vocabulary_senses.definition || ' ' ||
                             vocabulary_senses.examples_json || ' ' ||
                             vocabulary_senses.collocations_json || ' ' ||
                             vocabulary_senses.synonyms_json,
                             ' '
                           ), '')
                    FROM vocabulary_entries
                    INNER JOIN entities ON entities.id = vocabulary_entries.entity_id
                    LEFT JOIN vocabulary_senses ON vocabulary_senses.word_id = vocabulary_entries.entity_id
                    GROUP BY vocabulary_entries.entity_id, entities.title,
                             vocabulary_entries.language, vocabulary_entries.pronunciation,
                             vocabulary_entries.forms_json
                ")?;
                let rows = statement
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                        ))
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                rows
            };
            for (id, title, language, pronunciation, forms_json, senses) in vocabulary_rows {
                let forms = serde_json::from_str(&forms_json).unwrap_or_else(|_| json!({}));
                transaction.execute("DELETE FROM documents_fts WHERE entity_id = ?1", [&id])?;
                transaction.execute(
                    "INSERT INTO documents_fts(entity_id, title, body) VALUES (?1, ?2, ?3)",
                    (
                        &id,
                        &title,
                        Self::vocabulary_fts_body(
                            &title,
                            &language,
                            Some(&pronunciation),
                            &forms,
                            &senses,
                        ),
                    ),
                )?;
            }
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (14, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 15 {
            // SQLite cannot widen a CHECK constraint in place. Rebuild both
            // small pointer tables while preserving every existing row.
            transaction.execute_batch(
                "
                DROP INDEX IF EXISTS content_favorites_recent_idx;
                ALTER TABLE content_favorites RENAME TO content_favorites_v14;
                CREATE TABLE content_favorites (
                  item_kind TEXT NOT NULL CHECK(item_kind IN ('note', 'question', 'word', 'source', 'diagram')),
                  item_id TEXT NOT NULL,
                  added_at TEXT NOT NULL,
                  PRIMARY KEY(item_kind, item_id)
                );
                INSERT INTO content_favorites(item_kind, item_id, added_at)
                  SELECT item_kind, item_id, added_at FROM content_favorites_v14;
                DROP TABLE content_favorites_v14;
                CREATE INDEX content_favorites_recent_idx ON content_favorites(added_at DESC);

                DROP INDEX IF EXISTS content_recents_opened_idx;
                ALTER TABLE content_recents RENAME TO content_recents_v14;
                CREATE TABLE content_recents (
                  item_kind TEXT NOT NULL CHECK(item_kind IN ('note', 'question', 'word', 'source', 'diagram')),
                  item_id TEXT NOT NULL,
                  opened_at TEXT NOT NULL,
                  PRIMARY KEY(item_kind, item_id)
                );
                INSERT INTO content_recents(item_kind, item_id, opened_at)
                  SELECT item_kind, item_id, opened_at FROM content_recents_v14;
                DROP TABLE content_recents_v14;
                CREATE INDEX content_recents_opened_idx ON content_recents(opened_at DESC);
                ",
            )?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (15, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 16 {
            // Absolute Markdown paths tied an archive to the machine and
            // Vault folder where it was created. Canonical relative paths
            // make the SQLite index portable and keep reads inside the Vault.
            transaction.execute_batch(
                "
                UPDATE documents
                SET markdown_path = CASE kind
                  WHEN 'question' THEN 'questions/' || entity_id || '.md'
                  ELSE 'notes/' || entity_id || '.md'
                END;
                ",
            )?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (16, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 17 {
            // Imported text, code and extracted PDF text belong to the same
            // knowledge search as Markdown and vocabulary. Keep a separate
            // FTS table because source_records are not entity rows and may
            // reference large managed binaries that must never be loaded by
            // the renderer merely to search them.
            transaction.execute_batch(
                "
                CREATE VIRTUAL TABLE IF NOT EXISTS sources_fts USING fts5(
                  source_id UNINDEXED,
                  name,
                  body,
                  tags,
                  tokenize='unicode61 remove_diacritics 2'
                );
                ",
            )?;
            let source_rows = {
                let mut statement = transaction.prepare(
                    "SELECT id, name, kind, mime, COALESCE(content_text, ''), tags_json FROM source_records",
                )?;
                let rows = statement
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                        ))
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                rows
            };
            transaction.execute("DELETE FROM sources_fts", [])?;
            for (id, name, kind, mime, content, tags_json) in source_rows {
                let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
                transaction.execute(
                    "INSERT INTO sources_fts(source_id, name, body, tags) VALUES (?1, ?2, ?3, ?4)",
                    (
                        &id,
                        &name,
                        Self::fts_body(&format!("{name}\n{kind}\n{mime}\n{content}")),
                        Self::fts_body(&tags.join("\n")),
                    ),
                )?;
            }
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (17, Utc::now().to_rfc3339()),
            )?;
        }
        if current_version < 18 {
            // Wiki links are derived metadata. Index them when Markdown is
            // saved so the global relationship view never scans every body.
            transaction.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS document_wiki_links (
                  from_id TEXT NOT NULL REFERENCES documents(entity_id) ON DELETE CASCADE,
                  ordinal INTEGER NOT NULL,
                  target_title TEXT NOT NULL,
                  target_key TEXT NOT NULL,
                  heading TEXT,
                  PRIMARY KEY(from_id, ordinal)
                );
                CREATE INDEX IF NOT EXISTS document_wiki_links_target_idx ON document_wiki_links(target_key);
                ",
            )?;
            let document_rows = {
                let mut statement = transaction
                    .prepare("SELECT entity_id, content_text FROM documents ORDER BY entity_id")?;
                let rows = statement
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                rows
            };
            for (document_id, markdown) in document_rows {
                Self::replace_document_wiki_links(&transaction, &document_id, &markdown)?;
            }
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                (18, Utc::now().to_rfc3339()),
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn save_editor_crash_draft(
        &self,
        kind: String,
        entity_id: String,
        base_updated_at: String,
        payload_json: String,
    ) -> Result<EditorCrashDraft> {
        if kind != "document" && kind != "vocabulary" {
            bail!("未知的编辑器恢复类型")
        }
        if !Self::valid_document_id(&entity_id) {
            bail!("恢复点实体 ID 无效")
        }
        if base_updated_at.trim().is_empty() {
            bail!("恢复点缺少基础更新时间")
        }
        let byte_size = payload_json.len();
        if byte_size == 0 {
            bail!("恢复点内容为空")
        }
        if byte_size > EDITOR_CRASH_DRAFT_MAX_BYTES {
            bail!("恢复点超过 8 MiB 上限，请手动保存")
        }
        // Reject malformed payloads before they can displace a valid recovery
        // point. The frontend performs the domain-specific validation later.
        let _: serde_json::Value =
            serde_json::from_str(&payload_json).context("恢复点不是有效的 JSON")?;
        let saved_at = Utc::now().to_rfc3339();
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO editor_crash_drafts(
               kind, entity_id, base_updated_at, saved_at, byte_size, payload_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(kind, entity_id) DO UPDATE SET
               base_updated_at = excluded.base_updated_at,
               saved_at = excluded.saved_at,
               byte_size = excluded.byte_size,
               payload_json = excluded.payload_json",
            (
                &kind,
                &entity_id,
                &base_updated_at,
                &saved_at,
                byte_size as i64,
                &payload_json,
            ),
        )?;
        transaction.execute(
            "DELETE FROM editor_crash_drafts
             WHERE rowid IN (
               SELECT rowid FROM editor_crash_drafts
               ORDER BY saved_at DESC, rowid DESC
               LIMIT -1 OFFSET ?1
             )",
            [EDITOR_CRASH_DRAFT_LIMIT],
        )?;
        transaction.commit()?;
        Ok(EditorCrashDraft {
            kind,
            entity_id,
            base_updated_at,
            saved_at,
            byte_size: byte_size as i64,
            payload_json,
        })
    }

    pub fn get_editor_crash_draft(
        &self,
        kind: String,
        entity_id: String,
    ) -> Result<Option<EditorCrashDraft>> {
        if kind != "document" && kind != "vocabulary" {
            bail!("未知的编辑器恢复类型")
        }
        if !Self::valid_document_id(&entity_id) {
            bail!("恢复点实体 ID 无效")
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        connection
            .query_row(
                "SELECT kind, entity_id, base_updated_at, saved_at, byte_size, payload_json
                 FROM editor_crash_drafts WHERE kind = ?1 AND entity_id = ?2",
                (&kind, &entity_id),
                |row| {
                    Ok(EditorCrashDraft {
                        kind: row.get(0)?,
                        entity_id: row.get(1)?,
                        base_updated_at: row.get(2)?,
                        saved_at: row.get(3)?,
                        byte_size: row.get(4)?,
                        payload_json: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn delete_editor_crash_draft(&self, kind: String, entity_id: String) -> Result<()> {
        if kind != "document" && kind != "vocabulary" {
            bail!("未知的编辑器恢复类型")
        }
        if !Self::valid_document_id(&entity_id) {
            bail!("恢复点实体 ID 无效")
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        connection.execute(
            "DELETE FROM editor_crash_drafts WHERE kind = ?1 AND entity_id = ?2",
            (&kind, &entity_id),
        )?;
        Ok(())
    }

    pub fn info(&self) -> Result<VaultInfo> {
        let count = fs::read_dir(self.root.join("sources"))?
            .filter_map(|entry| entry.ok())
            .count();
        Ok(VaultInfo {
            root: self.root.display().to_string(),
            source_count: count,
            initialized_at: Utc::now().to_rfc3339(),
        })
    }

    pub fn import_source(&self, source_path: String) -> Result<ImportedSource> {
        let source = PathBuf::from(source_path);
        if !source.is_file() {
            bail!("只可导入普通文件")
        }
        let mut file = fs::File::open(&source)?;
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
        let digest = format!("{:x}", hash.finalize());
        let connection = self.connection()?;
        // The source_records index is the primary duplicate boundary. Check
        // it before the compatibility `sources` table so repeated desktop
        // imports never copy the same binary a second time.
        let indexed: Option<(String, Option<String>)> = connection
            .query_row(
                "SELECT id, managed_path FROM source_records WHERE sha256 = ?1",
                [&digest],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();
        if let Some((id, managed_path)) = indexed {
            return Ok(ImportedSource {
                id,
                managed_path: managed_path.unwrap_or_default(),
                sha256: digest,
                duplicate: true,
            });
        }
        let existing: Option<(String, String)> = connection
            .query_row(
                "SELECT id, managed_path FROM sources WHERE sha256 = ?1",
                [&digest],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();
        if let Some((id, managed_path)) = existing {
            return Ok(ImportedSource {
                id,
                managed_path,
                sha256: digest,
                duplicate: true,
            });
        }
        let id = Uuid::now_v7().to_string();
        let filename = source.file_name().context("文件名无效")?;
        let destination_dir = self.root.join("sources").join(&id);
        fs::create_dir_all(&destination_dir)?;
        let destination = destination_dir.join(filename);
        fs::copy(&source, &destination)?;
        fs::write(
            destination_dir.join("source.json"),
            serde_json::to_vec_pretty(
                &serde_json::json!({"id": id, "sha256": digest, "original_name": filename, "imported_at": Utc::now().to_rfc3339()}),
            )?,
        )?;
        let managed_path = destination.display().to_string();
        connection.execute("INSERT INTO sources (id, sha256, original_name, managed_path, imported_at) VALUES (?1, ?2, ?3, ?4, ?5)", (&id, &digest, filename.to_string_lossy().as_ref(), &managed_path, Utc::now().to_rfc3339()))?;
        drop(connection);
        let mime = mime_guess::from_path(&source)
            .first_or_octet_stream()
            .to_string();
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let is_code = matches!(
            extension.as_str(),
            "c" | "cc"
                | "cpp"
                | "cs"
                | "go"
                | "java"
                | "js"
                | "jsx"
                | "py"
                | "rs"
                | "ts"
                | "tsx"
                | "vue"
        );
        let kind = if mime.starts_with("image/") {
            "image"
        } else if mime == "application/pdf" {
            "pdf"
        } else if is_code {
            "code"
        } else if mime.starts_with("text/") {
            "text"
        } else {
            "text"
        };
        let size = source.metadata()?.len().min(i64::MAX as u64) as i64;
        // Text is safe and useful in SQLite/FTS; binary previews remain a
        // file in Vault and are served only after the user selects the row.
        let content = if matches!(kind, "code" | "text") && size <= 16 * 1024 * 1024 {
            fs::read_to_string(&destination).ok()
        } else {
            None
        };
        self.save_source(VaultSource {
            id: id.clone(),
            name: filename.to_string_lossy().into_owned(),
            kind: kind.into(),
            mime,
            size,
            sha256: Some(digest.clone()),
            imported_at: Utc::now().to_rfc3339(),
            last_opened_at: None,
            original_path: Some(source.display().to_string()),
            managed_path: Some(managed_path.clone()),
            page_count: None,
            tags: vec![],
            content,
            preview: None,
            crops: None,
        })?;
        Ok(ImportedSource {
            id,
            managed_path,
            sha256: digest,
            duplicate: false,
        })
    }

    pub fn import_source_record(&self, source_path: String) -> Result<ImportedVaultSource> {
        let imported = self.import_source(source_path)?;
        let source = self.get_source(imported.id)?;
        Ok(ImportedVaultSource {
            source,
            duplicate: imported.duplicate,
        })
    }

    fn normalize_source(source: &mut VaultSource) -> Result<()> {
        if !Self::valid_document_id(&source.id) {
            bail!("资料 ID 无效")
        }
        source.name = source.name.trim().to_owned();
        if source.name.is_empty() {
            source.name = "未命名资料".into();
        }
        if source.name.len() > 512 {
            bail!("资料名称过长")
        }
        if !matches!(source.kind.as_str(), "image" | "pdf" | "code" | "text") {
            bail!("未知资料类型")
        }
        source.mime = source.mime.trim().to_owned();
        if source.mime.is_empty() {
            source.mime = "application/octet-stream".into();
        }
        if source.mime.len() > 256 {
            bail!("资料 MIME 类型无效")
        }
        if !(0..=1_099_511_627_776).contains(&source.size) {
            bail!("资料大小无效")
        }
        if source.imported_at.trim().is_empty() {
            source.imported_at = Utc::now().to_rfc3339();
        }
        if let Some(hash) = &mut source.sha256 {
            *hash = hash.trim().to_owned();
            if hash.len() > 128 {
                bail!("资料哈希无效")
            }
            if hash.is_empty() {
                source.sha256 = None;
            }
        }
        source.tags.retain(|tag| !tag.trim().is_empty());
        source
            .tags
            .iter_mut()
            .for_each(|tag| *tag = tag.trim().to_owned());
        source.tags.truncate(64);
        if source.tags.iter().any(|tag| tag.len() > 120) {
            bail!("资料标签过长")
        }
        if let Some(content) = &source.content {
            if content.len() > 16 * 1024 * 1024 {
                bail!("资料文本过大，请以文件方式导入")
            }
        }
        if let Some(preview) = &source.preview {
            if preview.len() > 20 * 1024 * 1024 {
                bail!("资料预览过大，请使用原始文件导入")
            }
        }
        if let Some(crops) = &source.crops {
            if crops.len() > 80 {
                bail!("资料裁剪数量过多")
            }
            let crop_bytes = crops
                .iter()
                .map(|(id, data)| id.len() + data.len())
                .sum::<usize>();
            if crop_bytes > 24 * 1024 * 1024 {
                bail!("资料裁剪数据过大")
            }
            if crops
                .iter()
                .any(|(id, data)| !Self::valid_document_id(id) || data.len() > 4 * 1024 * 1024)
            {
                bail!("资料裁剪数据无效")
            }
        }
        Ok(())
    }

    /// The database stores relative asset paths only.  This prevents a
    /// corrupted index from being used as a way to read arbitrary local files.
    fn source_asset_path(&self, relative: &str) -> Result<PathBuf> {
        let relative = PathBuf::from(relative);
        if relative.is_absolute() {
            bail!("资料资源路径无效")
        }
        let mut components = relative.components();
        if !matches!(components.next(), Some(Component::Normal(name)) if name == "assets")
            || components.any(|part| !matches!(part, Component::Normal(_)))
        {
            bail!("资料资源路径无效")
        }
        Ok(self.root.join(relative))
    }

    fn question_attachment_prefix(document_id: &str) -> Result<String> {
        if !Self::valid_document_id(document_id) {
            bail!("题目 ID 无效")
        }
        Ok(format!("assets/questions/{document_id}/"))
    }

    fn safe_attachment_name(source: &Path) -> String {
        let original = source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("attachment");
        let sanitized = original
            .chars()
            .map(|character| {
                if character.is_control()
                    || matches!(
                        character,
                        '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                    )
                {
                    '_'
                } else {
                    character
                }
            })
            .take(120)
            .collect::<String>();
        let trimmed = sanitized.trim_matches([' ', '.']);
        if trimmed.is_empty() {
            "attachment".into()
        } else {
            trimmed.to_owned()
        }
    }

    fn question_attachment_name(relative: &str) -> String {
        Path::new(relative)
            .file_name()
            .and_then(|value| value.to_str())
            .and_then(|value| value.split_once("--").map(|(_, name)| name))
            .filter(|value| !value.is_empty())
            .unwrap_or("attachment")
            .to_owned()
    }

    fn question_attachment_summary(
        &self,
        id: String,
        relative: String,
        mime: String,
        created_at: String,
    ) -> Result<VaultQuestionAttachment> {
        let path = self.source_asset_path(&relative)?;
        let metadata = fs::metadata(path).ok();
        Ok(VaultQuestionAttachment {
            id,
            name: Self::question_attachment_name(&relative),
            mime,
            size: metadata.as_ref().map(|value| value.len()).unwrap_or(0),
            created_at,
            available: metadata.is_some_and(|value| value.is_file()),
        })
    }

    pub fn list_question_attachments(
        &self,
        document_id: String,
    ) -> Result<Vec<VaultQuestionAttachment>> {
        let prefix = Self::question_attachment_prefix(&document_id)?;
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT attachments.id, attachments.path, attachments.mime, attachments.created_at
             FROM attachments
             INNER JOIN entities ON entities.id = attachments.entity_id
             WHERE attachments.entity_id = ?1 AND entities.type = 'question' AND attachments.path LIKE ?2
             ORDER BY attachments.created_at DESC
             LIMIT ?3",
        )?;
        let like_prefix = format!("{prefix}%");
        let rows = statement
            .query_map(
                (&document_id, &like_prefix, QUESTION_ATTACHMENT_LIMIT),
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(id, relative, mime, created_at)| {
                self.question_attachment_summary(id, relative, mime, created_at)
            })
            .collect()
    }

    pub fn import_question_attachment(
        &self,
        document_id: String,
        source_path: String,
    ) -> Result<VaultQuestionAttachment> {
        let prefix = Self::question_attachment_prefix(&document_id)?;
        let source = PathBuf::from(source_path);
        if !source.is_file() {
            bail!("只可附加普通文件")
        }
        let size = source.metadata()?.len();
        if size > QUESTION_ATTACHMENT_MAX_BYTES {
            bail!("单个题目附件不能超过 250 MB")
        }

        let mut file = fs::File::open(&source)?;
        let mut hash = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
        let sha256 = format!("{:x}", hash.finalize());
        let connection = self.connection()?;
        let is_question: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM entities WHERE id = ?1 AND type = 'question')",
            [&document_id],
            |row| row.get(0),
        )?;
        if !is_question {
            bail!("请先保存当前题目，再添加附件")
        }
        let like_prefix = format!("{prefix}%");
        let existing: Option<(String, String, String, String)> = connection
            .query_row(
                "SELECT id, path, mime, created_at FROM attachments
                 WHERE entity_id = ?1 AND sha256 = ?2 AND path LIKE ?3 LIMIT 1",
                (&document_id, &sha256, &like_prefix),
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?;
        if let Some((id, relative, mime, created_at)) = existing {
            return self.question_attachment_summary(id, relative, mime, created_at);
        }
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM attachments WHERE entity_id = ?1 AND path LIKE ?2",
            (&document_id, &like_prefix),
            |row| row.get(0),
        )?;
        if count >= QUESTION_ATTACHMENT_LIMIT {
            bail!("每道题最多保存 64 个附件")
        }

        let name = Self::safe_attachment_name(&source);
        let relative = format!("{prefix}{}--{name}", &sha256[..24]);
        let destination = self.source_asset_path(&relative)?;
        let directory = destination.parent().context("题目附件目录无效")?;
        fs::create_dir_all(directory)?;
        let created_file = !destination.is_file();
        if created_file {
            let staging = directory.join(format!(".{}.{}.staging", &sha256[..24], Uuid::now_v7()));
            fs::copy(&source, &staging)?;
            if let Err(error) = fs::rename(&staging, &destination) {
                let _ = fs::remove_file(&staging);
                return Err(error.into());
            }
        }

        let id = Uuid::now_v7().to_string();
        let mime = mime_guess::from_path(&source)
            .first_or_octet_stream()
            .to_string();
        let created_at = Utc::now().to_rfc3339();
        if let Err(error) = connection.execute(
            "INSERT INTO attachments(id, entity_id, path, mime, sha256, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (&id, &document_id, &relative, &mime, &sha256, &created_at),
        ) {
            if created_file {
                let _ = fs::remove_file(&destination);
            }
            return Err(error.into());
        }
        self.question_attachment_summary(id, relative, mime, created_at)
    }

    pub fn question_attachment_path(
        &self,
        document_id: String,
        attachment_id: String,
    ) -> Result<PathBuf> {
        let prefix = Self::question_attachment_prefix(&document_id)?;
        let connection = self.connection()?;
        let relative: String = connection
            .query_row(
                "SELECT path FROM attachments WHERE id = ?1 AND entity_id = ?2",
                (&attachment_id, &document_id),
                |row| row.get(0),
            )
            .context("题目附件不存在")?;
        if !relative.starts_with(&prefix) {
            bail!("附件不属于当前题目")
        }
        let path = self.source_asset_path(&relative)?;
        if !path.is_file() {
            bail!("题目附件文件已经不存在")
        }
        Ok(path)
    }

    pub fn delete_question_attachment(
        &self,
        document_id: String,
        attachment_id: String,
    ) -> Result<()> {
        let prefix = Self::question_attachment_prefix(&document_id)?;
        let connection = self.connection()?;
        let relative: String = connection
            .query_row(
                "SELECT path FROM attachments WHERE id = ?1 AND entity_id = ?2",
                (&attachment_id, &document_id),
                |row| row.get(0),
            )
            .context("题目附件不存在")?;
        if !relative.starts_with(&prefix) {
            bail!("附件不属于当前题目")
        }
        connection.execute(
            "DELETE FROM attachments WHERE id = ?1 AND entity_id = ?2",
            (&attachment_id, &document_id),
        )?;
        let path = self.source_asset_path(&relative)?;
        if path.is_file() {
            let _ = fs::remove_file(path);
        }
        Ok(())
    }

    pub fn save_document_image(
        &self,
        document_id: &str,
        width: usize,
        height: usize,
        rgba: &[u8],
    ) -> Result<VaultMarkdownAttachment> {
        if !Self::valid_document_id(document_id) {
            bail!("文档 ID 无效")
        }
        let pixels = width.checked_mul(height).context("剪贴板图片尺寸无效")?;
        let expected_bytes = pixels.checked_mul(4).context("剪贴板图片尺寸无效")?;
        if width == 0
            || height == 0
            || pixels > MARKDOWN_IMAGE_MAX_PIXELS
            || rgba.len() != expected_bytes
        {
            bail!("剪贴板图片尺寸无效或过大")
        }
        let connection = self.connection()?;
        let document_exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM documents WHERE entity_id = ?1)",
            [document_id],
            |row| row.get(0),
        )?;
        if !document_exists {
            bail!("当前文档尚未写入本地资料库")
        }

        let sha256 = format!("{:x}", Sha256::digest(rgba));
        let filename = format!("clipboard-{}.png", &sha256[..16]);
        let relative = format!("assets/documents/{document_id}/{filename}");
        let path = self.source_asset_path(&relative)?;
        let parent = path.parent().context("Markdown 图片目录无效")?;
        fs::create_dir_all(parent)?;
        if !path.is_file() {
            let staging = parent.join(format!(".{filename}.{}.staging", Uuid::now_v7()));
            let mut encoded = Vec::new();
            image::codecs::png::PngEncoder::new(&mut encoded).write_image(
                rgba,
                width as u32,
                height as u32,
                image::ExtendedColorType::Rgba8,
            )?;
            if encoded.len() as u64 > MARKDOWN_IMAGE_MAX_BYTES {
                bail!("图片编码后超过 12 MB；请先压缩或裁剪")
            }
            let mut staging_file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&staging)?;
            let write_result = staging_file
                .write_all(&encoded)
                .and_then(|_| staging_file.sync_all());
            drop(staging_file);
            if let Err(error) = write_result {
                let _ = fs::remove_file(&staging);
                return Err(error.into());
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
                            std::thread::sleep(Duration::from_millis(18));
                        }
                    }
                }
            }
            if let Some(error) = rename_error {
                let _ = fs::remove_file(&staging);
                return Err(error.into());
            }
            let _ = fs::remove_file(&staging);
        }
        let size = fs::metadata(&path)?.len();
        connection.execute(
            "INSERT OR IGNORE INTO attachments(id, entity_id, path, mime, sha256, created_at) VALUES (?1, ?2, ?3, 'image/png', ?4, ?5)",
            (Uuid::now_v7().to_string(), document_id, &relative, &sha256, Utc::now().to_rfc3339()),
        )?;
        Ok(VaultMarkdownAttachment {
            source: format!("../{relative}"),
            filename,
            size,
        })
    }

    /// Copies a user-selected raster image into this document's asset folder.
    /// The original encoded bytes are preserved (including animated GIF/WebP),
    /// while a content hash makes repeated imports idempotent.
    pub fn import_document_image(
        &self,
        document_id: &str,
        source_path: &str,
    ) -> Result<VaultMarkdownAttachment> {
        if !Self::valid_document_id(document_id) {
            bail!("文档 ID 无效")
        }
        let source = Path::new(source_path)
            .canonicalize()
            .context("选择的图片已经不存在")?;
        if !source.is_file() {
            bail!("选择的图片不是普通文件")
        }
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .context("图片缺少受支持的扩展名")?;
        let mime = match extension.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            "avif" => "image/avif",
            "ico" => "image/x-icon",
            _ => bail!("本地图片仅支持 PNG、JPG、GIF、WebP、BMP、AVIF 或 ICO"),
        };
        let metadata = fs::metadata(&source)?;
        if metadata.len() == 0 || metadata.len() > MARKDOWN_IMAGE_MAX_BYTES {
            bail!("本地图片为空或超过 12 MB；请先压缩或裁剪")
        }
        let (width, height) = image::image_dimensions(&source).context("无法读取图片尺寸")?;
        let pixels = (width as usize)
            .checked_mul(height as usize)
            .context("图片尺寸无效")?;
        if width == 0 || height == 0 || pixels > MARKDOWN_IMAGE_MAX_PIXELS {
            bail!("图片尺寸无效或超过 2400 万像素；请先缩小")
        }

        let connection = self.connection()?;
        let document_exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM documents WHERE entity_id = ?1)",
            [document_id],
            |row| row.get(0),
        )?;
        if !document_exists {
            bail!("当前文档尚未写入本地资料库")
        }
        let bytes = fs::read(&source)?;
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        let filename = format!("import-{}.{}", &sha256[..16], extension);
        let relative = format!("assets/documents/{document_id}/{filename}");
        let target = self.source_asset_path(&relative)?;
        let parent = target.parent().context("Markdown 图片目录无效")?;
        fs::create_dir_all(parent)?;
        if !target.is_file() {
            let staging = parent.join(format!(".{filename}.{}.staging", Uuid::now_v7()));
            let mut staging_file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&staging)?;
            let write_result = staging_file
                .write_all(&bytes)
                .and_then(|_| staging_file.sync_all());
            drop(staging_file);
            if let Err(error) = write_result {
                let _ = fs::remove_file(&staging);
                return Err(error.into());
            }
            match fs::rename(&staging, &target) {
                Ok(()) => {}
                Err(_) if target.is_file() => {}
                Err(error) => {
                    let _ = fs::remove_file(&staging);
                    return Err(error.into());
                }
            }
            let _ = fs::remove_file(&staging);
        }
        connection.execute(
            "INSERT OR IGNORE INTO attachments(id, entity_id, path, mime, sha256, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (Uuid::now_v7().to_string(), document_id, &relative, mime, &sha256, Utc::now().to_rfc3339()),
        )?;
        Ok(VaultMarkdownAttachment {
            source: format!("../{relative}"),
            filename,
            size: metadata.len(),
        })
    }

    pub fn document_image_path(&self, document_id: &str, source: &str) -> Result<PathBuf> {
        if !Self::valid_document_id(document_id) {
            bail!("文档 ID 无效")
        }
        let mut components = Path::new(source).components();
        if !matches!(components.next(), Some(Component::ParentDir))
            || !matches!(components.next(), Some(Component::Normal(name)) if name == "assets")
            || !matches!(components.next(), Some(Component::Normal(name)) if name == "documents")
            || !matches!(components.next(), Some(Component::Normal(name)) if name == document_id)
        {
            bail!("Markdown 图片路径不属于当前文档")
        }
        let filename = match components.next() {
            Some(Component::Normal(name)) => name.to_string_lossy().into_owned(),
            _ => bail!("Markdown 图片路径无效"),
        };
        if components.next().is_some() {
            bail!("Markdown 图片路径无效")
        }
        let relative = format!("assets/documents/{document_id}/{filename}");
        let connection = self.connection()?;
        let registered: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM attachments WHERE entity_id = ?1 AND path = ?2 AND mime LIKE 'image/%')",
            (document_id, &relative),
            |row| row.get(0),
        )?;
        if !registered {
            bail!("Markdown 图片没有登记到当前文档")
        }
        let path = self.source_asset_path(&relative)?;
        if !path.is_file() {
            bail!("Markdown 图片已经不存在")
        }
        Ok(path)
    }

    fn write_source_asset(&self, source_id: &str, filename: &str, payload: &str) -> Result<String> {
        let relative = format!("assets/source-records/{source_id}/{filename}");
        let path = self.source_asset_path(&relative)?;
        let parent = path.parent().context("资料资源目录无效")?;
        fs::create_dir_all(parent)?;
        fs::write(path, payload)?;
        Ok(relative)
    }

    fn write_source_crop_assets(
        &self,
        source_id: &str,
        crops: &HashMap<String, String>,
    ) -> Result<HashMap<String, String>> {
        let mut stored = HashMap::new();
        for (crop_id, payload) in crops {
            let relative = format!("assets/crops/{source_id}/{crop_id}.data");
            let path = self.source_asset_path(&relative)?;
            let parent = path.parent().context("资料裁剪目录无效")?;
            fs::create_dir_all(parent)?;
            fs::write(path, payload)?;
            stored.insert(crop_id.clone(), relative);
        }
        Ok(stored)
    }

    fn read_source_asset(&self, relative: &str) -> Result<String> {
        fs::read_to_string(self.source_asset_path(relative)?)
            .with_context(|| "读取本地资料资源失败")
    }

    fn resolve_source_crops(&self, crops_json: &str) -> Result<HashMap<String, String>> {
        let crops: HashMap<String, String> = serde_json::from_str(crops_json).unwrap_or_default();
        crops
            .into_iter()
            .map(|(crop_id, value)| {
                let payload = if value.starts_with("assets/") {
                    self.read_source_asset(&value)?
                } else {
                    value
                };
                Ok((crop_id, payload))
            })
            .collect()
    }

    fn normalize_clipboard_item(item: &mut VaultClipboardItem) -> Result<()> {
        if !Self::valid_document_id(&item.id) {
            bail!("剪贴板记录 ID 无效")
        }
        if !matches!(item.kind.as_str(), "text" | "code" | "image") {
            bail!("剪贴板内容类型无效")
        }
        item.hash = item.hash.trim().to_owned();
        if item.hash.is_empty() || item.hash.len() > 160 {
            bail!("剪贴板内容哈希无效")
        }
        if item.captured_at.trim().is_empty() {
            item.captured_at = Utc::now().to_rfc3339();
        }
        if item
            .content
            .as_ref()
            .is_some_and(|content| content.len() > 16 * 1024 * 1024)
        {
            bail!("剪贴板文本过大，请先保存为文件")
        }
        if item
            .asset_path
            .as_ref()
            .is_some_and(|path| path.len() > 32 * 1024)
        {
            bail!("剪贴板图片路径无效")
        }
        if item
            .preview
            .as_ref()
            .is_some_and(|preview| preview.len() > 48 * 1024 * 1024)
        {
            bail!("剪贴板图片预览过大")
        }
        match item.kind.as_str() {
            "image" if item.asset_path.is_none() && item.preview.is_none() => {
                bail!("图片剪贴板记录缺少本地资源")
            }
            "text" | "code" if item.content.is_none() => bail!("文本剪贴板记录缺少内容"),
            _ => {}
        }
        Ok(())
    }

    fn clipboard_asset_directory(&self) -> PathBuf {
        self.root.join(".toolknit/clipboard")
    }

    /// Converts a browser-mode Data URL into a Vault-owned file exactly once
    /// during migration. This removes the last image-sized localStorage value
    /// while keeping the old history copyable in desktop mode.
    fn write_clipboard_preview_asset(&self, id: &str, preview: &str) -> Result<String> {
        let (header, encoded) = preview.split_once(',').context("剪贴板图片预览格式无效")?;
        let extension = match header.trim().to_ascii_lowercase().as_str() {
            "data:image/png;base64" => "png",
            "data:image/jpeg;base64" | "data:image/jpg;base64" => "jpg",
            "data:image/webp;base64" => "webp",
            "data:image/gif;base64" => "gif",
            _ => bail!("剪贴板图片格式不受支持"),
        };
        let bytes = BASE64
            .decode(encoded.trim())
            .context("剪贴板图片预览无法解码")?;
        if bytes.len() > CLIPBOARD_PREVIEW_MAX_BYTES {
            bail!("剪贴板图片预览过大")
        }
        let directory = self.clipboard_asset_directory();
        fs::create_dir_all(&directory)?;
        let path = directory.join(format!("{id}.{extension}"));
        fs::write(&path, bytes)?;
        Ok(path.to_string_lossy().into_owned())
    }

    fn remove_vault_clipboard_asset(&self, path: Option<String>) {
        let Some(path) = path else { return };
        let directory = self.clipboard_asset_directory();
        let Ok(root) = directory.canonicalize() else {
            return;
        };
        let Ok(candidate) = PathBuf::from(path).canonicalize() else {
            return;
        };
        if candidate.starts_with(&root) {
            let _ = fs::remove_file(candidate);
        }
    }

    fn preview_clipboard_content(content: Option<String>) -> (Option<String>, bool) {
        let Some(content) = content else {
            return (None, true);
        };
        if content.len() <= CLIPBOARD_LIST_CONTENT_LIMIT {
            return (Some(content), true);
        }
        let boundary = content
            .char_indices()
            .nth(CLIPBOARD_LIST_CONTENT_LIMIT)
            .map(|(index, _)| index);
        match boundary {
            Some(index) => (Some(content[..index].to_owned()), false),
            None => (Some(content), true),
        }
    }

    fn map_clipboard_row(
        row: &rusqlite::Row<'_>,
        include_full_content: bool,
    ) -> rusqlite::Result<VaultClipboardItem> {
        let content = row.get::<_, Option<String>>(2)?;
        let (content, content_loaded) = if include_full_content {
            (content, true)
        } else {
            Self::preview_clipboard_content(content)
        };
        Ok(VaultClipboardItem {
            id: row.get(0)?,
            kind: row.get(1)?,
            content,
            asset_path: row.get(3)?,
            preview: None,
            hash: row.get(4)?,
            captured_at: row.get(5)?,
            pinned: row.get::<_, i64>(6)? != 0,
            content_loaded,
        })
    }

    pub fn list_clipboard_items(&self) -> Result<Vec<VaultClipboardItem>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "\
            SELECT id, kind, content_text, asset_path, hash, captured_at, pinned
            FROM clipboard_items
            ORDER BY pinned DESC, captured_at DESC
        ",
        )?;
        let rows = statement.query_map([], |row| Self::map_clipboard_row(row, false))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn get_clipboard_item(&self, id: String) -> Result<VaultClipboardItem> {
        if !Self::valid_document_id(&id) {
            bail!("剪贴板记录 ID 无效")
        }
        let connection = self.connection()?;
        connection
            .query_row(
                "\
                SELECT id, kind, content_text, asset_path, hash, captured_at, pinned
                FROM clipboard_items WHERE id = ?1
            ",
                [&id],
                |row| Self::map_clipboard_row(row, true),
            )
            .context("剪贴板记录不存在")
    }

    pub fn save_clipboard_item(&self, mut item: VaultClipboardItem) -> Result<VaultClipboardItem> {
        Self::normalize_clipboard_item(&mut item)?;
        let connection = self.connection()?;
        let existing: Option<(String, bool)> = connection
            .query_row(
                "SELECT id, pinned FROM clipboard_items WHERE hash = ?1",
                [&item.hash],
                |row| Ok((row.get(0)?, row.get::<_, i64>(1)? != 0)),
            )
            .ok();
        if let Some((existing_id, pinned)) = existing {
            connection.execute(
                "UPDATE clipboard_items SET captured_at = ?2 WHERE id = ?1",
                (&existing_id, &item.captured_at),
            )?;
            let mut saved = self.get_clipboard_item(existing_id)?;
            saved.pinned = pinned;
            return Ok(saved);
        }
        if item.asset_path.is_none() {
            if let Some(preview) = item.preview.take() {
                item.asset_path = Some(self.write_clipboard_preview_asset(&item.id, &preview)?);
            }
        }
        item.preview = None;
        item.content_loaded = true;
        connection.execute("\
            INSERT INTO clipboard_items(id, kind, content_text, asset_path, hash, captured_at, pinned)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ", (
            &item.id,
            &item.kind,
            &item.content,
            &item.asset_path,
            &item.hash,
            &item.captured_at,
            i64::from(item.pinned),
        ))?;
        Ok(item)
    }

    pub fn set_clipboard_item_pinned(&self, id: String, pinned: bool) -> Result<()> {
        if !Self::valid_document_id(&id) {
            bail!("剪贴板记录 ID 无效")
        }
        let connection = self.connection()?;
        if connection.execute(
            "UPDATE clipboard_items SET pinned = ?2 WHERE id = ?1",
            (&id, i64::from(pinned)),
        )? == 0
        {
            bail!("剪贴板记录不存在")
        }
        Ok(())
    }

    pub fn delete_clipboard_item(&self, id: String) -> Result<()> {
        if !Self::valid_document_id(&id) {
            bail!("剪贴板记录 ID 无效")
        }
        let connection = self.connection()?;
        let asset_path = connection
            .query_row(
                "SELECT asset_path FROM clipboard_items WHERE id = ?1",
                [&id],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok();
        connection.execute("DELETE FROM clipboard_items WHERE id = ?1", [&id])?;
        self.remove_vault_clipboard_asset(asset_path.flatten());
        Ok(())
    }

    pub fn clear_unpinned_clipboard_items(&self) -> Result<()> {
        let connection = self.connection()?;
        let paths = {
            let mut statement =
                connection.prepare("SELECT asset_path FROM clipboard_items WHERE pinned = 0")?;
            let paths = statement
                .query_map([], |row| row.get::<_, Option<String>>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            paths
        };
        connection.execute("DELETE FROM clipboard_items WHERE pinned = 0", [])?;
        drop(connection);
        for path in paths {
            self.remove_vault_clipboard_asset(path);
        }
        Ok(())
    }

    pub fn prune_clipboard_items(&self, limit: usize, retention_days: i64) -> Result<()> {
        let limit = limit.clamp(10, 500) as i64;
        let retention_days = retention_days.clamp(1, 3650);
        let threshold = Utc::now()
            .checked_sub_signed(chrono::Duration::days(retention_days))
            .unwrap_or_else(Utc::now)
            .to_rfc3339();
        let connection = self.connection()?;
        let paths = {
            let mut statement = connection.prepare(
                "\
                SELECT asset_path FROM clipboard_items
                WHERE pinned = 0 AND (
                  captured_at < ?1 OR id NOT IN (
                    SELECT id FROM clipboard_items
                    WHERE pinned = 0 AND captured_at >= ?1
                    ORDER BY captured_at DESC LIMIT ?2
                  )
                )
            ",
            )?;
            let paths = statement
                .query_map((&threshold, limit), |row| row.get::<_, Option<String>>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            paths
        };
        connection.execute(
            "\
            DELETE FROM clipboard_items
            WHERE pinned = 0 AND (
              captured_at < ?1 OR id NOT IN (
                SELECT id FROM clipboard_items
                WHERE pinned = 0 AND captured_at >= ?1
                ORDER BY captured_at DESC LIMIT ?2
              )
            )
        ",
            (&threshold, limit),
        )?;
        drop(connection);
        for path in paths {
            self.remove_vault_clipboard_asset(path);
        }
        Ok(())
    }

    pub fn hydrate_clipboard_items(
        &self,
        browser_items: Vec<VaultClipboardItem>,
        limit: usize,
        retention_days: i64,
    ) -> Result<Vec<VaultClipboardItem>> {
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let migrated: Option<String> = connection
            .query_row(
                "SELECT value FROM vault_meta WHERE key = 'browser-clipboard-migration-v1'",
                [],
                |row| row.get(0),
            )
            .ok();
        drop(connection);
        // The marker, rather than the current row count, is the source of
        // truth. A previous process may have exited after importing only part
        // of the browser history. Replaying the remaining input is safe:
        // `save_clipboard_item` de-duplicates by hash.
        let should_migrate = migrated.is_none() && !browser_items.is_empty();
        if should_migrate {
            let migration_directory = self.root.join(".toolknit/migrations");
            fs::create_dir_all(&migration_directory)?;
            let timestamp = Utc::now().format("%Y%m%d-%H%M%S");
            fs::write(
                migration_directory
                    .join(format!("browser-clipboard-before-vault-{timestamp}.json")),
                serde_json::to_vec_pretty(&browser_items)?,
            )?;
            for item in browser_items {
                self.save_clipboard_item(item)?;
            }
        }
        self.prune_clipboard_items(limit, retention_days)?;
        let connection = self.connection()?;
        if migrated.is_none() {
            connection.execute("\
                INSERT INTO vault_meta(key, value, updated_at) VALUES ('browser-clipboard-migration-v1', ?1, ?2)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            ", (if should_migrate { "imported" } else { "skipped" }, Utc::now().to_rfc3339()))?;
        }
        drop(connection);
        self.list_clipboard_items()
    }

    pub fn save_source(&self, mut source: VaultSource) -> Result<()> {
        Self::normalize_source(&mut source)?;
        let tags_json = serde_json::to_string(&source.tags)?;
        let mut connection = self.connection()?;
        if let Some(hash) = source.sha256.as_deref() {
            let existing: Option<String> = connection
                .query_row(
                    "SELECT id FROM source_records WHERE sha256 = ?1",
                    [hash],
                    |row| row.get(0),
                )
                .ok();
            if existing.as_deref().is_some_and(|id| id != source.id) {
                bail!("相同资料已在本地资料库中")
            }
        }
        let existing_media: Option<(Option<String>, String)> = connection
            .query_row(
                "SELECT preview_path, crops_json FROM source_records WHERE id = ?1",
                [&source.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();
        let preview_path = match source.preview.take() {
            Some(preview) => Some(self.write_source_asset(&source.id, "preview.data", &preview)?),
            None => existing_media.as_ref().and_then(|(path, _)| path.clone()),
        };
        let crops_json = match source.crops.take() {
            Some(crops) => {
                serde_json::to_string(&self.write_source_crop_assets(&source.id, &crops)?)?
            }
            None => existing_media
                .map(|(_, crops)| crops)
                .unwrap_or_else(|| "{}".into()),
        };
        let transaction = connection.transaction()?;
        transaction.execute("\
            INSERT INTO source_records(id, name, kind, mime, size, sha256, tags_json, imported_at, last_opened_at, original_path, managed_path, page_count, content_text, preview_data, preview_path, crops_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL, ?14, ?15)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name, kind = excluded.kind, mime = excluded.mime, size = excluded.size,
              sha256 = excluded.sha256, tags_json = excluded.tags_json, imported_at = excluded.imported_at,
              last_opened_at = excluded.last_opened_at, original_path = excluded.original_path,
              managed_path = excluded.managed_path, page_count = excluded.page_count,
              content_text = excluded.content_text, preview_data = NULL, preview_path = excluded.preview_path, crops_json = excluded.crops_json
        ", (&source.id, &source.name, &source.kind, &source.mime, source.size, &source.sha256, &tags_json, &source.imported_at, &source.last_opened_at, &source.original_path, &source.managed_path, &source.page_count, &source.content, &preview_path, &crops_json))?;
        transaction.execute("DELETE FROM sources_fts WHERE source_id = ?1", [&source.id])?;
        transaction.execute(
            "INSERT INTO sources_fts(source_id, name, body, tags) VALUES (?1, ?2, ?3, ?4)",
            (
                &source.id,
                &source.name,
                Self::fts_body(&format!(
                    "{}\n{}\n{}\n{}",
                    source.name,
                    source.kind,
                    source.mime,
                    source.content.as_deref().unwrap_or_default()
                )),
                Self::fts_body(&source.tags.join("\n")),
            ),
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn list_sources(&self) -> Result<Vec<VaultSource>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare("\
            SELECT id, name, kind, mime, size, sha256, tags_json, imported_at, last_opened_at, original_path, managed_path, page_count
            FROM source_records ORDER BY COALESCE(last_opened_at, imported_at) DESC
        ")?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<i64>>(11)?,
            ))
        })?;
        let mut sources = Vec::new();
        for row in rows {
            let (
                id,
                name,
                kind,
                mime,
                size,
                sha256,
                tags_json,
                imported_at,
                last_opened_at,
                original_path,
                managed_path,
                page_count,
            ) = row?;
            sources.push(VaultSource {
                id,
                name,
                kind,
                mime,
                size,
                sha256,
                imported_at,
                last_opened_at,
                original_path,
                managed_path,
                page_count,
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                content: None,
                preview: None,
                crops: None,
            });
        }
        Ok(sources)
    }

    pub fn get_source(&self, id: String) -> Result<VaultSource> {
        if !Self::valid_document_id(&id) {
            bail!("资料 ID 无效")
        }
        let connection = self.connection()?;
        let row = connection.query_row("\
            SELECT id, name, kind, mime, size, sha256, tags_json, imported_at, last_opened_at, original_path, managed_path, page_count, content_text, preview_data, preview_path, crops_json
            FROM source_records WHERE id = ?1
        ", [&id], |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, i64>(4)?, row.get::<_, Option<String>>(5)?, row.get::<_, String>(6)?, row.get::<_, String>(7)?, row.get::<_, Option<String>>(8)?, row.get::<_, Option<String>>(9)?, row.get::<_, Option<String>>(10)?, row.get::<_, Option<i64>>(11)?, row.get::<_, Option<String>>(12)?, row.get::<_, Option<String>>(13)?, row.get::<_, Option<String>>(14)?, row.get::<_, String>(15)?,
        ))).map_err(|_| anyhow::anyhow!("资料不存在"))?;
        let (
            id,
            name,
            kind,
            mime,
            size,
            sha256,
            tags_json,
            imported_at,
            last_opened_at,
            original_path,
            managed_path,
            page_count,
            content,
            legacy_preview,
            preview_path,
            crops_json,
        ) = row;
        let preview = match preview_path {
            Some(path) => Some(self.read_source_asset(&path)?),
            None => legacy_preview,
        };
        Ok(VaultSource {
            id,
            name,
            kind,
            mime,
            size,
            sha256,
            imported_at,
            last_opened_at,
            original_path,
            managed_path,
            page_count,
            tags: serde_json::from_str(&tags_json).unwrap_or_default(),
            content,
            preview,
            crops: Some(self.resolve_source_crops(&crops_json)?),
        })
    }

    pub fn touch_source(&self, id: String) -> Result<()> {
        self.touch_content_recent(id, "source".into())?;
        Ok(())
    }

    /// Tags are metadata-only. Updating them must never rewrite a large source
    /// body, preview, crop, or managed binary path.
    pub fn save_source_tags(&self, id: String, tags: Vec<String>) -> Result<Vec<String>> {
        if !Self::valid_document_id(&id) {
            bail!("资料 ID 无效")
        }
        let mut normalized = Vec::new();
        let mut seen = HashSet::new();
        for raw_tag in tags {
            let tag = raw_tag.trim().to_owned();
            if tag.is_empty() {
                continue;
            }
            if tag.len() > 120 {
                bail!("资料标签过长")
            }
            if seen.insert(tag.to_lowercase()) {
                normalized.push(tag);
            }
            if normalized.len() >= 64 {
                break;
            }
        }
        let tags_json = serde_json::to_string(&normalized)?;
        let connection = self.connection()?;
        if connection.execute(
            "UPDATE source_records SET tags_json = ?2 WHERE id = ?1",
            (&id, &tags_json),
        )? == 0
        {
            bail!("资料不存在")
        }
        connection.execute(
            "UPDATE sources_fts SET tags = ?2 WHERE source_id = ?1",
            (&id, Self::fts_body(&normalized.join("\n"))),
        )?;
        Ok(normalized)
    }

    pub fn save_source_crops(&self, id: String, crops: HashMap<String, String>) -> Result<()> {
        if !Self::valid_document_id(&id) {
            bail!("资料 ID 无效")
        }
        if crops.len() > 80
            || crops.iter().any(|(crop_id, value)| {
                !Self::valid_document_id(crop_id) || value.len() > 4 * 1024 * 1024
            })
        {
            bail!("资料裁剪数据无效")
        }
        if crops
            .iter()
            .map(|(crop_id, value)| crop_id.len() + value.len())
            .sum::<usize>()
            > 24 * 1024 * 1024
        {
            bail!("资料裁剪数据过大")
        }
        let crops_json = serde_json::to_string(&self.write_source_crop_assets(&id, &crops)?)?;
        let connection = self.connection()?;
        if connection.execute(
            "UPDATE source_records SET crops_json = ?2 WHERE id = ?1",
            (&id, crops_json),
        )? == 0
        {
            bail!("资料不存在")
        }
        Ok(())
    }

    pub fn get_source_crop(&self, id: String, crop_id: String) -> Result<Option<String>> {
        if !Self::valid_document_id(&id) || !Self::valid_document_id(&crop_id) {
            bail!("资料裁剪 ID 无效")
        }
        let connection = self.connection()?;
        let crops_json: String = connection
            .query_row(
                "SELECT crops_json FROM source_records WHERE id = ?1",
                [&id],
                |row| row.get(0),
            )
            .map_err(|_| anyhow::anyhow!("资料不存在"))?;
        let crops: HashMap<String, String> = serde_json::from_str(&crops_json).unwrap_or_default();
        crops
            .get(&crop_id)
            .map(|value| {
                if value.starts_with("assets/") {
                    self.read_source_asset(value)
                } else {
                    Ok(value.clone())
                }
            })
            .transpose()
    }

    pub fn hydrate_sources(&self, browser_sources: Vec<VaultSource>) -> Result<Vec<VaultSource>> {
        let connection = self.connection()?;
        let migrated: Option<String> = connection
            .query_row(
                "SELECT value FROM vault_meta WHERE key = 'browser-source-migration-v1'",
                [],
                |row| row.get(0),
            )
            .ok();
        drop(connection);
        if migrated.is_none() {
            for source in browser_sources {
                // A stale browser duplicate should not invalidate the entire
                // desktop migration; the primary copy already lives in Vault.
                if let Err(error) = self.save_source(source) {
                    if !error.to_string().contains("相同资料已在本地资料库中") {
                        return Err(error);
                    }
                }
            }
            let connection = self.connection()?;
            connection.execute("\
                INSERT INTO vault_meta(key, value, updated_at) VALUES ('browser-source-migration-v1', 'imported', ?1)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            ", [Utc::now().to_rfc3339()])?;
        }
        self.list_sources()
    }

    pub fn save_markdown(&self, id: String, kind: String, markdown: String) -> Result<()> {
        if !id
            .chars()
            .all(|char| char.is_ascii_hexdigit() || char == '-')
        {
            bail!("文档 ID 无效")
        }
        let folder = match kind.as_str() {
            "question" => "questions",
            "note" => "notes",
            _ => bail!("未知文档类型"),
        };
        let path = self.root.join(folder).join(format!("{id}.md"));
        self.write_document_content(&path, &markdown)?;
        let content_hash = format!("{:x}", Sha256::digest(markdown.as_bytes()));
        let title = markdown
            .lines()
            .find_map(|line| {
                line.trim()
                    .strip_prefix("# ")
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            })
            .unwrap_or(if kind == "question" {
                "未命名题目"
            } else {
                "未命名笔记"
            });
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let transaction = connection.transaction()?;
        let entity_type = if kind == "question" {
            "question"
        } else {
            "document"
        };
        transaction.execute("\
            INSERT INTO entities(id, type, title, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?4)
            ON CONFLICT(id) DO UPDATE SET type = excluded.type, title = excluded.title, updated_at = excluded.updated_at
        ", (&id, entity_type, title, &now))?;
        let markdown_path = Self::document_relative_path(&id, &kind)?;
        transaction.execute("\
            INSERT INTO documents(entity_id, kind, markdown_path, content_hash, content_text, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(entity_id) DO UPDATE SET
              kind = excluded.kind,
              markdown_path = excluded.markdown_path,
              content_hash = excluded.content_hash,
              content_text = excluded.content_text,
              updated_at = excluded.updated_at
        ", (&id, &kind, &markdown_path, &content_hash, &markdown, &now))?;
        if kind == "question" {
            transaction.execute(
                "INSERT INTO questions(entity_id) VALUES (?1) ON CONFLICT(entity_id) DO NOTHING",
                [&id],
            )?;
        }
        transaction.execute("DELETE FROM documents_fts WHERE entity_id = ?1", [&id])?;
        transaction.execute(
            "INSERT INTO documents_fts(entity_id, title, body) VALUES (?1, ?2, ?3)",
            (&id, title, Self::fts_body(&format!("{title}\n{markdown}"))),
        )?;
        Self::replace_document_wiki_links(&transaction, &id, &markdown)?;
        transaction.commit()?;
        Ok(())
    }

    fn valid_document_id(id: &str) -> bool {
        !id.is_empty()
            && id.len() <= 96
            && id
                .chars()
                .all(|character| character.is_ascii_hexdigit() || character == '-')
    }

    fn is_wide_text(character: char) -> bool {
        matches!(character as u32,
            0x3040..=0x30ff | 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xac00..=0xd7af | 0xf900..=0xfaff | 0x20000..=0x2ebef
        )
    }

    fn append_wide_bigrams(tokens: &mut Vec<String>, run: &[char]) {
        match run.len() {
            0 => {}
            1 => tokens.push(run[0].to_string()),
            _ => tokens.extend(run.windows(2).map(|pair| pair.iter().collect())),
        }
    }

    fn wide_bigrams(text: &str) -> Vec<String> {
        let mut tokens = Vec::new();
        let mut run = Vec::new();
        for character in text.chars() {
            if Self::is_wide_text(character) {
                run.push(character);
            } else {
                Self::append_wide_bigrams(&mut tokens, &run);
                run.clear();
            }
        }
        Self::append_wide_bigrams(&mut tokens, &run);
        tokens
    }

    fn fts_body(text: &str) -> String {
        let bigrams = Self::wide_bigrams(text);
        if bigrams.is_empty() {
            text.to_owned()
        } else {
            format!("{text}\n{}", bigrams.join(" "))
        }
    }

    fn json_search_text(value: &serde_json::Value) -> String {
        match value {
            serde_json::Value::String(value) => value.to_owned(),
            serde_json::Value::Array(values) => values
                .iter()
                .map(Self::json_search_text)
                .collect::<Vec<_>>()
                .join("\n"),
            serde_json::Value::Object(values) => values
                .iter()
                .flat_map(|(key, value)| [key.to_owned(), Self::json_search_text(value)])
                .collect::<Vec<_>>()
                .join("\n"),
            serde_json::Value::Null => String::new(),
            value => value.to_string(),
        }
    }

    fn vocabulary_fts_body(
        lemma: &str,
        language: &str,
        pronunciation: Option<&str>,
        forms: &serde_json::Value,
        senses: &str,
    ) -> String {
        Self::fts_body(
            &[
                lemma,
                language,
                pronunciation.unwrap_or_default(),
                &Self::json_search_text(forms),
                senses,
            ]
            .join("\n"),
        )
    }

    fn fts_query(query: &str) -> String {
        let mut tokens = Vec::new();
        let mut wide_run = Vec::new();
        let mut word = String::new();
        let flush_word = |tokens: &mut Vec<String>, word: &mut String| {
            if !word.is_empty() {
                tokens.push(std::mem::take(word));
            }
        };
        for character in query.chars() {
            if Self::is_wide_text(character) {
                flush_word(&mut tokens, &mut word);
                wide_run.push(character);
            } else if character.is_alphanumeric() || character == '_' || character == '-' {
                Self::append_wide_bigrams(&mut tokens, &wide_run);
                wide_run.clear();
                word.push(character);
            } else {
                flush_word(&mut tokens, &mut word);
                Self::append_wide_bigrams(&mut tokens, &wide_run);
                wide_run.clear();
            }
        }
        flush_word(&mut tokens, &mut word);
        Self::append_wide_bigrams(&mut tokens, &wide_run);
        // FTS5 treats characters such as `-` as query syntax in an unquoted
        // bareword. Search terms commonly used in a computing notebook
        // (Vue-3, code-snapshot, C-style names) must therefore be quoted
        // before the prefix operator is appended. The tokenizer still breaks
        // the quoted phrase into its searchable terms, while this boundary
        // keeps user input out of the FTS query grammar.
        tokens
            .into_iter()
            .filter(|token| !token.is_empty())
            .map(|token| format!("\"{}\"*", token.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" AND ")
    }

    fn document_relative_path(id: &str, kind: &str) -> Result<String> {
        if !Self::valid_document_id(id) {
            bail!("文档 ID 无效")
        }
        let folder = match kind {
            "question" => "questions",
            "note" => "notes",
            _ => bail!("未知文档类型"),
        };
        Ok(format!("{folder}/{id}.md"))
    }

    fn document_path(&self, id: &str, kind: &str) -> Result<PathBuf> {
        Ok(self.root.join(Self::document_relative_path(id, kind)?))
    }

    /// Resolves a stored path without allowing a malformed database row or
    /// imported archive to read an absolute path or escape through `..`.
    fn resolve_document_path(&self, stored: &str) -> Option<PathBuf> {
        let relative = Path::new(stored);
        if relative.is_absolute() {
            return None;
        }
        let mut components = relative.components();
        let valid_folder = matches!(
            components.next(),
            Some(Component::Normal(folder)) if folder == "notes" || folder == "questions"
        );
        if !valid_folder || components.any(|component| !matches!(component, Component::Normal(_))) {
            return None;
        }
        Some(self.root.join(relative))
    }

    fn document_write_artifact(path: &Path, suffix: &str) -> Result<PathBuf> {
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .context("文档文件名无效")?;
        Ok(path.with_file_name(format!("{file_name}{suffix}")))
    }

    /// Writes Markdown through a synced sibling file. On Unix the final rename
    /// replaces the destination atomically. Windows cannot rename over an
    /// existing path with `std::fs`, so keep a recoverable previous sibling
    /// until the replacement succeeds; `open` reconciles either interruption
    /// state before the database is used again.
    fn write_document_content(&self, path: &Path, content: &str) -> Result<()> {
        let parent = path.parent().context("文档目录无效")?;
        fs::create_dir_all(parent)?;
        let staging = Self::document_write_artifact(path, DOCUMENT_WRITE_STAGING_SUFFIX)?;
        let temporary = Self::document_write_artifact(path, DOCUMENT_WRITE_TEMP_SUFFIX)?;
        let backup = Self::document_write_artifact(path, DOCUMENT_WRITE_BACKUP_SUFFIX)?;
        let _ = fs::remove_file(&staging);
        let _ = fs::remove_file(&temporary);

        let write_result = (|| -> Result<()> {
            let mut file = fs::File::create(&staging)?;
            file.write_all(content.as_bytes())?;
            file.sync_all()?;
            Ok(())
        })();
        if let Err(error) = write_result {
            let _ = fs::remove_file(&staging);
            return Err(error);
        }
        if let Err(error) = fs::rename(&staging, &temporary) {
            let _ = fs::remove_file(&staging);
            let _ = fs::remove_file(&temporary);
            return Err(error.into());
        }

        #[cfg(windows)]
        {
            if path.exists() {
                let _ = fs::remove_file(&backup);
                fs::rename(path, &backup)?;
                if let Err(error) = fs::rename(&temporary, path) {
                    let _ = fs::rename(&backup, path);
                    let _ = fs::remove_file(&temporary);
                    return Err(error.into());
                }
                let _ = fs::remove_file(&backup);
            } else {
                fs::rename(&temporary, path)?;
            }
        }
        #[cfg(not(windows))]
        {
            fs::rename(&temporary, path)?;
        }
        Ok(())
    }

    /// Reconciles the two deliberate write artifacts left by an interrupted
    /// Windows replacement. Prefer the fully synced new file when no target
    /// exists; once a target is present, every older sibling is safe to drop.
    fn recover_document_write_artifacts(&self) -> Result<()> {
        for folder in ["notes", "questions"] {
            let directory = self.root.join(folder);
            let paths = fs::read_dir(&directory)?
                .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                .filter(|path| path.is_file())
                .collect::<Vec<_>>();
            // A staging file has not passed `sync_all` and is deliberately
            // never a recovery candidate. Its matching live Markdown remains
            // the last durable version.
            for staging in paths.iter().filter(|path| {
                path.file_name()
                    .and_then(|value| value.to_str())
                    .is_some_and(|name| name.ends_with(DOCUMENT_WRITE_STAGING_SUFFIX))
            }) {
                let _ = fs::remove_file(staging);
            }
            for suffix in [DOCUMENT_WRITE_TEMP_SUFFIX, DOCUMENT_WRITE_BACKUP_SUFFIX] {
                for artifact in paths.iter().filter(|path| {
                    path.file_name()
                        .and_then(|value| value.to_str())
                        .is_some_and(|name| name.ends_with(suffix))
                }) {
                    let Some(name) = artifact.file_name().and_then(|value| value.to_str()) else {
                        continue;
                    };
                    let Some(original_name) = name.strip_suffix(suffix) else {
                        continue;
                    };
                    if !original_name.ends_with(".md") {
                        continue;
                    }
                    let target = artifact.with_file_name(original_name);
                    if target.exists() {
                        let _ = fs::remove_file(artifact);
                    } else {
                        fs::rename(artifact, target)?;
                    }
                }
            }
        }
        Ok(())
    }

    fn normalize_folder(folder: Option<String>) -> Option<String> {
        let mut segments = Vec::new();
        for raw in folder.unwrap_or_default().replace('\\', "/").split('/') {
            let cleaned = raw
                .trim()
                .chars()
                .filter(|character| {
                    !matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
                        && !character.is_control()
                })
                .take(72)
                .collect::<String>();
            if !cleaned.is_empty() && cleaned != "." && cleaned != ".." {
                segments.push(cleaned);
            }
            if segments.len() == 12 {
                break;
            }
        }
        if segments.is_empty() {
            None
        } else {
            Some(segments.join("/"))
        }
    }

    fn document_from_values(
        id: String,
        title: String,
        kind: String,
        created_at: String,
        updated_at: String,
        metadata_json: String,
        content: String,
        question_text: Option<String>,
        answer: Option<String>,
        explanation: Option<String>,
        wrong_answer: Option<String>,
        error_reason: Option<String>,
        include_question_details: bool,
    ) -> VaultDocument {
        let metadata: serde_json::Value =
            serde_json::from_str(&metadata_json).unwrap_or_else(|_| json!({}));
        let string_list = |key: &str| {
            metadata
                .get(key)
                .and_then(|value| value.as_array())
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|value| value.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default()
        };
        let detail_string = |key: &str| {
            metadata
                .get("questionDetails")
                .and_then(|value| value.get(key))
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_owned()
        };
        let is_question = kind == "question";
        let default_review_enabled = is_question;
        VaultDocument {
            id,
            title,
            kind,
            question_type: metadata
                .get("questionType")
                .and_then(|value| value.as_str())
                .map(str::to_owned),
            subject: metadata
                .get("subject")
                .and_then(|value| value.as_str())
                .unwrap_or("未分类")
                .to_owned(),
            tags: string_list("tags"),
            folder: metadata
                .get("folder")
                .and_then(|value| value.as_str())
                .and_then(|value| Self::normalize_folder(Some(value.to_owned()))),
            difficulty: metadata
                .get("difficulty")
                .and_then(|value| value.as_i64())
                .unwrap_or(0)
                .clamp(0, 5),
            content,
            question_details: if include_question_details && is_question {
                Some(QuestionDetails {
                    source: detail_string("source"),
                    stem: question_text.unwrap_or_else(|| detail_string("stem")),
                    answer: answer.unwrap_or_else(|| detail_string("answer")),
                    explanation: explanation.unwrap_or_else(|| detail_string("explanation")),
                    wrong_answer: wrong_answer.unwrap_or_else(|| detail_string("wrongAnswer")),
                    error_reason: error_reason.unwrap_or_else(|| detail_string("errorReason")),
                })
            } else {
                None
            },
            source_anchor: metadata
                .get("sourceAnchor")
                .filter(|value| !value.is_null())
                .cloned(),
            created_at,
            updated_at,
            review_enabled: metadata
                .get("reviewEnabled")
                .and_then(|value| value.as_bool())
                .unwrap_or(default_review_enabled),
            review: metadata
                .get("review")
                .filter(|value| !value.is_null())
                .cloned(),
            review_facets: metadata
                .get("reviewFacets")
                .cloned()
                .and_then(|value| serde_json::from_value(value).ok())
                .unwrap_or_default(),
            error_types: string_list("errorTypes"),
            ai_generated: metadata
                .get("aiGenerated")
                .and_then(|value| value.as_bool()),
            external_file: metadata
                .get("externalFile")
                .filter(|value| !value.is_null())
                .cloned(),
        }
    }

    fn document_version_preview(document: &VaultDocument) -> String {
        let title = document.title.trim();
        let line = document
            .content
            .lines()
            .map(str::trim)
            .find(|line| {
                !line.is_empty()
                    && line.trim_start_matches('#').trim() != title
                    && !line.starts_with("---")
            })
            .unwrap_or(title)
            .trim_start_matches('#')
            .trim();
        let mut preview: String = line.chars().take(180).collect();
        if line.chars().count() > 180 {
            preview.push('…');
        }
        preview
    }

    fn record_document_version(
        transaction: &rusqlite::Transaction<'_>,
        document: &VaultDocument,
        content_hash: &str,
        force: bool,
    ) -> Result<()> {
        let snapshot_json = serde_json::to_string(document)?;
        let snapshot_hash = format!("{:x}", Sha256::digest(snapshot_json.as_bytes()));
        let latest = transaction
            .query_row(
                "SELECT id, saved_at, snapshot_hash, pinned
                 FROM document_versions
                 WHERE document_id = ?1
                 ORDER BY saved_at DESC, id DESC
                 LIMIT 1",
                [&document.id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .optional()?;
        if let Some((_, _, latest_hash, pinned)) = latest.as_ref() {
            if latest_hash == &snapshot_hash && (!force || *pinned == 1) {
                return Ok(());
            }
        }

        let saved_at = Utc::now();
        let preview = Self::document_version_preview(document);
        let byte_size = document.content.len() as i64;
        let coalesce_id = if force {
            None
        } else {
            latest
                .as_ref()
                .and_then(|(id, previous_saved_at, _, pinned)| {
                    if *pinned == 1 {
                        return None;
                    }
                    let previous = chrono::DateTime::parse_from_rfc3339(previous_saved_at).ok()?;
                    (saved_at
                        .signed_duration_since(previous.with_timezone(&Utc))
                        .num_seconds()
                        < DOCUMENT_VERSION_COALESCE_SECONDS)
                        .then(|| id.clone())
                })
        };
        if let Some(id) = coalesce_id {
            transaction.execute(
                "UPDATE document_versions
                 SET title = ?2, saved_at = ?3, byte_size = ?4, content_hash = ?5,
                     snapshot_hash = ?6, preview = ?7, snapshot_json = ?8
                 WHERE id = ?1",
                (
                    id,
                    &document.title,
                    saved_at.to_rfc3339(),
                    byte_size,
                    content_hash,
                    &snapshot_hash,
                    &preview,
                    &snapshot_json,
                ),
            )?;
        } else {
            transaction.execute(
                "INSERT INTO document_versions(
                   id, document_id, title, saved_at, byte_size, content_hash,
                   snapshot_hash, preview, snapshot_json, pinned
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                (
                    Uuid::now_v7().to_string(),
                    &document.id,
                    &document.title,
                    saved_at.to_rfc3339(),
                    byte_size,
                    content_hash,
                    &snapshot_hash,
                    &preview,
                    &snapshot_json,
                    if force { 1 } else { 0 },
                ),
            )?;
        }
        transaction.execute(
            "DELETE FROM document_versions
             WHERE document_id = ?1 AND id NOT IN (
               SELECT id FROM document_versions
               WHERE document_id = ?1
               ORDER BY saved_at DESC, id DESC
               LIMIT ?2
             )",
            (&document.id, DOCUMENT_VERSION_LIMIT),
        )?;
        Ok(())
    }

    fn pin_latest_or_record_document_version(
        transaction: &rusqlite::Transaction<'_>,
        document: &VaultDocument,
        content_hash: &str,
    ) -> Result<()> {
        let snapshot_hash = format!(
            "{:x}",
            Sha256::digest(serde_json::to_string(document)?.as_bytes())
        );
        let latest = transaction
            .query_row(
                "SELECT id, snapshot_hash FROM document_versions
                 WHERE document_id = ?1
                 ORDER BY saved_at DESC, id DESC
                 LIMIT 1",
                [&document.id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        if let Some((id, latest_hash)) = latest {
            if latest_hash == snapshot_hash {
                transaction.execute(
                    "UPDATE document_versions SET pinned = 1 WHERE id = ?1",
                    [&id],
                )?;
                return Ok(());
            }
        }
        Self::record_document_version(transaction, document, content_hash, true)
    }

    fn normalize_document(mut document: VaultDocument) -> Result<VaultDocument> {
        if !Self::valid_document_id(&document.id) {
            bail!("文档 ID 无效")
        }
        if document.kind != "note" && document.kind != "question" {
            bail!("未知文档类型")
        }
        if document.title.trim().is_empty() {
            document.title = if document.kind == "question" {
                "未命名错题".into()
            } else {
                "未命名笔记".into()
            };
        }
        if document.created_at.trim().is_empty() {
            document.created_at = Utc::now().to_rfc3339();
        }
        if document.updated_at.trim().is_empty() {
            document.updated_at = Utc::now().to_rfc3339();
        }
        document.tags.retain(|tag| !tag.trim().is_empty());
        document.folder = Self::normalize_folder(document.folder);
        document.error_types.retain(|kind| !kind.trim().is_empty());
        document.difficulty = document.difficulty.clamp(0, 5);
        if document.kind == "question" {
            document.review_facets.retain(|facet, review| {
                facet == "error" && review.get("due").and_then(|value| value.as_str()).is_some()
            });
            document.review_enabled =
                document.review.is_some() || !document.review_facets.is_empty();
        } else {
            document.review_facets.clear();
        }
        Ok(document)
    }

    fn save_document_transaction(
        transaction: &Transaction<'_>,
        document: &VaultDocument,
        content_hash: &str,
    ) -> Result<()> {
        let question_details = document.question_details.clone().unwrap_or_default();
        let metadata = json!({
            "questionType": document.question_type,
            "subject": document.subject,
            "tags": document.tags,
            "folder": document.folder,
            "difficulty": document.difficulty,
            "questionDetails": document.question_details,
            "sourceAnchor": document.source_anchor,
            "reviewEnabled": document.review_enabled,
            "review": document.review,
            "reviewFacets": document.review_facets,
            "errorTypes": document.error_types,
            "aiGenerated": document.ai_generated,
            "externalFile": document.external_file,
        });
        let metadata_json = serde_json::to_string(&metadata)?;
        let entity_type = if document.kind == "question" {
            "question"
        } else {
            "document"
        };
        transaction.execute(
            "\
            INSERT INTO entities(id, type, title, created_at, updated_at, metadata_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
              type = excluded.type,
              title = excluded.title,
              updated_at = excluded.updated_at,
              metadata_json = excluded.metadata_json
        ",
            (
                &document.id,
                entity_type,
                &document.title,
                &document.created_at,
                &document.updated_at,
                &metadata_json,
            ),
        )?;
        let markdown_path = Self::document_relative_path(&document.id, &document.kind)?;
        transaction.execute("\
            INSERT INTO documents(entity_id, kind, markdown_path, content_hash, content_text, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(entity_id) DO UPDATE SET
              kind = excluded.kind,
              markdown_path = excluded.markdown_path,
              content_hash = excluded.content_hash,
              content_text = excluded.content_text,
              updated_at = excluded.updated_at
        ", (&document.id, &document.kind, &markdown_path, content_hash, &document.content, &document.updated_at))?;
        if document.kind == "question" {
            transaction.execute("\
                INSERT INTO questions(entity_id, question_type, question_text, answer, explanation, wrong_answer, error_reason, difficulty)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ON CONFLICT(entity_id) DO UPDATE SET
                  question_type = excluded.question_type,
                  question_text = excluded.question_text,
                  answer = excluded.answer,
                  explanation = excluded.explanation,
                  wrong_answer = excluded.wrong_answer,
                  error_reason = excluded.error_reason,
                  difficulty = excluded.difficulty
            ", (&document.id, &document.question_type, &question_details.stem, &question_details.answer, &question_details.explanation, &question_details.wrong_answer, &question_details.error_reason, document.difficulty))?;
        } else {
            transaction.execute("DELETE FROM questions WHERE entity_id = ?1", [&document.id])?;
        }
        transaction.execute(
            "DELETE FROM review_cards WHERE entity_id = ?1 AND facet IN ('default', 'error')",
            [&document.id],
        )?;
        if document.review_enabled {
            if let Some(review) = document.review.as_ref() {
                let due = review.get("due").and_then(|value| value.as_str());
                transaction.execute("\
                    INSERT INTO review_cards(id, entity_id, facet, due, fsrs_state, created_at, updated_at)
                    VALUES (?1, ?2, 'default', ?3, ?4, ?5, ?6)
                ", (format!("{}:default", document.id), &document.id, due, serde_json::to_string(review)?, &document.created_at, &document.updated_at))?;
            }
            if let Some(review) = document.review_facets.get("error") {
                let due = review.get("due").and_then(|value| value.as_str());
                transaction.execute("\
                    INSERT INTO review_cards(id, entity_id, facet, due, fsrs_state, created_at, updated_at)
                    VALUES (?1, ?2, 'error', ?3, ?4, ?5, ?6)
                ", (format!("{}:error", document.id), &document.id, due, serde_json::to_string(review)?, &document.created_at, &document.updated_at))?;
            }
        } else {
            transaction.execute(
                "DELETE FROM review_cards WHERE entity_id = ?1",
                [&document.id],
            )?;
        }
        // The Markdown triggers index the free-form note. Replace that row so
        // title search also finds the separately stored question fields.
        transaction.execute(
            "DELETE FROM documents_fts WHERE entity_id = ?1",
            [&document.id],
        )?;
        transaction.execute(
            "INSERT INTO documents_fts(entity_id, title, body) VALUES (?1, ?2, ?3)",
            (
                &document.id,
                &document.title,
                Self::fts_body(&format!(
                    "{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
                    document.title,
                    document.content,
                    question_details.source,
                    question_details.stem,
                    question_details.answer,
                    question_details.explanation,
                    question_details.wrong_answer,
                    question_details.error_reason
                )),
            ),
        )?;
        Self::replace_document_wiki_links(transaction, &document.id, &document.content)?;
        Self::record_document_version(transaction, document, content_hash, false)?;
        Ok(())
    }

    pub fn save_document(&self, document: VaultDocument) -> Result<()> {
        let document = Self::normalize_document(document)?;
        let path = self.document_path(&document.id, &document.kind)?;
        self.write_document_content(&path, &document.content)?;
        let content_hash = format!("{:x}", Sha256::digest(document.content.as_bytes()));
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let transaction = connection.transaction()?;
        Self::save_document_transaction(&transaction, &document, &content_hash)?;
        transaction.commit()?;
        Ok(())
    }

    /// Question intake is new-only: validate and write every Markdown file
    /// before exposing any SQLite row, then commit metadata, FTS and review
    /// cards together. Normal errors remove the unreferenced files again.
    pub fn save_question_batch(&self, documents: Vec<VaultDocument>) -> Result<()> {
        if documents.is_empty() {
            bail!("批量题目不能为空")
        }
        if documents.len() > 2_000 {
            bail!("单次最多导入 2,000 道题")
        }
        let ids = documents
            .iter()
            .map(|document| document.id.as_str())
            .collect::<HashSet<_>>();
        if ids.len() != documents.len() {
            bail!("批量题目包含重复 ID")
        }
        let normalized = documents
            .into_iter()
            .map(Self::normalize_document)
            .collect::<Result<Vec<_>>>()?;
        if normalized
            .iter()
            .any(|document| document.kind != "question")
        {
            bail!("批量导入只接受题目")
        }

        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        for document in &normalized {
            let exists: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM entities WHERE id = ?1)",
                [&document.id],
                |row| row.get(0),
            )?;
            if exists {
                bail!("批量题目 ID 已存在")
            }
        }

        let mut written = Vec::with_capacity(normalized.len());
        for document in &normalized {
            let path = self.document_path(&document.id, "question")?;
            if path.exists() {
                for cleanup in &written {
                    let _ = fs::remove_file(cleanup);
                }
                bail!("批量题目的 Markdown 文件已存在")
            }
            if let Err(error) = self.write_document_content(&path, &document.content) {
                for cleanup in &written {
                    let _ = fs::remove_file(cleanup);
                }
                return Err(error);
            }
            written.push(path);
        }

        let result = (|| -> Result<()> {
            let transaction = connection.transaction()?;
            for document in &normalized {
                let content_hash = format!("{:x}", Sha256::digest(document.content.as_bytes()));
                Self::save_document_transaction(&transaction, document, &content_hash)?;
            }
            transaction.commit()?;
            Ok(())
        })();
        if result.is_err() {
            for path in &written {
                let _ = fs::remove_file(path);
            }
        }
        result
    }

    pub fn list_document_versions(
        &self,
        document_id: String,
    ) -> Result<Vec<VaultDocumentVersionSummary>> {
        if !Self::valid_document_id(&document_id) {
            bail!("文档 ID 无效")
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let mut statement = connection.prepare(
            "SELECT document_versions.id, document_versions.document_id,
                    document_versions.title, document_versions.saved_at,
                    document_versions.byte_size, document_versions.preview,
                    document_versions.id = (
                      SELECT latest.id FROM document_versions AS latest
                      WHERE latest.document_id = document_versions.document_id
                      ORDER BY latest.saved_at DESC, latest.id DESC
                      LIMIT 1
                    ) AND document_versions.content_hash = documents.content_hash
             FROM document_versions
             INNER JOIN documents ON documents.entity_id = document_versions.document_id
             WHERE document_versions.document_id = ?1
             ORDER BY document_versions.saved_at DESC, document_versions.id DESC
             LIMIT ?2",
        )?;
        let rows = statement.query_map((&document_id, DOCUMENT_VERSION_LIMIT), |row| {
            Ok(VaultDocumentVersionSummary {
                id: row.get(0)?,
                document_id: row.get(1)?,
                title: row.get(2)?,
                saved_at: row.get(3)?,
                byte_size: row.get(4)?,
                preview: row.get(5)?,
                is_current: row.get::<_, i64>(6)? == 1,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn get_document_version(
        &self,
        document_id: String,
        version_id: String,
    ) -> Result<VaultDocument> {
        if !Self::valid_document_id(&document_id) || !Self::valid_document_id(&version_id) {
            bail!("文档版本 ID 无效")
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let snapshot: String = connection
            .query_row(
                "SELECT snapshot_json FROM document_versions
                 WHERE document_id = ?1 AND id = ?2",
                (&document_id, &version_id),
                |row| row.get(0),
            )
            .optional()?
            .context("文档版本不存在或已经过期")?;
        serde_json::from_str(&snapshot).context("文档版本快照已损坏")
    }

    pub fn preserve_current_document_version(&self, document_id: String) -> Result<()> {
        let document = self.get_document(document_id)?;
        let content_hash = format!("{:x}", Sha256::digest(document.content.as_bytes()));
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let transaction = connection.transaction()?;
        // An explicit restore point remains a distinct pinned snapshot even
        // when it matches the latest coalesced autosave entry.
        Self::record_document_version(&transaction, &document, &content_hash, true)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn list_documents(&self) -> Result<Vec<VaultDocument>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare("\
            SELECT entities.id, entities.title, documents.kind, entities.created_at, entities.updated_at,
                   entities.metadata_json, documents.markdown_path, documents.content_text,
                   questions.question_text, questions.answer, questions.explanation, questions.wrong_answer, questions.error_reason
            FROM documents
            INNER JOIN entities ON entities.id = documents.entity_id
            LEFT JOIN questions ON questions.entity_id = documents.entity_id
            ORDER BY entities.updated_at DESC
        ")?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, Option<String>>(12)?,
            ))
        })?;
        let mut documents = Vec::new();
        for row in rows {
            let (
                id,
                title,
                kind,
                created_at,
                updated_at,
                metadata_json,
                markdown_path,
                content_text,
                question_text,
                answer,
                explanation,
                wrong_answer,
                error_reason,
            ) = row?;
            let content = self
                .resolve_document_path(&markdown_path)
                .and_then(|path| fs::read_to_string(path).ok())
                .unwrap_or(content_text);
            documents.push(Self::document_from_values(
                id,
                title,
                kind,
                created_at,
                updated_at,
                metadata_json,
                content,
                question_text,
                answer,
                explanation,
                wrong_answer,
                error_reason,
                true,
            ));
        }
        Ok(documents)
    }

    /// Startup and list navigation need titles and structured metadata, not
    /// every Markdown body. Keep those large files on disk until the user
    /// selects one, just as sources keep binary previews out of hydration.
    pub fn list_document_summaries(&self) -> Result<Vec<VaultDocument>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare("\
            SELECT entities.id, entities.title, documents.kind, entities.created_at, entities.updated_at, entities.metadata_json
            FROM documents
            INNER JOIN entities ON entities.id = documents.entity_id
            ORDER BY entities.updated_at DESC
        ")?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })?;
        rows.map(|row| {
            let (id, title, kind, created_at, updated_at, metadata_json) = row?;
            Ok(Self::document_from_values(
                id,
                title,
                kind,
                created_at,
                updated_at,
                metadata_json,
                String::new(),
                None,
                None,
                None,
                None,
                None,
                false,
            ))
        })
        .collect()
    }

    fn get_indexed_document(&self, id: &str) -> Result<(VaultDocument, String)> {
        if !Self::valid_document_id(&id) {
            bail!("文档 ID 无效")
        }
        let connection = self.connection()?;
        let (id, title, kind, created_at, updated_at, metadata_json, markdown_path, content_text, question_text, answer, explanation, wrong_answer, error_reason) = connection.query_row("\
            SELECT entities.id, entities.title, documents.kind, entities.created_at, entities.updated_at,
                   entities.metadata_json, documents.markdown_path, documents.content_text,
                   questions.question_text, questions.answer, questions.explanation, questions.wrong_answer, questions.error_reason
            FROM documents
            INNER JOIN entities ON entities.id = documents.entity_id
            LEFT JOIN questions ON questions.entity_id = documents.entity_id
            WHERE entities.id = ?1
        ", [&id], |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
            row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?,
            row.get::<_, String>(6)?, row.get::<_, String>(7)?,
            row.get::<_, Option<String>>(8)?, row.get::<_, Option<String>>(9)?, row.get::<_, Option<String>>(10)?, row.get::<_, Option<String>>(11)?, row.get::<_, Option<String>>(12)?,
        )))?;
        Ok((
            Self::document_from_values(
                id,
                title,
                kind,
                created_at,
                updated_at,
                metadata_json,
                content_text,
                question_text,
                answer,
                explanation,
                wrong_answer,
                error_reason,
                true,
            ),
            markdown_path,
        ))
    }

    /// Reads one document body only after it becomes the active document or a
    /// review card. This avoids sending a whole Markdown Vault to the webview
    /// during application startup.
    pub fn get_document(&self, id: String) -> Result<VaultDocument> {
        let (mut document, markdown_path) = self.get_indexed_document(&id)?;
        if let Some(content) = self
            .resolve_document_path(&markdown_path)
            .and_then(|path| fs::read_to_string(path).ok())
        {
            document.content = content;
        }
        Ok(document)
    }

    /// Rebuilds the SQLite body, FTS entry, wiki-link projection and version
    /// metadata after Typora or another local editor changes a managed `.md`.
    /// Missing files are reported, never recreated; untracked ids are ignored
    /// so the application's own delete operation cannot produce a false alarm.
    pub fn reconcile_document_markdown(&self, id: String) -> Result<VaultMarkdownReconcile> {
        if !Self::valid_document_id(&id) {
            bail!("文档 ID 无效")
        }
        let connection = self.connection()?;
        let indexed_hash = connection
            .query_row(
                "SELECT content_hash FROM documents WHERE entity_id = ?1",
                [&id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let Some(indexed_hash) = indexed_hash else {
            return Ok(VaultMarkdownReconcile {
                document_id: id,
                status: "untracked".into(),
                document: None,
            });
        };
        let (indexed_document, markdown_path) = self.get_indexed_document(&id)?;
        let path = self
            .resolve_document_path(&markdown_path)
            .context("Vault Markdown 路径无效")?;
        if !path.is_file() {
            return Ok(VaultMarkdownReconcile {
                document_id: id,
                status: "missing".into(),
                document: None,
            });
        }
        let content = fs::read_to_string(&path)
            .with_context(|| format!("无法读取 UTF-8 Vault Markdown：{}", path.display()))?;
        let disk_hash = format!("{:x}", Sha256::digest(content.as_bytes()));
        if disk_hash == indexed_hash {
            return Ok(VaultMarkdownReconcile {
                document_id: id,
                status: "unchanged".into(),
                document: None,
            });
        }

        let mut document = indexed_document.clone();
        document.content = content;
        document.updated_at = Utc::now().to_rfc3339();
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let transaction = connection.transaction()?;
        // External edits bypass the normal save transaction. Preserve the
        // last indexed state as a non-coalescing recovery point before the
        // new disk body becomes current, even if both writes are seconds apart.
        Self::pin_latest_or_record_document_version(
            &transaction,
            &indexed_document,
            &indexed_hash,
        )?;
        Self::save_document_transaction(&transaction, &document, &disk_hash)?;
        transaction.commit()?;
        Ok(VaultMarkdownReconcile {
            document_id: id,
            status: "updated".into(),
            document: Some(document),
        })
    }

    pub fn save_vocabulary(&self, entry: VocabularyEntry) -> Result<()> {
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let transaction = connection.transaction()?;
        Self::save_vocabulary_transaction(&transaction, entry)?;
        transaction.commit()?;
        Ok(())
    }

    /// Importing a study list must be all-or-nothing. A single SQLite
    /// transaction avoids hundreds of renderer round-trips and cannot leave a
    /// half-imported vocabulary if one row is malformed.
    pub fn save_vocabulary_batch(&self, entries: Vec<VocabularyEntry>) -> Result<()> {
        if entries.is_empty() {
            bail!("批量单词不能为空")
        }
        if entries.len() > 5_000 {
            bail!("单次最多导入 5,000 个单词")
        }
        let ids = entries
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<HashSet<_>>();
        if ids.len() != entries.len() {
            bail!("批量单词包含重复 ID")
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let transaction = connection.transaction()?;
        for entry in entries {
            Self::save_vocabulary_transaction(&transaction, entry)?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// Resume the one-time browser migration without deleting native words or
    /// imposing the interactive import limit. Existing entity IDs always win;
    /// only rows that have not reached SQLite yet are inserted in one
    /// transaction.
    fn migrate_missing_vocabulary(&self, entries: Vec<VocabularyEntry>) -> Result<()> {
        if entries.is_empty() {
            return Ok(());
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let existing = connection
            .prepare("SELECT id FROM entities")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<HashSet<_>, _>>()?;
        let transaction = connection.transaction()?;
        for entry in entries {
            if !existing.contains(&entry.id) {
                Self::save_vocabulary_transaction(&transaction, entry)?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    fn save_vocabulary_transaction(
        transaction: &Transaction<'_>,
        mut entry: VocabularyEntry,
    ) -> Result<()> {
        if !Self::valid_document_id(&entry.id) {
            bail!("单词 ID 无效")
        }
        entry.lemma = entry.lemma.trim().to_owned();
        if entry.lemma.is_empty() {
            bail!("单词不能为空")
        }
        entry.language = if entry.language.trim().is_empty() {
            "英语".into()
        } else {
            entry.language.trim().to_owned()
        };
        if entry.created_at.trim().is_empty() {
            entry.created_at = Utc::now().to_rfc3339();
        }
        if entry.updated_at.trim().is_empty() {
            entry.updated_at = Utc::now().to_rfc3339();
        }
        for sense in &mut entry.senses {
            if !Self::valid_document_id(&sense.id) {
                bail!("词义 ID 无效")
            }
            sense.part_of_speech = sense.part_of_speech.trim().to_owned();
            sense.definition = sense.definition.trim().to_owned();
            sense.examples.retain(|item| !item.trim().is_empty());
            sense.collocations.retain(|item| !item.trim().is_empty());
            sense.synonyms.retain(|item| !item.trim().is_empty());
            sense.review_facets.retain(|facet, review| {
                matches!(facet.as_str(), "spelling" | "example")
                    && review.get("due").and_then(|value| value.as_str()).is_some()
            });
            sense.review_enabled = sense.review.is_some() || !sense.review_facets.is_empty();
        }
        if entry
            .senses
            .iter()
            .map(|sense| sense.id.as_str())
            .collect::<HashSet<_>>()
            .len()
            != entry.senses.len()
        {
            bail!("单词包含重复的词义 ID")
        }

        let metadata = json!({
            "language": entry.language,
            "pronunciation": entry.pronunciation,
            "forms": entry.forms,
        });
        let metadata_json = serde_json::to_string(&metadata)?;
        let search_body = entry
            .senses
            .iter()
            .flat_map(|sense| {
                std::iter::once(sense.part_of_speech.as_str())
                    .chain(std::iter::once(sense.definition.as_str()))
                    .chain(sense.examples.iter().map(String::as_str))
                    .chain(sense.collocations.iter().map(String::as_str))
                    .chain(sense.synonyms.iter().map(String::as_str))
            })
            .collect::<Vec<_>>()
            .join("\n");
        transaction.execute("\
            INSERT INTO entities(id, type, title, created_at, updated_at, metadata_json)
            VALUES (?1, 'word', ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
              type = 'word', title = excluded.title, updated_at = excluded.updated_at, metadata_json = excluded.metadata_json
        ", (&entry.id, &entry.lemma, &entry.created_at, &entry.updated_at, &metadata_json))?;
        transaction.execute("\
            INSERT INTO vocabulary_entries(entity_id, lemma, language, pronunciation, forms_json)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(entity_id) DO UPDATE SET
              lemma = excluded.lemma, language = excluded.language, pronunciation = excluded.pronunciation, forms_json = excluded.forms_json
        ", (&entry.id, &entry.lemma, &entry.language, &entry.pronunciation, serde_json::to_string(&entry.forms)?))?;
        transaction.execute(
            "DELETE FROM vocabulary_senses WHERE word_id = ?1",
            [&entry.id],
        )?;
        transaction.execute(
            "DELETE FROM review_cards WHERE entity_id = ?1 AND facet LIKE 'sense:%'",
            [&entry.id],
        )?;
        for sense in &entry.senses {
            transaction.execute("INSERT INTO vocabulary_senses(id, word_id, part_of_speech, definition, examples_json, collocations_json, synonyms_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                (&sense.id, &entry.id, &sense.part_of_speech, &sense.definition, serde_json::to_string(&sense.examples)?, serde_json::to_string(&sense.collocations)?, serde_json::to_string(&sense.synonyms)?))?;
            if sense.review_enabled {
                if let Some(review) = sense.review.as_ref() {
                    let due = review.get("due").and_then(|value| value.as_str());
                    transaction.execute("\
                        INSERT INTO review_cards(id, entity_id, facet, due, fsrs_state, created_at, updated_at)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                    ", (format!("{}:sense:{}", entry.id, sense.id), &entry.id, format!("sense:{}", sense.id), due, serde_json::to_string(review)?, &entry.created_at, &entry.updated_at))?;
                }
                for facet in ["spelling", "example"] {
                    if let Some(review) = sense.review_facets.get(facet) {
                        let due = review.get("due").and_then(|value| value.as_str());
                        transaction.execute("\
                            INSERT INTO review_cards(id, entity_id, facet, due, fsrs_state, created_at, updated_at)
                            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                        ", (format!("{}:sense:{}:{facet}", entry.id, sense.id), &entry.id, format!("sense:{}:{facet}", sense.id), due, serde_json::to_string(review)?, &entry.created_at, &entry.updated_at))?;
                    }
                }
            }
        }
        transaction.execute(
            "DELETE FROM documents_fts WHERE entity_id = ?1",
            [&entry.id],
        )?;
        transaction.execute(
            "INSERT INTO documents_fts(entity_id, title, body) VALUES (?1, ?2, ?3)",
            (
                &entry.id,
                &entry.lemma,
                Self::vocabulary_fts_body(
                    &entry.lemma,
                    &entry.language,
                    entry.pronunciation.as_deref(),
                    &entry.forms,
                    &search_body,
                ),
            ),
        )?;
        Ok(())
    }

    pub fn list_vocabulary(&self) -> Result<Vec<VocabularyEntry>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare("\
            SELECT vocabulary_entries.entity_id, vocabulary_entries.lemma, vocabulary_entries.language, vocabulary_entries.pronunciation,
                   vocabulary_entries.forms_json, entities.created_at, entities.updated_at,
                   vocabulary_senses.id, vocabulary_senses.part_of_speech, vocabulary_senses.definition,
                   vocabulary_senses.examples_json, vocabulary_senses.collocations_json, vocabulary_senses.synonyms_json,
                   meaning_review.fsrs_state, spelling_review.fsrs_state, example_review.fsrs_state
            FROM vocabulary_entries INNER JOIN entities ON entities.id = vocabulary_entries.entity_id
            LEFT JOIN vocabulary_senses ON vocabulary_senses.word_id = vocabulary_entries.entity_id
            LEFT JOIN review_cards AS meaning_review
              ON meaning_review.entity_id = vocabulary_senses.word_id AND meaning_review.facet = ('sense:' || vocabulary_senses.id)
            LEFT JOIN review_cards AS spelling_review
              ON spelling_review.entity_id = vocabulary_senses.word_id AND spelling_review.facet = ('sense:' || vocabulary_senses.id || ':spelling')
            LEFT JOIN review_cards AS example_review
              ON example_review.entity_id = vocabulary_senses.word_id AND example_review.facet = ('sense:' || vocabulary_senses.id || ':example')
            ORDER BY entities.updated_at DESC, vocabulary_entries.entity_id, vocabulary_senses.rowid
        ")?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, Option<String>>(12)?,
                row.get::<_, Option<String>>(13)?,
                row.get::<_, Option<String>>(14)?,
                row.get::<_, Option<String>>(15)?,
            ))
        })?;
        let mut entries = Vec::new();
        for row in rows {
            let (
                id,
                lemma,
                language,
                pronunciation,
                forms_json,
                created_at,
                updated_at,
                sense_id,
                part_of_speech,
                definition,
                examples_json,
                collocations_json,
                synonyms_json,
                review_json,
                spelling_review_json,
                example_review_json,
            ) = row?;
            if entries.last().map(|entry: &VocabularyEntry| &entry.id) != Some(&id) {
                entries.push(VocabularyEntry {
                    id,
                    lemma,
                    language,
                    pronunciation,
                    forms: serde_json::from_str(&forms_json).unwrap_or_else(|_| json!({})),
                    senses: Vec::new(),
                    created_at,
                    updated_at,
                });
            }
            let Some(sense_id) = sense_id else {
                continue;
            };
            let mut review_facets = HashMap::new();
            for (facet, state) in [
                ("spelling", spelling_review_json),
                ("example", example_review_json),
            ] {
                if let Some(value) = state.and_then(|value| serde_json::from_str(&value).ok()) {
                    review_facets.insert(facet.to_string(), value);
                }
            }
            let review_enabled = review_json.is_some() || !review_facets.is_empty();
            entries
                .last_mut()
                .expect("vocabulary entry exists")
                .senses
                .push(VocabularySense {
                    id: sense_id,
                    part_of_speech: part_of_speech.unwrap_or_default(),
                    definition: definition.unwrap_or_default(),
                    examples: examples_json
                        .as_deref()
                        .and_then(|value| serde_json::from_str(value).ok())
                        .unwrap_or_default(),
                    collocations: collocations_json
                        .as_deref()
                        .and_then(|value| serde_json::from_str(value).ok())
                        .unwrap_or_default(),
                    synonyms: synonyms_json
                        .as_deref()
                        .and_then(|value| serde_json::from_str(value).ok())
                        .unwrap_or_default(),
                    review_enabled,
                    review: review_json.and_then(|value| serde_json::from_str(&value).ok()),
                    review_facets,
                });
        }
        Ok(entries)
    }

    pub fn delete_vocabulary(&self, id: String) -> Result<()> {
        if !Self::valid_document_id(&id) {
            bail!("单词 ID 无效")
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM content_favorites WHERE item_kind = 'word' AND item_id = ?1",
            [&id],
        )?;
        transaction.execute(
            "DELETE FROM content_recents WHERE item_kind = 'word' AND item_id = ?1",
            [&id],
        )?;
        transaction.execute("DELETE FROM documents_fts WHERE entity_id = ?1", [&id])?;
        transaction.execute(
            "DELETE FROM entities WHERE id = ?1 AND type = 'word'",
            [&id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn replace_vocabulary(&self, entries: Vec<VocabularyEntry>) -> Result<()> {
        let incoming_ids: HashSet<String> = entries.iter().map(|entry| entry.id.clone()).collect();
        if incoming_ids.len() != entries.len() {
            bail!("备份中包含重复单词 ID")
        }
        let existing_ids = self
            .list_vocabulary()?
            .into_iter()
            .map(|entry| entry.id)
            .collect::<Vec<_>>();
        for id in existing_ids
            .into_iter()
            .filter(|id| !incoming_ids.contains(id))
        {
            self.delete_vocabulary(id)?;
        }
        for entry in entries {
            self.save_vocabulary(entry)?;
        }
        Ok(())
    }

    pub fn save_relation(&self, mut relation: VaultRelation) -> Result<()> {
        if !Self::valid_document_id(&relation.from_id)
            || !Self::valid_document_id(&relation.to_id)
            || relation.from_id == relation.to_id
        {
            bail!("关联实体无效")
        }
        if !matches!(
            relation.relation_type.as_str(),
            "related" | "prerequisite" | "variation"
        ) {
            bail!("关联类型无效")
        }
        if relation.created_at.trim().is_empty() {
            relation.created_at = Utc::now().to_rfc3339();
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        connection.execute(
            "\
            INSERT INTO relations(from_id, to_id, relation_type, created_at) VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(from_id, to_id, relation_type) DO NOTHING
        ",
            (
                &relation.from_id,
                &relation.to_id,
                &relation.relation_type,
                &relation.created_at,
            ),
        )?;
        Ok(())
    }

    pub fn delete_relation(&self, relation: VaultRelation) -> Result<()> {
        if !Self::valid_document_id(&relation.from_id) || !Self::valid_document_id(&relation.to_id)
        {
            bail!("关联实体无效")
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        connection.execute(
            "DELETE FROM relations WHERE from_id = ?1 AND to_id = ?2 AND relation_type = ?3",
            (&relation.from_id, &relation.to_id, &relation.relation_type),
        )?;
        Ok(())
    }

    pub fn list_relations(&self) -> Result<Vec<VaultRelation>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare("SELECT from_id, to_id, relation_type, created_at FROM relations ORDER BY created_at DESC")?;
        let rows = statement.query_map([], |row| {
            Ok(VaultRelation {
                from_id: row.get(0)?,
                to_id: row.get(1)?,
                relation_type: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn replace_relations(&self, relations: Vec<VaultRelation>) -> Result<()> {
        let unique = relations
            .iter()
            .map(|relation| {
                (
                    relation.from_id.as_str(),
                    relation.to_id.as_str(),
                    relation.relation_type.as_str(),
                )
            })
            .collect::<HashSet<_>>();
        if unique.len() != relations.len() {
            bail!("备份中包含重复关联")
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        connection.execute("DELETE FROM relations", [])?;
        drop(connection);
        for relation in relations {
            self.save_relation(relation)?;
        }
        Ok(())
    }

    fn normalize_event(event: &mut VaultEvent) -> Result<()> {
        if !Self::valid_document_id(&event.id) {
            bail!("事件 ID 无效")
        }
        if !matches!(
            event.event_type.as_str(),
            "pomodoro" | "anniversary" | "activity"
        ) {
            bail!("事件类型无效")
        }
        if event.starts_at.trim().is_empty() {
            bail!("事件开始时间不能为空")
        }
        if !event.payload.is_object() {
            bail!("事件内容必须是对象")
        }
        if serde_json::to_vec(&event.payload)?.len() > 128 * 1024 {
            bail!("事件内容超过 128 KB")
        }
        let now = Utc::now().to_rfc3339();
        if event.created_at.trim().is_empty() {
            event.created_at = now.clone();
        }
        if event.updated_at.trim().is_empty() {
            event.updated_at = now;
        }
        Ok(())
    }

    pub fn save_event(&self, mut event: VaultEvent) -> Result<()> {
        Self::normalize_event(&mut event)?;
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        connection.execute(
            "\
            INSERT INTO events(id, type, starts_at, payload_json, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
              type = excluded.type,
              starts_at = excluded.starts_at,
              payload_json = excluded.payload_json,
              updated_at = excluded.updated_at
        ",
            (
                &event.id,
                &event.event_type,
                &event.starts_at,
                serde_json::to_string(&event.payload)?,
                &event.created_at,
                &event.updated_at,
            ),
        )?;
        if event.event_type == "activity" {
            connection.execute(
                "DELETE FROM events WHERE type = 'activity' AND id NOT IN (SELECT id FROM events WHERE type = 'activity' ORDER BY starts_at DESC, updated_at DESC LIMIT 300)",
                [],
            )?;
        }
        Ok(())
    }

    /// Browser backups contain only the activity feed. Replacing this subtype
    /// must never clear independent focus or anniversary records.
    pub fn replace_activity_events(&self, mut events: Vec<VaultEvent>) -> Result<()> {
        events.truncate(300);
        for event in &mut events {
            if event.event_type != "activity" {
                bail!("活动日志只能包含 activity 事件")
            }
            Self::normalize_event(event)?;
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let transaction = connection.transaction()?;
        transaction.execute("DELETE FROM events WHERE type = 'activity'", [])?;
        for event in events {
            transaction.execute(
                "INSERT INTO events(id, type, starts_at, payload_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                (
                    &event.id,
                    &event.event_type,
                    &event.starts_at,
                    serde_json::to_string(&event.payload)?,
                    &event.created_at,
                    &event.updated_at,
                ),
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    fn list_events_query(
        &self,
        sql: &str,
        parameters: impl rusqlite::Params,
    ) -> Result<Vec<VaultEvent>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(sql)?;
        let rows = statement.query_map(parameters, |row| {
            let payload_json: String = row.get(3)?;
            Ok(VaultEvent {
                id: row.get(0)?,
                event_type: row.get(1)?,
                starts_at: row.get(2)?,
                payload: serde_json::from_str(&payload_json).unwrap_or_else(|_| json!({})),
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn list_events(&self, limit: usize) -> Result<Vec<VaultEvent>> {
        let safe_limit = i64::try_from(limit.clamp(1, 300)).unwrap_or(100);
        self.list_events_query(
            "SELECT id, type, starts_at, payload_json, created_at, updated_at FROM events ORDER BY starts_at DESC, updated_at DESC LIMIT ?1",
            [safe_limit],
        )
    }

    fn list_events_by_type(&self, event_type: &str, limit: usize) -> Result<Vec<VaultEvent>> {
        let safe_limit = i64::try_from(limit.clamp(1, 300)).unwrap_or(100);
        self.list_events_query(
            "SELECT id, type, starts_at, payload_json, created_at, updated_at FROM events WHERE type = ?1 ORDER BY starts_at DESC, updated_at DESC LIMIT ?2",
            rusqlite::params![event_type, safe_limit],
        )
    }

    /// Personal records and the high-churn application activity feed must not
    /// compete for one global LIMIT. Return a bounded slice for each personal
    /// subtype so an old recurring anniversary remains visible after hundreds
    /// of ordinary edits, captures and tool runs.
    pub fn list_personal_events(&self, limit_per_type: usize) -> Result<Vec<VaultEvent>> {
        let mut events = self.list_events_by_type("pomodoro", limit_per_type)?;
        events.extend(self.list_events_by_type("anniversary", limit_per_type)?);
        events.sort_by(|left, right| {
            right
                .starts_at
                .cmp(&left.starts_at)
                .then_with(|| right.updated_at.cmp(&left.updated_at))
        });
        Ok(events)
    }

    pub fn list_activity_events(&self, limit: usize) -> Result<Vec<VaultEvent>> {
        self.list_events_by_type("activity", limit)
    }

    pub fn delete_event(&self, id: String) -> Result<()> {
        if !Self::valid_document_id(&id) {
            bail!("事件 ID 无效")
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        connection.execute("DELETE FROM events WHERE id = ?1", [&id])?;
        Ok(())
    }

    fn visual_project_image_format(data: &[u8]) -> Result<(&'static str, &'static str)> {
        match image::guess_format(data).context("无法识别画布源图格式")? {
            image::ImageFormat::Png => Ok(("png", "image/png")),
            image::ImageFormat::Jpeg => Ok(("jpg", "image/jpeg")),
            image::ImageFormat::WebP => Ok(("webp", "image/webp")),
            image::ImageFormat::Gif => Ok(("gif", "image/gif")),
            image::ImageFormat::Bmp => Ok(("bmp", "image/bmp")),
            _ => bail!("画布项目仅支持 PNG、JPG、WebP、GIF 和 BMP 源图"),
        }
    }

    fn visual_project_asset_directory(&self, id: &str) -> Result<PathBuf> {
        if !Self::valid_document_id(id) {
            bail!("画布项目 ID 无效")
        }
        self.source_asset_path(&format!("assets/diagrams/{id}"))
    }

    /// Store one source image through Tauri's raw IPC body. This avoids the
    /// several-fold memory expansion of serializing binary bytes as JSON
    /// numbers. The following metadata save only references this validated
    /// project-scoped asset.
    pub fn stage_visual_project_image(
        &self,
        project_id: &str,
        name: &str,
        declared_mime: &str,
        data: &[u8],
    ) -> Result<VisualProjectImageInput> {
        if !Self::valid_document_id(project_id) {
            bail!("画布项目 ID 无效")
        }
        if data.is_empty() || data.len() > VISUAL_PROJECT_IMAGE_MAX_BYTES {
            bail!("单张画布源图需要小于 32 MB")
        }
        if !declared_mime.is_empty() && !declared_mime.starts_with("image/") {
            bail!("画布项目包含非图片文件")
        }
        let (extension, mime) = Self::visual_project_image_format(data)?;
        let sha256 = format!("{:x}", Sha256::digest(data));
        let filename = format!("{}.{}", &sha256[..24], extension);
        let asset_path = format!("assets/diagrams/{project_id}/{filename}");
        let destination = self.source_asset_path(&asset_path)?;
        let directory = self.visual_project_asset_directory(project_id)?;
        fs::create_dir_all(&directory)?;
        if !destination.is_file() {
            let staging = directory.join(format!(".{filename}.{}.staging", Uuid::now_v7()));
            let mut file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&staging)?;
            let write_result = file.write_all(data).and_then(|_| file.sync_all());
            drop(file);
            if let Err(error) = write_result {
                let _ = fs::remove_file(&staging);
                return Err(error.into());
            }
            if let Err(error) = fs::rename(&staging, &destination) {
                let _ = fs::remove_file(&staging);
                if !destination.is_file() {
                    return Err(error.into());
                }
            }
        }
        let display_name = Path::new(name)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("画布源图")
            .chars()
            .take(180)
            .collect::<String>();
        Ok(VisualProjectImageInput {
            name: display_name,
            mime: mime.to_string(),
            asset_path,
            size: data.len() as u64,
            sha256,
        })
    }

    pub fn save_visual_project(&self, project: VisualProjectInput) -> Result<VaultVisualProject> {
        if !Self::valid_document_id(&project.id) {
            bail!("画布项目 ID 无效")
        }
        let title = project.title.trim();
        if title.is_empty() || title.chars().count() > 120 {
            bail!("画布项目名称需要在 1–120 个字符之间")
        }
        if !matches!(project.layout.as_str(), "single" | "pair" | "grid") {
            bail!("画布布局无效")
        }
        if project.canvas_title.chars().count() > 160 || project.watermark.chars().count() > 160 {
            bail!("画布标题或署名过长")
        }
        if project.background.len() != 7
            || !project.background.starts_with('#')
            || !project.background[1..]
                .chars()
                .all(|value| value.is_ascii_hexdigit())
        {
            bail!("画布背景颜色无效")
        }
        if project.images.is_empty() || project.images.len() > VISUAL_PROJECT_IMAGE_LIMIT {
            bail!("一个画布项目需要包含 1–4 张源图")
        }
        let annotation_bytes = serde_json::to_vec(&project.annotations)?;
        if annotation_bytes.len() > VISUAL_PROJECT_ANNOTATION_MAX_BYTES
            || !project.annotations.is_array()
        {
            bail!("画布标注数据无效或超过 256 KB")
        }
        let annotation_count = project
            .annotations
            .as_array()
            .map(Vec::len)
            .unwrap_or_default();
        if annotation_count > 500 {
            bail!("单个画布项目最多保存 500 个标注")
        }
        let total_bytes = project.images.iter().try_fold(0u64, |total, image| {
            if image.size == 0 || image.size > VISUAL_PROJECT_IMAGE_MAX_BYTES as u64 {
                bail!("单张画布源图需要小于 32 MB")
            }
            total.checked_add(image.size).context("画布源图总体积无效")
        })?;
        if total_bytes > VISUAL_PROJECT_TOTAL_MAX_BYTES as u64 {
            bail!("一个画布项目的源图总量不能超过 96 MB")
        }

        let now = Utc::now().to_rfc3339();
        let created_at = project
            .created_at
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| now.clone());
        let directory = self.visual_project_asset_directory(&project.id)?;
        let mut stored_images = Vec::with_capacity(project.images.len());
        let mut relative_paths = HashSet::new();
        for image in project.images {
            if !matches!(
                image.mime.as_str(),
                "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/bmp"
            ) {
                bail!("画布项目包含非图片文件")
            }
            let expected_prefix = format!("assets/diagrams/{}/", project.id);
            if !image.asset_path.starts_with(&expected_prefix)
                || image.sha256.len() != 64
                || !image.sha256.chars().all(|value| value.is_ascii_hexdigit())
                || !image.asset_path[expected_prefix.len()..].starts_with(&image.sha256[..24])
            {
                bail!("画布源图引用无效")
            }
            let destination = self.source_asset_path(&image.asset_path)?;
            let actual_size = fs::metadata(&destination)
                .with_context(|| "画布源图暂存文件不存在")?
                .len();
            if actual_size != image.size {
                bail!("画布源图暂存文件大小已变化")
            }
            relative_paths.insert(image.asset_path.clone());
            stored_images.push((
                image.name,
                image.mime,
                image.asset_path,
                image.size,
                image.sha256,
            ));
        }

        let metadata_images = stored_images
            .iter()
            .map(|(name, mime, path, size, _)| json!({ "name": name, "mime": mime, "path": path, "size": size }))
            .collect::<Vec<_>>();
        let metadata = json!({
            "canvasTitle": project.canvas_title,
            "layout": project.layout,
            "background": project.background,
            "watermark": project.watermark,
            "annotations": project.annotations,
            "images": metadata_images,
        });

        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let existing_type: Option<String> = connection
            .query_row(
                "SELECT type FROM entities WHERE id = ?1",
                [&project.id],
                |row| row.get(0),
            )
            .optional()?;
        if existing_type
            .as_deref()
            .is_some_and(|kind| kind != "diagram")
        {
            bail!("当前 ID 已被其他资料占用")
        }
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO entities(id, type, title, created_at, updated_at, metadata_json) VALUES (?1, 'diagram', ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at, metadata_json = excluded.metadata_json",
            (&project.id, title, &created_at, &now, serde_json::to_string(&metadata)?),
        )?;
        transaction.execute(
            "DELETE FROM attachments WHERE entity_id = ?1",
            [&project.id],
        )?;
        for (_, mime, relative, _, hash) in &stored_images {
            transaction.execute(
                "INSERT INTO attachments(id, entity_id, path, mime, sha256, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                (Uuid::now_v7().to_string(), &project.id, relative, mime, hash, &now),
            )?;
        }
        transaction.commit()?;

        // Assets no longer referenced by the latest project snapshot are safe
        // to remove only after the database transaction succeeds.
        for entry in fs::read_dir(&directory)?.filter_map(std::result::Result::ok) {
            let path = entry.path();
            let relative = path
                .strip_prefix(&self.root)
                .ok()
                .map(|value| value.to_string_lossy().replace('\\', "/"));
            if path.is_file()
                && !relative
                    .as_ref()
                    .is_some_and(|value| relative_paths.contains(value))
            {
                let _ = fs::remove_file(path);
            }
        }
        self.get_visual_project(project.id)
    }

    pub fn list_visual_projects(&self, limit: usize) -> Result<Vec<VisualProjectSummary>> {
        let connection = self.connection()?;
        let safe_limit = i64::try_from(limit.clamp(1, 100)).unwrap_or(40);
        let mut statement = connection.prepare(
            "SELECT id, title, metadata_json, updated_at FROM entities WHERE type = 'diagram' ORDER BY updated_at DESC LIMIT ?1",
        )?;
        let rows = statement.query_map([safe_limit], |row| {
            let metadata_json: String = row.get(2)?;
            let metadata: serde_json::Value =
                serde_json::from_str(&metadata_json).unwrap_or_else(|_| json!({}));
            Ok(VisualProjectSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                image_count: metadata
                    .get("images")
                    .and_then(|value| value.as_array())
                    .map(Vec::len)
                    .unwrap_or_default(),
                annotation_count: metadata
                    .get("annotations")
                    .and_then(|value| value.as_array())
                    .map(Vec::len)
                    .unwrap_or_default(),
                updated_at: row.get(3)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn get_visual_project(&self, id: String) -> Result<VaultVisualProject> {
        if !Self::valid_document_id(&id) {
            bail!("画布项目 ID 无效")
        }
        let connection = self.connection()?;
        let (title, metadata_json, created_at, updated_at): (String, String, String, String) =
            connection
                .query_row(
                    "SELECT title, metadata_json, created_at, updated_at FROM entities WHERE id = ?1 AND type = 'diagram'",
                    [&id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .context("画布项目不存在")?;
        let metadata: serde_json::Value = serde_json::from_str(&metadata_json)?;
        let registered = {
            let mut statement = connection.prepare(
                "SELECT path, mime FROM attachments WHERE entity_id = ?1 AND mime LIKE 'image/%'",
            )?;
            let rows = statement
                .query_map([&id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<std::result::Result<HashMap<_, _>, _>>()?;
            rows
        };
        let mut images = Vec::new();
        for value in metadata
            .get("images")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            let relative = value
                .get("path")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let Some(mime) = registered.get(relative) else {
                continue;
            };
            let path = self.source_asset_path(relative)?;
            if !path.is_file() {
                continue;
            }
            images.push(VisualProjectImage {
                name: value
                    .get("name")
                    .and_then(|value| value.as_str())
                    .unwrap_or("画布源图")
                    .to_string(),
                mime: mime.clone(),
                size: fs::metadata(&path)?.len(),
                path: path.to_string_lossy().into_owned(),
            });
        }
        Ok(VaultVisualProject {
            id,
            title,
            canvas_title: metadata
                .get("canvasTitle")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string(),
            layout: metadata
                .get("layout")
                .and_then(|value| value.as_str())
                .filter(|value| matches!(*value, "single" | "pair" | "grid"))
                .unwrap_or("single")
                .to_string(),
            background: metadata
                .get("background")
                .and_then(|value| value.as_str())
                .unwrap_or("#172321")
                .to_string(),
            watermark: metadata
                .get("watermark")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string(),
            annotations: metadata
                .get("annotations")
                .cloned()
                .filter(|value| value.is_array())
                .unwrap_or_else(|| json!([])),
            images,
            created_at,
            updated_at,
        })
    }

    pub fn delete_visual_project(&self, id: String) -> Result<()> {
        if !Self::valid_document_id(&id) {
            bail!("画布项目 ID 无效")
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM content_favorites WHERE item_kind = 'diagram' AND item_id = ?1",
            [&id],
        )?;
        transaction.execute(
            "DELETE FROM content_recents WHERE item_kind = 'diagram' AND item_id = ?1",
            [&id],
        )?;
        transaction.execute(
            "DELETE FROM entities WHERE id = ?1 AND type = 'diagram'",
            [&id],
        )?;
        transaction.commit()?;
        let directory = self.visual_project_asset_directory(&id)?;
        if directory.is_dir() {
            fs::remove_dir_all(directory)?;
        }
        Ok(())
    }

    pub fn delete_document(&self, id: String) -> Result<()> {
        if !Self::valid_document_id(&id) {
            bail!("文档 ID 无效")
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM content_favorites WHERE item_kind IN ('note', 'question') AND item_id = ?1",
            [&id],
        )?;
        transaction.execute(
            "DELETE FROM content_recents WHERE item_kind IN ('note', 'question') AND item_id = ?1",
            [&id],
        )?;
        transaction.execute("DELETE FROM entities WHERE id = ?1", [&id])?;
        transaction.commit()?;
        for kind in ["note", "question"] {
            let path = self.document_path(&id, kind)?;
            if path.is_file() {
                fs::remove_file(path)?;
            }
        }
        let attachment_directory = self.source_asset_path(&format!("assets/questions/{id}"))?;
        if attachment_directory.is_dir() {
            fs::remove_dir_all(attachment_directory)?;
        }
        Ok(())
    }

    pub fn search_documents(&self, query: String, limit: usize) -> Result<Vec<VaultSearchResult>> {
        let fts_query = Self::fts_query(&query);
        if fts_query.is_empty() {
            return Ok(Vec::new());
        }
        let connection = self.connection()?;
        let mut statement = connection.prepare("\
            SELECT id, title, kind, metadata_json, updated_at, snippet, source_kind
            FROM (
              SELECT documents_fts.entity_id AS id,
                     entities.title AS title,
                     COALESCE(documents.kind, entities.type) AS kind,
                     entities.metadata_json AS metadata_json,
                     entities.updated_at AS updated_at,
                     snippet(documents_fts, 2, '[', ']', '…', 18) AS snippet,
                     bm25(documents_fts) AS rank,
                     '' AS source_kind
              FROM documents_fts
              INNER JOIN entities ON entities.id = documents_fts.entity_id
              LEFT JOIN documents ON documents.entity_id = documents_fts.entity_id
              WHERE documents_fts MATCH ?1 AND entities.type IN ('document', 'question', 'word')
              UNION ALL
              SELECT sources_fts.source_id AS id,
                     source_records.name AS title,
                     'source' AS kind,
                     source_records.tags_json AS metadata_json,
                     COALESCE(source_records.last_opened_at, source_records.imported_at) AS updated_at,
                     snippet(sources_fts, 2, '[', ']', '…', 18) AS snippet,
                     bm25(sources_fts) AS rank,
                     source_records.kind AS source_kind
              FROM sources_fts
              INNER JOIN source_records ON source_records.id = sources_fts.source_id
              WHERE sources_fts MATCH ?1
            )
            ORDER BY rank, updated_at DESC
            LIMIT ?2
        ")?;
        let rows = statement.query_map((fts_query, limit.clamp(1, 30) as i64), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;
        let mut results = Vec::new();
        for row in rows {
            let (id, title, kind, metadata_json, updated_at, snippet, source_kind) = row?;
            let metadata: serde_json::Value =
                serde_json::from_str(&metadata_json).unwrap_or_else(|_| {
                    if kind == "source" {
                        json!([])
                    } else {
                        json!({})
                    }
                });
            let tags = if kind == "source" {
                metadata
                    .as_array()
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|value| value.as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default()
            } else {
                metadata
                    .get("tags")
                    .and_then(|value| value.as_array())
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|value| value.as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default()
            };
            let snippet = if snippet.trim().is_empty() && kind == "source" {
                title.clone()
            } else {
                snippet
            };
            results.push(VaultSearchResult {
                id,
                title,
                kind: kind.clone(),
                subject: if kind == "source" {
                    source_kind
                } else {
                    metadata
                        .get("subject")
                        .or_else(|| metadata.get("language"))
                        .and_then(|value| value.as_str())
                        .unwrap_or("未分类")
                        .to_owned()
                },
                tags,
                updated_at,
                snippet,
            });
        }
        Ok(results)
    }

    /// Backlinks use the save-time link index rather than scanning hydrated
    /// Markdown in Vue or running instr() across every SQLite body.
    pub fn find_wiki_backlinks(
        &self,
        target_title: String,
        exclude_id: String,
        limit: usize,
    ) -> Result<Vec<VaultSearchResult>> {
        let target_title = target_title.trim();
        if target_title.is_empty() {
            return Ok(Vec::new());
        }
        let connection = self.connection()?;
        let mut statement = connection.prepare("\
            SELECT DISTINCT entities.id, entities.title, documents.kind, entities.metadata_json, entities.updated_at
            FROM document_wiki_links
            INNER JOIN documents ON documents.entity_id = document_wiki_links.from_id
            INNER JOIN entities ON entities.id = documents.entity_id
            WHERE document_wiki_links.target_key = ?1 AND entities.id != ?2
            ORDER BY entities.updated_at DESC
            LIMIT ?3
        ")?;
        let rows = statement.query_map(
            (
                Self::normalize_wiki_title(target_title),
                exclude_id,
                limit.clamp(1, 30) as i64,
            ),
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )?;
        let mut results = Vec::new();
        for row in rows {
            let (id, title, kind, metadata_json, updated_at) = row?;
            let metadata: serde_json::Value =
                serde_json::from_str(&metadata_json).unwrap_or_else(|_| json!({}));
            let tags = metadata
                .get("tags")
                .and_then(|value| value.as_array())
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|value| value.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default();
            results.push(VaultSearchResult {
                id,
                title,
                kind,
                subject: metadata
                    .get("subject")
                    .and_then(|value| value.as_str())
                    .unwrap_or("未分类")
                    .to_owned(),
                tags,
                updated_at,
                snippet: format!("[[{target_title}]]"),
            });
        }
        Ok(results)
    }

    /// Returns a bounded metadata projection for the global knowledge graph.
    /// Link extraction happens on document save; this path never reads a
    /// Markdown file or content_text and resolves only exact unique titles.
    pub fn list_wiki_links(&self, limit: usize) -> Result<VaultWikiLinkProjection> {
        const WIKI_LINK_SCAN_LIMIT: usize = 10_000;
        let limit = limit.clamp(1, 2_000);
        let connection = self.connection()?;
        let document_titles = {
            let mut statement = connection.prepare(
                "SELECT entities.id, entities.title FROM documents INNER JOIN entities ON entities.id = documents.entity_id ORDER BY entities.id",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };
        let mut targets_by_key: HashMap<String, Vec<String>> = HashMap::new();
        for (id, title) in document_titles {
            targets_by_key
                .entry(Self::normalize_wiki_title(&title))
                .or_default()
                .push(id);
        }
        let rows = {
            let mut statement = connection.prepare(
                "SELECT document_wiki_links.from_id, document_wiki_links.target_title, document_wiki_links.target_key, document_wiki_links.heading, entities.updated_at
                 FROM document_wiki_links
                 INNER JOIN entities ON entities.id = document_wiki_links.from_id
                 ORDER BY entities.updated_at DESC, document_wiki_links.from_id, document_wiki_links.ordinal
                 LIMIT ?1",
            )?;
            let rows = statement
                .query_map([(WIKI_LINK_SCAN_LIMIT + 1) as i64], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };
        let mut links: Vec<VaultWikiLink> = Vec::new();
        let mut link_indexes: HashMap<(String, String), usize> = HashMap::new();
        let mut unresolved_count = 0usize;
        let mut ambiguous_count = 0usize;
        let mut truncated = rows.len() > WIKI_LINK_SCAN_LIMIT;
        for (from_id, target_title, target_key, heading, source_updated_at) in
            rows.into_iter().take(WIKI_LINK_SCAN_LIMIT)
        {
            let Some(targets) = targets_by_key.get(&target_key) else {
                unresolved_count += 1;
                continue;
            };
            if targets.len() != 1 {
                ambiguous_count += 1;
                continue;
            }
            let to_id = targets[0].clone();
            if to_id == from_id {
                continue;
            }
            let pair = (from_id.clone(), to_id.clone());
            if let Some(index) = link_indexes.get(&pair).copied() {
                let link = &mut links[index];
                link.occurrences += 1;
                if let Some(heading) = heading {
                    if link.headings.len() < 8 && !link.headings.contains(&heading) {
                        link.headings.push(heading);
                    }
                }
                continue;
            }
            if links.len() >= limit {
                truncated = true;
                break;
            }
            let headings = heading.into_iter().collect();
            link_indexes.insert(pair, links.len());
            links.push(VaultWikiLink {
                from_id,
                to_id,
                target_title,
                headings,
                occurrences: 1,
                source_updated_at,
            });
        }
        Ok(VaultWikiLinkProjection {
            links,
            unresolved_count,
            ambiguous_count,
            truncated,
        })
    }

    /// Explicit restore semantics: only this method removes documents that are
    /// absent from the incoming backup. Ordinary saves never erase siblings.
    pub fn replace_documents(&self, documents: Vec<VaultDocument>) -> Result<()> {
        let incoming_ids: HashSet<String> = documents
            .iter()
            .map(|document| document.id.clone())
            .collect();
        if incoming_ids.len() != documents.len() {
            bail!("备份中包含重复文档 ID")
        }
        let existing_ids = self
            .list_documents()?
            .into_iter()
            .map(|document| document.id)
            .collect::<Vec<_>>();
        for document in documents {
            self.save_document(document)?;
        }
        for id in existing_ids {
            if !incoming_ids.contains(&id) {
                self.delete_document(id)?;
            }
        }
        Ok(())
    }

    fn content_pointer_item_exists(
        connection: &rusqlite::Connection,
        item_kind: &str,
        item_id: &str,
    ) -> Result<bool> {
        let exists = match item_kind {
            "note" => connection.query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM documents
                   INNER JOIN entities ON entities.id = documents.entity_id
                   WHERE documents.entity_id = ?1 AND documents.kind = 'note' AND entities.type = 'document'
                 )",
                [item_id],
                |row| row.get(0),
            )?,
            "question" => connection.query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM documents
                   INNER JOIN entities ON entities.id = documents.entity_id
                   WHERE documents.entity_id = ?1 AND documents.kind = 'question' AND entities.type = 'question'
                 )",
                [item_id],
                |row| row.get(0),
            )?,
            "word" => connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM vocabulary_entries WHERE entity_id = ?1)",
                [item_id],
                |row| row.get(0),
            )?,
            "source" => connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM source_records WHERE id = ?1)",
                [item_id],
                |row| row.get(0),
            )?,
            "diagram" => connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM entities WHERE id = ?1 AND type = 'diagram')",
                [item_id],
                |row| row.get(0),
            )?,
            _ => bail!("不支持的内容类型"),
        };
        Ok(exists)
    }

    pub fn list_content_favorites(&self) -> Result<Vec<ContentFavorite>> {
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let mut statement = connection.prepare(
            "SELECT item_id, item_kind, added_at
             FROM content_favorites
             ORDER BY added_at DESC
             LIMIT ?1",
        )?;
        let rows = statement.query_map([CONTENT_FAVORITE_LIMIT], |row| {
            Ok(ContentFavorite {
                item_id: row.get(0)?,
                item_kind: row.get(1)?,
                added_at: row.get(2)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn set_content_favorite(
        &self,
        item_id: String,
        item_kind: String,
        favorite: bool,
    ) -> Result<Option<ContentFavorite>> {
        if !Self::valid_document_id(&item_id) {
            bail!("收藏内容 ID 无效")
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        if !favorite {
            connection.execute(
                "DELETE FROM content_favorites WHERE item_kind = ?1 AND item_id = ?2",
                (&item_kind, &item_id),
            )?;
            return Ok(None);
        }
        if !Self::content_pointer_item_exists(&connection, &item_kind, &item_id)? {
            bail!("要收藏的本地内容已经不存在")
        }
        let already_favorite: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM content_favorites WHERE item_kind = ?1 AND item_id = ?2)",
            (&item_kind, &item_id),
            |row| row.get(0),
        )?;
        if !already_favorite {
            let count: i64 =
                connection.query_row("SELECT COUNT(*) FROM content_favorites", [], |row| {
                    row.get(0)
                })?;
            if count >= CONTENT_FAVORITE_LIMIT {
                bail!("内容收藏最多保留 256 项")
            }
        }
        let added_at = Utc::now().to_rfc3339();
        connection.execute(
            "INSERT INTO content_favorites(item_kind, item_id, added_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(item_kind, item_id) DO UPDATE SET added_at = excluded.added_at",
            (&item_kind, &item_id, &added_at),
        )?;
        Ok(Some(ContentFavorite {
            item_id,
            item_kind,
            added_at,
        }))
    }

    /// Replaces the complete bounded pointer set during an explicit JSON
    /// backup restore. All rows are validated before the transaction mutates
    /// the database; pointers to content no longer present in the restored
    /// Vault are deliberately skipped.
    pub fn replace_content_favorites(
        &self,
        favorites: Vec<ContentFavorite>,
    ) -> Result<Vec<ContentFavorite>> {
        if favorites.len() > CONTENT_FAVORITE_LIMIT as usize {
            bail!("内容收藏最多保留 256 项")
        }
        let unique = favorites
            .iter()
            .map(|favorite| (favorite.item_kind.as_str(), favorite.item_id.as_str()))
            .collect::<HashSet<_>>();
        if unique.len() != favorites.len() {
            bail!("备份中包含重复内容收藏")
        }
        for favorite in &favorites {
            if !Self::valid_document_id(&favorite.item_id) {
                bail!("收藏内容 ID 无效")
            }
            if !matches!(
                favorite.item_kind.as_str(),
                "note" | "question" | "word" | "source" | "diagram"
            ) {
                bail!("不支持的收藏内容类型")
            }
            if favorite.added_at.trim().is_empty() || favorite.added_at.len() > 64 {
                bail!("收藏时间无效")
            }
        }

        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let transaction = connection.transaction()?;
        let mut retained = Vec::with_capacity(favorites.len());
        for favorite in favorites {
            if Self::content_pointer_item_exists(
                &transaction,
                &favorite.item_kind,
                &favorite.item_id,
            )? {
                retained.push(favorite);
            }
        }
        transaction.execute("DELETE FROM content_favorites", [])?;
        for favorite in &retained {
            transaction.execute(
                "INSERT INTO content_favorites(item_kind, item_id, added_at) VALUES (?1, ?2, ?3)",
                (&favorite.item_kind, &favorite.item_id, &favorite.added_at),
            )?;
        }
        transaction.commit()?;
        drop(connection);
        self.list_content_favorites()
    }

    pub fn hydrate_content_favorites(
        &self,
        browser_favorites: Vec<ContentFavorite>,
    ) -> Result<Vec<ContentFavorite>> {
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let already_migrated: Option<String> = connection
            .query_row(
                "SELECT value FROM vault_meta WHERE key = 'browser-content-favorites-migration-v1'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        // INSERT OR IGNORE makes this resumable after an interrupted startup;
        // a non-empty pointer table does not prove that every browser pointer
        // was imported.
        if already_migrated.is_none() && !browser_favorites.is_empty() {
            let migration_directory = self.root.join(".toolknit/migrations");
            fs::create_dir_all(&migration_directory)?;
            let archive = migration_directory.join(format!(
                "browser-content-favorites-before-vault-{}.json",
                Utc::now().format("%Y%m%d-%H%M%S")
            ));
            fs::write(&archive, serde_json::to_vec_pretty(&browser_favorites)?)?;
            for item in browser_favorites
                .into_iter()
                .take(CONTENT_FAVORITE_LIMIT as usize)
            {
                if !Self::valid_document_id(&item.item_id)
                    || !Self::content_pointer_item_exists(
                        &connection,
                        &item.item_kind,
                        &item.item_id,
                    )?
                {
                    continue;
                }
                connection.execute(
                    "INSERT OR IGNORE INTO content_favorites(item_kind, item_id, added_at) VALUES (?1, ?2, ?3)",
                    (&item.item_kind, &item.item_id, &item.added_at),
                )?;
            }
        }
        if already_migrated.is_none() {
            connection.execute(
                "INSERT INTO vault_meta(key, value, updated_at) VALUES ('browser-content-favorites-migration-v1', 'complete', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                [Utc::now().to_rfc3339()],
            )?;
        }
        drop(connection);
        self.list_content_favorites()
    }

    pub fn list_content_recents(&self) -> Result<Vec<ContentRecent>> {
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let mut statement = connection.prepare(
            "SELECT item_id, item_kind, opened_at
             FROM content_recents
             ORDER BY opened_at DESC, rowid DESC
             LIMIT ?1",
        )?;
        let rows = statement.query_map([CONTENT_RECENT_LIMIT], |row| {
            Ok(ContentRecent {
                item_id: row.get(0)?,
                item_kind: row.get(1)?,
                opened_at: row.get(2)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    /// Records an actual open, not an edit timestamp. The source's historical
    /// `last_opened_at` projection is updated in the same transaction so a
    /// single click performs one SQLite commit.
    pub fn touch_content_recent(
        &self,
        item_id: String,
        item_kind: String,
    ) -> Result<ContentRecent> {
        if !Self::valid_document_id(&item_id) {
            bail!("最近内容 ID 无效")
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let transaction = connection.transaction()?;
        if !Self::content_pointer_item_exists(&transaction, &item_kind, &item_id)? {
            bail!("要记录的本地内容已经不存在")
        }
        let opened_at = Utc::now().to_rfc3339();
        if item_kind == "source" {
            transaction.execute(
                "UPDATE source_records SET last_opened_at = ?2 WHERE id = ?1",
                (&item_id, &opened_at),
            )?;
        }
        // Reinsert instead of updating in place. Windows clocks can return the
        // same instant for rapid consecutive opens; the fresh rowid provides
        // a deterministic newest-first tie breaker without another counter.
        transaction.execute(
            "DELETE FROM content_recents WHERE item_kind = ?1 AND item_id = ?2",
            (&item_kind, &item_id),
        )?;
        transaction.execute(
            "INSERT INTO content_recents(item_kind, item_id, opened_at) VALUES (?1, ?2, ?3)",
            (&item_kind, &item_id, &opened_at),
        )?;
        transaction.execute(
            "DELETE FROM content_recents WHERE rowid IN (
               SELECT rowid FROM content_recents ORDER BY opened_at DESC, rowid DESC LIMIT -1 OFFSET ?1
             )",
            [CONTENT_RECENT_LIMIT],
        )?;
        transaction.commit()?;
        Ok(ContentRecent {
            item_id,
            item_kind,
            opened_at,
        })
    }

    pub fn remove_content_recent(&self, item_id: String, item_kind: String) -> Result<()> {
        if !Self::valid_document_id(&item_id) {
            bail!("最近内容 ID 无效")
        }
        if !matches!(
            item_kind.as_str(),
            "note" | "question" | "word" | "source" | "diagram"
        ) {
            bail!("不支持的内容类型")
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        connection.execute(
            "DELETE FROM content_recents WHERE item_kind = ?1 AND item_id = ?2",
            (&item_kind, &item_id),
        )?;
        Ok(())
    }

    pub fn clear_content_recents(&self) -> Result<()> {
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        connection.execute("DELETE FROM content_recents", [])?;
        Ok(())
    }

    pub fn replace_content_recents(
        &self,
        recents: Vec<ContentRecent>,
    ) -> Result<Vec<ContentRecent>> {
        if recents.len() > CONTENT_RECENT_LIMIT as usize {
            bail!("最近内容最多保留 128 项")
        }
        let unique = recents
            .iter()
            .map(|recent| (recent.item_kind.as_str(), recent.item_id.as_str()))
            .collect::<HashSet<_>>();
        if unique.len() != recents.len() {
            bail!("备份中包含重复最近内容")
        }
        for recent in &recents {
            if !Self::valid_document_id(&recent.item_id) {
                bail!("最近内容 ID 无效")
            }
            if !matches!(
                recent.item_kind.as_str(),
                "note" | "question" | "word" | "source" | "diagram"
            ) {
                bail!("不支持的内容类型")
            }
            if recent.opened_at.trim().is_empty() || recent.opened_at.len() > 64 {
                bail!("内容打开时间无效")
            }
        }

        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let transaction = connection.transaction()?;
        let mut retained = Vec::with_capacity(recents.len());
        for recent in recents {
            if Self::content_pointer_item_exists(&transaction, &recent.item_kind, &recent.item_id)?
            {
                retained.push(recent);
            }
        }
        transaction.execute("DELETE FROM content_recents", [])?;
        for recent in &retained {
            transaction.execute(
                "INSERT INTO content_recents(item_kind, item_id, opened_at) VALUES (?1, ?2, ?3)",
                (&recent.item_kind, &recent.item_id, &recent.opened_at),
            )?;
        }
        transaction.commit()?;
        drop(connection);
        self.list_content_recents()
    }

    pub fn hydrate_content_recents(
        &self,
        browser_recents: Vec<ContentRecent>,
    ) -> Result<Vec<ContentRecent>> {
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let already_migrated: Option<String> = connection
            .query_row(
                "SELECT value FROM vault_meta WHERE key = 'browser-content-recents-migration-v1'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if already_migrated.is_none() && !browser_recents.is_empty() {
            let migration_directory = self.root.join(".toolknit/migrations");
            fs::create_dir_all(&migration_directory)?;
            let archive = migration_directory.join(format!(
                "browser-content-recents-before-vault-{}.json",
                Utc::now().format("%Y%m%d-%H%M%S")
            ));
            fs::write(&archive, serde_json::to_vec_pretty(&browser_recents)?)?;
            for item in browser_recents
                .into_iter()
                .take(CONTENT_RECENT_LIMIT as usize)
            {
                if !Self::valid_document_id(&item.item_id)
                    || !matches!(
                        item.item_kind.as_str(),
                        "note" | "question" | "word" | "source" | "diagram"
                    )
                    || !Self::content_pointer_item_exists(
                        &connection,
                        &item.item_kind,
                        &item.item_id,
                    )?
                {
                    continue;
                }
                connection.execute(
                    "INSERT OR IGNORE INTO content_recents(item_kind, item_id, opened_at) VALUES (?1, ?2, ?3)",
                    (&item.item_kind, &item.item_id, &item.opened_at),
                )?;
            }
        }
        if already_migrated.is_none() {
            connection.execute(
                "INSERT INTO vault_meta(key, value, updated_at) VALUES ('browser-content-recents-migration-v1', 'complete', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                [Utc::now().to_rfc3339()],
            )?;
        }
        drop(connection);
        self.list_content_recents()
    }

    pub fn hydrate_documents(
        &self,
        browser_documents: Vec<VaultDocument>,
        browser_vocabulary: Vec<VocabularyEntry>,
        browser_relations: Vec<VaultRelation>,
    ) -> Result<VaultHydration> {
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        let documents_already_migrated: Option<String> = connection
            .query_row(
                "SELECT value FROM vault_meta WHERE key = 'browser-document-migration-v1'",
                [],
                |row| row.get(0),
            )
            .ok();
        let vocabulary_already_migrated: Option<String> = connection
            .query_row(
                "SELECT value FROM vault_meta WHERE key = 'browser-vocabulary-migration-v1'",
                [],
                |row| row.get(0),
            )
            .ok();
        let relations_already_migrated: Option<String> = connection
            .query_row(
                "SELECT value FROM vault_meta WHERE key = 'browser-relation-migration-v1'",
                [],
                |row| row.get(0),
            )
            .ok();
        // A count greater than zero may mean a previous migration stopped
        // halfway. Preserve native entities and resume only the missing IDs.
        let mut existing_entity_ids = connection
            .prepare("SELECT id FROM entities")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<HashSet<_>, _>>()?;
        drop(connection);
        let should_migrate_documents =
            documents_already_migrated.is_none() && !browser_documents.is_empty();
        let should_migrate_vocabulary =
            vocabulary_already_migrated.is_none() && !browser_vocabulary.is_empty();
        let should_migrate_relations =
            relations_already_migrated.is_none() && !browser_relations.is_empty();
        if should_migrate_documents || should_migrate_vocabulary || should_migrate_relations {
            let migration_directory = self.root.join(".toolknit/migrations");
            fs::create_dir_all(&migration_directory)?;
            let timestamp = Utc::now().format("%Y%m%d-%H%M%S");
            if should_migrate_documents {
                let archive = migration_directory
                    .join(format!("browser-documents-before-vault-{timestamp}.json"));
                fs::write(archive, serde_json::to_vec_pretty(&browser_documents)?)?;
                for document in browser_documents {
                    if existing_entity_ids.insert(document.id.clone()) {
                        self.save_document(document)?;
                    }
                }
            }
            if should_migrate_vocabulary {
                let archive = migration_directory
                    .join(format!("browser-vocabulary-before-vault-{timestamp}.json"));
                fs::write(archive, serde_json::to_vec_pretty(&browser_vocabulary)?)?;
                self.migrate_missing_vocabulary(browser_vocabulary)?;
            }
            if should_migrate_relations {
                let archive = migration_directory
                    .join(format!("browser-relations-before-vault-{timestamp}.json"));
                fs::write(archive, serde_json::to_vec_pretty(&browser_relations)?)?;
                // Relations use an idempotent INSERT ... ON CONFLICT DO
                // NOTHING, so a retry fills the remainder without removing
                // native-only links.
                for relation in browser_relations {
                    self.save_relation(relation)?;
                }
            }
        }
        let mut connection = self.connection()?;
        self.migrate(&mut connection)?;
        if documents_already_migrated.is_none() {
            connection.execute("\
                INSERT INTO vault_meta(key, value, updated_at) VALUES ('browser-document-migration-v1', ?1, ?2)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            ", (if should_migrate_documents { "imported" } else { "skipped" }, Utc::now().to_rfc3339()))?;
        }
        if vocabulary_already_migrated.is_none() {
            connection.execute("\
                INSERT INTO vault_meta(key, value, updated_at) VALUES ('browser-vocabulary-migration-v1', ?1, ?2)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            ", (if should_migrate_vocabulary { "imported" } else { "skipped" }, Utc::now().to_rfc3339()))?;
        }
        if relations_already_migrated.is_none() {
            connection.execute("\
                INSERT INTO vault_meta(key, value, updated_at) VALUES ('browser-relation-migration-v1', ?1, ?2)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            ", (if should_migrate_relations { "imported" } else { "skipped" }, Utc::now().to_rfc3339()))?;
        }
        Ok(VaultHydration {
            root: self.root.display().to_string(),
            documents: self.list_document_summaries()?,
            vocabulary: self.list_vocabulary()?,
            relations: self.list_relations()?,
            migrated: should_migrate_documents
                || should_migrate_vocabulary
                || should_migrate_relations,
        })
    }

    pub fn write_api_key(profile: AiProfileInput) -> Result<()> {
        if profile.id.is_empty() || profile.api_key.is_empty() {
            bail!("配置或 API Key 不能为空")
        }
        let entry = Entry::new("ToolKnit", &format!("ai-profile:{}", profile.id))?;
        entry.set_password(&profile.api_key)?;
        if entry.get_password()? != profile.api_key {
            bail!("系统凭据库写入后校验失败")
        }
        Ok(())
    }

    pub fn has_api_key(profile_id: String) -> Result<bool> {
        if profile_id.is_empty() {
            bail!("配置 ID 不能为空")
        }
        let entry = Entry::new("ToolKnit", &format!("ai-profile:{profile_id}"))?;
        match entry.get_password() {
            Ok(value) => Ok(!value.is_empty()),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    pub fn delete_api_key(profile_id: String) -> Result<()> {
        if profile_id.is_empty() {
            bail!("配置 ID 不能为空")
        }
        Entry::new("ToolKnit", &format!("ai-profile:{profile_id}"))?.delete_credential()?;
        Ok(())
    }

    pub async fn run_ai_action(request: AiActionRequest) -> Result<String> {
        let mut base_url = request.base_url.trim().to_owned();
        if !base_url.ends_with('/') {
            base_url.push('/');
        }
        let endpoint = url::Url::parse(&base_url)?.join("chat/completions")?;
        let is_loopback = endpoint
            .host_str()
            .map(|host| host == "localhost" || host == "127.0.0.1" || host == "::1")
            .unwrap_or(false);
        if endpoint.scheme() != "https" && !(endpoint.scheme() == "http" && is_loopback) {
            bail!("远程 AI 地址必须使用 HTTPS；仅 loopback 本地服务可使用 HTTP")
        }
        let api_key = Entry::new("ToolKnit", &format!("ai-profile:{}", request.profile_id))?
            .get_password()?;
        let payload =
            ai_chat_completion_payload(&request.model, request.temperature, request.messages)?;
        let response = reqwest::Client::new()
            .post(endpoint)
            .timeout(Duration::from_secs(120))
            .bearer_auth(api_key)
            .json(&payload)
            .send()
            .await?;
        let status = response.status();
        let body: serde_json::Value = response.json().await.context("AI 服务返回了非 JSON 内容")?;
        if !status.is_success() {
            bail!(
                "AI 服务请求失败：{}",
                body.get("error")
                    .and_then(|value| value.get("message"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("未知错误")
            )
        }
        ai_chat_completion_text(&body)
    }

    pub fn backup(&self, output_path: String) -> Result<()> {
        let output = PathBuf::from(output_path);
        if output.starts_with(&self.root) {
            bail!("备份文件不能写入资料库目录，避免递归归档")
        }
        let parent = output.parent().context("备份路径无效")?;
        fs::create_dir_all(parent)?;
        let vault_name = self
            .root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("KnitspaceVault");
        let snapshot_dir = self
            .root
            .parent()
            .unwrap_or(parent)
            .join(format!(".{vault_name}-backup-{}", Uuid::now_v7()));
        let snapshot_database = snapshot_dir.join("index.sqlite3");
        let live_database = Path::new(".toolknit/index.sqlite3");
        let live_wal = Path::new(".toolknit/index.sqlite3-wal");
        let live_shm = Path::new(".toolknit/index.sqlite3-shm");

        let result = (|| -> Result<()> {
            fs::create_dir_all(&snapshot_dir)?;
            // Copying index.sqlite3 and its WAL as unrelated files can capture
            // two different moments while the app remains open. VACUUM INTO
            // asks SQLite for one transactionally consistent standalone image.
            let connection = self.connection()?;
            let snapshot_path = snapshot_database.to_string_lossy().into_owned();
            connection.execute("VACUUM INTO ?1", [snapshot_path])?;
            let snapshot_connection = rusqlite::Connection::open(&snapshot_database)?;
            let integrity: String =
                snapshot_connection.query_row("PRAGMA quick_check(1)", [], |row| row.get(0))?;
            if integrity != "ok" {
                bail!("备份前的 SQLite 快照完整性检查失败：{integrity}")
            }
            drop(snapshot_connection);

            let output_file = fs::File::create(&output)?;
            let mut zip = ZipWriter::new(output_file);
            zip.start_file(".toolknit/index.sqlite3", SimpleFileOptions::default())?;
            let mut snapshot_input = fs::File::open(&snapshot_database)?;
            std::io::copy(&mut snapshot_input, &mut zip)?;

            for entry in WalkDir::new(&self.root)
                .into_iter()
                .filter_map(|entry| entry.ok())
                .filter(|entry| entry.file_type().is_file())
            {
                let relative = entry.path().strip_prefix(&self.root)?;
                if relative == live_database || relative == live_wal || relative == live_shm {
                    continue;
                }
                // ZIP format uses forward slashes even on Windows. Keeping this
                // portable lets the archive be restored on another machine.
                zip.start_file(
                    relative.to_string_lossy().replace('\\', "/"),
                    SimpleFileOptions::default(),
                )?;
                let mut input = fs::File::open(entry.path())?;
                std::io::copy(&mut input, &mut zip)?;
            }
            zip.finish()?;
            Ok(())
        })();
        let _ = fs::remove_dir_all(&snapshot_dir);
        if result.is_err() {
            let _ = fs::remove_file(&output);
        }
        result
    }

    /// A full Vault archive is intentionally infrequent: it runs at most once
    /// per day and keeps seven versions.  The directory is a sibling of the
    /// Vault, never inside it, so future archives cannot recursively contain
    /// older ones.
    pub fn automatic_backup(&self) -> Result<Option<String>> {
        let parent = self.root.parent().context("资料库根目录无效")?;
        let vault_name = self
            .root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("KnitspaceVault");
        let backup_dir = parent.join(format!("{vault_name} Backups"));
        fs::create_dir_all(&backup_dir)?;
        let archive = backup_dir.join(format!(
            "knitspace-auto-{}.zip",
            Utc::now().format("%Y-%m-%d")
        ));
        if archive.is_file() {
            return Ok(None);
        }
        self.backup(archive.to_string_lossy().into_owned())?;

        let mut archives = fs::read_dir(&backup_dir)?
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| automatic_backup_date(&entry.path()).map(|date| (date, entry)))
            .collect::<Vec<_>>();
        archives.sort_by_key(|(date, _)| *date);
        let stale_count = archives.len().saturating_sub(7);
        for (_, stale) in archives.into_iter().take(stale_count) {
            fs::remove_file(stale.path())?;
        }
        Ok(Some(archive.to_string_lossy().into_owned()))
    }

    fn archive_path_for_restore(&self, archive_path: String) -> Result<PathBuf> {
        let archive_path = PathBuf::from(archive_path);
        if !archive_path.is_file() {
            bail!("找不到完整 Vault 归档")
        }
        if archive_path.starts_with(&self.root) {
            bail!("不能从当前资料库内部恢复归档")
        }
        Ok(archive_path)
    }

    fn inspect_backup_path(&self, archive_path: &Path) -> Result<VaultBackupInspection> {
        let metadata = fs::metadata(archive_path)?;
        let archive_file = fs::File::open(archive_path)?;
        let mut archive = ZipArchive::new(archive_file).context("完整 Vault 归档无法读取")?;
        if archive.len() > VAULT_ARCHIVE_MAX_ENTRIES {
            bail!("归档包含过多文件，无法安全检查")
        }

        let mut names = HashSet::with_capacity(archive.len());
        let mut file_count = 0usize;
        let mut managed_file_count = 0usize;
        let mut uncompressed_size = 0u64;
        let mut database_size = None;
        for index in 0..archive.len() {
            let entry = archive.by_index(index)?;
            let relative = entry
                .enclosed_name()
                .map(|path| path.to_path_buf())
                .context("归档中包含不安全的文件路径")?;
            if relative.as_os_str().is_empty() || entry.is_dir() {
                continue;
            }
            let name = relative.to_string_lossy().replace('\\', "/");
            if !names.insert(name.clone()) {
                bail!("归档包含重复文件路径：{name}")
            }
            file_count += 1;
            uncompressed_size = uncompressed_size
                .checked_add(entry.size())
                .context("归档声明的文件总大小无效")?;
            if uncompressed_size > VAULT_ARCHIVE_MAX_UNCOMPRESSED_BYTES {
                bail!("归档展开后过大，无法安全恢复")
            }
            if name == ".toolknit/index.sqlite3" {
                database_size = Some(entry.size());
            } else if !name.starts_with("notes/") && !name.starts_with("questions/") {
                managed_file_count += 1;
            }
        }
        let database_size = database_size.context("这不是可恢复的 Knitspace Vault 归档")?;
        if database_size > VAULT_ARCHIVE_MAX_DATABASE_BYTES {
            bail!("归档中的 SQLite 索引异常过大")
        }

        let temporary_root =
            std::env::temp_dir().join(format!("knitspace-vault-inspection-{}", Uuid::now_v7()));
        let result = (|| -> Result<VaultBackupInspection> {
            let database_path = temporary_root.join(".toolknit/index.sqlite3");
            fs::create_dir_all(database_path.parent().context("临时检查目录无效")?)?;
            let mut database_entry = archive.by_name(".toolknit/index.sqlite3")?;
            let mut database_output = fs::File::create(&database_path)?;
            let copied = std::io::copy(&mut database_entry, &mut database_output)?;
            if copied != database_size {
                bail!("归档中的 SQLite 索引大小不一致")
            }
            drop(database_output);
            drop(database_entry);

            // Open a throwaway copy so old supported schema versions can be
            // migrated and checked without mutating the selected ZIP.
            let staged = VaultService::open(temporary_root.to_string_lossy().into_owned())?;
            let health = staged.health()?;
            if health.integrity != "ok" {
                bail!("归档中的 SQLite 完整性检查失败：{}", health.integrity)
            }
            if health.schema_version > SCHEMA_VERSION {
                bail!(
                    "归档需要更新版本的 Knitspace（schema v{}，当前支持 v{}）",
                    health.schema_version,
                    SCHEMA_VERSION
                )
            }
            let connection = staged.connection()?;
            let markdown_paths = {
                let mut statement = connection.prepare("SELECT markdown_path FROM documents")?;
                let paths = statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                paths
            };
            let missing_markdown_count = markdown_paths
                .iter()
                .filter(|path| !names.contains(&path.replace('\\', "/")))
                .count() as i64;
            if missing_markdown_count > 0 {
                bail!("归档缺少 {missing_markdown_count} 个 Markdown 正文文件，当前资料库未修改")
            }

            Ok(VaultBackupInspection {
                archive_name: archive_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("Knitspace Vault 归档")
                    .to_owned(),
                archive_size: metadata.len(),
                modified_at: metadata
                    .modified()
                    .ok()
                    .map(|value| chrono::DateTime::<Utc>::from(value).to_rfc3339()),
                schema_version: health.schema_version,
                latest_schema_version: SCHEMA_VERSION,
                integrity: health.integrity,
                document_count: health.document_count,
                note_count: health.note_count,
                question_count: health.question_count,
                vocabulary_count: health.vocabulary_count,
                source_count: health.source_count,
                relation_count: health.relation_count,
                review_card_count: health.review_card_count,
                file_count,
                managed_file_count,
                uncompressed_size,
                missing_markdown_count,
            })
        })();
        let _ = fs::remove_dir_all(&temporary_root);
        result
    }

    pub fn inspect_backup(&self, archive_path: String) -> Result<VaultBackupInspection> {
        let archive_path = self.archive_path_for_restore(archive_path)?;
        self.inspect_backup_path(&archive_path)
    }

    /// Replace this Vault with a previously created archive.  Extraction is
    /// staged beside the Vault and each entry must have a safe relative name;
    /// the live folder is only swapped after the staged SQLite index opens.
    /// A last-known-good archive of the current Vault is created first so a
    /// confirmed restore never discards the state it replaces.
    pub fn restore_backup(&self, archive_path: String) -> Result<String> {
        let archive_path = self.archive_path_for_restore(archive_path)?;
        // Re-run the same read-only inspection at confirmation time so a ZIP
        // replaced after the preview cannot bypass integrity/schema checks.
        self.inspect_backup_path(&archive_path)?;
        let parent = self.root.parent().context("资料库根目录无效")?;
        let vault_name = self
            .root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("KnitspaceVault");
        let stage = parent.join(format!(".{vault_name}-restore-{}", Uuid::now_v7()));
        let displaced = parent.join(format!(".{vault_name}-replacing-{}", Uuid::now_v7()));
        let backup_dir = parent.join(format!("{vault_name} Backups"));
        fs::create_dir_all(&backup_dir)?;
        let safety_archive = backup_dir.join(format!(
            "knitspace-before-restore-{}.zip",
            Utc::now().format("%Y%m%dT%H%M%SZ")
        ));

        // Produce the fallback before touching the live directory. It also
        // means a damaged or incompatible selected ZIP leaves the live Vault
        // completely untouched.
        self.backup(safety_archive.to_string_lossy().into_owned())?;
        let result = (|| -> Result<()> {
            fs::create_dir_all(&stage)?;
            let archive_file = fs::File::open(&archive_path)?;
            let mut archive = ZipArchive::new(archive_file).context("完整 Vault 归档无法读取")?;
            if archive.len() > VAULT_ARCHIVE_MAX_ENTRIES {
                bail!("归档包含过多文件，无法安全恢复")
            }
            let mut extracted_names = HashSet::with_capacity(archive.len());
            let mut extracted_bytes = 0u64;
            for index in 0..archive.len() {
                let mut entry = archive.by_index(index)?;
                let relative = entry
                    .enclosed_name()
                    .map(|path| path.to_path_buf())
                    .context("归档中包含不安全的文件路径")?;
                if relative.as_os_str().is_empty() {
                    continue;
                }
                let normalized = relative.to_string_lossy().replace('\\', "/");
                if !extracted_names.insert(normalized.clone()) {
                    bail!("归档包含重复文件路径：{normalized}")
                }
                extracted_bytes = extracted_bytes
                    .checked_add(entry.size())
                    .context("归档声明的文件总大小无效")?;
                if extracted_bytes > VAULT_ARCHIVE_MAX_UNCOMPRESSED_BYTES {
                    bail!("归档展开后过大，无法安全恢复")
                }
                let destination = stage.join(relative);
                if entry.is_dir() {
                    fs::create_dir_all(destination)?;
                    continue;
                }
                let output_parent = destination.parent().context("归档文件路径无效")?;
                fs::create_dir_all(output_parent)?;
                let mut output = fs::File::create(destination)?;
                std::io::copy(&mut entry, &mut output)?;
            }

            if !stage.join(".toolknit/index.sqlite3").is_file() {
                bail!("这不是可恢复的 Knitspace Vault 归档")
            }
            // Open/migrate and run the same health checks shown in Settings
            // while still staged. A corrupt index, incompatible schema, or
            // database row whose Markdown body is absent therefore cannot
            // replace the live Vault.
            let staged = VaultService::open(stage.to_string_lossy().into_owned())?;
            let staged_health = staged.health()?;
            if staged_health.integrity != "ok" {
                bail!(
                    "归档中的 SQLite 完整性检查失败：{}",
                    staged_health.integrity
                )
            }
            if staged_health.schema_version > SCHEMA_VERSION {
                bail!(
                    "归档需要更新版本的 Knitspace（schema v{}，当前支持 v{}）",
                    staged_health.schema_version,
                    SCHEMA_VERSION
                )
            }
            if staged_health.missing_markdown_count > 0 {
                bail!(
                    "归档缺少 {} 个 Markdown 正文文件，当前资料库未修改",
                    staged_health.missing_markdown_count
                )
            }
            fs::rename(&self.root, &displaced).context("无法准备替换当前资料库")?;
            if let Err(error) = fs::rename(&stage, &self.root) {
                let rollback = fs::rename(&displaced, &self.root);
                if let Err(rollback_error) = rollback {
                    bail!("恢复替换失败：{error}；回滚也失败：{rollback_error}")
                }
                return Err(error.into());
            }
            // The restored Vault is now live.  A transient Windows file lock
            // on the displaced folder must not turn this successful swap into
            // a false failure; the uniquely named folder remains recoverable.
            let _ = fs::remove_dir_all(&displaced);
            Ok(())
        })();
        if result.is_err() && stage.exists() {
            let _ = fs::remove_dir_all(&stage);
        }
        result?;
        Ok(safety_archive.to_string_lossy().into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deepseek_v4_ai_payload_disables_default_thinking() -> Result<()> {
        let payload = ai_chat_completion_payload("deepseek-v4-flash", 0.45, json!([]))?;
        assert_eq!(payload.pointer("/thinking/type"), Some(&json!("disabled")));
        assert_eq!(payload.get("temperature"), Some(&json!(0.45)));

        let generic = ai_chat_completion_payload("gpt-4.1-mini", 0.2, json!([]))?;
        assert!(generic.get("thinking").is_none());
        assert!(ai_chat_completion_payload("gpt-4.1-mini", 2.1, json!([])).is_err());
        Ok(())
    }

    #[test]
    fn ai_text_parser_rejects_silent_empty_results() -> Result<()> {
        assert_eq!(
            ai_chat_completion_text(&json!({
                "choices": [{ "message": { "content": "完成" } }]
            }))?,
            "完成"
        );
        let error = ai_chat_completion_text(&json!({
            "choices": [{ "message": { "content": "" } }]
        }))
        .expect_err("空结果必须明确报错");
        assert!(error.to_string().contains("没有返回可显示的文本"));
        Ok(())
    }

    fn test_document(id: String, title: &str) -> VaultDocument {
        VaultDocument {
            id,
            title: title.into(),
            kind: "question".into(),
            question_type: Some("algorithm".into()),
            subject: "算法".into(),
            tags: vec!["图论".into(), "最短路".into()],
            folder: Some("算法/图论".into()),
            difficulty: 3,
            content: format!("# {title}\n\nDijkstra 适合非负权图。"),
            question_details: Some(QuestionDetails {
                source: "算法课程 · 第 7 章".into(),
                stem: "Dijkstra 能否处理负边？".into(),
                answer: "不能。".into(),
                explanation: "A negative edge breaks the greedy precondition.".into(),
                wrong_answer: "直接套用模板。".into(),
                error_reason: "忽略前置条件。".into(),
            }),
            source_anchor: Some(
                json!({ "sourceId": "source-1", "pageIndex": 2, "bbox": [0.1, 0.2, 0.3, 0.4] }),
            ),
            created_at: "2026-08-09T00:00:00Z".into(),
            updated_at: "2026-08-09T00:00:00Z".into(),
            review_enabled: true,
            review: Some(
                json!({ "due": "2026-08-10T00:00:00Z", "intervalDays": 0, "repetitions": 0, "lapses": 0 }),
            ),
            review_facets: HashMap::new(),
            error_types: vec!["边界条件".into()],
            ai_generated: Some(false),
            external_file: Some(
                json!({ "path": "F:/Notes/dijkstra.md", "name": "dijkstra.md", "hash": "hash", "modifiedAt": "2026-08-09T00:00:00Z", "size": 42 }),
            ),
        }
    }

    #[test]
    fn managed_markdown_reconcile_updates_indexes_without_losing_structured_fields() -> Result<()> {
        let root = std::env::temp_dir().join(format!(
            "knitspace-managed-markdown-reconcile-{}",
            Uuid::now_v7()
        ));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let id = Uuid::now_v7().to_string();
        let original = test_document(id.clone(), "负权最短路");
        service.save_document(original.clone())?;
        assert_eq!(
            service.get_document(id.clone())?.question_details.unwrap().source,
            "算法课程 · 第 7 章"
        );
        assert!(service
            .search_documents("算法课程".into(), 12)?
            .iter()
            .any(|entry| entry.id == id));
        let path = root.join("questions").join(format!("{id}.md"));
        fs::write(
            &path,
            "# 外部编辑仍保留结构\n\nTypora 增加 Bellman-Ford 负环检测。\n\n[[图论索引]]",
        )?;

        let reconciled = service.reconcile_document_markdown(id.clone())?;
        assert_eq!(reconciled.status, "updated");
        let updated = reconciled.document.context("应返回更新后的文档")?;
        assert!(updated.content.contains("Bellman-Ford"));
        assert_eq!(updated.title, original.title);
        assert_eq!(updated.question_details, original.question_details);
        assert_eq!(updated.review, original.review);
        assert!(service
            .search_documents("负环检测".into(), 12)?
            .iter()
            .any(|entry| entry.id == id));
        let versions = service.list_document_versions(id.clone())?;
        assert_eq!(versions.len(), 2);
        assert!(service
            .get_document_version(id.clone(), versions[0].id.clone())?
            .content
            .contains("Bellman-Ford"));
        assert_eq!(
            service
                .get_document_version(id.clone(), versions[1].id.clone())?
                .content,
            original.content
        );
        assert_eq!(service.list_wiki_links(32)?.unresolved_count, 1);

        let unchanged = service.reconcile_document_markdown(id.clone())?;
        assert_eq!(unchanged.status, "unchanged");
        assert!(unchanged.document.is_none());
        fs::remove_file(path)?;
        assert_eq!(
            service.reconcile_document_markdown(id.clone())?.status,
            "missing"
        );

        fs::remove_dir_all(root)?;
        Ok(())
    }

    fn test_vocabulary(id: String) -> VocabularyEntry {
        VocabularyEntry {
            id: id.clone(),
            lemma: "run".into(),
            language: "英语".into(),
            pronunciation: Some("/rʌn/".into()),
            forms: json!({ "past": "ran", "presentParticiple": "running" }),
            senses: vec![VocabularySense {
                id: Uuid::now_v7().to_string(),
                part_of_speech: "verb".into(),
                definition: "运行；经营".into(),
                examples: vec!["The program runs locally.".into()],
                collocations: vec!["run a program".into(), "run locally".into()],
                synonyms: vec!["operate".into()],
                review_enabled: true,
                review: Some(
                    json!({ "due": "2026-08-10T00:00:00Z", "intervalDays": 0, "repetitions": 0, "lapses": 0 }),
                ),
                review_facets: HashMap::new(),
            }],
            created_at: "2026-08-09T00:00:00Z".into(),
            updated_at: "2026-08-09T00:00:00Z".into(),
        }
    }

    fn test_clipboard_item(id: String, kind: &str, content: Option<String>) -> VaultClipboardItem {
        VaultClipboardItem {
            id,
            kind: kind.into(),
            content,
            asset_path: None,
            preview: None,
            hash: Uuid::now_v7().to_string(),
            captured_at: "2026-08-09T00:00:00Z".into(),
            pinned: false,
            content_loaded: true,
        }
    }

    fn test_png(color: [u8; 4]) -> Result<Vec<u8>> {
        let mut encoded = Vec::new();
        image::codecs::png::PngEncoder::new(&mut encoded).write_image(
            &color,
            1,
            1,
            image::ExtendedColorType::Rgba8,
        )?;
        Ok(encoded)
    }

    #[test]
    fn markdown_images_are_deduplicated_registered_and_document_scoped() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-markdown-image-test-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let document_id = Uuid::now_v7().to_string();
        service.save_document(test_document(document_id.clone(), "截图笔记"))?;
        let rgba = [36, 118, 95, 255, 244, 240, 231, 255];

        let first = service.save_document_image(&document_id, 2, 1, &rgba)?;
        let second = service.save_document_image(&document_id, 2, 1, &rgba)?;
        assert_eq!(first.source, second.source);
        assert_eq!(first.filename, second.filename);
        assert!(first
            .source
            .starts_with(&format!("../assets/documents/{document_id}/clipboard-")));
        let resolved = service.document_image_path(&document_id, &first.source)?;
        assert!(resolved.is_file());
        assert_eq!(fs::metadata(&resolved)?.len(), first.size);

        let connection = service.connection()?;
        let attachment_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM attachments WHERE entity_id = ?1",
            [&document_id],
            |row| row.get(0),
        )?;
        assert_eq!(attachment_count, 1);
        drop(connection);

        let other_document = Uuid::now_v7().to_string();
        assert!(service
            .document_image_path(&other_document, &first.source)
            .is_err());
        assert!(service
            .document_image_path(
                &document_id,
                &format!("../assets/documents/{document_id}/../secret.png")
            )
            .is_err());
        assert!(service
            .document_image_path(
                &document_id,
                &format!("../assets/documents/{document_id}/missing.png")
            )
            .is_err());
        assert!(service
            .save_document_image(&document_id, 2, 1, &[0; 4])
            .is_err());

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn selected_markdown_images_preserve_bytes_and_deduplicate() -> Result<()> {
        let root = std::env::temp_dir().join(format!(
            "knitspace-markdown-image-import-test-{}",
            Uuid::now_v7()
        ));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let document_id = Uuid::now_v7().to_string();
        service.save_document(test_document(document_id.clone(), "导入图片"))?;
        let selected = root.join("selected.png");
        image::save_buffer(
            &selected,
            &[36, 118, 95, 255, 244, 240, 231, 255],
            2,
            1,
            image::ColorType::Rgba8,
        )?;
        let original = fs::read(&selected)?;

        let first = service.import_document_image(&document_id, &selected.to_string_lossy())?;
        let second = service.import_document_image(&document_id, &selected.to_string_lossy())?;
        assert_eq!(first.source, second.source);
        assert!(first.filename.starts_with("import-"));
        assert_eq!(
            fs::read(service.document_image_path(&document_id, &first.source)?)?,
            original
        );
        let connection = service.connection()?;
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM attachments WHERE entity_id = ?1 AND path = ?2",
            (&document_id, first.source.trim_start_matches("../")),
            |row| row.get(0),
        )?;
        assert_eq!(count, 1);
        drop(connection);

        let fake = root.join("fake.jpg");
        fs::write(&fake, b"not an image")?;
        assert!(service
            .import_document_image(&document_id, &fake.to_string_lossy())
            .is_err());
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn question_attachments_are_streamed_deduplicated_scoped_and_cleaned() -> Result<()> {
        let root = std::env::temp_dir().join(format!(
            "knitspace-question-attachment-test-{}",
            Uuid::now_v7()
        ));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let document_id = Uuid::now_v7().to_string();
        service.save_document(test_document(document_id.clone(), "带附件的错题"))?;
        let input = root.join("Dijkstra 证明.pdf");
        fs::write(&input, b"%PDF-1.7\nquestion attachment")?;

        let first = service.import_question_attachment(
            document_id.clone(),
            input.to_string_lossy().into_owned(),
        )?;
        let duplicate = service.import_question_attachment(
            document_id.clone(),
            input.to_string_lossy().into_owned(),
        )?;
        assert_eq!(first.id, duplicate.id);
        assert_eq!(first.name, "Dijkstra 证明.pdf");
        assert_eq!(first.mime, "application/pdf");
        assert_eq!(first.size, fs::metadata(&input)?.len());
        assert!(first.available);

        let attachments = service.list_question_attachments(document_id.clone())?;
        assert_eq!(attachments.len(), 1);
        let managed = service.question_attachment_path(document_id.clone(), first.id.clone())?;
        assert!(managed.is_file());
        assert_ne!(managed, input);
        assert!(service
            .question_attachment_path(Uuid::now_v7().to_string(), first.id.clone())
            .is_err());

        service.delete_question_attachment(document_id.clone(), first.id)?;
        assert!(!managed.exists());
        assert!(service
            .list_question_attachments(document_id.clone())?
            .is_empty());

        let second = service.import_question_attachment(
            document_id.clone(),
            input.to_string_lossy().into_owned(),
        )?;
        let second_path = service.question_attachment_path(document_id.clone(), second.id)?;
        service.delete_document(document_id)?;
        assert!(!second_path.exists());
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn visual_projects_keep_editable_metadata_and_source_images_in_vault_assets() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-visual-project-test-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let id = Uuid::now_v7().to_string();
        let first_png = test_png([36, 118, 95, 255])?;
        let second_png = test_png([244, 240, 231, 255])?;
        let first_image =
            service.stage_visual_project_image(&id, "one.png", "image/png", &first_png)?;
        let second_image =
            service.stage_visual_project_image(&id, "two.png", "image/png", &second_png)?;
        let saved = service.save_visual_project(VisualProjectInput {
            id: id.clone(),
            title: "算法标注画布".into(),
            canvas_title: "Dijkstra 边界条件".into(),
            layout: "pair".into(),
            background: "#172321".into(),
            watermark: "Knitspace".into(),
            annotations: json!([{ "id": 1, "kind": "box", "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4, "text": "", "color": "#ffbf69" }]),
            images: vec![first_image.clone(), second_image],
            created_at: None,
        })?;
        assert_eq!(saved.images.len(), 2);
        assert!(saved
            .images
            .iter()
            .all(|image| Path::new(&image.path).is_file()));
        let old_paths = saved
            .images
            .iter()
            .map(|image| PathBuf::from(&image.path))
            .collect::<Vec<_>>();

        let summaries = service.list_visual_projects(20)?;
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].image_count, 2);
        assert_eq!(summaries[0].annotation_count, 1);

        let updated = service.save_visual_project(VisualProjectInput {
            id: id.clone(),
            title: "算法标注画布（精简）".into(),
            canvas_title: "Dijkstra 边界条件".into(),
            layout: "single".into(),
            background: "#fffcf6".into(),
            watermark: String::new(),
            annotations: json!([]),
            images: vec![first_image],
            created_at: Some(saved.created_at.clone()),
        })?;
        assert_eq!(updated.images.len(), 1);
        assert_eq!(updated.title, "算法标注画布（精简）");
        assert_eq!(updated.canvas_title, "Dijkstra 边界条件");
        assert_eq!(updated.created_at, saved.created_at);
        assert!(old_paths[0].is_file());
        assert!(!old_paths[1].exists());
        let connection = service.connection()?;
        let (entity_type, attachment_count): (String, i64) = connection.query_row(
            "SELECT entities.type, COUNT(attachments.id) FROM entities LEFT JOIN attachments ON attachments.entity_id = entities.id WHERE entities.id = ?1 GROUP BY entities.id",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(entity_type, "diagram");
        assert_eq!(attachment_count, 1);
        drop(connection);

        let note_id = Uuid::now_v7().to_string();
        service.save_document(test_document(note_id.clone(), "画布关联笔记"))?;
        service.save_relation(VaultRelation {
            from_id: note_id,
            to_id: id.clone(),
            relation_type: "related".into(),
            created_at: String::new(),
        })?;
        assert_eq!(service.list_relations()?.len(), 1);

        assert!(service
            .set_content_favorite(id.clone(), "diagram".into(), true)?
            .is_some());
        service.touch_content_recent(id.clone(), "diagram".into())?;
        assert_eq!(service.list_content_favorites()?[0].item_kind, "diagram");
        assert_eq!(service.list_content_recents()?[0].item_kind, "diagram");

        service.delete_visual_project(id.clone())?;
        assert!(service.list_visual_projects(20)?.is_empty());
        assert!(service.list_content_favorites()?.is_empty());
        assert!(service.list_content_recents()?.is_empty());
        assert!(service.list_relations()?.is_empty());
        assert!(!root.join("assets/diagrams").join(id).exists());
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn clipboard_history_hydrates_as_bounded_previews_and_reads_full_text_on_demand() -> Result<()>
    {
        let root =
            std::env::temp_dir().join(format!("knitspace-clipboard-test-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let id = Uuid::now_v7().to_string();
        let long_code = "const value = graph[node];\n".repeat(1_200);
        let hydrated = service.hydrate_clipboard_items(
            vec![test_clipboard_item(
                id.clone(),
                "code",
                Some(long_code.clone()),
            )],
            100,
            30,
        )?;
        assert_eq!(hydrated.len(), 1);
        assert!(!hydrated[0].content_loaded);
        assert!(hydrated[0].content.as_deref().unwrap_or_default().len() < long_code.len());

        let full = service.get_clipboard_item(id.clone())?;
        assert!(full.content_loaded);
        assert_eq!(full.content.as_deref(), Some(long_code.as_str()));

        service.set_clipboard_item_pinned(id.clone(), true)?;
        service.save_clipboard_item(test_clipboard_item(
            Uuid::now_v7().to_string(),
            "text",
            Some("temporary clipboard item".into()),
        ))?;
        service.clear_unpinned_clipboard_items()?;
        let remaining = service.list_clipboard_items()?;
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, id);
        assert!(remaining[0].pinned);

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn interrupted_clipboard_migration_resumes_when_native_table_is_not_empty() -> Result<()> {
        let root = std::env::temp_dir().join(format!(
            "knitspace-clipboard-resume-test-{}",
            Uuid::now_v7()
        ));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let first = test_clipboard_item(
            Uuid::now_v7().to_string(),
            "text",
            Some("already imported".into()),
        );
        let second = test_clipboard_item(
            Uuid::now_v7().to_string(),
            "code",
            Some("const resumed = true".into()),
        );
        service.save_clipboard_item(first.clone())?;

        let hydrated = service.hydrate_clipboard_items(vec![first, second], 100, 30)?;
        assert_eq!(hydrated.len(), 2);
        let connection = service.connection()?;
        let marker: String = connection.query_row(
            "SELECT value FROM vault_meta WHERE key = 'browser-clipboard-migration-v1'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(marker, "imported");
        drop(connection);

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn vault_migrates_and_indexes_markdown() -> Result<()> {
        let root = std::env::temp_dir().join(format!("toolknit-vault-test-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let id = Uuid::now_v7().to_string();
        service.save_markdown(
            id.clone(),
            "note".into(),
            "# 图算法笔记\n\nDijkstra 适合非负权图。".into(),
        )?;
        {
            let connection = service.connection()?;
            let title: String =
                connection.query_row("SELECT title FROM entities WHERE id = ?1", [&id], |row| {
                    row.get(0)
                })?;
            let match_count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM documents_fts WHERE documents_fts MATCH 'Dijkstra'",
                [],
                |row| row.get(0),
            )?;
            let version: i64 =
                connection.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                    row.get(0)
                })?;
            assert_eq!(title, "图算法笔记");
            assert_eq!(match_count, 1);
            assert_eq!(version, SCHEMA_VERSION);
        }
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn document_versions_coalesce_and_preserve_a_restore_point() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-document-versions-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let id = Uuid::now_v7().to_string();
        let mut document = test_document(id.clone(), "版本历史");
        document.content = "# 版本历史\n\n第一版内容。".into();
        service.save_document(document.clone())?;

        document.content = "# 版本历史\n\n第二版内容，应该合并最近的自动保存点。".into();
        document.updated_at = Utc::now().to_rfc3339();
        service.save_document(document.clone())?;

        let coalesced = service.list_document_versions(id.clone())?;
        assert_eq!(coalesced.len(), 1);
        assert!(coalesced[0].is_current);
        assert!(coalesced[0].preview.contains("第二版内容"));
        assert_eq!(
            service
                .get_document_version(id.clone(), coalesced[0].id.clone())?
                .content,
            document.content
        );

        service.preserve_current_document_version(id.clone())?;
        let preserved = service.list_document_versions(id.clone())?;
        assert_eq!(preserved.len(), 2);
        assert_eq!(
            preserved
                .iter()
                .filter(|version| version.is_current)
                .count(),
            1
        );
        document.content = "# 版本历史\n\n第三版内容。".into();
        document.updated_at = Utc::now().to_rfc3339();
        service.save_document(document.clone())?;

        let versions = service.list_document_versions(id.clone())?;
        assert_eq!(versions.len(), 3);
        assert!(versions[0].is_current);
        let snapshots = versions
            .iter()
            .map(|version| service.get_document_version(id.clone(), version.id.clone()))
            .collect::<Result<Vec<_>>>()?;
        assert!(snapshots
            .iter()
            .any(|snapshot| snapshot.content.contains("第二版内容")));
        assert!(snapshots
            .iter()
            .any(|snapshot| snapshot.content.contains("第三版内容")));

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn editor_crash_drafts_round_trip_upsert_bound_and_delete() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-editor-crash-drafts-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let first_id = Uuid::now_v7().to_string();

        let saved = service.save_editor_crash_draft(
            "document".into(),
            first_id.clone(),
            "2026-08-10T08:00:00Z".into(),
            serde_json::to_string(&json!({ "id": first_id, "content": "unfinished" }))?,
        )?;
        assert_eq!(saved.kind, "document");
        assert!(saved.byte_size > 0);
        let loaded = service
            .get_editor_crash_draft("document".into(), first_id.clone())?
            .expect("saved draft should be available");
        assert!(loaded.payload_json.contains("unfinished"));

        service.save_editor_crash_draft(
            "document".into(),
            first_id.clone(),
            "2026-08-10T08:00:00Z".into(),
            serde_json::to_string(&json!({ "id": first_id, "content": "newest" }))?,
        )?;
        assert!(service
            .get_editor_crash_draft("document".into(), first_id.clone())?
            .expect("upserted draft should be available")
            .payload_json
            .contains("newest"));

        let mut newest_id = String::new();
        for index in 0..EDITOR_CRASH_DRAFT_LIMIT {
            newest_id = Uuid::now_v7().to_string();
            service.save_editor_crash_draft(
                if index % 2 == 0 {
                    "document"
                } else {
                    "vocabulary"
                }
                .into(),
                newest_id.clone(),
                "2026-08-10T08:00:00Z".into(),
                serde_json::to_string(&json!({ "id": newest_id, "index": index }))?,
            )?;
        }
        let connection = service.connection()?;
        let count: i64 =
            connection.query_row("SELECT COUNT(*) FROM editor_crash_drafts", [], |row| {
                row.get(0)
            })?;
        assert_eq!(count, EDITOR_CRASH_DRAFT_LIMIT);
        assert!(service
            .get_editor_crash_draft("document".into(), first_id.clone())?
            .is_none());

        let newest_kind = if (EDITOR_CRASH_DRAFT_LIMIT - 1) % 2 == 0 {
            "document"
        } else {
            "vocabulary"
        };
        service.delete_editor_crash_draft(newest_kind.into(), newest_id.clone())?;
        assert!(service
            .get_editor_crash_draft(newest_kind.into(), newest_id)?
            .is_none());

        assert!(service
            .save_editor_crash_draft(
                "document".into(),
                Uuid::now_v7().to_string(),
                "2026-08-10T08:00:00Z".into(),
                "not-json".into(),
            )
            .is_err());
        let oversize = format!("\"{}\"", "x".repeat(EDITOR_CRASH_DRAFT_MAX_BYTES));
        assert!(service
            .save_editor_crash_draft(
                "document".into(),
                Uuid::now_v7().to_string(),
                "2026-08-10T08:00:00Z".into(),
                oversize,
            )
            .is_err());

        drop(connection);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn vault_health_reports_schema_integrity_index_and_missing_markdown() -> Result<()> {
        let root = std::env::temp_dir().join(format!("knitspace-vault-health-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let id = Uuid::now_v7().to_string();
        service.save_markdown(
            id.clone(),
            "note".into(),
            "# 数据健康\n\nSQLite 与 Markdown。".into(),
        )?;

        let healthy = service.health()?;
        assert_eq!(healthy.schema_version, SCHEMA_VERSION);
        assert_eq!(healthy.latest_schema_version, SCHEMA_VERSION);
        assert_eq!(healthy.integrity, "ok");
        assert_eq!(healthy.document_count, 1);
        assert_eq!(healthy.note_count, 1);
        assert_eq!(healthy.fts_entry_count, 1);
        assert_eq!(healthy.missing_markdown_count, 0);
        assert!(healthy.database_size > 0);

        fs::remove_file(root.join("notes").join(format!("{id}.md")))?;
        let damaged = service.health()?;
        assert_eq!(damaged.missing_markdown_count, 1);

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn opening_the_vault_recovers_an_interrupted_markdown_replacement() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-write-recovery-{}", Uuid::now_v7()));
        let notes = root.join("notes");
        fs::create_dir_all(&notes)?;
        let id = Uuid::now_v7().to_string();
        let target = notes.join(format!("{id}.md"));
        let temporary = VaultService::document_write_artifact(&target, DOCUMENT_WRITE_TEMP_SUFFIX)?;
        let backup = VaultService::document_write_artifact(&target, DOCUMENT_WRITE_BACKUP_SUFFIX)?;
        // This is the brief Windows replacement state after the old file has
        // moved aside and the synced new sibling is ready to take its place.
        fs::write(&temporary, "# 新正文\n\n不会留下半截文件。")?;
        fs::write(&backup, "# 旧正文")?;

        let _service = VaultService::open(root.to_string_lossy().into_owned())?;
        assert_eq!(
            fs::read_to_string(&target)?,
            "# 新正文\n\n不会留下半截文件。"
        );
        assert!(!temporary.exists());
        assert!(!backup.exists());

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn opening_the_vault_discards_uncommitted_markdown_staging() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-staging-recovery-{}", Uuid::now_v7()));
        let notes = root.join("notes");
        fs::create_dir_all(&notes)?;
        let id = Uuid::now_v7().to_string();
        let target = notes.join(format!("{id}.md"));
        let staging =
            VaultService::document_write_artifact(&target, DOCUMENT_WRITE_STAGING_SUFFIX)?;
        fs::write(&target, "# 上一次已保存正文")?;
        fs::write(&staging, "# 未同步的临时片段")?;

        let _service = VaultService::open(root.to_string_lossy().into_owned())?;
        assert_eq!(fs::read_to_string(&target)?, "# 上一次已保存正文");
        assert!(!staging.exists());

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn searches_hyphenated_development_terms_as_content_not_fts_syntax() -> Result<()> {
        let root = std::env::temp_dir().join(format!("knitspace-fts-query-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let id = Uuid::now_v7().to_string();
        service.save_markdown(
            id.clone(),
            "note".into(),
            "# Vue-3 代码快照\n\n用 code-snapshot 导出长代码图。".into(),
        )?;

        let vue_matches = service.search_documents("Vue-3".into(), 12)?;
        assert_eq!(
            vue_matches.first().map(|entry| entry.id.as_str()),
            Some(id.as_str())
        );
        let snapshot_matches = service.search_documents("code-snapshot".into(), 12)?;
        assert_eq!(
            snapshot_matches.first().map(|entry| entry.id.as_str()),
            Some(id.as_str())
        );

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn unified_search_indexes_source_bodies_and_updated_tags() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-source-fts-query-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let id = Uuid::now_v7().to_string();
        service.save_source(VaultSource {
            id: id.clone(),
            name: "bellman-ford-notes.txt".into(),
            kind: "code".into(),
            mime: "text/plain".into(),
            size: 48,
            sha256: Some("source-search-hash".into()),
            imported_at: "2026-08-12T08:00:00Z".into(),
            last_opened_at: None,
            original_path: None,
            managed_path: None,
            page_count: None,
            tags: vec!["图论".into()],
            content: Some("Bellman-Ford 通过反复松弛边来处理负权最短路。".into()),
            preview: None,
            crops: None,
        })?;

        let body_matches = service.search_documents("松弛".into(), 12)?;
        let body_result = body_matches.iter().find(|entry| entry.id == id).unwrap();
        assert_eq!(body_result.kind, "source");
        assert_eq!(body_result.subject, "code");
        assert_eq!(body_result.tags, vec!["图论"]);
        assert!(body_result.snippet.contains('['));

        service.save_source_tags(id.clone(), vec!["动态规划".into(), "负权图".into()])?;
        let tag_matches = service.search_documents("动态规划".into(), 12)?;
        let tag_result = tag_matches.iter().find(|entry| entry.id == id).unwrap();
        assert_eq!(tag_result.tags, vec!["动态规划", "负权图"]);

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn source_fts_migration_backfills_existing_records() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-source-fts-migration-{}", Uuid::now_v7()));
        let id = Uuid::now_v7().to_string();
        {
            let service = VaultService::open(root.to_string_lossy().into_owned())?;
            service.save_source(VaultSource {
                id: id.clone(),
                name: "operating-system.txt".into(),
                kind: "text".into(),
                mime: "text/plain".into(),
                size: 32,
                sha256: Some("source-migration-search-hash".into()),
                imported_at: "2026-08-12T09:00:00Z".into(),
                last_opened_at: None,
                original_path: None,
                managed_path: None,
                page_count: None,
                tags: vec!["操作系统".into()],
                content: Some("银行家算法用于避免系统进入不安全状态。".into()),
                preview: None,
                crops: None,
            })?;
            let connection = service.connection()?;
            connection.execute("DELETE FROM schema_migrations WHERE version >= 17", [])?;
            connection.execute("DROP TABLE sources_fts", [])?;
        }

        let reopened = VaultService::open(root.to_string_lossy().into_owned())?;
        let matches = reopened.search_documents("银行家算法".into(), 12)?;
        assert_eq!(
            matches
                .iter()
                .find(|entry| entry.id == id)
                .map(|entry| entry.kind.as_str()),
            Some("source")
        );
        assert_eq!(
            reopened.connection()?.query_row(
                "SELECT MAX(version) FROM schema_migrations",
                [],
                |row| row.get::<_, i64>(0)
            )?,
            SCHEMA_VERSION
        );

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn finds_exact_wiki_backlinks_without_reading_every_note_in_the_renderer() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-wiki-backlinks-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let target_id = Uuid::now_v7().to_string();
        let linked_id = Uuid::now_v7().to_string();
        let similarly_named_id = Uuid::now_v7().to_string();
        service.save_markdown(
            target_id.clone(),
            "note".into(),
            "# 二分\n\n边界条件。".into(),
        )?;
        service.save_markdown(
            linked_id.clone(),
            "note".into(),
            "# 关联笔记\n\n[[二分]] [[二分#边界]] [[二分|别名]]".into(),
        )?;
        service.save_markdown(
            similarly_named_id,
            "note".into(),
            "# 不应命中\n\n[[二分法]]".into(),
        )?;

        let backlinks = service.find_wiki_backlinks("二分".into(), target_id, 12)?;
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].id, linked_id);
        assert_eq!(backlinks[0].snippet, "[[二分]]");
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn wiki_link_projection_aggregates_exact_targets_and_updates_with_document_save() -> Result<()>
    {
        let root = std::env::temp_dir().join(format!("knitspace-wiki-graph-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let source_id = Uuid::now_v7().to_string();
        let target_id = Uuid::now_v7().to_string();
        let duplicate_one = Uuid::now_v7().to_string();
        let duplicate_two = Uuid::now_v7().to_string();
        service.save_markdown(
            target_id.clone(),
            "note".into(),
            "# 目标知识\n\n正文".into(),
        )?;
        service.save_markdown(duplicate_one, "note".into(), "# 同名目标\n\n一".into())?;
        service.save_markdown(duplicate_two, "question".into(), "# 同名目标\n\n二".into())?;
        service.save_markdown(
            source_id.clone(),
            "note".into(),
            "# 来源\n\n[[目标知识#定义]] [[目标知识|别名]] [[尚未创建]] [[同名目标]]".into(),
        )?;

        let projection = service.list_wiki_links(100)?;
        assert_eq!(projection.links.len(), 1);
        assert_eq!(projection.links[0].from_id, source_id);
        assert_eq!(projection.links[0].to_id, target_id);
        assert_eq!(projection.links[0].occurrences, 2);
        assert_eq!(projection.links[0].headings, vec!["定义"]);
        assert_eq!(projection.unresolved_count, 1);
        assert_eq!(projection.ambiguous_count, 1);
        assert!(!projection.truncated);

        service.save_markdown(
            source_id.clone(),
            "note".into(),
            "# 来源\n\n双链已移除。".into(),
        )?;
        let updated = service.list_wiki_links(100)?;
        assert!(updated.links.iter().all(|link| link.from_id != source_id));
        assert_eq!(updated.unresolved_count, 0);
        assert_eq!(updated.ambiguous_count, 0);

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn wiki_link_schema_migration_backfills_existing_markdown() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-wiki-migration-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let target_id = Uuid::now_v7().to_string();
        let source_id = Uuid::now_v7().to_string();
        service.save_markdown(
            target_id.clone(),
            "note".into(),
            "# 迁移目标\n\n正文".into(),
        )?;
        service.save_markdown(
            source_id.clone(),
            "note".into(),
            "# 迁移来源\n\n[[迁移目标]]".into(),
        )?;
        let connection = service.connection()?;
        connection.execute_batch(
            "DROP TABLE document_wiki_links; DELETE FROM schema_migrations WHERE version >= 18;",
        )?;
        drop(connection);

        let reopened = VaultService::open(root.to_string_lossy().into_owned())?;
        let projection = reopened.list_wiki_links(20)?;
        assert_eq!(projection.links.len(), 1);
        assert_eq!(projection.links[0].from_id, source_id);
        assert_eq!(projection.links[0].to_id, target_id);
        assert_eq!(
            reopened.connection()?.query_row(
                "SELECT MAX(version) FROM schema_migrations",
                [],
                |row| row.get::<_, i64>(0)
            )?,
            SCHEMA_VERSION
        );

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn question_batch_commits_markdown_fts_and_review_cards_together() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-question-batch-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let first_id = Uuid::now_v7().to_string();
        let second_id = Uuid::now_v7().to_string();
        let first = test_document(first_id.clone(), "批量题目一");
        let mut second = test_document(second_id.clone(), "批量题目二");
        second.question_details.as_mut().unwrap().stem = "为什么需要循环不变量？".into();
        second.review = None;
        second.review_facets.insert(
            "error".into(),
            json!({ "due": "2026-08-12T00:00:00Z", "intervalDays": 0, "repetitions": 0, "lapses": 0 }),
        );
        service.save_question_batch(vec![first, second])?;

        let connection = service.connection()?;
        let question_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM questions WHERE entity_id IN (?1, ?2)",
            (&first_id, &second_id),
            |row| row.get(0),
        )?;
        let card_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM review_cards WHERE entity_id IN (?1, ?2)",
            (&first_id, &second_id),
            |row| row.get(0),
        )?;
        drop(connection);
        assert_eq!(question_count, 2);
        assert_eq!(card_count, 2);
        assert!(root
            .join("questions")
            .join(format!("{first_id}.md"))
            .is_file());
        assert!(root
            .join("questions")
            .join(format!("{second_id}.md"))
            .is_file());
        assert_eq!(
            service.search_documents("循环不变量".into(), 12)?[0].id,
            second_id
        );

        let rejected_id = Uuid::now_v7().to_string();
        let mut rejected = test_document(rejected_id.clone(), "不应留下半份数据");
        rejected.kind = "note".into();
        assert!(service.save_question_batch(vec![rejected]).is_err());
        assert!(!root
            .join("questions")
            .join(format!("{rejected_id}.md"))
            .exists());
        assert!(service.get_document(rejected_id).is_err());
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn hydrates_browser_documents_once_and_keeps_structured_metadata() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-vault-hydration-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let first_id = Uuid::now_v7().to_string();
        let first = test_document(first_id.clone(), "Dijkstra 的边界");
        let hydration = service.hydrate_documents(vec![first.clone()], vec![], vec![])?;
        assert!(hydration.migrated);
        assert_eq!(hydration.documents.len(), 1);
        assert_eq!(hydration.documents[0].tags, vec!["图论", "最短路"]);
        assert_eq!(hydration.documents[0].folder.as_deref(), Some("算法/图论"));
        assert_eq!(
            hydration.documents[0]
                .review
                .as_ref()
                .and_then(|value| value.get("due"))
                .and_then(|value| value.as_str()),
            Some("2026-08-10T00:00:00Z")
        );
        assert_eq!(
            hydration.documents[0]
                .external_file
                .as_ref()
                .and_then(|value| value.get("name"))
                .and_then(|value| value.as_str()),
            Some("dijkstra.md")
        );
        assert!(hydration.documents[0].content.is_empty());
        assert!(hydration.documents[0].question_details.is_none());
        let loaded = service.get_document(first_id.clone())?;
        assert_eq!(
            loaded
                .question_details
                .as_ref()
                .map(|value| value.stem.as_str()),
            Some("Dijkstra 能否处理负边？")
        );
        assert_eq!(loaded.content, first.content);
        let matches = service.search_documents("Dijkstra".into(), 12)?;
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].id, first_id);
        assert_eq!(matches[0].subject, "算法");
        let structured_matches = service.search_documents("precondition".into(), 12)?;
        assert_eq!(structured_matches[0].id, first_id);
        let chinese_structured_matches = service.search_documents("负边".into(), 12)?;
        assert_eq!(chinese_structured_matches[0].id, hydration.documents[0].id);

        // A second start must load Vault data, never import stale browser data
        // again over the user's desktop edits.
        let stale = test_document(Uuid::now_v7().to_string(), "浏览器旧副本");
        let second = service.hydrate_documents(vec![stale], vec![], vec![])?;
        assert!(!second.migrated);
        assert_eq!(second.documents.len(), 1);
        assert_eq!(second.documents[0].id, first_id);

        let mut edited = first;
        edited.title = "Dijkstra 的更新标题".into();
        edited.content = "# Dijkstra 的更新标题\n\n更新后的正文。".into();
        edited.review = None;
        service.save_document(edited.clone())?;
        {
            let connection = service.connection()?;
            let card_count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM review_cards WHERE entity_id = ?1",
                [&first_id],
                |row| row.get(0),
            )?;
            assert_eq!(card_count, 0);
        }
        let after_save = service.list_documents()?;
        assert_eq!(after_save[0].title, "Dijkstra 的更新标题");
        assert_eq!(after_save[0].content, edited.content);

        let replacement = test_document(Uuid::now_v7().to_string(), "恢复后的唯一文档");
        service.replace_documents(vec![replacement.clone()])?;
        let after_restore = service.list_documents()?;
        assert_eq!(after_restore.len(), 1);
        assert_eq!(after_restore[0].id, replacement.id);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn interrupted_browser_migration_resumes_missing_entities_without_overwriting_native_data(
    ) -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-resumable-hydration-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;

        // Simulate a process exit after the first document, word, and relation
        // reached SQLite but before any migration marker was committed.
        let native_document = test_document(Uuid::now_v7().to_string(), "SQLite 中的新标题");
        let native_word = test_vocabulary(Uuid::now_v7().to_string());
        service.save_document(native_document.clone())?;
        service.save_vocabulary(native_word.clone())?;
        let first_relation = VaultRelation {
            from_id: native_document.id.clone(),
            to_id: native_word.id.clone(),
            relation_type: "related".into(),
            created_at: "2026-08-11T00:00:00Z".into(),
        };
        service.save_relation(first_relation.clone())?;

        let mut stale_document = native_document.clone();
        stale_document.title = "浏览器里的旧标题".into();
        let missing_document = test_document(Uuid::now_v7().to_string(), "尚未导入的文档");
        let mut stale_word = native_word.clone();
        stale_word.lemma = "stale-browser-word".into();
        let missing_word = test_vocabulary(Uuid::now_v7().to_string());
        let missing_relation = VaultRelation {
            from_id: missing_document.id.clone(),
            to_id: missing_word.id.clone(),
            relation_type: "prerequisite".into(),
            created_at: "2026-08-12T00:00:00Z".into(),
        };

        let hydration = service.hydrate_documents(
            vec![stale_document, missing_document.clone()],
            vec![stale_word, missing_word.clone()],
            vec![first_relation, missing_relation.clone()],
        )?;
        assert!(hydration.migrated);
        assert_eq!(hydration.documents.len(), 2);
        assert_eq!(hydration.vocabulary.len(), 2);
        assert_eq!(hydration.relations.len(), 2);
        assert_eq!(
            service.get_document(native_document.id.clone())?.title,
            "SQLite 中的新标题"
        );
        assert_eq!(
            service
                .list_vocabulary()?
                .into_iter()
                .find(|entry| entry.id == native_word.id)
                .map(|entry| entry.lemma),
            Some(native_word.lemma)
        );
        assert!(service
            .list_relations()?
            .into_iter()
            .any(|relation| relation == missing_relation));

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn stores_question_answer_and_error_reviews_as_independent_cards() -> Result<()> {
        let root = std::env::temp_dir().join(format!(
            "knitspace-question-review-facets-{}",
            Uuid::now_v7()
        ));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let mut document = test_document(Uuid::now_v7().to_string(), "独立错因复习");
        document.review_facets.insert(
            "error".into(),
            json!({ "due": "2026-08-12T00:00:00Z", "intervalDays": 2, "repetitions": 1, "lapses": 0 }),
        );
        service.save_document(document.clone())?;

        let loaded = service.get_document(document.id.clone())?;
        assert_eq!(
            loaded
                .review_facets
                .get("error")
                .and_then(|value| value.get("due"))
                .and_then(|value| value.as_str()),
            Some("2026-08-12T00:00:00Z")
        );
        {
            let connection = service.connection()?;
            let facets: Vec<String> = connection
                .prepare("SELECT facet FROM review_cards WHERE entity_id = ?1 ORDER BY facet")?
                .query_map([&document.id], |row| row.get(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            assert_eq!(facets, vec!["default", "error"]);
        }

        document.review_facets.clear();
        service.save_document(document.clone())?;
        let connection = service.connection()?;
        let remaining: i64 = connection.query_row(
            "SELECT COUNT(*) FROM review_cards WHERE entity_id = ?1",
            [&document.id],
            |row| row.get(0),
        )?;
        assert_eq!(remaining, 1);
        drop(connection);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn hydrates_browser_vocabulary_once_without_overwriting_desktop_data() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-vocabulary-hydration-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let first = test_vocabulary(Uuid::now_v7().to_string());
        let first_id = first.id.clone();
        let hydration = service.hydrate_documents(vec![], vec![first], vec![])?;
        assert!(hydration.migrated);
        assert_eq!(hydration.vocabulary.len(), 1);
        assert_eq!(hydration.vocabulary[0].id, first_id);
        assert!(root
            .join(".toolknit/migrations")
            .read_dir()?
            .any(|entry| entry
                .map(|value| value
                    .file_name()
                    .to_string_lossy()
                    .contains("browser-vocabulary-before-vault"))
                .unwrap_or(false)));

        let stale = test_vocabulary(Uuid::now_v7().to_string());
        let second = service.hydrate_documents(vec![], vec![stale], vec![])?;
        assert!(!second.migrated);
        assert_eq!(second.vocabulary.len(), 1);
        assert_eq!(second.vocabulary[0].id, first_id);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn migrates_and_preserves_entity_relations() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-relation-hydration-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let document = test_document(Uuid::now_v7().to_string(), "Dijkstra 的边界");
        let word = test_vocabulary(Uuid::now_v7().to_string());
        let relation = VaultRelation {
            from_id: document.id.clone(),
            to_id: word.id.clone(),
            relation_type: "related".into(),
            created_at: "2026-08-09T00:00:00Z".into(),
        };
        let hydration =
            service.hydrate_documents(vec![document], vec![word], vec![relation.clone()])?;
        assert!(hydration.migrated);
        assert_eq!(hydration.relations, vec![relation.clone()]);
        service.save_relation(relation.clone())?;
        assert_eq!(service.list_relations()?.len(), 1);
        service.delete_relation(relation)?;
        assert!(service.list_relations()?.is_empty());
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn stores_vocabulary_as_independent_senses_and_indexes_definitions() -> Result<()> {
        let root = std::env::temp_dir().join(format!("knitspace-vocabulary-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let entry = test_vocabulary(Uuid::now_v7().to_string());
        let sense_id = entry.senses[0].id.clone();
        let mut entry = entry;
        entry.senses[0].review_facets.insert(
            "spelling".into(),
            json!({ "due": "2026-08-11T00:00:00Z", "intervalDays": 2, "repetitions": 1, "lapses": 0 }),
        );
        service.save_vocabulary(entry.clone())?;
        let loaded = service.list_vocabulary()?;
        assert_eq!(loaded.len(), 1);
        assert_eq!(
            loaded[0].forms.get("past").and_then(|value| value.as_str()),
            Some("ran")
        );
        assert_eq!(
            loaded[0].senses[0].examples,
            vec!["The program runs locally."]
        );
        assert_eq!(
            loaded[0].senses[0].collocations,
            vec!["run a program", "run locally"]
        );
        assert_eq!(
            loaded[0].senses[0]
                .review_facets
                .get("spelling")
                .and_then(|value| value.get("due"))
                .and_then(|value| value.as_str()),
            Some("2026-08-11T00:00:00Z")
        );
        let search = service.search_documents("operate".into(), 12)?;
        assert_eq!(search[0].kind, "word");
        assert_eq!(search[0].id, entry.id);
        let chinese_search = service.search_documents("运行".into(), 12)?;
        assert_eq!(chinese_search[0].id, loaded[0].id);
        let form_search = service.search_documents("ran".into(), 12)?;
        assert_eq!(form_search[0].id, loaded[0].id);
        let example_search = service.search_documents("locally".into(), 12)?;
        assert_eq!(example_search[0].id, loaded[0].id);
        let collocation_search = service.search_documents("run a program".into(), 12)?;
        assert_eq!(collocation_search[0].id, loaded[0].id);
        let connection = service.connection()?;
        let cards: i64 = connection.query_row(
            "SELECT COUNT(*) FROM review_cards WHERE entity_id = ?1 AND facet = ?2",
            (&entry.id, format!("sense:{sense_id}")),
            |row| row.get(0),
        )?;
        assert_eq!(cards, 1);
        let spelling_cards: i64 = connection.query_row(
            "SELECT COUNT(*) FROM review_cards WHERE entity_id = ?1 AND facet = ?2",
            (&entry.id, format!("sense:{sense_id}:spelling")),
            |row| row.get(0),
        )?;
        assert_eq!(spelling_cards, 1);
        drop(connection);
        let mut without_review = entry;
        without_review.senses[0].review_enabled = false;
        without_review.senses[0].review = None;
        without_review.senses[0].review_facets.clear();
        service.save_vocabulary(without_review)?;
        let connection = service.connection()?;
        let cards: i64 = connection.query_row(
            "SELECT COUNT(*) FROM review_cards WHERE entity_id = ?1",
            [&loaded[0].id],
            |row| row.get(0),
        )?;
        assert_eq!(cards, 0);
        drop(connection);
        service.delete_vocabulary(loaded[0].id.clone())?;
        assert!(service.list_vocabulary()?.is_empty());
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn imports_vocabulary_batch_atomically() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-vocabulary-batch-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let first = test_vocabulary(Uuid::now_v7().to_string());
        let mut invalid = test_vocabulary(Uuid::now_v7().to_string());
        invalid.lemma = "   ".into();

        assert!(service
            .save_vocabulary_batch(vec![first.clone(), invalid])
            .is_err());
        assert!(service.list_vocabulary()?.is_empty());

        let mut second = test_vocabulary(Uuid::now_v7().to_string());
        second.lemma = "compile".into();
        service.save_vocabulary_batch(vec![first, second])?;
        let loaded = service.list_vocabulary()?;
        assert_eq!(loaded.len(), 2);
        assert!(loaded.iter().any(|entry| entry.lemma == "run"));
        assert!(loaded.iter().any(|entry| entry.lemma == "compile"));

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn vocabulary_fts_migration_rebuilds_existing_inflection_search() -> Result<()> {
        let root = std::env::temp_dir().join(format!(
            "knitspace-vocabulary-fts-migration-{}",
            Uuid::now_v7()
        ));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let entry = test_vocabulary(Uuid::now_v7().to_string());
        let id = entry.id.clone();
        service.save_vocabulary(entry)?;

        // Simulate a pre-v9 Vault: its vocabulary row and metadata exist, but
        // the old FTS entry is absent or lacks inflections. Opening the Vault
        // again must repair only that search projection.
        let connection = service.connection()?;
        connection.execute("DELETE FROM documents_fts WHERE entity_id = ?1", [&id])?;
        // Remove v9 and every later marker. A real pre-v9 Vault cannot carry a
        // v10 marker, and leaving it behind would correctly tell the migrator
        // that no older projection rebuild is needed.
        connection.execute("DELETE FROM schema_migrations WHERE version >= 9", [])?;
        drop(connection);

        let reopened = VaultService::open(root.to_string_lossy().into_owned())?;
        let matches = reopened.search_documents("ran".into(), 12)?;
        assert_eq!(
            matches.first().map(|result| result.id.as_str()),
            Some(id.as_str())
        );
        let connection = reopened.connection()?;
        let version: i64 =
            connection.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })?;
        assert_eq!(version, SCHEMA_VERSION);
        drop(connection);

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn vocabulary_collocations_migrate_from_v13_and_reindex() -> Result<()> {
        let root = std::env::temp_dir().join(format!(
            "knitspace-vocabulary-collocation-migration-{}",
            Uuid::now_v7()
        ));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let entry = test_vocabulary(Uuid::now_v7().to_string());
        let id = entry.id.clone();
        service.save_vocabulary(entry)?;

        let connection = service.connection()?;
        connection.execute(
            "ALTER TABLE vocabulary_senses DROP COLUMN collocations_json",
            [],
        )?;
        connection.execute("DELETE FROM schema_migrations WHERE version >= 14", [])?;
        drop(connection);

        let reopened = VaultService::open(root.to_string_lossy().into_owned())?;
        let mut loaded = reopened.list_vocabulary()?;
        assert!(loaded[0].senses[0].collocations.is_empty());
        loaded[0].senses[0].collocations = vec!["run a program".into()];
        reopened.save_vocabulary(loaded.remove(0))?;
        let matches = reopened.search_documents("run a program".into(), 12)?;
        assert_eq!(
            matches.first().map(|item| item.id.as_str()),
            Some(id.as_str())
        );
        let connection = reopened.connection()?;
        let version: i64 =
            connection.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })?;
        assert_eq!(version, SCHEMA_VERSION);
        drop(connection);

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn lists_multiple_vocabulary_entries_without_mixing_their_senses() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-vocabulary-list-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let mut newest = test_vocabulary(Uuid::now_v7().to_string());
        newest.lemma = "move".into();
        newest.updated_at = "2026-08-12T00:00:00Z".into();
        let mut second_sense = newest.senses[0].clone();
        second_sense.id = Uuid::now_v7().to_string();
        second_sense.part_of_speech = "noun".into();
        second_sense.definition = "一次移动".into();
        second_sense.review_facets.insert(
            "example".into(),
            json!({ "due": "2026-08-13T00:00:00Z", "intervalDays": 1, "repetitions": 0, "lapses": 0 }),
        );
        newest.senses.push(second_sense);
        service.save_vocabulary(newest.clone())?;

        let mut older = test_vocabulary(Uuid::now_v7().to_string());
        older.lemma = "run".into();
        older.updated_at = "2026-08-11T00:00:00Z".into();
        service.save_vocabulary(older.clone())?;

        let loaded = service.list_vocabulary()?;
        assert_eq!(
            loaded
                .iter()
                .map(|entry| entry.lemma.as_str())
                .collect::<Vec<_>>(),
            vec!["move", "run"]
        );
        assert_eq!(loaded[0].senses.len(), 2);
        assert_eq!(loaded[0].senses[1].definition, "一次移动");
        assert_eq!(
            loaded[0].senses[1]
                .review_facets
                .get("example")
                .and_then(|value| value.get("due"))
                .and_then(|value| value.as_str()),
            Some("2026-08-13T00:00:00Z")
        );
        assert_eq!(loaded[1].id, older.id);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn stores_and_removes_structured_timeline_events() -> Result<()> {
        let root = std::env::temp_dir().join(format!("knitspace-events-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let id = Uuid::now_v7().to_string();
        service.save_event(VaultEvent {
            id: id.clone(),
            event_type: "pomodoro".into(),
            starts_at: "2026-08-09T08:00:00Z".into(),
            payload: json!({ "title": "算法练习", "actualMinutes": 25, "status": "completed" }),
            created_at: "2026-08-09T08:00:00Z".into(),
            updated_at: "2026-08-09T08:25:00Z".into(),
        })?;
        let events = service.list_events(20)?;
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "pomodoro");
        assert_eq!(
            events[0]
                .payload
                .get("actualMinutes")
                .and_then(|value| value.as_i64()),
            Some(25)
        );
        service.delete_event(id)?;
        assert!(service.list_events(20)?.is_empty());
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn replacing_activity_events_preserves_focus_and_anniversary_records() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-activity-events-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let focus_id = Uuid::now_v7().to_string();
        service.save_event(VaultEvent {
            id: focus_id.clone(),
            event_type: "pomodoro".into(),
            starts_at: "2026-08-09T08:00:00Z".into(),
            payload: json!({ "title": "算法练习", "actualMinutes": 25 }),
            created_at: "2026-08-09T08:00:00Z".into(),
            updated_at: "2026-08-09T08:25:00Z".into(),
        })?;
        let activity_id = Uuid::now_v7().to_string();
        service.replace_activity_events(vec![VaultEvent {
            id: activity_id.clone(),
            event_type: "activity".into(),
            starts_at: "2026-08-09T09:00:00Z".into(),
            payload: json!({ "kind": "output", "title": "复制代码图片" }),
            created_at: "2026-08-09T09:00:00Z".into(),
            updated_at: "2026-08-09T09:00:00Z".into(),
        }])?;
        let events = service.list_events(20)?;
        assert_eq!(events.len(), 2);
        assert!(events
            .iter()
            .any(|event| event.id == focus_id && event.event_type == "pomodoro"));
        assert!(events
            .iter()
            .any(|event| event.id == activity_id && event.event_type == "activity"));
        service.replace_activity_events(vec![])?;
        let events = service.list_events(20)?;
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, focus_id);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn event_feeds_do_not_crowd_each_other_out() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-filtered-events-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let focus_id = Uuid::now_v7().to_string();
        let anniversary_id = Uuid::now_v7().to_string();
        service.save_event(VaultEvent {
            id: focus_id.clone(),
            event_type: "pomodoro".into(),
            starts_at: "2026-01-01T08:00:00Z".into(),
            payload: json!({ "title": "算法练习", "actualMinutes": 25 }),
            created_at: "2026-01-01T08:00:00Z".into(),
            updated_at: "2026-01-01T08:25:00Z".into(),
        })?;
        service.save_event(VaultEvent {
            id: anniversary_id.clone(),
            event_type: "anniversary".into(),
            starts_at: "2020-05-20T12:00:00Z".into(),
            payload: json!({ "title": "开始学习", "recurring": true }),
            created_at: "2020-05-20T12:00:00Z".into(),
            updated_at: "2026-01-01T09:00:00Z".into(),
        })?;
        let activities = (0..90)
            .map(|index| VaultEvent {
                id: Uuid::now_v7().to_string(),
                event_type: "activity".into(),
                starts_at: format!("2026-08-10T{:02}:{:02}:00Z", 10 + index / 60, index % 60),
                payload: json!({ "kind": "system", "title": format!("操作 {index}") }),
                created_at: "2026-08-10T10:00:00Z".into(),
                updated_at: "2026-08-10T10:00:00Z".into(),
            })
            .collect();
        service.replace_activity_events(activities)?;

        assert!(service
            .list_events(80)?
            .iter()
            .all(|event| event.event_type == "activity"));
        let personal = service.list_personal_events(80)?;
        assert_eq!(personal.len(), 2);
        assert!(personal.iter().any(|event| event.id == focus_id));
        assert!(personal.iter().any(|event| event.id == anniversary_id));
        assert_eq!(service.list_activity_events(80)?.len(), 80);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn source_list_omits_heavy_detail_until_requested() -> Result<()> {
        let root = std::env::temp_dir().join(format!("knitspace-sources-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let id = Uuid::now_v7().to_string();
        let crop_id = Uuid::now_v7().to_string();
        let mut crops = HashMap::new();
        crops.insert(crop_id.clone(), "data:image/png;base64,crop".into());
        service.save_source(VaultSource {
            id: id.clone(),
            name: "lecture.pdf".into(),
            kind: "pdf".into(),
            mime: "application/pdf".into(),
            size: 5_242_880,
            sha256: Some("source-hash".into()),
            imported_at: "2026-08-09T08:00:00Z".into(),
            last_opened_at: None,
            original_path: Some("F:/Downloads/lecture.pdf".into()),
            managed_path: None,
            page_count: Some(12),
            tags: vec!["算法".into()],
            content: None,
            preview: Some("data:application/pdf;base64,large-preview".into()),
            crops: Some(crops),
        })?;
        let connection = service.connection()?;
        let (database_preview, preview_path, crops_json): (Option<String>, Option<String>, String) =
            connection.query_row(
                "SELECT preview_data, preview_path, crops_json FROM source_records WHERE id = ?1",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
        assert!(database_preview.is_none());
        assert!(preview_path
            .as_deref()
            .is_some_and(|path| root.join(path).is_file()));
        let stored_crops: HashMap<String, String> = serde_json::from_str(&crops_json)?;
        assert!(stored_crops
            .get(&crop_id)
            .is_some_and(|path| root.join(path).is_file()));
        drop(connection);
        let listed = service.list_sources()?;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "lecture.pdf");
        assert!(listed[0].preview.is_none());
        assert!(listed[0].content.is_none());
        assert!(listed[0].crops.is_none());
        let detail = service.get_source(id.clone())?;
        assert_eq!(
            detail.preview.as_deref(),
            Some("data:application/pdf;base64,large-preview")
        );
        assert_eq!(
            detail
                .crops
                .as_ref()
                .and_then(|items| items.get(&crop_id))
                .map(String::as_str),
            Some("data:image/png;base64,crop")
        );
        let saved_tags = service.save_source_tags(
            id.clone(),
            vec![" 算法 ".into(), "图论".into(), "算法".into()],
        )?;
        assert_eq!(saved_tags, vec!["算法", "图论"]);
        let tagged_detail = service.get_source(id.clone())?;
        assert_eq!(tagged_detail.tags, saved_tags);
        assert_eq!(
            tagged_detail.preview.as_deref(),
            Some("data:application/pdf;base64,large-preview")
        );
        assert!(tagged_detail
            .crops
            .as_ref()
            .is_some_and(|items| items.contains_key(&crop_id)));
        service.touch_source(id.clone())?;
        assert!(service.list_sources()?[0].last_opened_at.is_some());
        service.save_source_crops(id.clone(), HashMap::new())?;
        assert!(service.get_source_crop(id, crop_id)?.is_none());
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn content_favorites_migrate_validate_persist_and_follow_entity_deletion() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-content-favorites-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let question_id = Uuid::now_v7().to_string();
        let word = test_vocabulary(Uuid::now_v7().to_string());
        let word_id = word.id.clone();
        let source_id = Uuid::now_v7().to_string();
        service.save_document(test_document(question_id.clone(), "收藏测试题"))?;
        service.save_vocabulary(word)?;
        service.save_source(VaultSource {
            id: source_id.clone(),
            name: "favorite.pdf".into(),
            kind: "pdf".into(),
            mime: "application/pdf".into(),
            size: 42,
            sha256: Some("favorite-source-hash".into()),
            imported_at: "2026-08-10T00:00:00Z".into(),
            last_opened_at: None,
            original_path: None,
            managed_path: None,
            page_count: Some(1),
            tags: vec![],
            content: None,
            preview: None,
            crops: None,
        })?;

        let migrated = service.hydrate_content_favorites(vec![
            ContentFavorite {
                item_id: question_id.clone(),
                item_kind: "question".into(),
                added_at: "2026-08-10T03:00:00Z".into(),
            },
            ContentFavorite {
                item_id: word_id.clone(),
                item_kind: "word".into(),
                added_at: "2026-08-10T02:00:00Z".into(),
            },
            ContentFavorite {
                item_id: source_id.clone(),
                item_kind: "source".into(),
                added_at: "2026-08-10T01:00:00Z".into(),
            },
            ContentFavorite {
                item_id: Uuid::now_v7().to_string(),
                item_kind: "note".into(),
                added_at: "2026-08-10T04:00:00Z".into(),
            },
        ])?;
        assert_eq!(migrated.len(), 3);
        assert_eq!(migrated[0].item_id, question_id);
        assert!(root
            .join(".toolknit/migrations")
            .read_dir()?
            .flatten()
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("browser-content-favorites-before-vault-")));

        assert!(service
            .set_content_favorite(source_id.clone(), "source".into(), false)?
            .is_none());
        assert_eq!(service.list_content_favorites()?.len(), 2);
        assert!(service
            .set_content_favorite(source_id.clone(), "source".into(), true)?
            .is_some());
        assert!(service
            .set_content_favorite(Uuid::now_v7().to_string(), "note".into(), true)
            .is_err());
        assert!(service
            .set_content_favorite(source_id.clone(), "diagram".into(), true)
            .is_err());

        let restored = service.replace_content_favorites(vec![
            ContentFavorite {
                item_id: word_id.clone(),
                item_kind: "word".into(),
                added_at: "2026-08-10T06:00:00Z".into(),
            },
            ContentFavorite {
                item_id: source_id.clone(),
                item_kind: "source".into(),
                added_at: "2026-08-10T05:00:00Z".into(),
            },
            ContentFavorite {
                item_id: Uuid::now_v7().to_string(),
                item_kind: "note".into(),
                added_at: "2026-08-10T07:00:00Z".into(),
            },
        ])?;
        assert_eq!(restored.len(), 2);
        assert_eq!(restored[0].item_id, word_id);
        assert!(service
            .set_content_favorite(question_id.clone(), "question".into(), true)?
            .is_some());

        service.delete_document(question_id.clone())?;
        service.delete_vocabulary(word_id.clone())?;
        let remaining = service.list_content_favorites()?;
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].item_kind, "source");
        drop(service);
        let reopened = VaultService::open(root.to_string_lossy().into_owned())?;
        assert_eq!(reopened.list_content_favorites()?.len(), 1);
        let connection = reopened.connection()?;
        assert_eq!(
            connection.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row
                .get::<_, i64>(
                0
            ))?,
            SCHEMA_VERSION
        );
        drop(connection);
        drop(reopened);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn content_recents_track_real_opens_restore_and_follow_entity_deletion() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-content-recents-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let question_id = Uuid::now_v7().to_string();
        let word = test_vocabulary(Uuid::now_v7().to_string());
        let word_id = word.id.clone();
        let source_id = Uuid::now_v7().to_string();
        service.save_document(test_document(question_id.clone(), "最近打开测试题"))?;
        service.save_vocabulary(word)?;
        service.save_source(VaultSource {
            id: source_id.clone(),
            name: "recent.pdf".into(),
            kind: "pdf".into(),
            mime: "application/pdf".into(),
            size: 42,
            sha256: Some("recent-source-hash".into()),
            imported_at: "2026-08-10T00:00:00Z".into(),
            last_opened_at: None,
            original_path: None,
            managed_path: None,
            page_count: Some(1),
            tags: vec![],
            content: None,
            preview: None,
            crops: None,
        })?;

        let migrated = service.hydrate_content_recents(vec![
            ContentRecent {
                item_id: word_id.clone(),
                item_kind: "word".into(),
                opened_at: "2020-08-10T01:00:00Z".into(),
            },
            ContentRecent {
                item_id: Uuid::now_v7().to_string(),
                item_kind: "note".into(),
                opened_at: "2020-08-10T02:00:00Z".into(),
            },
        ])?;
        assert_eq!(migrated.len(), 1);
        assert_eq!(migrated[0].item_id, word_id);
        assert!(root
            .join(".toolknit/migrations")
            .read_dir()?
            .flatten()
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("browser-content-recents-before-vault-")));

        service.touch_source(source_id.clone())?;
        assert_eq!(service.list_content_recents()?[0].item_id, source_id);
        assert!(service
            .get_source(source_id.clone())?
            .last_opened_at
            .is_some());
        service.touch_content_recent(question_id.clone(), "question".into())?;
        assert_eq!(service.list_content_recents()?[0].item_id, question_id);
        service.touch_content_recent(word_id.clone(), "word".into())?;
        let reopened_word = service.list_content_recents()?;
        assert_eq!(reopened_word.len(), 3);
        assert_eq!(reopened_word[0].item_id, word_id);
        assert!(service
            .touch_content_recent(Uuid::now_v7().to_string(), "note".into())
            .is_err());
        assert!(service
            .touch_content_recent(source_id.clone(), "diagram".into())
            .is_err());

        service.remove_content_recent(question_id.clone(), "question".into())?;
        assert_eq!(service.list_content_recents()?.len(), 2);
        let restored = service.replace_content_recents(vec![
            ContentRecent {
                item_id: question_id.clone(),
                item_kind: "question".into(),
                opened_at: "2026-08-10T03:00:00Z".into(),
            },
            ContentRecent {
                item_id: source_id.clone(),
                item_kind: "source".into(),
                opened_at: "2026-08-10T02:00:00Z".into(),
            },
            ContentRecent {
                item_id: Uuid::now_v7().to_string(),
                item_kind: "note".into(),
                opened_at: "2026-08-10T04:00:00Z".into(),
            },
        ])?;
        assert_eq!(restored.len(), 2);
        assert_eq!(restored[0].item_id, question_id);
        service.clear_content_recents()?;
        assert!(service.list_content_recents()?.is_empty());

        service.touch_content_recent(word_id.clone(), "word".into())?;
        service.delete_vocabulary(word_id)?;
        assert!(service.list_content_recents()?.is_empty());
        service.touch_content_recent(question_id.clone(), "question".into())?;
        service.delete_document(question_id)?;
        assert!(service.list_content_recents()?.is_empty());

        drop(service);
        let reopened = VaultService::open(root.to_string_lossy().into_owned())?;
        assert!(reopened.list_content_recents()?.is_empty());
        let connection = reopened.connection()?;
        assert_eq!(
            connection.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row
                .get::<_, i64>(
                0
            ))?,
            SCHEMA_VERSION
        );
        drop(connection);
        drop(reopened);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn direct_source_import_copies_the_file_and_keeps_binary_preview_out_of_sqlite() -> Result<()> {
        let root = std::env::temp_dir().join(format!("knitspace-native-source-{}", Uuid::now_v7()));
        fs::create_dir_all(&root)?;
        let input = root.join("example.rs");
        fs::write(&input, "fn main() { println!(\"local-first\"); }\n")?;
        let service = VaultService::open(root.to_string_lossy().into_owned())?;

        let first = service.import_source_record(input.to_string_lossy().into_owned())?;
        assert!(!first.duplicate);
        assert_eq!(first.source.kind, "code");
        assert_eq!(
            first.source.content.as_deref(),
            Some("fn main() { println!(\"local-first\"); }\n")
        );
        assert!(first.source.preview.is_none());
        assert!(first
            .source
            .managed_path
            .as_deref()
            .is_some_and(|path| PathBuf::from(path).is_file()));
        let listed = service.list_sources()?;
        assert_eq!(listed.len(), 1);
        assert!(listed[0].content.is_none());
        assert!(listed[0].preview.is_none());

        // The main source_records index must still prevent a second physical
        // copy even if the legacy compatibility table is absent.
        service.connection()?.execute("DELETE FROM sources", [])?;
        let duplicate = service.import_source_record(input.to_string_lossy().into_owned())?;
        assert!(duplicate.duplicate);
        assert_eq!(duplicate.source.id, first.source.id);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn schema_v16_normalizes_absolute_markdown_paths_for_portable_archives() -> Result<()> {
        let root = std::env::temp_dir().join(format!("knitspace-relative-path-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let id = Uuid::now_v7().to_string();
        service.save_markdown(
            id.clone(),
            "note".into(),
            "# 可迁移正文\n\n相对路径保持 Vault 可搬运。".into(),
        )?;
        let legacy_absolute = root.join("notes").join(format!("{id}.md"));
        let connection = service.connection()?;
        connection.execute(
            "UPDATE documents SET markdown_path = ?2 WHERE entity_id = ?1",
            (&id, legacy_absolute.to_string_lossy().as_ref()),
        )?;
        connection.execute("DELETE FROM schema_migrations WHERE version >= 16", [])?;
        drop(connection);

        let reopened = VaultService::open(root.to_string_lossy().into_owned())?;
        let connection = reopened.connection()?;
        let stored: String = connection.query_row(
            "SELECT markdown_path FROM documents WHERE entity_id = ?1",
            [&id],
            |row| row.get(0),
        )?;
        assert_eq!(stored, format!("notes/{id}.md"));
        drop(connection);
        assert!(reopened.get_document(id)?.content.contains("相对路径"));

        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn daily_backup_is_streamed_outside_the_vault_and_not_repeated() -> Result<()> {
        let root = std::env::temp_dir().join(format!("knitspace-auto-backup-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let id = Uuid::now_v7().to_string();
        service.save_markdown(
            id.clone(),
            "note".into(),
            "# 本地归档\n\n不应占用整份文件内存。".into(),
        )?;
        let archive = service
            .automatic_backup()?
            .context("首次启动应创建每日归档")?;
        let archive_path = PathBuf::from(&archive);
        let backup_dir = archive_path.parent().context("归档目录无效")?.to_path_buf();
        assert!(archive_path.is_file());
        assert!(!archive_path.starts_with(&root));
        let mut zip = zip::ZipArchive::new(fs::File::open(&archive_path)?)?;
        assert!(zip.by_name(&format!("notes/{id}.md")).is_ok());
        assert!(service.automatic_backup()?.is_none());
        fs::remove_dir_all(root)?;
        fs::remove_dir_all(backup_dir)?;
        Ok(())
    }

    #[test]
    fn backup_contains_a_checked_sqlite_snapshot_without_wal_sidecars() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-consistent-backup-{}", Uuid::now_v7()));
        let archive_path = root.with_extension("zip");
        let extracted_database = root.with_extension("snapshot.sqlite3");
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let id = Uuid::now_v7().to_string();
        service.save_markdown(id, "note".into(), "# 一致性快照\n\n正文".into())?;
        service.backup(archive_path.to_string_lossy().into_owned())?;

        let archive_file = fs::File::open(&archive_path)?;
        let mut archive = ZipArchive::new(archive_file)?;
        let names = archive.file_names().map(str::to_owned).collect::<Vec<_>>();
        assert!(names.iter().any(|name| name == ".toolknit/index.sqlite3"));
        assert!(!names.iter().any(|name| name.ends_with("index.sqlite3-wal")));
        assert!(!names.iter().any(|name| name.ends_with("index.sqlite3-shm")));
        {
            let mut database_entry = archive.by_name(".toolknit/index.sqlite3")?;
            let mut output = fs::File::create(&extracted_database)?;
            std::io::copy(&mut database_entry, &mut output)?;
        }
        drop(archive);

        let snapshot = rusqlite::Connection::open(&extracted_database)?;
        let integrity: String =
            snapshot.query_row("PRAGMA quick_check(1)", [], |row| row.get(0))?;
        let document_count: i64 =
            snapshot.query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))?;
        assert_eq!(integrity, "ok");
        assert_eq!(document_count, 1);
        drop(snapshot);

        fs::remove_dir_all(root)?;
        fs::remove_file(archive_path)?;
        fs::remove_file(extracted_database)?;
        Ok(())
    }

    #[test]
    fn inspects_a_complete_archive_without_extracting_managed_files() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-backup-inspection-{}", Uuid::now_v7()));
        let archive_path = root.with_extension("zip");
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        service.save_markdown(
            Uuid::now_v7().to_string(),
            "note".into(),
            "# 恢复审阅\n\n先检查再替换。".into(),
        )?;
        service.backup(archive_path.to_string_lossy().into_owned())?;

        let inspection = service.inspect_backup(archive_path.to_string_lossy().into_owned())?;
        assert_eq!(inspection.integrity, "ok");
        assert_eq!(inspection.document_count, 1);
        assert_eq!(inspection.note_count, 1);
        assert_eq!(inspection.question_count, 0);
        assert_eq!(inspection.missing_markdown_count, 0);
        assert!(inspection.file_count >= 2);
        assert!(inspection.archive_size > 0);

        fs::remove_dir_all(root)?;
        fs::remove_file(archive_path)?;
        Ok(())
    }

    #[test]
    fn rejects_an_archive_from_a_future_schema_before_restore() -> Result<()> {
        let root = std::env::temp_dir().join(format!(
            "knitspace-future-backup-inspection-{}",
            Uuid::now_v7()
        ));
        let archive_path = root.with_extension("zip");
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        service.save_markdown(
            Uuid::now_v7().to_string(),
            "note".into(),
            "# 未来版本\n\n不能由旧版直接恢复。".into(),
        )?;
        service.connection()?.execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
            (SCHEMA_VERSION + 1, Utc::now().to_rfc3339()),
        )?;
        service.backup(archive_path.to_string_lossy().into_owned())?;

        let error = service
            .inspect_backup(archive_path.to_string_lossy().into_owned())
            .expect_err("未来 schema 的归档必须在恢复前被拒绝");
        assert!(error.to_string().contains("需要更新版本的 Knitspace"));

        fs::remove_dir_all(root)?;
        fs::remove_file(archive_path)?;
        Ok(())
    }

    #[test]
    fn daily_backup_rotation_only_removes_its_own_archives() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-auto-retention-{}", Uuid::now_v7()));
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let backup_dir = root.parent().context("临时资料库父目录无效")?.join(format!(
            "{} Backups",
            root.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("KnitspaceVault")
        ));
        fs::create_dir_all(&backup_dir)?;

        let today = Utc::now().date_naive();
        for offset in 1..=8 {
            let date = today - chrono::Duration::days(offset);
            fs::write(
                backup_dir.join(format!("knitspace-auto-{}.zip", date.format("%Y-%m-%d"))),
                b"automatic backup placeholder",
            )?;
        }
        let safety_archive = backup_dir.join("knitspace-before-restore-20000101T000000Z.zip");
        let unrelated_archive = backup_dir.join("course-materials.zip");
        fs::write(&safety_archive, b"safety archive placeholder")?;
        fs::write(&unrelated_archive, b"unrelated archive placeholder")?;

        service
            .automatic_backup()?
            .context("今日的自动归档应创建")?;

        let automatic_archives = fs::read_dir(&backup_dir)?
            .filter_map(|entry| entry.ok())
            .filter(|entry| automatic_backup_date(&entry.path()).is_some())
            .count();
        assert_eq!(automatic_archives, 7);
        assert!(safety_archive.is_file());
        assert!(unrelated_archive.is_file());

        fs::remove_dir_all(root)?;
        fs::remove_dir_all(backup_dir)?;
        Ok(())
    }

    #[test]
    fn restores_archive_only_after_validating_the_staged_vault() -> Result<()> {
        let root = std::env::temp_dir().join(format!("knitspace-restore-{}", Uuid::now_v7()));
        let archive = root.with_extension("zip");
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let restored_id = Uuid::now_v7().to_string();
        let restored_markdown = "# 恢复前的内容\n\n完整恢复校验词：银杏事务。";
        service.save_markdown(restored_id.clone(), "note".into(), restored_markdown.into())?;
        let attachment = root
            .join("assets")
            .join("documents")
            .join(&restored_id)
            .join("diagram.png");
        fs::create_dir_all(attachment.parent().context("测试附件目录无效")?)?;
        fs::write(&attachment, b"original-managed-asset")?;
        service.backup(archive.to_string_lossy().into_owned())?;
        let later_id = Uuid::now_v7().to_string();
        service.save_markdown(
            later_id.clone(),
            "note".into(),
            "# 后写入\n\n不应保留的检索词：海盐回滚。".into(),
        )?;
        fs::write(&attachment, b"mutated-managed-asset")?;

        let safety_archive = service.restore_backup(archive.to_string_lossy().into_owned())?;
        let restored = VaultService::open(root.to_string_lossy().into_owned())?;
        let restored_document = restored.get_document(restored_id.clone())?;
        assert_eq!(restored_document.content, restored_markdown);
        assert!(restored.get_document(later_id).is_err());
        assert_eq!(fs::read(&attachment)?, b"original-managed-asset");
        assert_eq!(
            fs::read_to_string(root.join("notes").join(format!("{restored_id}.md")))?,
            restored_markdown
        );
        assert_eq!(
            restored.search_documents("银杏事务".into(), 12)?[0].id,
            restored_id
        );
        assert!(restored.search_documents("海盐回滚".into(), 12)?.is_empty());
        let health = restored.health()?;
        assert_eq!(health.integrity, "ok");
        assert_eq!(health.missing_markdown_count, 0);
        assert!(PathBuf::from(safety_archive).is_file());

        let backup_dir = root.parent().context("临时资料库父目录无效")?.join(format!(
            "{} Backups",
            root.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("KnitspaceVault")
        ));
        fs::remove_dir_all(root)?;
        fs::remove_file(archive)?;
        fs::remove_dir_all(backup_dir)?;
        Ok(())
    }

    #[test]
    fn restore_rejects_database_without_its_markdown_and_keeps_live_vault() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("knitspace-incomplete-restore-{}", Uuid::now_v7()));
        let complete_archive = root.with_extension("complete.zip");
        let incomplete_archive = root.with_extension("incomplete.zip");
        let service = VaultService::open(root.to_string_lossy().into_owned())?;
        let id = Uuid::now_v7().to_string();
        service.save_markdown(
            id.clone(),
            "note".into(),
            "# 当前资料库\n\n正文不能被缺文件的归档覆盖。".into(),
        )?;
        service.backup(complete_archive.to_string_lossy().into_owned())?;

        let mut complete = ZipArchive::new(fs::File::open(&complete_archive)?)?;
        let mut database = Vec::new();
        complete
            .by_name(".toolknit/index.sqlite3")?
            .read_to_end(&mut database)?;
        drop(complete);
        let output = fs::File::create(&incomplete_archive)?;
        let mut incomplete = ZipWriter::new(output);
        incomplete.start_file(".toolknit/index.sqlite3", SimpleFileOptions::default())?;
        incomplete.write_all(&database)?;
        incomplete.finish()?;

        let error = service
            .restore_backup(incomplete_archive.to_string_lossy().into_owned())
            .expect_err("缺少 Markdown 正文的归档必须被拒绝");
        assert!(error
            .to_string()
            .contains("归档缺少 1 个 Markdown 正文文件"));
        assert_eq!(service.get_document(id)?.title, "当前资料库");

        let backup_dir = root.parent().context("临时资料库父目录无效")?.join(format!(
            "{} Backups",
            root.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("KnitspaceVault")
        ));
        fs::remove_dir_all(root)?;
        fs::remove_file(complete_archive)?;
        fs::remove_file(incomplete_archive)?;
        if backup_dir.exists() {
            fs::remove_dir_all(backup_dir)?;
        }
        Ok(())
    }
}
