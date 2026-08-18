//! Offline English dictionary, so a word list is all the reader has to supply.
//!
//! The vocabulary tool used to demand every field by hand — pronunciation,
//! part of speech, senses, inflections — which meant re-creating a dictionary
//! that already exists. This module owns one read-only SQLite file (ECDICT,
//! MIT licensed, ~770k entries) and answers lookups from it.
//!
//! The file never lives under the Vault root: `VaultService::backup()` zips
//! every file it finds there, daily, keeping seven archives.

use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

pub const DICTIONARY_PROGRESS_EVENT: &str = "toolknit://dictionary-progress";

/// ECDICT release 1.0.28. Pinned rather than "latest" so an upstream change
/// cannot silently alter what a user downloads.
const DICTIONARY_URL: &str =
    "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip";
const DICTIONARY_VERSION: &str = "ecdict-1.0.28";
/// The published asset size. Used for the progress bar when the server omits
/// `Content-Length`, and as the shape of the sanity check below.
const EXPECTED_DOWNLOAD_BYTES: u64 = 216_765_132;
/// A ceiling, not a prediction: it stops a redirected or replaced URL from
/// filling the disk. Roughly three times the real archive.
const MAX_DOWNLOAD_BYTES: u64 = 700 * 1024 * 1024;
const DICTIONARY_FILE: &str = "ecdict.sqlite3";
const PROGRESS_INTERVAL: Duration = Duration::from_millis(320);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryStatus {
    pub installed: bool,
    pub path: String,
    pub version: String,
    pub entry_count: u32,
    pub size_bytes: u64,
    pub download_bytes: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DictionaryProgress {
    run_id: String,
    progress: u8,
    detail: String,
}

/// One dictionary record, already shaped for the vocabulary importer.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryRecord {
    /// The word as the dictionary spells it, which is what gets stored — a
    /// lookup for `Running` returns `run`, not the reader's capitalisation.
    pub word: String,
    pub phonetic: String,
    pub translation: String,
    pub definition: String,
    pub exchange: String,
    /// The term the caller asked for, so a batch answer can be matched back to
    /// its request even when the dictionary answered with a different lemma.
    pub query: String,
}

/// Holds the open connection and the set of cancelled installs. The database
/// is a large read-only file: opening it once and keeping it beats
/// `VaultService::open()`'s per-command reopen, which AGENTS.md warns against.
#[derive(Default)]
pub struct DictionaryState {
    connection: Arc<Mutex<Option<rusqlite::Connection>>>,
    /// `COUNT(*)` over 770k rows costs tens of milliseconds, and status is read
    /// every time the vocabulary view mounts. Counted once per open file.
    counted: Arc<Mutex<Option<u32>>>,
    cancelled: Arc<Mutex<HashSet<String>>>,
    active: Arc<Mutex<HashSet<String>>>,
}

impl DictionaryState {
    fn begin(&self, run_id: &str) -> Result<(), String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "词库安装状态不可用".to_string())?;
        if !active.insert(run_id.to_owned()) {
            return Err("同一个词库安装任务正在进行".into());
        }
        self.cancelled
            .lock()
            .map_err(|_| "词库安装状态不可用".to_string())?
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

    fn cancel(&self, run_id: &str) {
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.insert(run_id.to_owned());
        }
    }

    fn is_cancelled(&self, run_id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|cancelled| cancelled.contains(run_id))
            .unwrap_or(false)
    }

    /// Drops the connection so the file can be replaced or deleted. Windows
    /// keeps an open database locked, so every write path calls this first.
    fn close(&self) {
        if let Ok(mut connection) = self.connection.lock() {
            *connection = None;
        }
        if let Ok(mut counted) = self.counted.lock() {
            *counted = None;
        }
    }
}

fn dictionary_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(base.join("dictionaries"))
}

fn dictionary_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(dictionary_directory(app)?.join(DICTIONARY_FILE))
}

fn emit_progress(app: &tauri::AppHandle, run_id: &str, progress: u8, detail: impl Into<String>) {
    let _ = app.emit(
        DICTIONARY_PROGRESS_EVENT,
        DictionaryProgress {
            run_id: run_id.to_owned(),
            progress,
            detail: detail.into(),
        },
    );
}

/// Maps bytes received to the share of the bar the download owns. Extraction
/// and indexing take the rest, so a finished download does not read as done.
fn download_progress(received: u64, total: u64) -> u8 {
    if total == 0 {
        return 0;
    }
    let ratio = (received as f64 / total as f64).clamp(0.0, 1.0);
    (ratio * 76.0) as u8
}

