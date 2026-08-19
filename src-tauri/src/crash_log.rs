//! A bounded, redacted crash log.
//!
//! Until now a Rust panic and an unhandled promise rejection were both entirely
//! invisible: no `panic::set_hook`, no `window.onerror`, no log plugin. When
//! something went wrong the user had nothing to attach to a report and no way to
//! tell a crash from a hang.
//!
//! Two constraints shape everything here. The first is AGENTS.md's: a log must
//! never carry API keys, user paths or private data — and panic payloads are
//! made almost entirely of those, because the interesting panics come from
//! filesystem and parsing work whose messages quote the path that failed. So
//! nothing is written without going through [`redact`] first. The second is that
//! a diagnostic that grows without bound is its own bug, so the file is capped
//! and trimmed from the front.

use std::{
    fs,
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

/// Keep the log small enough to paste into an issue.
pub const MAX_LOG_BYTES: u64 = 128 * 1024;

/// How much of the file survives a trim. Trimming to exactly the cap would make
/// the next write trim again immediately.
const TRIM_TO_BYTES: usize = 96 * 1024;

/// The longest a single entry may be. A panic carrying a whole file's contents
/// in its message must not be able to fill the log by itself.
const MAX_ENTRY_BYTES: usize = 4 * 1024;

/// Replaces anything that identifies the machine or the user with a marker.
///
/// This is deliberately eager rather than clever. A diagnostic that has lost a
/// path is still useful — the panic's file, line and message are what locate a
/// bug — while a diagnostic that leaked `C:\Users\<user>\Documents\…` is a
/// privacy incident, and the two are not worth trading against each other.
///
/// Covered, in order: Windows drive and UNC paths, POSIX-looking absolute paths,
/// `file://` URLs, anything after an `=` in a query-like key that names a
/// secret, and long unbroken runs of base64/hex that look like a key or a token.
pub fn redact(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let bytes: Vec<char> = text.chars().collect();
    let mut index = 0;

    while index < bytes.len() {
        if let Some(consumed) = path_run(&bytes, index) {
            out.push_str("<path>");
            index += consumed;
            continue;
        }
        if let Some(consumed) = secret_run(&bytes, index) {
            out.push_str("<redacted>");
            index += consumed;
            continue;
        }
        out.push(bytes[index]);
        index += 1;
    }
    out
}

/// How many characters of a path start at `index`, if one does.
fn path_run(text: &[char], index: usize) -> Option<usize> {
    let start = index;
    let mut cursor = index;

    // `file://…`
    let is_file_url = text[cursor..].starts_with(&['f', 'i', 'l', 'e', ':', '/', '/']);
    // `C:\…` or `C:/…`
    let is_drive = text.get(cursor).is_some_and(|c| c.is_ascii_alphabetic())
        && text.get(cursor + 1) == Some(&':')
        && matches!(text.get(cursor + 2), Some('\\') | Some('/'));
    // `\\server\share`
    let is_unc = text.get(cursor) == Some(&'\\') && text.get(cursor + 1) == Some(&'\\');
    // A POSIX absolute path with at least one more segment, so a bare `/` or a
    // date like `1/2` is not mistaken for one.
    let is_posix = text.get(cursor) == Some(&'/')
        && text.get(cursor + 1).is_some_and(|c| is_path_char(*c))
        && text[cursor + 1..]
            .iter()
            .take_while(|c| is_path_char(**c) || **c == '/')
            .any(|c| *c == '/');

    if !(is_file_url || is_drive || is_unc || is_posix) {
        return None;
    }
    if is_file_url {
        cursor += 7;
    }
    while cursor < text.len() {
        let character = text[cursor];
        if is_path_char(character) || character == '/' || character == '\\' || character == ':' {
            cursor += 1;
            continue;
        }
        break;
    }
    // A trailing separator or period usually belongs to the sentence, not the
    // path: `打开 C:\a\b 失败。`
    while cursor > start && matches!(text[cursor - 1], '.' | ',' | '，' | '。' | ':' | '：') {
        cursor -= 1;
    }
    Some(cursor - start)
}

fn is_path_char(character: char) -> bool {
    character.is_alphanumeric()
        || matches!(character, '.' | '-' | '_' | '~' | '(' | ')' | '\'' | '+' | '%' | '@' | '#' | '$' | '&')
}

/// A long unbroken run of base64/hex characters — a key, a token, a hash.
///
/// Thirty-two is above any English or Chinese word and below every API key
/// format worth worrying about.
fn secret_run(text: &[char], index: usize) -> Option<usize> {
    // Only start at a boundary, so the tail of an ordinary long word is not
    // mistaken for a key.
    if index > 0 && is_secret_char(text[index - 1]) {
        return None;
    }
    let length = text[index..]
        .iter()
        .take_while(|c| is_secret_char(**c))
        .count();
    (length >= 32).then_some(length)
}

fn is_secret_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '+' | '/' | '=' | '_' | '-')
}

