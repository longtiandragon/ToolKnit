use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::Emitter;

const TRANSCRIPTION_PROGRESS_EVENT: &str = "toolknit://transcription-progress";
const MAX_TRANSCRIPT_BYTES: u64 = 5 * 1024 * 1024;
const MEDIA_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "mkv", "webm", "avi", "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus",
];

#[derive(Clone, Default)]
pub struct TranscriptionState {
    cancelled: Arc<Mutex<HashSet<String>>>,
    active: Arc<Mutex<HashSet<String>>>,
}

impl TranscriptionState {
    fn begin(&self, run_id: &str) -> Result<(), String> {
        if run_id.trim().is_empty() || run_id.len() > 120 {
            return Err("转写任务标识无效。".into());
        }
        let mut active = self
            .active
            .lock()
            .map_err(|_| "转写任务状态不可用".to_string())?;
        if !active.is_empty() {
            return Err("已有一个本地转写任务正在执行，请完成或停止后再开始。".into());
        }
        active.insert(run_id.to_owned());
        self.cancelled
            .lock()
            .map_err(|_| "转写任务状态不可用".to_string())?
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

    fn cancel(&self, run_id: &str) -> Result<(), String> {
        if !self
            .active
            .lock()
            .map_err(|_| "转写任务状态不可用".to_string())?
            .contains(run_id)
        {
            return Err("没有找到正在执行的转写任务。".into());
        }
        self.cancelled
            .lock()
            .map_err(|_| "转写任务状态不可用".to_string())?
            .insert(run_id.to_owned());
        Ok(())
    }

    fn is_cancelled(&self, run_id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|items| items.contains(run_id))
            .unwrap_or(false)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionProbeRequest {
    executable_path: String,
    model_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionRequest {
    executable_path: String,
    model_path: String,
    input_path: String,
    output_dir: String,
    run_id: String,
    language: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionCapability {
    available: bool,
    executable_name: String,
    model_name: String,
    detail: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionProgress {
    run_id: String,
    progress: u8,
    detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionOutput {
    path: String,
    name: String,
    size: u64,
    elapsed_ms: u128,
}

fn require_file(value: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if !path.is_absolute() || !path.is_file() {
        return Err(format!("{label}必须是存在的本机绝对文件路径。"));
    }
    Ok(path)
}

fn validated_model(value: &str) -> Result<PathBuf, String> {
    let path = require_file(value, "Whisper 模型")?;
    let extension = path
        .extension()
        .and_then(|item| item.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "bin" | "gguf") {
        return Err("Whisper 模型应为 .bin 或 .gguf 文件。".into());
    }
    Ok(path)
}

fn validated_media(value: &str) -> Result<PathBuf, String> {
    let path = require_file(value, "待转写媒体")?;
    let extension = path
        .extension()
        .and_then(|item| item.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !MEDIA_EXTENSIONS.contains(&extension.as_str()) {
        return Err("仅支持常见本地音频或视频格式。".into());
    }
    Ok(path)
}

fn validated_language(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value == "auto"
        || (value.len() == 2
            && value
                .chars()
                .all(|character| character.is_ascii_alphabetic()))
    {
        Ok(value)
    } else {
        Err("语言应为 auto 或两位语言代码，例如 zh、en。".into())
    }
}

fn safe_stem(path: &Path) -> String {
    let value = path
        .file_stem()
        .and_then(|item| item.to_str())
        .unwrap_or("media");
    let value = value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let value = value.trim_matches('-');
    if value.is_empty() {
        "media".into()
    } else {
        value.chars().take(72).collect()
    }
}

fn next_output(input: &Path, output_dir: &Path) -> PathBuf {
    let stem = safe_stem(input);
    for index in 1..10_000 {
        let serial = if index == 1 {
            String::new()
        } else {
            format!("-{index}")
        };
        let candidate = output_dir.join(format!("{stem}-knitspace-transcript{serial}.srt"));
        if !candidate.exists() {
            return candidate;
        }
    }
    output_dir.join(format!("{stem}-knitspace-transcript-overflow.srt"))
}

fn media_duration(path: &Path) -> Option<f64> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value > 0.0)
}

fn timestamp_seconds(value: &str) -> Option<f64> {
    let mut parts = value.trim().split(':');
    let hours = parts.next()?.parse::<f64>().ok()?;
    let minutes = parts.next()?.parse::<f64>().ok()?;
    let seconds = parts.next()?.parse::<f64>().ok()?;
    if parts.next().is_some() || !hours.is_finite() || !minutes.is_finite() || !seconds.is_finite()
    {
        return None;
    }
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn whisper_progress_seconds(line: &str) -> Option<f64> {
    let arrow = line.find("-->")?;
    let before = line[..arrow].trim().trim_start_matches('[').trim();
    timestamp_seconds(before)
}

fn emit_progress(app: &tauri::AppHandle, run_id: &str, progress: u8, detail: impl Into<String>) {
    let _ = app.emit(
        TRANSCRIPTION_PROGRESS_EVENT,
        TranscriptionProgress {
            run_id: run_id.to_owned(),
            progress,
            detail: detail.into(),
        },
    );
}

fn remove_if_exists(path: &Path) {
    if path.exists() {
        let _ = fs::remove_file(path);
    }
}

fn run_local_transcription(
    app: tauri::AppHandle,
    request: TranscriptionRequest,
    state: TranscriptionState,
) -> Result<TranscriptionOutput, String> {
    let started = Instant::now();
    let executable = require_file(&request.executable_path, "Whisper CLI")?;
    let model = validated_model(&request.model_path)?;
    let input = validated_media(&request.input_path)?;
    let language = validated_language(&request.language)?.to_ascii_lowercase();
    let output_dir = PathBuf::from(&request.output_dir);
    if !output_dir.is_absolute() || !output_dir.is_dir() {
        return Err("输出目录不存在。请选择有效的本地文件夹。".into());
    }
    let duration = media_duration(&input);
    let unique = uuid::Uuid::now_v7();
    let temporary_wav = output_dir.join(format!(".knitspace-transcription-{unique}.wav"));
    let temporary_base = output_dir.join(format!(".knitspace-transcription-{unique}"));
    let temporary_srt = temporary_base.with_extension("srt");
    let output = next_output(&input, &output_dir);

    emit_progress(
        &app,
        &request.run_id,
        4,
        "正在用本机 FFmpeg 准备 16 kHz 单声道音轨…",
    );
    let mut ffmpeg = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-i"])
        .arg(&input)
        .args([
            "-map",
            "0:a:0",
            "-vn",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            "-y",
        ])
        .arg(&temporary_wav)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("无法启动 FFmpeg：{error}"))?;
    loop {
        if state.is_cancelled(&request.run_id) {
            let _ = ffmpeg.kill();
            let _ = ffmpeg.wait();
            remove_if_exists(&temporary_wav);
            return Err("转写已停止，临时音轨已删除。".into());
        }
        if let Some(status) = ffmpeg
            .try_wait()
            .map_err(|error| format!("无法检查 FFmpeg 状态：{error}"))?
        {
            if !status.success() {
                remove_if_exists(&temporary_wav);
                return Err("FFmpeg 无法提取可转写音轨，请确认媒体包含音频。".into());
            }
            break;
        }
        thread::sleep(Duration::from_millis(70));
    }
    emit_progress(
        &app,
        &request.run_id,
        20,
        "音轨已准备，正在启动本机 Whisper 模型…",
    );

    let mut child = Command::new(&executable)
        .args(["-m"])
        .arg(&model)
        .args(["-f"])
        .arg(&temporary_wav)
        .args(["-l", &language, "-osrt", "-of"])
        .arg(&temporary_base)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            remove_if_exists(&temporary_wav);
            format!("无法启动 Whisper CLI：{error}")
        })?;
    let stdout = child.stdout.take().ok_or("无法读取 Whisper 输出")?;
    let stderr = child.stderr.take().ok_or("无法读取 Whisper 错误输出")?;
    let (sender, receiver) = mpsc::channel::<String>();
    let stdout_sender = sender.clone();
    let stdout_thread = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if stdout_sender.send(line).is_err() {
                break;
            }
        }
    });
    let stderr_thread = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    let mut log = String::new();
    let mut last_progress = 20_u8;
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let status = loop {
        if state.is_cancelled(&request.run_id) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();
            remove_if_exists(&temporary_wav);
            remove_if_exists(&temporary_srt);
            return Err("转写已停止，未完成的字幕草稿已删除。".into());
        }
        while let Ok(line) = receiver.try_recv() {
            if log.len() < 96 * 1024 {
                log.push_str(&line);
                log.push('\n');
            }
            if let (Some(seconds), Some(total)) = (whisper_progress_seconds(&line), duration) {
                let next = (20.0 + seconds / total * 78.0).floor().clamp(21.0, 98.0) as u8;
                if next > last_progress && last_emit.elapsed() >= Duration::from_millis(320) {
                    last_progress = next;
                    last_emit = Instant::now();
                    emit_progress(
                        &app,
                        &request.run_id,
                        next,
                        format!("Whisper 正在本机转写：{next}%（可随时停止）"),
                    );
                }
            }
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("无法检查 Whisper 状态：{error}"))?
        {
            break status;
        }
        thread::sleep(Duration::from_millis(70));
    };
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();
    remove_if_exists(&temporary_wav);
    while let Ok(line) = receiver.try_recv() {
        if log.len() < 96 * 1024 {
            log.push_str(&line);
            log.push('\n');
        }
    }
    if !status.success() {
        remove_if_exists(&temporary_srt);
        let detail = log
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("Whisper CLI 未返回错误详情");
        return Err(format!(
            "本机 Whisper 转写失败：{}",
            detail.chars().take(360).collect::<String>()
        ));
    }
    let metadata = fs::metadata(&temporary_srt).map_err(|_| {
        "Whisper 已结束，但没有生成 SRT；请确认所选 CLI 支持 -osrt 参数。".to_string()
    })?;
    if metadata.len() == 0 || metadata.len() > MAX_TRANSCRIPT_BYTES {
        remove_if_exists(&temporary_srt);
        return Err("转写字幕为空或超过 5 MB，请缩短媒体后重试。".into());
    }
    fs::rename(&temporary_srt, &output).map_err(|error| {
        remove_if_exists(&temporary_srt);
        format!("字幕已生成，但无法安全移动到输出位置：{error}")
    })?;
    let metadata =
        fs::metadata(&output).map_err(|error| format!("转写结束但未找到字幕输出：{error}"))?;
    emit_progress(
        &app,
        &request.run_id,
        100,
        "本机转写完成，正在载入字幕校对台。",
    );
    Ok(TranscriptionOutput {
        path: output.to_string_lossy().into_owned(),
        name: output
            .file_name()
            .and_then(|item| item.to_str())
            .unwrap_or("knitspace-transcript.srt")
            .to_owned(),
        size: metadata.len(),
        elapsed_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
pub async fn probe_transcription_engine(
    request: TranscriptionProbeRequest,
) -> Result<TranscriptionCapability, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let executable = require_file(&request.executable_path, "Whisper CLI")?;
        let model = validated_model(&request.model_path)?;
        let output = Command::new(&executable)
            .arg("--help")
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("无法启动所选 CLI：{error}"))?;
        let combined = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let recognizes_whisper = combined.to_ascii_lowercase().contains("whisper")
            && (combined.contains("-osrt") || combined.contains("--output-srt"));
        if !recognizes_whisper {
            return Err(
                "所选程序不像兼容的 whisper.cpp CLI，帮助信息中没有找到 Whisper 与 SRT 参数。"
                    .into(),
            );
        }
        Ok(TranscriptionCapability {
            available: true,
            executable_name: executable
                .file_name()
                .and_then(|item| item.to_str())
                .unwrap_or("whisper-cli")
                .to_owned(),
            model_name: model
                .file_name()
                .and_then(|item| item.to_str())
                .unwrap_or("model.bin")
                .to_owned(),
            detail: "本机 CLI 与模型可读取；媒体不会上传。".into(),
        })
    })
    .await
    .map_err(|error| format!("转写引擎探测失败：{error}"))?
}