fn open_read_only(path: &Path) -> Result<rusqlite::Connection> {
    let connection = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .context("词库文件无法打开")?;
    connection
        .execute_batch("PRAGMA query_only=ON; PRAGMA busy_timeout=5000;")
        .context("词库连接无法初始化")?;
    Ok(connection)
}

fn entry_count(connection: &rusqlite::Connection) -> Result<u32> {
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM stardict", [], |row| row.get(0))
        .context("词库缺少 stardict 表，可能不是 ECDICT 词库")?;
    Ok(count.max(0) as u32)
}

/// Opens the installed file if it is there, so status and lookups share one
/// lazily-opened connection instead of each reopening the file.
fn with_connection<T>(
    app: &tauri::AppHandle,
    state: &DictionaryState,
    action: impl FnOnce(&rusqlite::Connection) -> Result<T>,
) -> Result<Option<T>> {
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| anyhow::anyhow!("词库连接不可用"))?;
    if guard.is_none() {
        let path = dictionary_path(app).map_err(|error| anyhow::anyhow!(error))?;
        if !path.is_file() {
            return Ok(None);
        }
        *guard = Some(open_read_only(&path)?);
    }
    let connection = guard.as_ref().expect("connection was just opened");
    Ok(Some(action(connection)?))
}

fn status_for(app: &tauri::AppHandle, state: &DictionaryState) -> Result<DictionaryStatus> {
    let path = dictionary_path(app).map_err(|error| anyhow::anyhow!(error))?;
    let size_bytes = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    let cached = state.counted.lock().ok().and_then(|counted| *counted);
    let count = match cached {
        Some(count) => Some(count),
        None => {
            let counted = with_connection(app, state, entry_count)?;
            if let (Some(count), Ok(mut slot)) = (counted, state.counted.lock()) {
                *slot = Some(count);
            }
            counted
        }
    };
    Ok(DictionaryStatus {
        installed: count.is_some(),
        path: path.to_string_lossy().into_owned(),
        version: DICTIONARY_VERSION.to_string(),
        entry_count: count.unwrap_or(0),
        size_bytes,
        download_bytes: EXPECTED_DOWNLOAD_BYTES,
    })
}

/// Picks the database out of the archive. ECDICT ships a single `stardict.db`,
/// but choosing by shape rather than by name survives a renamed asset.
fn database_entry_name(archive: &mut zip::ZipArchive<File>) -> Result<String> {
    let mut best: Option<(String, u64)> = None;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).context("词库压缩包无法读取")?;
        if !entry.is_file() {
            continue;
        }
        let name = entry.name().to_owned();
        let lowered = name.to_ascii_lowercase();
        if !lowered.ends_with(".db") && !lowered.ends_with(".sqlite") && !lowered.ends_with(".sqlite3")
        {
            continue;
        }
        if best.as_ref().is_none_or(|(_, size)| entry.size() > *size) {
            best = Some((name, entry.size()));
        }
    }
    match best {
        Some((name, _)) => Ok(name),
        None => bail!("压缩包里没有找到词库数据库文件"),
    }
}

fn extract_database(archive_path: &Path, target: &Path) -> Result<()> {
    let mut archive =
        zip::ZipArchive::new(File::open(archive_path).context("下载的词库文件无法打开")?)
            .context("词库压缩包无法读取")?;
    let name = database_entry_name(&mut archive)?;
    let mut entry = archive
        .by_name(&name)
        .context("词库压缩包里的数据库无法读取")?;
    let mut output = File::create(target).context("无法写入词库文件")?;
    io::copy(&mut entry, &mut output).context("词库解压失败")?;
    output.sync_all().ok();
    Ok(())
}

/// Verifies the extracted file really is a dictionary and gives lookups an
/// index to hit. ECDICT ships indexes, but `IF NOT EXISTS` costs nothing when
/// they are already there and saves a full scan per lookup when they are not.
fn prepare_database(path: &Path) -> Result<u32> {
    let connection = rusqlite::Connection::open(path).context("解压出的词库无法打开")?;
    connection
        .execute_batch("PRAGMA busy_timeout=5000;")
        .context("词库连接无法初始化")?;
    let count = entry_count(&connection)?;
    if count == 0 {
        bail!("词库是空的，可能下载不完整")
    }
    connection
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_stardict_word ON stardict(word);
             CREATE INDEX IF NOT EXISTS idx_stardict_sw ON stardict(sw);",
        )
        .context("词库索引无法建立")?;
    Ok(count)
}