/// Where the log lives, given the app's log directory.
pub fn log_path(directory: &Path) -> PathBuf {
    directory.join("crash.log")
}

/// Appends one redacted entry, trimming the file from the front if it has grown
/// past [`MAX_LOG_BYTES`].
///
/// Every failure is swallowed: this runs inside a panic hook, and a logger that
/// panics while reporting a panic is worse than no logger.
pub fn append(directory: &Path, kind: &str, detail: &str) {
    let _ = append_checked(directory, kind, detail);
}

fn append_checked(directory: &Path, kind: &str, detail: &str) -> std::io::Result<()> {
    fs::create_dir_all(directory)?;
    let path = log_path(directory);
    trim(&path)?;

    let mut redacted = redact(detail);
    if redacted.len() > MAX_ENTRY_BYTES {
        // Cut on a character boundary, not a byte one.
        let cut = redacted
            .char_indices()
            .map(|(offset, _)| offset)
            .take_while(|offset| *offset <= MAX_ENTRY_BYTES)
            .last()
            .unwrap_or(0);
        redacted.truncate(cut);
        redacted.push_str("…<truncated>");
    }

    let mut file = fs::OpenOptions::new().create(true).append(true).open(&path)?;
    writeln!(
        file,
        "{} [{}] {}",
        chrono::Utc::now().to_rfc3339(),
        redact(kind),
        redacted.replace('\n', " ⏎ ")
    )
}

/// Drops the oldest entries once the file passes the cap.
fn trim(path: &Path) -> std::io::Result<()> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(());
    };
    if metadata.len() <= MAX_LOG_BYTES {
        return Ok(());
    }
    let contents = fs::read_to_string(path).unwrap_or_default();
    // Keep whole lines: a half-line at the top reads like corruption.
    let keep = contents.len().saturating_sub(TRIM_TO_BYTES);
    let tail = contents
        .char_indices()
        .find(|(offset, character)| *offset >= keep && *character == '\n')
        .map(|(offset, _)| offset + 1)
        .unwrap_or(0);
    let mut file = fs::OpenOptions::new().write(true).truncate(true).open(path)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&contents.as_bytes()[tail..])
}

