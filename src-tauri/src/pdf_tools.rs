use std::{
    fs,
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use tauri::ipc::Response;

const MAX_PDF_OPTIMIZE_INPUT_BYTES: usize = 192 * 1024 * 1024;
const MAX_PDF_OPTIMIZE_OUTPUT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_QPDF_DIAGNOSTIC_BYTES: usize = 16 * 1024;
const QPDF_TIMEOUT: Duration = Duration::from_secs(120);

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

fn qpdf_optimize(input: &Path, output: &Path) -> Result<(), String> {
    let mut child = Command::new("qpdf")
        .args([
            "--object-streams=generate",
            "--compress-streams=y",
            "--decode-level=generalized",
            "--recompress-flate",
            "--compression-level=9",
            "--",
        ])
        .arg(input)
        .arg(output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!("无法启动 qpdf：{error}。请在本机能力页确认 qpdf 已安装并加入 PATH。")
        })?;
    let stderr = child.stderr.take().ok_or("无法读取 qpdf 错误输出。")?;
    let stderr_reader = thread::spawn(move || read_bounded(stderr));
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
            return Err("qpdf 处理超过 120 秒，已停止且未保留不完整输出。".into());
        }
        thread::sleep(Duration::from_millis(80));
    };
    let detail = stderr_reader.join().unwrap_or_default();
    if !status.success() {
        return Err(if detail.is_empty() {
            "qpdf 未能优化 PDF。".into()
        } else {
            format!("qpdf 未能优化 PDF：{detail}")
        });
    }
    Ok(())
}

fn optimize_pdf_bytes_blocking(bytes: Vec<u8>) -> Result<Response, String> {
    validate_pdf_bytes(&bytes)?;
    let directory =
        std::env::temp_dir().join(format!("knitspace-pdf-optimize-{}", uuid::Uuid::now_v7()));
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建 PDF 临时目录：{error}"))?;
    let input = directory.join("input.pdf");
    let output = directory.join("optimized.pdf");
    let result = (|| {
        let mut file =
            fs::File::create(&input).map_err(|error| format!("无法写入 PDF 临时输入：{error}"))?;
        file.write_all(&bytes)
            .map_err(|error| format!("无法写入 PDF 临时输入：{error}"))?;
        file.flush()
            .map_err(|error| format!("无法完成 PDF 临时输入：{error}"))?;
        qpdf_optimize(&input, &output)?;
        let metadata =
            fs::metadata(&output).map_err(|error| format!("qpdf 未生成优化后的 PDF：{error}"))?;
        if !metadata.is_file()
            || metadata.len() == 0
            || metadata.len() > MAX_PDF_OPTIMIZE_OUTPUT_BYTES
        {
            return Err("qpdf 输出超过安全范围或不是普通文件。".into());
        }
        let optimized =
            fs::read(&output).map_err(|error| format!("无法读取 qpdf 输出：{error}"))?;
        validate_pdf_header(&optimized)?;
        Ok(Response::new(optimized))
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

#[cfg(test)]
mod tests {
    use super::{validate_pdf_bytes, MAX_PDF_OPTIMIZE_INPUT_BYTES};

    #[test]
    fn pdf_optimizer_rejects_empty_non_pdf_and_oversized_input() {
        assert!(validate_pdf_bytes(&[]).is_err());
        assert!(validate_pdf_bytes(b"not a pdf").is_err());
        assert!(validate_pdf_bytes(b"%PDF-1.7\n").is_ok());
        let oversized = vec![b'x'; MAX_PDF_OPTIMIZE_INPUT_BYTES + 1];
        assert!(validate_pdf_bytes(&oversized).is_err());
    }
}
