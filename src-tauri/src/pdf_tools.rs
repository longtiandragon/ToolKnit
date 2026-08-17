use std::{
    fs,
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;
use tauri::ipc::Response;

const MAX_PDF_OPTIMIZE_INPUT_BYTES: usize = 192 * 1024 * 1024;
const MAX_PDF_OPTIMIZE_OUTPUT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_QPDF_DIAGNOSTIC_BYTES: usize = 16 * 1024;
const MAX_PDF_PASSWORD_BYTES: usize = 256;
const QPDF_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfProtectRequest {
    pub bytes: Vec<u8>,
    pub password: String,
    pub allow_printing: bool,
    pub allow_copying: bool,
    pub allow_modification: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfDecryptRequest {
    pub bytes: Vec<u8>,
    pub password: String,
}

fn validate_pdf_header(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("PDF 文件为空。".into());
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err("输入不是有效的 PDF 文件。".into());
    }
    Ok(())
}

fn validate_pdf_bytes(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_PDF_OPTIMIZE_INPUT_BYTES {
        return Err("PDF 超过 192 MB 安全上限，请先拆分或压缩输入。".into());
    }
    validate_pdf_header(bytes)
}

fn read_bounded<R: Read>(mut reader: R) -> String {
    let mut bytes = Vec::new();
    let _ = reader
        .by_ref()
        .take((MAX_QPDF_DIAGNOSTIC_BYTES + 1) as u64)
        .read_to_end(&mut bytes);
    let truncated = bytes.len() > MAX_QPDF_DIAGNOSTIC_BYTES;
    bytes.truncate(MAX_QPDF_DIAGNOSTIC_BYTES);
    let mut detail = String::from_utf8_lossy(&bytes).trim().to_owned();
    if truncated {
        detail.push_str("…");
    }
    detail
}

fn run_qpdf(
    input: &Path,
    output: &Path,
    arguments: &[&str],
    response_lines: Option<&[String]>,
    action: &str,
) -> Result<(), String> {
    let mut command = Command::new("qpdf");
    if response_lines.is_some() {
        // Passwords are supplied through qpdf's @- response-file mechanism so
        // they do not appear in the Windows process command line or task log.
        command.arg("@-");
    }
    command.args(arguments);
    if response_lines.is_none() {
        command.arg("--");
    }
    let mut child = command
        .arg(input)
        .arg(output)
        .stdin(if response_lines.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!("无法启动 qpdf：{error}。请在本机能力页确认 qpdf 已安装并加入 PATH。")
        })?;
    let stderr = child.stderr.take().ok_or("无法读取 qpdf 错误输出。")?;
    let stderr_reader = thread::spawn(move || read_bounded(stderr));
    if let Some(lines) = response_lines {
        let mut stdin = child.stdin.take().ok_or("无法写入 qpdf 安全参数。")?;
        let mut response = lines.join("\n");
        response.push('\n');
        if let Err(error) = stdin.write_all(response.as_bytes()) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stderr_reader.join();
            return Err(format!("无法写入 qpdf 安全参数：{error}"));
        }
        // Closing stdin tells qpdf that the response file is complete.
    }
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("无法检查 qpdf 状态：{error}"))?
        {
            break status;
        }
        if started.elapsed() >= QPDF_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stderr_reader.join();
            return Err(format!(
                "qpdf {action}超过 120 秒，已停止且未保留不完整输出。"
            ));
        }
        thread::sleep(Duration::from_millis(80));
    };
    let detail = stderr_reader.join().unwrap_or_default();
    if !status.success() {
        return Err(if detail.is_empty() {
            format!("qpdf 未能{action} PDF。")
        } else {
            format!("qpdf 未能{action} PDF：{detail}")
        });
    }
    Ok(())
}

fn qpdf_optimize(input: &Path, output: &Path) -> Result<(), String> {
    run_qpdf(
        input,
        output,
        &[
            "--object-streams=generate",
            "--compress-streams=y",
            "--decode-level=generalized",
            "--recompress-flate",
            "--compression-level=9",
        ],
        None,
        "优化",
    )
}

fn validate_password(password: &str, require_strong: bool) -> Result<(), String> {
    if password.is_empty() {
        return Err("请输入 PDF 密码。".into());
    }
    if require_strong && password.chars().count() < 8 {
        return Err("PDF 打开密码至少需要 8 个字符。".into());
    }
    if password.as_bytes().len() > MAX_PDF_PASSWORD_BYTES {
        return Err("PDF 密码不能超过 256 字节。".into());
    }
    if password
        .chars()
        .any(|character| character == '\0' || character == '\r' || character == '\n')
    {
        return Err("PDF 密码不能包含换行或控制字符。".into());
    }
    Ok(())
}