#[tauri::command]
pub async fn transcribe_media_file(
    app: tauri::AppHandle,
    request: TranscriptionRequest,
    state: tauri::State<'_, TranscriptionState>,
) -> Result<TranscriptionOutput, String> {
    let state = state.inner().clone();
    let run_id = request.run_id.clone();
    state.begin(&run_id)?;
    let worker_state = state.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_local_transcription(app, request, worker_state)
    })
    .await
    .map_err(|error| format!("本机转写任务失败：{error}"));
    state.finish(&run_id);
    result?
}

#[tauri::command]
pub fn cancel_transcription(
    run_id: String,
    state: tauri::State<'_, TranscriptionState>,
) -> Result<(), String> {
    state.cancel(&run_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_whisper_timestamps_for_bounded_progress() {
        assert_eq!(
            whisper_progress_seconds("[00:01:02.500 --> 00:01:05.000] text"),
            Some(62.5)
        );
        assert_eq!(whisper_progress_seconds("whisper loading model"), None);
    }

    #[test]
    fn validates_language_without_accepting_cli_arguments() {
        assert_eq!(validated_language("auto").unwrap(), "auto");
        assert_eq!(validated_language("zh").unwrap(), "zh");
        assert!(validated_language("zh --output-json").is_err());
        assert!(validated_language("中文").is_err());
    }

    #[test]
    fn state_serializes_runs_and_records_cancellation() {
        let state = TranscriptionState::default();
        state.begin("run-1").unwrap();
        assert!(state.begin("run-2").is_err());
        state.cancel("run-1").unwrap();
        assert!(state.is_cancelled("run-1"));
        state.finish("run-1");
        assert!(!state.is_cancelled("run-1"));
    }
}