async fn download_archive(
    app: &tauri::AppHandle,
    state: &DictionaryState,
    run_id: &str,
    target: &Path,
) -> Result<()> {
    let response = reqwest::Client::new()
        .get(DICTIONARY_URL)
        .send()
        .await
        .context("无法连接词库下载地址")?;
    if !response.status().is_success() {
        bail!("词库下载失败：HTTP {}", response.status().as_u16())
    }
    let total = response.content_length().unwrap_or(EXPECTED_DOWNLOAD_BYTES);
    if total > MAX_DOWNLOAD_BYTES {
        bail!("词库文件异常地大，已停止下载")
    }
    let mut file = File::create(target).context("无法写入下载的词库文件")?;
    let mut response = response;
    let mut received = 0_u64;
    let mut last_emit = Instant::now() - PROGRESS_INTERVAL;
    let mut last_progress = 0_u8;
    while let Some(chunk) = response.chunk().await.context("词库下载中断")? {
        if state.is_cancelled(run_id) {
            bail!("已取消词库下载")
        }
        received += chunk.len() as u64;
        if received > MAX_DOWNLOAD_BYTES {
            bail!("词库文件超过大小上限，已停止下载")
        }
        io::Write::write_all(&mut file, &chunk).context("无法写入下载的词库文件")?;
        let progress = download_progress(received, total);
        if progress > last_progress && last_emit.elapsed() >= PROGRESS_INTERVAL {
            last_progress = progress;
            last_emit = Instant::now();
            emit_progress(
                app,
                run_id,
                progress,
                format!(
                    "正在下载词库 {} / {} MB",
                    received / (1024 * 1024),
                    total / (1024 * 1024)
                ),
            );
        }
    }
    file.sync_all().ok();
    Ok(())
}

fn free_space_looks_sufficient(directory: &Path) -> bool {
    // No portable free-space API without a new dependency. Writing the file is
    // still guarded by the size ceiling above, so this only refuses the
    // clearly-impossible case of an unusable directory.
    directory.is_dir()
}

#[tauri::command]
pub fn dictionary_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, DictionaryState>,
) -> Result<DictionaryStatus, String> {
    status_for(&app, &state).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn install_dictionary(
    app: tauri::AppHandle,
    state: tauri::State<'_, DictionaryState>,
    run_id: String,
) -> Result<DictionaryStatus, String> {
    state.begin(&run_id)?;
    let result = install_dictionary_inner(&app, &state, &run_id).await;
    state.finish(&run_id);
    result.map_err(|error| error.to_string())
}

async fn install_dictionary_inner(
    app: &tauri::AppHandle,
    state: &DictionaryState,
    run_id: &str,
) -> Result<DictionaryStatus> {
    let directory = dictionary_directory(app).map_err(|error| anyhow::anyhow!(error))?;
    fs::create_dir_all(&directory).context("无法创建词库目录")?;
    if !free_space_looks_sufficient(&directory) {
        bail!("词库目录不可用")
    }
    let archive_path = directory.join("ecdict-download.zip");
    let staging_path = directory.join("ecdict-staging.sqlite3");
    let final_path = directory.join(DICTIONARY_FILE);

    emit_progress(app, run_id, 1, "正在连接下载地址");
    let outcome = async {
        download_archive(app, state, run_id, &archive_path).await?;
        if state.is_cancelled(run_id) {
            bail!("已取消词库安装")
        }
        emit_progress(app, run_id, 78, "正在解压词库");
        let archive = archive_path.clone();
        let staging = staging_path.clone();
        tauri::async_runtime::spawn_blocking(move || extract_database(&archive, &staging))
            .await
            .context("解压任务无法执行")??;
        if state.is_cancelled(run_id) {
            bail!("已取消词库安装")
        }
        emit_progress(app, run_id, 90, "正在校验并建立索引");
        let staging = staging_path.clone();
        let count = tauri::async_runtime::spawn_blocking(move || prepare_database(&staging))
            .await
            .context("校验任务无法执行")??;
        // The old file has to be closed before Windows will let it be replaced.
        state.close();
        if final_path.exists() {
            fs::remove_file(&final_path).context("无法替换已有的词库文件")?;
        }
        fs::rename(&staging_path, &final_path).context("无法启用下载好的词库")?;
        emit_progress(app, run_id, 100, format!("词库就绪，共 {count} 个词条"));
        Ok(())
    }
    .await;

    // Whatever happened, the working files go away; a half-written database
    // must never be left where the next launch would open it.
    let _ = fs::remove_file(&archive_path);
    let _ = fs::remove_file(&staging_path);
    outcome?;
    status_for(app, state)
}

#[tauri::command]
pub fn cancel_dictionary_install(
    state: tauri::State<'_, DictionaryState>,
    run_id: String,
) -> Result<(), String> {
    state.cancel(&run_id);
    Ok(())
}

#[tauri::command]
pub fn remove_dictionary(
    app: tauri::AppHandle,
    state: tauri::State<'_, DictionaryState>,
) -> Result<DictionaryStatus, String> {
    state.close();
    let path = dictionary_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("无法删除词库文件：{error}"))?;
    }
    status_for(&app, &state).map_err(|error| error.to_string())
}