fn write_pdf_input(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file =
        fs::File::create(path).map_err(|error| format!("无法写入 PDF 临时输入：{error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("无法写入 PDF 临时输入：{error}"))?;
    file.flush()
        .map_err(|error| format!("无法完成 PDF 临时输入：{error}"))?;
    Ok(())
}

fn read_pdf_output(path: &Path) -> Result<Response, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("qpdf 未生成 PDF 输出：{error}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_PDF_OPTIMIZE_OUTPUT_BYTES
    {
        return Err("qpdf 输出超过安全范围或不是普通文件。".into());
    }
    let output = fs::read(path).map_err(|error| format!("无法读取 qpdf 输出：{error}"))?;
    validate_pdf_header(&output)?;
    Ok(Response::new(output))
}

fn optimize_pdf_bytes_blocking(bytes: Vec<u8>) -> Result<Response, String> {
    validate_pdf_bytes(&bytes)?;
    let directory =
        std::env::temp_dir().join(format!("knitspace-pdf-optimize-{}", uuid::Uuid::now_v7()));
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建 PDF 临时目录：{error}"))?;
    let input = directory.join("input.pdf");
    let output = directory.join("optimized.pdf");
    let result = (|| {
        write_pdf_input(&input, &bytes)?;
        qpdf_optimize(&input, &output)?;
        read_pdf_output(&output)
    })();
    let _ = fs::remove_dir_all(&directory);
    result
}

#[tauri::command]
pub async fn optimize_pdf_bytes(bytes: Vec<u8>) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || optimize_pdf_bytes_blocking(bytes))
        .await
        .map_err(|error| format!("PDF 优化任务失败：{error}"))?
}

fn protect_pdf_bytes_blocking(request: PdfProtectRequest) -> Result<Response, String> {
    validate_pdf_bytes(&request.bytes)?;
    validate_password(&request.password, true)?;
    let directory =
        std::env::temp_dir().join(format!("knitspace-pdf-protect-{}", uuid::Uuid::now_v7()));
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建 PDF 临时目录：{error}"))?;
    let input = directory.join("input.pdf");
    let output = directory.join("protected.pdf");
    let result = (|| {
        write_pdf_input(&input, &request.bytes)?;
        let owner_password = format!("knitspace-owner-{}", uuid::Uuid::now_v7().simple());
        let response = vec![
            "--encrypt".to_owned(),
            request.password.clone(),
            owner_password,
            "256".to_owned(),
            format!(
                "--print={}",
                if request.allow_printing {
                    "full"
                } else {
                    "none"
                }
            ),
            format!(
                "--extract={}",
                if request.allow_copying { "y" } else { "n" }
            ),
            format!(
                "--modify={}",
                if request.allow_modification {
                    "all"
                } else {
                    "none"
                }
            ),
            "--accessibility=y".to_owned(),
            "--".to_owned(),
        ];
        run_qpdf(&input, &output, &[], Some(&response), "加密")?;
        read_pdf_output(&output)
    })();
    let _ = fs::remove_dir_all(&directory);
    result
}

#[tauri::command]
pub async fn protect_pdf_bytes(request: PdfProtectRequest) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || protect_pdf_bytes_blocking(request))
        .await
        .map_err(|error| format!("PDF 加密任务失败：{error}"))?
}

fn decrypt_pdf_bytes_blocking(request: PdfDecryptRequest) -> Result<Response, String> {
    validate_pdf_bytes(&request.bytes)?;
    validate_password(&request.password, false)?;
    let directory =
        std::env::temp_dir().join(format!("knitspace-pdf-decrypt-{}", uuid::Uuid::now_v7()));
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建 PDF 临时目录：{error}"))?;
    let input = directory.join("input.pdf");
    let output = directory.join("decrypted.pdf");
    let result = (|| {
        write_pdf_input(&input, &request.bytes)?;
        let response = vec![
            format!("--password={}", request.password),
            "--decrypt".to_owned(),
        ];
        run_qpdf(&input, &output, &[], Some(&response), "移除密码")?;
        read_pdf_output(&output)
    })();
    let _ = fs::remove_dir_all(&directory);
    result
}

#[tauri::command]
pub async fn decrypt_pdf_bytes(request: PdfDecryptRequest) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || decrypt_pdf_bytes_blocking(request))
        .await
        .map_err(|error| format!("PDF 解密任务失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::{validate_password, validate_pdf_bytes, MAX_PDF_OPTIMIZE_INPUT_BYTES};

    #[test]
    fn pdf_optimizer_rejects_empty_non_pdf_and_oversized_input() {
        assert!(validate_pdf_bytes(&[]).is_err());
        assert!(validate_pdf_bytes(b"not a pdf").is_err());
        assert!(validate_pdf_bytes(b"%PDF-1.7\n").is_ok());
        let oversized = vec![b'x'; MAX_PDF_OPTIMIZE_INPUT_BYTES + 1];
        assert!(validate_pdf_bytes(&oversized).is_err());
    }

    #[test]
    fn pdf_password_policy_rejects_unsafe_values() {
        assert!(validate_password("short", true).is_err());
        assert!(validate_password("safe-password", true).is_ok());
        assert!(validate_password("line\nbreak", false).is_err());
        assert!(validate_password("", false).is_err());
    }
}
