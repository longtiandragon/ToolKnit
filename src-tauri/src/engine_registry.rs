use serde::Serialize;
use std::{
    io::Read,
    process::{Child, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

const MAX_PROBE_OUTPUT_BYTES: usize = 16 * 1024;
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub id: String,
    pub title: String,
    pub category: String,
    pub available: bool,
    pub executable: Option<String>,
    pub version: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Copy)]
struct EngineSpec {
    id: &'static str,
    title: &'static str,
    category: &'static str,
    candidates: &'static [&'static str],
    args: &'static [&'static str],
}

const ENGINE_SPECS: &[EngineSpec] = &[
    EngineSpec {
        id: "ffmpeg",
        title: "FFmpeg",
        category: "媒体",
        candidates: &["ffmpeg", "ffmpeg.exe"],
        args: &["-version"],
    },
    EngineSpec {
        id: "ffprobe",
        title: "FFprobe",
        category: "媒体",
        candidates: &["ffprobe", "ffprobe.exe"],
        args: &["-version"],
    },
    EngineSpec {
        id: "seven-zip",
        title: "7-Zip",
        category: "归档",
        candidates: &["7z.exe", "7zz.exe", "7z", "7zz"],
        args: &["-version"],
    },
    EngineSpec {
        id: "qpdf",
        title: "qpdf",
        category: "PDF",
        candidates: &["qpdf.exe", "qpdf"],
        args: &["--version"],
    },
    EngineSpec {
        id: "libreoffice",
        title: "LibreOffice",
        category: "文档转换",
        candidates: &["soffice.exe", "libreoffice.exe", "soffice", "libreoffice"],
        args: &["--version"],
    },
    EngineSpec {
        id: "tesseract",
        title: "Tesseract OCR",
        category: "OCR",
        candidates: &["tesseract.exe", "tesseract"],
        args: &["--version"],
    },
    EngineSpec {
        id: "imagemagick",
        title: "ImageMagick",
        category: "图片",
        candidates: &["magick.exe", "magick", "convert.exe", "convert"],
        args: &["-version"],
    },
    EngineSpec {
        id: "exiftool",
        title: "ExifTool",
        category: "元数据",
        candidates: &["exiftool.exe", "exiftool"],
        args: &["-ver"],
    },
    EngineSpec {
        id: "czkawka",
        title: "Czkawka",
        category: "文件整理",
        candidates: &["czkawka_cli.exe", "czkawka_cli", "czkawka.exe", "czkawka"],
        args: &["--version"],
    },
    EngineSpec {
        id: "yt-dlp",
        title: "yt-dlp",
        category: "下载",
        candidates: &["yt-dlp.exe", "yt-dlp"],
        args: &["--version"],
    },
];

fn read_bounded(stream: impl Read) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    stream
        .take((MAX_PROBE_OUTPUT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取引擎版本信息失败：{error}"))?;
    if bytes.len() > MAX_PROBE_OUTPUT_BYTES {
        return Err("引擎版本信息超过安全上限。".into());
    }
    Ok(bytes)
}

fn wait_with_timeout(mut child: Child) -> Result<(ExitStatus, Vec<u8>, Vec<u8>), String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取引擎标准输出。".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取引擎错误输出。".to_string())?;
    let stdout_thread = thread::spawn(|| read_bounded(stdout));
    let stderr_thread = thread::spawn(|| read_bounded(stderr));
    let deadline = Instant::now() + PROBE_TIMEOUT;
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("无法检查引擎状态：{error}"))?
        {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();
            return Err("引擎版本探针超时，已停止该进程。".into());
        }
        thread::sleep(Duration::from_millis(25));
    };
    let stdout = stdout_thread
        .join()
        .map_err(|_| "读取引擎标准输出的线程异常退出。".to_string())??;
    let stderr = stderr_thread
        .join()
        .map_err(|_| "读取引擎错误输出的线程异常退出。".to_string())??;
    Ok((status, stdout, stderr))
}

fn probe_candidate(candidate: &str, args: &[&str]) -> Result<(ExitStatus, String), String> {
    let child = Command::new(candidate)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 {candidate}：{error}"))?;
    let (status, stdout, stderr) = wait_with_timeout(child)?;
    let output = format!(
        "{}\n{}",
        String::from_utf8_lossy(&stdout),
        String::from_utf8_lossy(&stderr)
    );
    Ok((status, output))
}

fn version_label(output: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .next()
        .map(|line| line.chars().take(160).collect())
}

fn probe_engine(spec: &EngineSpec) -> EngineStatus {
    let mut last_error = None;
    for candidate in spec.candidates {
        match probe_candidate(candidate, spec.args) {
            Ok((status, output)) if status.success() => {
                let version = version_label(&output);
                return EngineStatus {
                    id: spec.id.into(),
                    title: spec.title.into(),
                    category: spec.category.into(),
                    available: true,
                    executable: Some((*candidate).into()),
                    detail: version
                        .clone()
                        .unwrap_or_else(|| "固定版本探针已通过。".into()),
                    version,
                };
            }
            Ok((status, output)) => {
                last_error = version_label(&output).or_else(|| Some(format!("退出状态：{status}")));
            }
            Err(error) => last_error = Some(error),
        }
    }
    let detail = last_error
        .map(|error| {
            format!(
                "未检测到 {}。最近一次探针：{}",
                spec.title,
                error.chars().take(180).collect::<String>()
            )
        })
        .unwrap_or_else(|| {
            format!(
                "未检测到 {}。可安装后加入系统 PATH；Knitspace 不会自动下载或执行它。",
                spec.title
            )
        });
    EngineStatus {
        id: spec.id.into(),
        title: spec.title.into(),
        category: spec.category.into(),
        available: false,
        executable: None,
        version: None,
        detail,
    }
}

pub fn list_engine_statuses() -> Vec<EngineStatus> {
    let mut handles = Vec::with_capacity(ENGINE_SPECS.len());
    for (index, spec) in ENGINE_SPECS.iter().enumerate() {
        handles.push(thread::spawn(move || (index, probe_engine(spec))));
    }
    let mut statuses = handles
        .into_iter()
        .filter_map(|handle| handle.join().ok())
        .collect::<Vec<_>>();
    statuses.sort_by_key(|(index, _)| *index);
    statuses.into_iter().map(|(_, status)| status).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_label_is_bounded_and_ignores_blank_lines() {
        assert_eq!(
            version_label("\n ffmpeg version 8.0 \nextra"),
            Some("ffmpeg version 8.0".into())
        );
        let long = "x".repeat(200);
        assert_eq!(version_label(&long).unwrap().len(), 160);
        assert_eq!(version_label("\n\t"), None);
    }

    #[test]
    fn registry_specs_use_fixed_arguments_and_unique_ids() {
        let mut ids = std::collections::HashSet::new();
        for spec in ENGINE_SPECS {
            assert!(ids.insert(spec.id));
            assert!(!spec.candidates.is_empty());
            assert!(!spec.args.is_empty());
            assert!(spec
                .args
                .iter()
                .all(|argument| !argument.contains([' ', '\\', '/'])));
        }
    }

    #[test]
    fn bounded_reader_rejects_large_probe_output() {
        let result = read_bounded(std::io::Cursor::new(vec![0_u8; MAX_PROBE_OUTPUT_BYTES + 1]));
        assert!(result.is_err());
    }
}
