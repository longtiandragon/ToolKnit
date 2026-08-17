use crate::vault::{VaultMarkdownAttachment, VaultService};
use image::ImageFormat;
use reqwest::{header, redirect::Policy, Client, Response};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use url::{Host, Url};
use uuid::Uuid;

const MAX_URL_CHARS: usize = 2_048;
const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
const MAX_REMOTE_IMAGES: usize = 8;
const MAX_IMAGE_BYTES: usize = 6 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES: usize = 24 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchWebPageRequest {
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedWebPage {
    pub url: String,
    pub html: String,
    pub content_type: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteArticleImageInput {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalizeArticleImagesRequest {
    pub document_id: String,
    pub images: Vec<RemoteArticleImageInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalizedArticleImage {
    pub original_url: String,
    pub source: String,
    pub filename: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleImageFailure {
    pub original_url: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalizeArticleImagesReport {
    pub localized: Vec<LocalizedArticleImage>,
    pub failures: Vec<ArticleImageFailure>,
}

#[derive(Debug, Clone)]
struct PinnedTarget {
    url: Url,
    host: String,
    addresses: Vec<SocketAddr>,
}

struct TemporaryRunDirectory(PathBuf);

impl Drop for TemporaryRunDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn parse_https_url(raw: &str) -> Result<Url, String> {
    let value = raw.trim();
    if value.is_empty()
        || value.chars().count() > MAX_URL_CHARS
        || value.chars().any(char::is_control)
    {
        return Err("网页地址为空、过长或包含控制字符。".into());
    }
    let mut url = Url::parse(value).map_err(|_| "网页地址格式无效。".to_string())?;
    if url.scheme() != "https" {
        return Err("受限抓取只允许 HTTPS 地址。".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("网页地址不能包含用户名或密码。".into());
    }
    if url.port_or_known_default() != Some(443) || url.port().is_some_and(|port| port != 443) {
        return Err("受限抓取只允许 HTTPS 标准端口 443。".into());
    }
    if url.host().is_none() {
        return Err("网页地址缺少主机名。".into());
    }
    url.set_fragment(None);
    Ok(url)
}

fn public_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    !(a == 0
        || a == 10
        || a == 127
        || a >= 224
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 88 && c == 99)
        || (a == 192 && b == 168)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113))
}

fn public_ipv6(address: Ipv6Addr) -> bool {
    if let Some(mapped) = address.to_ipv4_mapped() {
        return public_ipv4(mapped);
    }
    let segments = address.segments();
    let global_unicast = (segments[0] & 0xe000) == 0x2000;
    let documentation = segments[0] == 0x2001 && segments[1] == 0x0db8;
    let teredo = segments[0] == 0x2001 && segments[1] == 0;
    let six_to_four = segments[0] == 0x2002;
    global_unicast
        && !documentation
        && !teredo
        && !six_to_four
        && !address.is_loopback()
        && !address.is_unspecified()
        && !address.is_multicast()
}

fn public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => public_ipv4(address),
        IpAddr::V6(address) => public_ipv6(address),
    }
}

fn validate_addresses(
    url: Url,
    host: String,
    addresses: Vec<SocketAddr>,
) -> Result<PinnedTarget, String> {
    if addresses.is_empty() {
        return Err("网页主机没有可用的 DNS 地址。".into());
    }
    if addresses.iter().any(|address| !public_ip(address.ip())) {
        return Err("网页主机解析到了本机、局域网或保留地址，已阻止访问。".into());
    }
    let mut unique = HashSet::new();
    let addresses = addresses
        .into_iter()
        .filter(|address| unique.insert(*address))
        .take(16)
        .collect();
    Ok(PinnedTarget {
        url,
        host,
        addresses,
    })
}

fn resolve_target(raw: String) -> Result<PinnedTarget, String> {
    let url = parse_https_url(&raw)?;
    let host = url.host_str().ok_or("网页地址缺少主机名。")?.to_owned();
    let addresses = match url.host() {
        Some(Host::Ipv4(address)) => vec![SocketAddr::new(IpAddr::V4(address), 443)],
        Some(Host::Ipv6(address)) => vec![SocketAddr::new(IpAddr::V6(address), 443)],
        Some(Host::Domain(domain)) => (domain, 443)
            .to_socket_addrs()
            .map_err(|_| "无法解析网页主机；没有发出 HTTP 请求。".to_string())?
            .collect(),
        None => return Err("网页地址缺少主机名。".into()),
    };
    validate_addresses(url, host, addresses)
}

fn pinned_client(target: &PinnedTarget) -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .user_agent("Knitspace/0.1 restricted-web-fetch")
        .resolve_to_addrs(&target.host, &target.addresses)
        .build()
        .map_err(|error| format!("无法创建受限网页客户端：{error}"))
}

fn content_type(response: &Response) -> String {
    response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

fn validate_identity_encoding(response: &Response) -> Result<(), String> {
    let encoding = response
        .headers()
        .get(header::CONTENT_ENCODING)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .trim();
    if encoding.is_empty() || encoding.eq_ignore_ascii_case("identity") {
        Ok(())
    } else {
        Err("服务器返回了压缩响应；为避免解压炸弹，受限抓取不会处理它。".into())
    }
}

async fn read_bounded(mut response: Response, limit: usize) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(format!("响应超过 {} MiB 安全上限。", limit / 1024 / 1024));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("读取网络响应失败：{error}"))?
    {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(format!("响应超过 {} MiB 安全上限。", limit / 1024 / 1024));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn request_target(target: &PinnedTarget, accept: &str) -> Result<Response, String> {
    let response = pinned_client(target)?
        .get(target.url.clone())
        .header(header::ACCEPT, accept)
        .header(header::ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|error| format!("HTTPS 请求失败：{error}"))?;
    if response.status().is_redirection() {
        return Err("网页返回了重定向；为防止 SSRF 绕过，请复制最终 HTTPS 地址后重试。".into());
    }
    if !response.status().is_success() {
        return Err(format!("网页返回 HTTP {}。", response.status().as_u16()));
    }
    validate_identity_encoding(&response)?;
    Ok(response)
}

async fn fetch_page(raw: String) -> Result<FetchedWebPage, String> {
    let target = tauri::async_runtime::spawn_blocking(move || resolve_target(raw))
        .await
        .map_err(|error| format!("网页 DNS 校验任务失败：{error}"))??;
    let response = request_target(&target, "text/html, application/xhtml+xml;q=0.9").await?;
    let mime = content_type(&response);
    if mime != "text/html" && mime != "application/xhtml+xml" {
        return Err("目标不是受支持的 HTML 网页。".into());
    }
    let bytes = read_bounded(response, MAX_HTML_BYTES).await?;
    let html = String::from_utf8(bytes.clone())
        .map_err(|_| "网页不是 UTF-8 编码；当前受限抓取不会猜测或转码。".to_string())?;
    Ok(FetchedWebPage {
        url: target.url.to_string(),
        html,
        content_type: mime,
        bytes: bytes.len(),
    })
}

fn image_extension(mime: &str) -> Option<(&'static str, ImageFormat)> {
    match mime {
        "image/png" => Some(("png", ImageFormat::Png)),
        "image/jpeg" => Some(("jpg", ImageFormat::Jpeg)),
        "image/gif" => Some(("gif", ImageFormat::Gif)),
        "image/webp" => Some(("webp", ImageFormat::WebP)),
        "image/bmp" => Some(("bmp", ImageFormat::Bmp)),
        _ => None,
    }
}

async fn fetch_image(raw: String, remaining: usize) -> Result<(Vec<u8>, &'static str), String> {
    let target = tauri::async_runtime::spawn_blocking(move || resolve_target(raw))
        .await
        .map_err(|error| format!("图片 DNS 校验任务失败：{error}"))??;
    let response = request_target(
        &target,
        "image/png, image/jpeg, image/gif, image/webp, image/bmp",
    )
    .await?;
    let mime = content_type(&response);
    let (extension, expected_format) =
        image_extension(&mime).ok_or("远程资源不是受支持的栅格图片。")?;
    let bytes = read_bounded(response, remaining.min(MAX_IMAGE_BYTES)).await?;
    let actual_format =
        image::guess_format(&bytes).map_err(|_| "远程图片的文件签名无效。".to_string())?;
    if actual_format != expected_format {
        return Err("远程图片的 MIME 与文件签名不一致。".into());
    }
    Ok((bytes, extension))
}

fn write_temporary_image(
    directory: &Path,
    index: usize,
    extension: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let path = directory.join(format!("remote-{index:02}.{extension}"));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|error| format!("无法创建网页图片临时文件：{error}"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("无法写入网页图片临时文件：{error}"))?;
    Ok(path)
}

#[tauri::command]
pub async fn fetch_web_page(request: FetchWebPageRequest) -> Result<FetchedWebPage, String> {
    fetch_page(request.url).await
}

#[tauri::command]
pub async fn localize_web_article_images(
    app: AppHandle,
    request: LocalizeArticleImagesRequest,
) -> Result<LocalizeArticleImagesReport, String> {
    if request.images.is_empty() || request.images.len() > MAX_REMOTE_IMAGES {
        return Err(format!("请选择 1 到 {MAX_REMOTE_IMAGES} 张正文图片。"));
    }
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位应用缓存目录：{error}"))?
        .join("web-image-import");
    fs::create_dir_all(&cache_root)
        .map_err(|error| format!("无法创建网页图片缓存目录：{error}"))?;
    let run = cache_root.join(Uuid::now_v7().to_string());
    fs::create_dir(&run).map_err(|error| format!("无法创建网页图片临时目录：{error}"))?;
    let _cleanup = TemporaryRunDirectory(run.clone());
    let vault_path = crate::default_vault_path(&app)?;
    let service = VaultService::open(vault_path).map_err(|error| error.to_string())?;
    let mut localized = Vec::new();
    let mut failures = Vec::new();
    let mut total = 0_usize;
    let mut seen = HashSet::new();
    for (index, image) in request.images.into_iter().enumerate() {
        let original_url = image.url.trim().to_owned();
        if !seen.insert(original_url.clone()) {
            continue;
        }
        let remaining = MAX_IMAGE_TOTAL_BYTES.saturating_sub(total);
        let result = async {
            if remaining == 0 {
                return Err("本次图片总量已达到 24 MiB 安全上限。".into());
            }
            let (bytes, extension) = fetch_image(original_url.clone(), remaining).await?;
            total += bytes.len();
            let path = write_temporary_image(&run, index, extension, &bytes)?;
            let attachment: VaultMarkdownAttachment = service
                .import_document_image(&request.document_id, &path.to_string_lossy())
                .map_err(|error| error.to_string())?;
            let _ = fs::remove_file(&path);
            Ok::<_, String>(attachment)
        }
        .await;
        match result {
            Ok(attachment) => localized.push(LocalizedArticleImage {
                original_url,
                source: attachment.source,
                filename: attachment.filename,
                size: attachment.size,
            }),
            Err(error) => failures.push(ArticleImageFailure {
                original_url,
                error,
            }),
        }
    }
    Ok(LocalizeArticleImagesReport {
        localized,
        failures,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_policy_accepts_only_plain_https_on_port_443() {
        assert!(parse_https_url("https://example.com/article?q=1#part").is_ok());
        for value in [
            "http://example.com",
            "file:///etc/passwd",
            "https://user:pass@example.com",
            "https://example.com:444/path",
            "https://example.com/\nheader",
        ] {
            assert!(parse_https_url(value).is_err(), "accepted {value}");
        }
    }

    #[test]
    fn ip_policy_rejects_local_private_reserved_and_encoded_loopback() {
        for value in [
            "127.0.0.1",
            "10.0.0.1",
            "100.64.0.1",
            "169.254.169.254",
            "172.16.0.1",
            "192.168.1.1",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!public_ip(value.parse().unwrap()), "accepted {value}");
        }
        assert!(public_ip("1.1.1.1".parse().unwrap()));
        assert!(public_ip("2606:4700:4700::1111".parse().unwrap()));
    }

    #[test]
    fn any_private_dns_answer_rejects_the_entire_target() {
        let url = parse_https_url("https://example.com").unwrap();
        let mixed = vec![
            "1.1.1.1:443".parse().unwrap(),
            "127.0.0.1:443".parse().unwrap(),
        ];
        assert!(validate_addresses(url, "example.com".into(), mixed).is_err());
    }

    #[test]
    fn numeric_loopback_spellings_are_rejected_before_http() {
        for value in [
            "https://127.0.0.1/",
            "https://127.1/",
            "https://2130706433/",
            "https://0x7f000001/",
            "https://[::1]/",
            "https://[::ffff:127.0.0.1]/",
        ] {
            assert!(resolve_target(value.into()).is_err(), "accepted {value}");
        }
    }

    #[test]
    fn image_types_exclude_svg_and_active_content() {
        assert_eq!(image_extension("image/png").unwrap().0, "png");
        assert!(image_extension("image/svg+xml").is_none());
        assert!(image_extension("text/html").is_none());
    }
}