/// Normalises a query the way the dictionary stores its keys.
fn normalized_query(word: &str) -> String {
    word.trim().to_lowercase()
}

fn read_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<DictionaryRecord> {
    Ok(DictionaryRecord {
        word: row.get(0)?,
        phonetic: row.get(1)?,
        translation: row.get(2)?,
        definition: row.get(3)?,
        exchange: row.get(4)?,
        query: String::new(),
    })
}

/// The lemma an inflected entry points at, via the `0:` code in `exchange`.
/// A row that is its own lemma yields nothing, so no second query is made.
fn lemma_of(record: &DictionaryRecord) -> Option<String> {
    for part in record.exchange.split('/') {
        let (code, value) = part.split_once(':')?;
        if code.trim() != "0" {
            continue;
        }
        let lemma = value.trim();
        if lemma.is_empty() || lemma.eq_ignore_ascii_case(record.word.trim()) {
            return None;
        }
        return Some(lemma.to_lowercase());
    }
    None
}

/// Looks a batch of words up in one pass. A word the dictionary spells
/// differently (`Running` → `running`) is matched case-insensitively, and an
/// inflected form falls back to the lemma recorded in `exchange`, so the
/// reader can type what they actually read.
fn lookup_in(connection: &rusqlite::Connection, words: &[String]) -> Result<Vec<DictionaryRecord>> {
    let mut records = Vec::new();
    let mut statement = connection
        .prepare(
            "SELECT word, COALESCE(phonetic,''), COALESCE(translation,''), COALESCE(definition,''), COALESCE(exchange,'')
             FROM stardict WHERE word = ?1 COLLATE NOCASE LIMIT 1",
        )
        .context("词库查询无法准备")?;
    let mut lemma_statement = connection
        .prepare(
            "SELECT word, COALESCE(phonetic,''), COALESCE(translation,''), COALESCE(definition,''), COALESCE(exchange,'')
             FROM stardict WHERE sw = ?1 COLLATE NOCASE LIMIT 1",
        )
        .context("词库回退查询无法准备")?;
    for word in words {
        let query = normalized_query(word);
        if query.is_empty() {
            continue;
        }
        let found = statement
            .query_row([&query], read_record)
            .or_else(|_| lemma_statement.query_row([&query], read_record));
        let Ok(mut record) = found else { continue };
        // ECDICT stores inflected forms as their own rows, and those rows carry
        // `0:<lemma>` instead of a gloss. Following it is what lets the reader
        // type the word they actually met.
        if let Some(lemma) = lemma_of(&record) {
            if let Ok(base) = statement.query_row([&lemma], read_record) {
                if !base.translation.trim().is_empty() || record.translation.trim().is_empty() {
                    record = base;
                }
            }
        }
        record.query = word.trim().to_owned();
        records.push(record);
    }
    Ok(records)
}

