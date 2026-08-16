use serde::Serialize;
use std::{fs, path::PathBuf};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrLanguagePayload {
    pub tag: String,
    pub display_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrCapabilityPayload {
    pub available: bool,
    pub languages: Vec<OcrLanguagePayload>,
    pub default_language: Option<String>,
    pub max_image_dimension: u32,
    pub detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrRecognitionPayload {
    pub text: String,
    pub language: OcrLanguagePayload,
    pub source_width: u32,
    pub source_height: u32,
    pub processed_width: u32,
    pub processed_height: u32,
    pub line_count: u32,
    pub downscaled: bool,
}

#[cfg(windows)]
fn winrt_error(context: &str, error: windows::core::Error) -> String {
    format!("{context}：{error}")
}

#[cfg(windows)]
fn language_payload(
    language: &windows::Globalization::Language,
) -> Result<OcrLanguagePayload, String> {
    Ok(OcrLanguagePayload {
        tag: language
            .LanguageTag()
            .map_err(|error| winrt_error("无法读取 OCR 语言标识", error))?
            .to_string(),
        display_name: language
            .DisplayName()
            .map_err(|error| winrt_error("无法读取 OCR 语言名称", error))?
            .to_string(),
    })
}

#[cfg(windows)]
fn available_languages(
) -> Result<Vec<(windows::Globalization::Language, OcrLanguagePayload)>, String> {
    use windows::Media::Ocr::OcrEngine;

    let values = OcrEngine::AvailableRecognizerLanguages()
        .map_err(|error| winrt_error("无法读取 Windows OCR 语言包", error))?;
    let mut languages = Vec::with_capacity(values.Size().unwrap_or_default() as usize);
    for index in 0..values.Size().unwrap_or_default() {
        let language = values
            .GetAt(index)
            .map_err(|error| winrt_error("无法读取 Windows OCR 语言包", error))?;
        let payload = language_payload(&language)?;
        languages.push((language, payload));
    }
    Ok(languages)
}

#[cfg(windows)]
#[tauri::command]
pub fn probe_windows_ocr() -> Result<OcrCapabilityPayload, String> {
    use windows::Media::Ocr::OcrEngine;

    let languages = available_languages()?;
    let max_image_dimension = OcrEngine::MaxImageDimension()
        .map_err(|error| winrt_error("无法读取 Windows OCR 图像限制", error))?;
    let default_language = OcrEngine::TryCreateFromUserProfileLanguages()
        .ok()
        .and_then(|engine| engine.RecognizerLanguage().ok())
        .and_then(|language| language.LanguageTag().ok())
        .map(|tag| tag.to_string());
    let available = !languages.is_empty();
    let detail = if available {
        format!(
            "Windows 本机 OCR 已就绪，共 {} 个语言包；图片不会离开本机。",
            languages.len()
        )
    } else {
        "Windows 没有可用的 OCR 语言包，请先在系统语言设置中添加语言功能。".into()
    };
    Ok(OcrCapabilityPayload {
        available,
        languages: languages.into_iter().map(|(_, payload)| payload).collect(),
        default_language,
        max_image_dimension,
        detail,
    })
}

#[cfg(not(windows))]
#[tauri::command]
pub fn probe_windows_ocr() -> Result<OcrCapabilityPayload, String> {
    Ok(OcrCapabilityPayload {
        available: false,
        languages: Vec::new(),
        default_language: None,
        max_image_dimension: 0,
        detail: "当前平台尚未接入本机 OCR；Windows 10/11 开发版可使用系统 OCR。".into(),
    })
}

#[cfg(windows)]
#[tauri::command]
pub fn read_ocr_font() -> Result<tauri::ipc::Response, String> {
    const MAX_FONT_BYTES: u64 = 32 * 1024 * 1024;
    let candidates = [
        PathBuf::from(r"C:\Windows\Fonts\msyh.ttc"),
        PathBuf::from(r"C:\Windows\Fonts\simsun.ttc"),
        PathBuf::from(r"C:\Windows\Fonts\segoeui.ttf"),
    ];
    for path in candidates {
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_FONT_BYTES {
            continue;
        }
        let bytes = fs::read(&path).map_err(|error| format!("无法读取系统 OCR 字体：{error}"))?;
        return Ok(tauri::ipc::Response::new(bytes));
    }
    Err("未找到可用于 OCR 文本层的 Windows 系统字体。".into())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn read_ocr_font() -> Result<tauri::ipc::Response, String> {
    Err("当前平台尚未接入 Windows OCR 字体。".into())
}

#[cfg(windows)]
fn bounded_image_bytes(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    const MAX_OCR_INPUT_BYTES: usize = 50 * 1024 * 1024;
    if bytes.is_empty() {
        return Err("图片文件为空。".into());
    }
    if bytes.len() > MAX_OCR_INPUT_BYTES {
        return Err("图片超过 50 MB 安全上限，请先在图片工作室缩小或压缩。".into());
    }
    Ok(bytes)
}

#[cfg(windows)]
fn bounded_image_file(path: &str) -> Result<Vec<u8>, String> {
    let requested = PathBuf::from(path);
    let canonical = requested
        .canonicalize()
        .map_err(|error| format!("无法访问待识别图片：{error}"))?;
    let metadata =
        fs::metadata(&canonical).map_err(|error| format!("无法读取图片信息：{error}"))?;
    if !metadata.is_file() {
        return Err("请选择一个图片文件，而不是文件夹。".into());
    }
    bounded_image_bytes(fs::read(canonical).map_err(|error| format!("无法读取待识别图片：{error}"))?)
}

#[cfg(windows)]
fn scaled_dimensions(width: u32, height: u32, max_dimension: u32) -> Result<(u32, u32), String> {
    if width == 0 || height == 0 {
        return Err("图片尺寸无效。".into());
    }
    if max_dimension == 0 || (width <= max_dimension && height <= max_dimension) {
        return Ok((width, height));
    }
    let scale = f64::from(max_dimension) / f64::from(width.max(height));
    Ok((
        (f64::from(width) * scale).round().max(1.0) as u32,
        (f64::from(height) * scale).round().max(1.0) as u32,
    ))
}

#[cfg(windows)]
fn recognize_image_bytes_inner(
    bytes: Vec<u8>,
    language_tag: Option<String>,
) -> Result<OcrRecognitionPayload, String> {
    use windows::{
        core::HSTRING,
        Globalization::Language,
        Graphics::Imaging::{
            BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, BitmapTransform,
            ColorManagementMode, ExifOrientationMode,
        },
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    };

    let languages = available_languages()?;
    if languages.is_empty() {
        return Err(
            "Windows 没有可用的 OCR 语言包，请先在系统语言设置中添加中文或英文语言功能。".into(),
        );
    }

    let requested_tag = language_tag.unwrap_or_default().trim().to_string();
    let selected = if requested_tag.is_empty() {
        OcrEngine::TryCreateFromUserProfileLanguages()
            .ok()
            .and_then(|engine| engine.RecognizerLanguage().ok())
            .and_then(|default_language| {
                let default_tag = default_language.LanguageTag().ok()?.to_string();
                languages
                    .iter()
                    .find(|(_, payload)| payload.tag.eq_ignore_ascii_case(&default_tag))
                    .cloned()
            })
            .unwrap_or_else(|| languages[0].clone())
    } else {
        languages
            .iter()
            .find(|(_, payload)| payload.tag.eq_ignore_ascii_case(&requested_tag))
            .cloned()
            .ok_or_else(|| {
                format!("未安装 {requested_tag} OCR 语言包。请在本机能力页刷新后重新选择。")
            })?
    };
    let language = Language::CreateLanguage(&HSTRING::from(&selected.1.tag))
        .map_err(|error| winrt_error("无法初始化所选 OCR 语言", error))?;
    let engine = OcrEngine::TryCreateFromLanguage(&language)
        .map_err(|error| winrt_error("无法启动 Windows OCR", error))?;

    let stream = InMemoryRandomAccessStream::new()
        .map_err(|error| winrt_error("无法创建图片读取缓冲区", error))?;
    let writer = DataWriter::CreateDataWriter(&stream)
        .map_err(|error| winrt_error("无法创建图片写入缓冲区", error))?;
    writer
        .WriteBytes(&bytes)
        .map_err(|error| winrt_error("无法载入图片数据", error))?;
    writer
        .StoreAsync()
        .and_then(|operation| operation.get())
        .map_err(|error| winrt_error("无法载入图片数据", error))?;
    let _ = writer.DetachStream();
    stream
        .Seek(0)
        .map_err(|error| winrt_error("无法定位图片数据", error))?;

    let decoder = BitmapDecoder::CreateAsync(&stream)
        .and_then(|operation| operation.get())
        .map_err(|error| winrt_error("Windows 无法解码这张图片，请先转换为 PNG 或 JPG", error))?;
    let source_width = decoder
        .OrientedPixelWidth()
        .or_else(|_| decoder.PixelWidth())
        .map_err(|error| winrt_error("无法读取图片宽度", error))?;
    let source_height = decoder
        .OrientedPixelHeight()
        .or_else(|_| decoder.PixelHeight())
        .map_err(|error| winrt_error("无法读取图片高度", error))?;
    let max_dimension = OcrEngine::MaxImageDimension()
        .map_err(|error| winrt_error("无法读取 Windows OCR 图像限制", error))?;
    let (processed_width, processed_height) =
        scaled_dimensions(source_width, source_height, max_dimension)?;
    let transform =
        BitmapTransform::new().map_err(|error| winrt_error("无法创建 OCR 图像变换", error))?;
    transform
        .SetScaledWidth(processed_width)
        .and_then(|_| transform.SetScaledHeight(processed_height))
        .map_err(|error| winrt_error("无法缩放 OCR 图片", error))?;
    let bitmap = decoder
        .GetSoftwareBitmapTransformedAsync(
            BitmapPixelFormat::Bgra8,
            BitmapAlphaMode::Premultiplied,
            &transform,
            ExifOrientationMode::RespectExifOrientation,
            ColorManagementMode::ColorManageToSRgb,
        )
        .and_then(|operation| operation.get())
        .map_err(|error| winrt_error("无法准备 OCR 图片", error))?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .and_then(|operation| operation.get())
        .map_err(|error| winrt_error("Windows OCR 识别失败", error))?;
    let text = result
        .Text()
        .map_err(|error| winrt_error("无法读取 OCR 文本", error))?
        .to_string()
        .replace("\r\n", "\n")
        .trim()
        .to_string();
    let line_count = result
        .Lines()
        .ok()
        .and_then(|lines| lines.Size().ok())
        .unwrap_or_default();

    Ok(OcrRecognitionPayload {
        text,
        language: selected.1,
        source_width,
        source_height,
        processed_width,
        processed_height,
        line_count,
        downscaled: source_width != processed_width || source_height != processed_height,
    })
}

#[cfg(windows)]
#[tauri::command]
pub fn recognize_image_text(
    path: String,
    language_tag: Option<String>,
) -> Result<OcrRecognitionPayload, String> {
    recognize_image_bytes_inner(bounded_image_file(&path)?, language_tag)
}

#[cfg(windows)]
#[tauri::command]
pub fn recognize_image_bytes(
    request: tauri::ipc::Request<'_>,
) -> Result<OcrRecognitionPayload, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("OCR 图片传输格式无效。".into());
    };
    let language_tag = request
        .headers()
        .get("x-toolknit-language")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    recognize_image_bytes_inner(bounded_image_bytes(data.to_vec())?, language_tag)
}

#[cfg(not(windows))]
#[tauri::command]
pub fn recognize_image_text(
    _path: String,
    _language_tag: Option<String>,
) -> Result<OcrRecognitionPayload, String> {
    Err("当前平台尚未接入本机 OCR；请使用 Windows 10/11 桌面开发版。".into())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn recognize_image_bytes(
    _request: tauri::ipc::Request<'_>,
) -> Result<OcrRecognitionPayload, String> {
    Err("当前平台尚未接入本机 OCR；请使用 Windows 10/11 桌面开发版。".into())
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    use super::{recognize_image_text, scaled_dimensions};

    #[cfg(windows)]
    #[test]
    fn keeps_small_ocr_images_at_source_size() {
        assert_eq!(scaled_dimensions(1200, 800, 2600).unwrap(), (1200, 800));
    }

    #[cfg(windows)]
    #[test]
    fn downscales_large_ocr_images_without_changing_aspect_ratio() {
        assert_eq!(scaled_dimensions(5200, 2600, 2600).unwrap(), (2600, 1300));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_zero_sized_ocr_images() {
        assert!(scaled_dimensions(0, 100, 2600).is_err());
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires a Windows OCR language pack and exercises the real WinRT decoder"]
    fn recognizes_a_real_local_png_without_uploading_it() {
        use image::{codecs::png::PngEncoder, ExtendedColorType, ImageEncoder};

        let width = 480_u32;
        let height = 160_u32;
        let mut pixels = vec![255_u8; (width * height * 3) as usize];
        // A few dark bars keep the smoke image non-uniform while avoiding any
        // font or network dependency. The assertion verifies the full native
        // decode -> SoftwareBitmap -> OCR pipeline, not recognition accuracy.
        for y in 45..115 {
            for x in [60..76, 100..116, 140..156, 180..196, 220..236] {
                for pixel_x in x {
                    let offset = ((y * width + pixel_x) * 3) as usize;
                    pixels[offset..offset + 3].fill(24);
                }
            }
        }
        let path = std::env::temp_dir().join(format!("knitspace-ocr-{}.png", uuid::Uuid::now_v7()));
        let file = std::fs::File::create(&path).unwrap();
        PngEncoder::new(file)
            .write_image(&pixels, width, height, ExtendedColorType::Rgb8)
            .unwrap();
        let result = recognize_image_text(path.to_string_lossy().into_owned(), None).unwrap();
        let _ = std::fs::remove_file(path);
        assert_eq!((result.source_width, result.source_height), (width, height));
        assert_eq!(
            (result.processed_width, result.processed_height),
            (width, height)
        );
    }
}