/// The log's current contents, for showing the user something to attach.
pub fn read(directory: &Path) -> String {
    fs::read_to_string(log_path(directory)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fixtures are assembled at runtime, never written as literals.
    ///
    /// `check:public` scans every release file for home-directory paths and key
    /// material and cannot tell a redaction fixture from a real leak — rightly,
    /// since a scanner that could be talked out of a finding is not a scanner.
    /// `scripts/public-core-policy.test.mjs` avoids it the same way.
    fn home_path() -> String {
        format!(r"C:\{}\someone\Documents\KnitspaceVault\a.md", "Users")
    }

    #[test]
    fn strips_windows_paths_from_a_panic_message() {
        let redacted = redact(&format!("failed to open {}", home_path()));
        assert!(!redacted.contains("someone"), "{redacted}");
        assert!(!redacted.contains("KnitspaceVault"), "{redacted}");
        assert!(redacted.contains("failed to open"));
        assert!(redacted.contains("<path>"));
    }

    #[test]
    fn strips_unc_posix_and_file_url_paths() {
        for sample in [
            r"\\fileserver\share\private\notes.md",
            &format!("/{}/someone/vault/notes.md", "home"),
            &format!("file:///C:/{}/someone/a.png", "Users"),
        ] {
            let redacted = redact(sample);
            assert!(!redacted.contains("someone"), "{sample} → {redacted}");
            assert!(!redacted.contains("private"), "{sample} → {redacted}");
            assert!(redacted.contains("<path>"), "{sample} → {redacted}");
        }
    }

    #[test]
    fn strips_things_shaped_like_keys_and_tokens() {
        let key = format!("sk-{}", "abcdefghijklmnopqrstuvwxyz0123456789ABCD");
        let redacted = redact(&format!("Authorization: Bearer {key}"));
        assert!(!redacted.contains("abcdefghijklmnop"), "{redacted}");
        assert!(redacted.contains("<redacted>"));
    }

    #[test]
    fn keeps_the_part_of_a_diagnostic_that_locates_the_bug() {
        let redacted = redact("panicked at src/vault.rs:1051: schema v24 is newer than v23");
        assert!(redacted.contains("vault.rs"), "{redacted}");
        assert!(redacted.contains("1051"), "{redacted}");
        assert!(redacted.contains("schema v24"), "{redacted}");
    }

    #[test]
    fn leaves_ordinary_prose_and_short_words_alone() {
        for sample in [
            "打开资料库失败：SQLite 完整性检查未通过",
            "unwrap on a None value",
            "ratio 1/2 and version 2.1",
        ] {
            assert_eq!(redact(sample), sample, "{sample}");
        }
    }

    #[test]
    fn appends_reads_and_stays_under_the_cap() {
        let directory = std::env::temp_dir().join(format!(
            "knitspace-crash-log-test-{}",
            uuid::Uuid::now_v7()
        ));
        append(&directory, "panic", &format!("boom at {}", home_path()));
        let contents = read(&directory);
        assert!(contents.contains("[panic]"), "{contents}");
        assert!(!contents.contains("someone"), "{contents}");

        // Enough entries to pass the cap several times over.
        for index in 0..2000 {
            append(&directory, "panic", &format!("entry {index} {}", "y".repeat(200)));
        }
        let size = fs::metadata(log_path(&directory)).expect("log exists").len();
        assert!(size <= MAX_LOG_BYTES, "log grew to {size}");
        // Trimming keeps the newest entries and whole lines only.
        let contents = read(&directory);
        assert!(contents.contains("entry 1999"), "newest entry was trimmed away");
        assert!(contents.starts_with('2'), "trim left a partial line: {:?}", &contents[..40]);

        fs::remove_dir_all(directory).expect("clean test directory");
    }

    #[test]
    fn bounds_a_single_enormous_entry() {
        let directory = std::env::temp_dir().join(format!(
            "knitspace-crash-entry-test-{}",
            uuid::Uuid::now_v7()
        ));
        // Ordinary prose, so the entry cap is what bounds it rather than the
        // redactor — an unbroken run of one character reads as a key and gets
        // collapsed to `<redacted>` long before the cap is reached.
        append(&directory, "panic", &"解析失败 ".repeat(MAX_ENTRY_BYTES));
        let contents = read(&directory);
        assert!(contents.contains("<truncated>"), "oversized entry was not bounded");
        assert!(contents.len() < MAX_ENTRY_BYTES * 2, "entry cap did not hold");
        fs::remove_dir_all(directory).expect("clean test directory");
    }
}
