use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    io::Read,
    path::PathBuf,
    process::{Child, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

const MAX_IMAGE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 512 * 1024;
const MAX_FIELDS: usize = 256;
const MAX_VALUE_CHARS: usize = 2048;
const INSPECT_TIMEOUT: Duration = Duration::from_secs(8);
const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif", "avif",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadataField {
    pub key: String,
    pub group: String,
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadataReport {
    pub name: String,
    pub fields: Vec<ImageMetadataField>,
    pub truncated: bool,
    pub elapsed_ms: u128,
}

fn read_bounded(mut reader: impl Read) -> Result<(Vec<u8>, bool), String> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let length = reader
            .read(&mut buffer)
            .map_err(|error| format!("读取 ExifTool 输出失败：{error}"))?;
        if length == 0 {
            break;
        }
        let remaining = MAX_OUTPUT_BYTES.saturating_sub(bytes.len());
        if remaining > 0 {
            bytes.extend_from_slice(&buffer[..length.min(remaining)]);
        }
        if length > remaining {
            truncated = true;
        }
    }
    Ok((bytes, truncated))
}

fn wait_with_timeout(mut child: Child) -> Result<(ExitStatus, Vec<u8>, Vec<u8>, bool), String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 ExifTool 标准输出。".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 ExifTool 错误输出。".to_string())?;
    let stdout_thread = thread::spawn(|| read_bounded(stdout));
    let stderr_thread = thread::spawn(|| read_bounded(stderr));
    let deadline = Instant::now() + INSPECT_TIMEOUT;
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("无法检查 ExifTool 状态：{error}"))?
        {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();
            return Err("ExifTool 元数据读取超时，已停止该进程。".into());
        }
        thread::sleep(Duration::from_millis(25));
    };
    let (stdout, stdout_truncated) = stdout_thread
        .join()
        .map_err(|_| "读取 ExifTool 标准输出的线程异常退出。".to_string())??;
    let (stderr, stderr_truncated) = stderr_thread
        .join()
        .map_err(|_| "读取 ExifTool 错误输出的线程异常退出。".to_string())??;
    Ok((status, stdout, stderr, stdout_truncated || stderr_truncated))
}

fn validate_image_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("图片路径必须是本地绝对路径。".into());
    }
    let metadata = fs::metadata(&path).map_err(|_| "图片不存在或无法读取。".to_string())?;
    if !metadata.is_file() {
        return Err("图片路径不是普通文件。".into());
    }
    if metadata.len() == 0 {
        return Err("图片文件为空。".into());
    }
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err("图片过大，元数据读取最多支持 128 MB。".into());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    if !extension
        .as_deref()
        .is_some_and(|value| IMAGE_EXTENSIONS.contains(&value))
    {
        return Err("仅支持常见图片格式的元数据读取。".into());
    }
    fs::canonicalize(path).map_err(|error| format!("无法定位图片文件：{error}"))
}

fn metadata_value(value: &Value) -> Option<(String, bool)> {
    let text = match value {
        Value::Null => return None,
        Value::String(text) => text.clone(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::Array(_) | Value::Object(_) => serde_json::to_string(value).ok()?,
    };
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let truncated = text.chars().count() > MAX_VALUE_CHARS;
    Some((text.chars().take(MAX_VALUE_CHARS).collect(), truncated))
}

fn metadata_key_parts(key: &str) -> (String, String) {
    key.split_once(':')
        .map(|(group, name)| (group.to_owned(), name.to_owned()))
        .unwrap_or_else(|| ("Other".into(), key.to_owned()))
}

fn parse_metadata(
    stdout: &[u8],
    name: String,
    elapsed_ms: u128,
    process_truncated: bool,
) -> Result<ImageMetadataReport, String> {
    let root: Value = serde_json::from_slice(stdout)
        .map_err(|error| format!("无法解析 ExifTool 元数据：{error}"))?;
    let object = root
        .as_array()
        .and_then(|items| items.first())
        .and_then(Value::as_object)
        .or_else(|| root.as_object())
        .ok_or_else(|| "ExifTool 返回的元数据格式无效。".to_string())?;
    let mut fields = Vec::new();
    let mut truncated = process_truncated;
    for (key, value) in object {
        if key == "SourceFile" {
            continue;
        }
        let Some((value, value_truncated)) = metadata_value(value) else {
            continue;
        };
        truncated |= value_truncated;
        let (group, name) = metadata_key_parts(key);
        if fields.len() >= MAX_FIELDS {
            truncated = true;
            break;
        }
        fields.push(ImageMetadataField {
            key: key.chars().take(160).collect(),
            group: group.chars().take(80).collect(),
            name: name.chars().take(120).collect(),
            value,
        });
    }
    Ok(ImageMetadataReport {
        name,
        fields,
        truncated,
        elapsed_ms,
    })
}

fn inspect_blocking(raw_path: String) -> Result<ImageMetadataReport, String> {
    let path = validate_image_path(&raw_path)?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("image")
        .to_owned();
    let started = Instant::now();
    let mut last_error = None;
    for candidate in ["exiftool.exe", "exiftool"] {
        let child = match Command::new(candidate)
            .args(["-json", "-G1", "-n", "--"])
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => {
                last_error = Some(error.to_string());
                continue;
            }
        };
        let (status, stdout, stderr, process_truncated) = wait_with_timeout(child)?;
        if !status.success() {
            let detail = String::from_utf8_lossy(&stderr)
                .trim()
                .chars()
                .take(500)
                .collect::<String>();
            return Err(if detail.is_empty() {
                "ExifTool 无法读取这张图片的元数据。".into()
            } else {
                detail
            });
        }
        return parse_metadata(
            &stdout,
            name,
            started.elapsed().as_millis(),
            process_truncated,
        );
    }
    Err(format!(
        "未检测到 ExifTool。请安装 ExifTool 并加入系统 PATH 后重试。{}",
        last_error
            .map(|error| format!(
                " 最近一次启动错误：{}",
                error.chars().take(180).collect::<String>()
            ))
            .unwrap_or_default()
    ))
}

#[tauri::command]
pub async fn inspect_image_metadata(path: String) -> Result<ImageMetadataReport, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_blocking(path))
        .await
        .map_err(|error| format!("图片元数据读取任务失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_key_parts_keep_exif_group() {
        assert_eq!(
            metadata_key_parts("EXIF:GPSLatitude"),
            ("EXIF".into(), "GPSLatitude".into())
        );
        assert_eq!(
            metadata_key_parts("Comment"),
            ("Other".into(), "Comment".into())
        );
    }

    #[test]
    fn metadata_value_is_bounded_and_ignores_empty_values() {
        assert_eq!(
            metadata_value(&Value::String("  hello  ".into())),
            Some(("hello".into(), false))
        );
        assert_eq!(metadata_value(&Value::String("  ".into())), None);
        assert_eq!(
            metadata_value(&Value::String("x".repeat(3000))),
            Some(("x".repeat(MAX_VALUE_CHARS), true))
        );
    }

    #[test]
    fn parser_skips_source_file_and_caps_fields() {
        let json = serde_json::json!([{
            "SourceFile": "C:/photo.jpg",
            "EXIF:GPSLatitude": 31.2,
            "EXIF:GPSLongitude": 121.4
        }]);
        let report =
            parse_metadata(json.to_string().as_bytes(), "photo.jpg".into(), 4, false).unwrap();
        assert_eq!(report.name, "photo.jpg");
        assert_eq!(report.fields.len(), 2);
        assert!(!report.truncated);
    }
}