#[tauri::command]
pub fn lookup_dictionary_words(
    app: tauri::AppHandle,
    state: tauri::State<'_, DictionaryState>,
    words: Vec<String>,
) -> Result<Vec<DictionaryRecord>, String> {
    if words.is_empty() {
        return Ok(Vec::new());
    }
    if words.len() > 500 {
        return Err("一次最多查询 500 个单词".into());
    }
    with_connection(&app, &state, |connection| lookup_in(connection, &words))
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "词库尚未安装".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Result<rusqlite::Connection> {
        let connection = rusqlite::Connection::open_in_memory()?;
        connection.execute_batch(
            "CREATE TABLE stardict (word TEXT, sw TEXT, phonetic TEXT, definition TEXT, translation TEXT, exchange TEXT);
             INSERT INTO stardict VALUES ('run','run','rʌn','to move fast','n. 奔跑\nvi. 跑；运行','d:run/p:ran/3:runs/i:running');
             INSERT INTO stardict VALUES ('Beijing','beijing','beɪˈdʒɪŋ','the capital','n. 北京','');
             INSERT INTO stardict VALUES ('running','running','','','','0:run/1:i');
             INSERT INTO stardict VALUES ('orphaned','orphaned','','','','0:missingword');",
        )?;
        Ok(connection)
    }

    #[test]
    fn finds_a_word_whatever_case_the_reader_typed() -> Result<()> {
        let connection = fixture()?;
        let records = lookup_in(&connection, &["RUN".to_string(), "beijing".to_string()])?;
        if records.len() != 2 {
            bail!("expected both words, got {}", records.len())
        }
        // The dictionary's own spelling is what gets stored, not the query's.
        if records[1].word != "Beijing" {
            bail!("expected the dictionary spelling, got {}", records[1].word)
        }
        Ok(())
    }

    #[test]
    fn keeps_the_query_beside_the_answer_so_a_batch_can_be_matched_back() -> Result<()> {
        let connection = fixture()?;
        let records = lookup_in(&connection, &["  Run  ".to_string()])?;
        if records[0].query != "Run" {
            bail!("expected the trimmed query, got {:?}", records[0].query)
        }
        Ok(())
    }

    #[test]
    fn skips_blank_and_unknown_words_without_failing_the_batch() -> Result<()> {
        let connection = fixture()?;
        let records = lookup_in(
            &connection,
            &["".to_string(), "zzzznotaword".to_string(), "run".to_string()],
        )?;
        if records.len() != 1 {
            bail!("expected only the known word, got {}", records.len())
        }
        Ok(())
    }

    #[test]
    fn resolves_an_inflected_form_to_the_entry_that_carries_the_meaning() -> Result<()> {
        let connection = fixture()?;
        let records = lookup_in(&connection, &["Running".to_string()])?;
        if records.len() != 1 {
            bail!("expected one record, got {}", records.len())
        }
        if records[0].word != "run" {
            bail!("expected the lemma, got {}", records[0].word)
        }
        // The reader still needs to see which form they typed.
        if records[0].query != "Running" {
            bail!("expected the typed form to survive, got {:?}", records[0].query)
        }
        Ok(())
    }

    #[test]
    fn keeps_the_inflected_row_when_its_lemma_is_not_in_the_dictionary() -> Result<()> {
        let connection = fixture()?;
        let records = lookup_in(&connection, &["orphaned".to_string()])?;
        if records.len() != 1 || records[0].word != "orphaned" {
            bail!("a dangling lemma pointer must not lose the word")
        }
        Ok(())
    }

    #[test]
    fn reads_the_lemma_pointer_only_when_it_names_another_word() -> Result<()> {
        let own = DictionaryRecord { word: "run".into(), exchange: "0:run/3:runs".into(), ..Default::default() };
        if lemma_of(&own).is_some() {
            bail!("a word that is its own lemma must not trigger a second query")
        }
        let inflected = DictionaryRecord { word: "running".into(), exchange: "0:run/1:i".into(), ..Default::default() };
        if lemma_of(&inflected).as_deref() != Some("run") {
            bail!("expected the lemma pointer to resolve")
        }
        let none = DictionaryRecord { word: "run".into(), exchange: "3:runs/i:running".into(), ..Default::default() };
        if lemma_of(&none).is_some() {
            bail!("an exchange without a `0:` code names no lemma")
        }
        Ok(())
    }

    #[test]
    fn reports_the_entry_count_and_refuses_a_file_without_the_table() -> Result<()> {
        let connection = fixture()?;
        if entry_count(&connection)? != 4 {
            bail!("fixture should hold four entries")
        }
        let empty = rusqlite::Connection::open_in_memory()?;
        if entry_count(&empty).is_ok() {
            bail!("a database without `stardict` must not pass as a dictionary")
        }
        Ok(())
    }

    #[test]
    fn leaves_room_on_the_bar_for_extraction_and_indexing() -> Result<()> {
        if download_progress(0, 100) != 0 {
            bail!("an untouched download should read as zero")
        }
        // A finished download must not read as a finished install.
        let complete = download_progress(100, 100);
        if !(70..=80).contains(&complete) {
            bail!("a finished download should leave the tail of the bar, got {complete}")
        }
        if download_progress(50, 0) != 0 {
            bail!("an unknown total must not divide by zero")
        }
        Ok(())
    }
}
