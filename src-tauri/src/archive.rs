use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{BufWriter, Read, Write},
    net::{IpAddr, ToSocketAddrs},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri_plugin_http::reqwest::{self, redirect::Policy};
use tauri::{
    ipc::Response,
    webview::{DownloadEvent, NewWindowResponse, WebviewBuilder},
    AppHandle, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl,
};

const HOME: &str = "https://annas-archive.gd/";
const VIEW: &str = "archive-browser";
const MAX_BYTES: u64 = 150 * 1024 * 1024;

#[derive(Default)]
pub struct ArchiveState(Mutex<Transfers>);

#[derive(Default)]
pub struct ArchiveHistory(Mutex<PageHistory>);

#[derive(Default)]
struct PageHistory {
    pages: Vec<Url>,
    on_partner_site: bool,
}

impl PageHistory {
    fn record(&mut self, url: &Url) {
        if !browser_url(url) { return; }
        if !archive_site(url) {
            self.on_partner_site = true;
            return;
        }
        if url.path().starts_with("/cdn-cgi/") || url.path().starts_with("/dyn/") { return; }

        self.on_partner_site = false;
        let mut page = url.clone();
        page.set_fragment(None);
        let params: Vec<_> = url.query_pairs().filter(|(key, _)| {
            !key.starts_with("__ddg") && !key.starts_with("__cf_chl") && !key.starts_with("cf_chl_")
        }).collect();
        if params.len() != url.query_pairs().count() {
            page.set_query(None);
            if !params.is_empty() { page.query_pairs_mut().extend_pairs(params); }
        }
        let repeated = self.pages.last().is_some_and(|last| {
            last.origin() == page.origin() && last.path() == page.path()
                && last.query_pairs().eq(page.query_pairs())
        });
        if !repeated {
            self.pages.push(page);
            if self.pages.len() > 64 { self.pages.remove(0); }
        }
    }

    fn download_page(&self) -> Option<&Url> {
        if self.on_partner_site { return None; }
        self.pages.last().filter(|page| page.path().starts_with("/slow_download/"))
    }

    fn back(&mut self) -> Option<Url> {
        if std::mem::take(&mut self.on_partner_site) { return self.pages.last().cloned(); }
        let current = self.pages.pop()?;
        self.pages.last().cloned().or_else(|| {
            let mut parts = current.path_segments()?;
            if parts.next()? != "slow_download" { return None; }
            let id = parts.next()?;
            if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) { return None; }
            current.join(&format!("/md5/{id}")).ok()
        })
    }
}

pub fn record_page(webview: &Webview, url: &Url) {
    let history = webview.state::<ArchiveHistory>();
    let Ok(mut pages) = history.0.lock() else { return; };
    pages.record(url);
}

#[derive(Default)]
struct Transfers {
    active: Option<Transfer>,
    direct: Option<Progress>,
    error: Option<String>,
}

#[derive(Clone, Serialize, Default)]
struct Progress {
    received: u64,
    total: Option<u64>,
}

struct Transfer {
    url: Url,
    temp: PathBuf,
    ready: PathBuf,
}

#[derive(Serialize)]
struct Download {
    id: String,
    name: String,
    size: u64,
}

#[derive(Serialize)]
pub struct Downloads {
    items: Vec<Download>,
    downloading: bool,
    progress: Option<Progress>,
    error: Option<String>,
}

#[derive(Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BrowserAction { Show, Resize, Hide, Back, Reload, Home }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BrowserOutcome { Ok, Exit }

fn browser_url(url: &Url) -> bool {
    url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
        && url.domain().is_some_and(|domain| {
            let host = domain.trim_end_matches('.');
            host.contains('.') && !host.ends_with(".localhost")
                && !host.ends_with(".local") && !host.ends_with(".internal")
        })
}

fn archive_site(url: &Url) -> bool {
    if !browser_url(url) { return false; }
    let Some(host) = url.domain() else { return false; };
    let (prefix, root) = host.split_once('.').unwrap_or(("", host));
    let language = (2..=3).contains(&prefix.len()) && prefix.bytes().all(|b| b.is_ascii_lowercase());
    let host = if language { root } else { host };
    matches!(host, "annas-archive.gd" | "annas-archive.gl" | "annas-archive.pk") && url.port().is_none()
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => !matches!(ip.octets(),
            [0 | 10 | 127 | 224..=255, ..] | [100, 64..=127, ..] | [169, 254, ..]
            | [172, 16..=31, ..] | [192, 0, 0 | 2, _] | [192, 168, ..]
            | [198, 18 | 19, ..] | [198, 51, 100, _] | [203, 0, 113, _]),
        IpAddr::V6(ip) => matches!(ip.segments(), [0x2000..=0x3fff, ..])
            && !matches!(ip.segments(), [0x2001, 0..=0x01ff | 0x0db8, ..] | [0x2002, ..] | [0x3fff, ..]),
    }
}

fn direct_url(url: &Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() { return false; }
    let literal = url.host_str().and_then(|host| host.trim_matches(['[', ']']).parse::<IpAddr>().ok());
    match url.scheme() {
        "http" => literal.is_some_and(public_ip),
        "https" => literal.map_or_else(|| browser_url(url), public_ip),
        _ => false,
    }
}

fn direct_filename(url: &Url) -> Option<String> {
    let leaf = url.path_segments()?.next_back()?;
    let name = percent_encoding::percent_decode_str(leaf).decode_utf8().ok()?.into_owned();
    book_extension(&name)?;
    (!name.contains(['/', '\\'])).then_some(name)
}

fn navigation_allowed(app: &AppHandle, url: &Url) -> bool {
    if intercept_download(app, url) { return false; }
    if browser_url(url) || matches!(url.as_str(), "about:blank" | "about:srcdoc") { return true; }
    if url.scheme() == "http" {
        if let Ok(mut transfers) = app.state::<ArchiveState>().0.lock() {
            transfers.error = Some("这个网页链接使用 HTTP，请复制下载地址，再点「粘贴链接下载」".into());
        }
    }
    false
}

fn download_from_page(history: &PageHistory, url: &Url) -> Option<String> {
    let page = history.download_page()?;
    if page.origin() == url.origin() || !direct_url(url) || url.as_str().len() > 16384 { return None; }
    direct_filename(url)
}

fn intercept_download(app: &AppHandle, url: &Url) -> bool {
    let history = app.state::<ArchiveHistory>();
    let name = history.0.lock().ok().and_then(|history| download_from_page(&history, url));
    let Some(name) = name else { return false; };
    if let Err(error) = queue_direct_download(app, url.clone(), name) {
        if let Ok(mut transfers) = app.state::<ArchiveState>().0.lock() {
            if transfers.active.is_none() && transfers.direct.is_none() { transfers.error = Some(error); }
        }
    }
    true
}

fn archive_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_local_data_dir().map_err(|_| "无法定位下载目录")?.join("archive-books");
    fs::create_dir_all(&root).map_err(|_| "无法创建电子书下载目录")?;
    root.canonicalize().map_err(|_| "无法打开电子书下载目录".into())
}

fn book_extension(name: &str) -> Option<&'static str> {
    let ext = Path::new(name).extension()?.to_str()?;
    if ext.eq_ignore_ascii_case("epub") { return Some("epub"); }
    if ext.eq_ignore_ascii_case("pdf") { return Some("pdf"); }
    None
}

fn start_download(root: &Path, url: Url, destination: &Path) -> Result<Transfer, &'static str> {
    let name = destination.file_name().and_then(|part| part.to_str()).ok_or("无法识别电子书文件名")?;
    let extension = book_extension(name).ok_or("请选择 EPUB 或 PDF 格式的电子书")?;
    let stem: String = name[..name.len() - extension.len() - 1].chars().filter(|c| !c.is_control()).take(240).collect();
    let name = format!("{stem}.{extension}");
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "无法创建下载任务")?;
    let dir = root.join(now.as_nanos().to_string());
    fs::create_dir(&dir).map_err(|_| "无法创建下载任务")?;
    fs::write(dir.join("name.txt"), name).map_err(|_| "无法记录电子书名称")?;
    Ok(Transfer { url, temp: dir.join(format!("partial.{extension}")), ready: dir.join(format!("book.{extension}")) })
}

fn download_event(webview: Webview, event: DownloadEvent<'_>) -> bool {
    let state = webview.state::<ArchiveState>();
    let Ok(mut transfers) = state.0.lock() else { return false };
    match event {
        DownloadEvent::Requested { url, destination } => {
            if transfers.active.is_some() || transfers.direct.is_some() {
                transfers.error = Some("请等当前电子书下载完成后再试".into());
                return false;
            }
            if !browser_url(&url) {
                transfers.error = Some("这个下载链接需要复制后使用「粘贴链接下载」".into());
                return false;
            }
            let Ok(root) = archive_root(webview.app_handle()) else {
                transfers.error = Some("无法打开电子书下载目录".into());
                return false;
            };
            match start_download(&root, url, destination) {
                Ok(transfer) => {
                    *destination = transfer.temp.clone();
                    transfers.active = Some(transfer);
                    transfers.error = None;
                    true
                }
                Err(error) => { transfers.error = Some(error.into()); false }
            }
        }
        DownloadEvent::Finished { url, path, success, .. } => {
            if !transfers.active.as_ref().is_some_and(|task| {
                if let Some(path) = &path {
                    path.canonicalize().ok().zip(task.temp.canonicalize().ok()).is_some_and(|(a, b)| a == b)
                } else {
                    task.url == url
                }
            }) { return true; }
            let Some(task) = transfers.active.take() else { return true };
            let error = match fs::metadata(&task.temp) {
                Ok(meta) if success && meta.len() > MAX_BYTES => Some("文件超过 150 MB，无法导入"),
                Ok(meta) if success && meta.len() > 0 && fs::rename(&task.temp, &task.ready).is_ok() => None,
                _ => Some("下载未完成，请回到网页重试"),
            };
            transfers.error = error.map(str::to_owned);
            if error.is_some() { remove_partial(&task); }
            true
        }
        _ => true,
    }
}

fn remove_partial(task: &Transfer) {
    let _ = fs::remove_file(&task.temp);
    if let Some(dir) = task.temp.parent() {
        let _ = fs::remove_file(dir.join("name.txt"));
        let _ = fs::remove_dir(dir);
    }
}

async fn request_direct(url: Url) -> Result<reqwest::Response, String> {
    let origin = url.origin();
    let mut client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(12))
        .timeout(Duration::from_secs(300))
        .referer(false)
        .redirect(Policy::custom(move |attempt| {
            if attempt.previous().len() <= 4 && attempt.url().origin() == origin { attempt.follow() }
            else { attempt.stop() }
        }));
    if let Some(domain) = url.domain() {
        let domain = domain.to_owned();
        let host = domain.clone();
        let port = url.port_or_known_default().ok_or("下载地址缺少端口")?;
        let addresses = tauri::async_runtime::spawn_blocking(move || {
            (host.as_str(), port).to_socket_addrs().map(|ips| ips.collect::<Vec<_>>())
        }).await.map_err(|_| "无法解析下载服务器")?.map_err(|_| "无法解析下载服务器")?;
        if addresses.is_empty() || addresses.iter().any(|address| !public_ip(address.ip())) {
            return Err("下载地址必须指向公网服务器".into());
        }
        client = client.resolve_to_addrs(&domain, &addresses);
    }
    let response = client.build().map_err(|_| "无法启动下载")?.get(url).send().await.map_err(|error| {
        if error.is_timeout() { "连接下载服务器超时，可换一个慢速服务器" }
        else { "无法连接下载服务器，可换一个慢速服务器" }
    })?;
    if !response.status().is_success() {
        let code = response.status().as_u16();
        let message = match code {
            401 | 403 | 404 | 410 => "请刷新下载页后重试，或换一个慢速服务器",
            429 => "服务器限流，请稍后重试",
            300..=399 => "服务器要求跳转，请刷新下载页或换一个慢速服务器",
            _ => "可换一个慢速服务器",
        };
        return Err(format!("下载失败（HTTP {code}），{message}"));
    }
    Ok(response)
}

async fn save_direct(app: &AppHandle, url: Url, name: String) -> Result<(), String> {
    let mut response = request_direct(url.clone()).await?;
    let total = response.content_length();
    if total.is_some_and(|size| size > MAX_BYTES) { return Err("文件超过 150 MB，无法导入".into()); }
    let root = archive_root(app)?;
    let task = start_download(&root, url, Path::new(&name))?;
    let state = app.state::<ArchiveState>();
    let result = async {
        let mut file = BufWriter::new(fs::File::create(&task.temp).map_err(|_| "无法创建下载文件")?);
        let mut received = 0u64;
        let mut header = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "下载中断，请重新复制链接后重试")? {
            received += chunk.len() as u64;
            if received > MAX_BYTES { return Err("文件超过 150 MB，无法导入"); }
            let take = chunk.len().min(1024 - header.len());
            header.extend_from_slice(&chunk[..take]);
            file.write_all(&chunk).map_err(|_| "无法写入下载文件")?;
            if let Ok(mut transfers) = state.0.lock() {
                transfers.direct = Some(Progress { received, total });
            }
        }
        let valid = if book_extension(&name) == Some("pdf") {
            header.windows(5).any(|prefix| prefix == b"%PDF-")
        } else { header.starts_with(b"PK\x03\x04") };
        if !valid { return Err("服务器返回的内容不是电子书，请换一个下载地址"); }
        file.flush().map_err(|_| "无法保存下载文件")?;
        drop(file);
        fs::rename(&task.temp, &task.ready).map_err(|_| "无法保存下载文件")
    }.await;
    if result.is_err() { remove_partial(&task); }
    result.map_err(str::to_owned)
}

#[tauri::command]
pub async fn archive_download_link(app: AppHandle, link: String) -> Result<(), String> {
    if link.len() > 16384 { return Err("下载地址过长，请重新复制".into()); }
    let url = Url::parse(link.trim()).map_err(|_| "请粘贴完整的电子书下载地址")?;
    if !direct_url(&url) { return Err("请使用 HTTPS 地址或指向公网 IP 的 HTTP 地址".into()); }
    let name = direct_filename(&url).ok_or("请粘贴网页复制的 EPUB 或 PDF 直链")?;
    queue_direct_download(&app, url, name)
}

fn queue_direct_download(app: &AppHandle, url: Url, name: String) -> Result<(), String> {
    {
        let state = app.state::<ArchiveState>();
        let mut transfers = state.0.lock().map_err(|_| "无法读取下载状态")?;
        if transfers.active.is_some() || transfers.direct.is_some() { return Err("请等当前电子书下载完成后再试".into()); }
        transfers.direct = Some(Progress::default());
        transfers.error = None;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = save_direct(&app, url, name).await;
        if let Ok(mut transfers) = app.state::<ArchiveState>().0.lock() {
            transfers.direct = None;
            transfers.error = result.err();
        }
    });
    Ok(())
}

fn ready_book(root: &Path, id: &str) -> Option<(Download, PathBuf)> {
    if id.is_empty() || id.len() > 30 || !id.bytes().all(|c| c.is_ascii_digit()) { return None; }
    let dir = root.join(id);
    if !fs::symlink_metadata(&dir).ok()?.file_type().is_dir() || dir.canonicalize().ok()? != dir { return None; }
    let name_path = dir.join("name.txt");
    if !fs::symlink_metadata(&name_path).ok()?.file_type().is_file() { return None; }
    let mut name = String::new();
    fs::File::open(name_path).ok()?.take(1024).read_to_string(&mut name).ok()?;
    let path = dir.join(format!("book.{}", book_extension(&name)?));
    let meta = fs::symlink_metadata(&path).ok()?;
    if !meta.file_type().is_file() || meta.len() == 0 || meta.len() > MAX_BYTES { return None; }
    Some((Download { id: id.to_owned(), name, size: meta.len() }, path))
}

#[tauri::command]
pub async fn archive_browser(app: AppHandle, action: BrowserAction, bounds: Option<Bounds>) -> Result<BrowserOutcome, String> {
    let child = app.get_webview(VIEW);
    if matches!(action, BrowserAction::Show | BrowserAction::Resize) {
        let b = bounds.ok_or("浏览区域无效")?;
        if ![b.x, b.y, b.width, b.height].into_iter().all(|n| n.is_finite() && (0.0..=16384.0).contains(&n))
            || b.width < 1.0 || b.height < 1.0 { return Err("浏览区域无效".into()); }
        let position = LogicalPosition::new(b.x, b.y);
        let size = LogicalSize::new(b.width, b.height);
        if let Some(child) = child {
            child.set_bounds(Rect { position: position.into(), size: size.into() }).map_err(|_| "无法调整浏览区域")?;
            if matches!(action, BrowserAction::Show) { child.show().map_err(|_| "无法显示内嵌浏览器")?; }
        } else if matches!(action, BrowserAction::Show) {
            let window = app.get_window("main").ok_or("主窗口未打开")?;
            let profile = app.path().app_local_data_dir().map_err(|_| "无法定位浏览器目录")?.join("archive-browser");
            let popup_app = app.clone();
            let navigation_app = app.clone();
            let builder = WebviewBuilder::new(VIEW, WebviewUrl::External(HOME.parse::<Url>().unwrap()))
                .data_directory(profile)
                .devtools(false)
                .on_navigation(move |url| navigation_allowed(&navigation_app, url))
                .on_new_window(move |url, _| {
                    if navigation_allowed(&popup_app, &url) && browser_url(&url) {
                        if let Some(child) = popup_app.get_webview(VIEW) {
                            tauri::async_runtime::spawn(async move { let _ = child.navigate(url); });
                        }
                    }
                    NewWindowResponse::Deny
                })
                .on_download(download_event);
            window.add_child(builder, position, size).map_err(|_| "无法启动内嵌浏览器，请检查 WebView2 是否正常")?;
        }
        return Ok(BrowserOutcome::Ok);
    }
    let Some(child) = child else {
        return Ok(if matches!(action, BrowserAction::Back) { BrowserOutcome::Exit } else { BrowserOutcome::Ok });
    };
    let history = app.state::<ArchiveHistory>();
    match action {
        BrowserAction::Hide => child.hide(),
        BrowserAction::Back => {
            let previous = history.0.lock().map_err(|_| "无法读取浏览历史")?.back();
            let Some(previous) = previous else { return Ok(BrowserOutcome::Exit); };
            child.navigate(previous)
        }
        BrowserAction::Reload => child.reload(),
        BrowserAction::Home => {
            *history.0.lock().map_err(|_| "无法读取浏览历史")? = PageHistory::default();
            child.navigate(HOME.parse::<Url>().unwrap())
        }
        BrowserAction::Show | BrowserAction::Resize => unreachable!(),
    }.map_err(|_| "浏览器操作失败")?;
    Ok(BrowserOutcome::Ok)
}

#[tauri::command]
pub async fn archive_downloads(app: AppHandle) -> Result<Downloads, String> {
    let root = archive_root(&app)?;
    let mut items: Vec<_> = fs::read_dir(&root).map_err(|_| "无法读取下载列表")?
        .filter_map(Result::ok)
        .filter_map(|entry| ready_book(&root, entry.file_name().to_str()?).map(|(book, _)| book))
        .collect();
    items.sort_unstable_by(|a, b| b.id.cmp(&a.id));
    let state = app.state::<ArchiveState>();
    let transfers = state.0.lock().map_err(|_| "无法读取下载状态")?;
    Ok(Downloads { items, downloading: transfers.active.is_some() || transfers.direct.is_some(), progress: transfers.direct.clone(), error: transfers.error.clone() })
}

#[tauri::command]
pub async fn archive_download_read(app: AppHandle, id: String) -> Result<Response, String> {
    let (_, path) = ready_book(&archive_root(&app)?, &id).ok_or("下载的电子书已不存在")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut bytes = Vec::new();
        fs::File::open(path).map_err(|_| "无法读取电子书")?.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes).map_err(|_| "无法读取电子书")?;
        if bytes.len() as u64 > MAX_BYTES { return Err("文件超过 150 MB，无法导入".into()); }
        Ok(Response::new(bytes))
    }).await.map_err(|_| "读取电子书失败")?
}

#[tauri::command]
pub async fn archive_download_remove(app: AppHandle, id: String) -> Result<(), String> {
    let (_, path) = ready_book(&archive_root(&app)?, &id).ok_or("下载的电子书已不存在")?;
    fs::remove_file(&path).map_err(|_| "无法清理下载文件")?;
    if let Some(dir) = path.parent() {
        let _ = fs::remove_file(dir.join("name.txt"));
        let _ = fs::remove_dir(dir);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_back_skips_verification_reloads_and_partner_redirects() {
        let home = Url::parse(HOME).unwrap();
        let search = home.join("search?q=Jane%20Austen&ext=epub").unwrap();
        let book = home.join("md5/51d2b22ca12a8b470b51f543298b34c9").unwrap();
        let slow = home.join("slow_download/51d2b22ca12a8b470b51f543298b34c9/0/7").unwrap();
        let mut history = PageHistory::default();
        for page in [&home, &search, &home.join("search?q=Jane+Austen&ext=epub&__ddg_token=check").unwrap(),
            &book, &slow, &slow.join("?__cf_chl_tk=check").unwrap(), &home.join("cdn-cgi/challenge-platform/check").unwrap(),
            &Url::parse("https://partner.example.org/first").unwrap(), &Url::parse("https://cdn.example.org/error").unwrap()] {
            history.record(page);
        }
        for expected in [&slow, &book, &search, &home] {
            assert_eq!(history.back().as_ref(), Some(expected));
            history.record(expected);
        }
        assert!(history.back().is_none());
    }

    #[test]
    fn archive_back_from_direct_slow_page_returns_to_book_details() {
        let mut history = PageHistory::default();
        history.record(&Url::parse("https://annas-archive.gd/slow_download/51d2b22ca12a8b470b51f543298b34c9/0/7").unwrap());
        let book = history.back().unwrap();
        assert_eq!(book.path(), "/md5/51d2b22ca12a8b470b51f543298b34c9");
        history.record(&book);
        assert!(history.back().is_none());
    }

    #[test]
    fn slow_download_links_route_from_localized_pages_to_the_downloader() {
        let source = Url::parse("https://zh.annas-archive.gd/slow_download/51d2b22ca12a8b470b51f543298b34c9/0/0").unwrap();
        let https = Url::parse("https://partner.example.org/signed/%E7%94%B5%E5%AD%90%E4%B9%A6.epub?token=test").unwrap();
        let http = Url::parse("http://1.1.1.1:6060/signed/book.pdf").unwrap();
        let mut history = PageHistory::default();
        history.record(&source);
        assert_eq!(download_from_page(&history, &https).as_deref(), Some("电子书.epub"));
        assert_eq!(download_from_page(&history, &http).as_deref(), Some("book.pdf"));
        for blocked in ["https://zh.annas-archive.gd/book.epub", "https://partner.example.org/verify",
            "http://127.0.0.1/book.pdf", "https://tauri.localhost/book.pdf"] {
            assert!(download_from_page(&history, &Url::parse(blocked).unwrap()).is_none(), "{blocked}");
        }
        history.record(&Url::parse("https://zh.annas-archive.gd.evil.example/slow_download/book").unwrap());
        assert!(download_from_page(&history, &https).is_none());
        history.record(&Url::parse("https://zh.annas-archive.gd/search?q=book").unwrap());
        assert!(download_from_page(&history, &https).is_none());
    }

    #[test]
    fn archive_navigation_excludes_local_and_non_https_origins() {
        for url in [HOME, "https://example.org/file.pdf", "https://challenges.cloudflare.com/"] {
            assert!(browser_url(&Url::parse(url).unwrap()));
        }
        for url in ["http://example.org/", "https://tauri.localhost/", "https://tauri.localhost./",
            "https://127.0.0.1/", "https://[::1]/", "file:///C:/secret.pdf", "https://user@example.org/"] {
            assert!(!browser_url(&Url::parse(url).unwrap()));
        }
    }

    #[test]
    fn pasted_downloads_accept_public_ip_links_without_widening_browser_navigation() {
        let link = Url::parse("http://1.1.1.1:6060/signed/%E7%94%B5%E5%AD%90%E4%B9%A6.epub?token=example").unwrap();
        assert!(direct_url(&link));
        assert_eq!(direct_filename(&link).as_deref(), Some("电子书.epub"));
        assert!(!browser_url(&link));
        assert!(direct_url(&Url::parse("https://www.gutenberg.org/book.pdf").unwrap()));

        for text in ["http://192.168.1.1/book.pdf", "http://100.64.0.1/book.pdf", "http://127.0.0.1/book.pdf",
            "http://localhost/book.pdf", "http://example.org/book.pdf", "http://[::ffff:127.0.0.1]/book.pdf",
            "https://tauri.localhost/book.pdf", "https://user@example.org/book.pdf", "https://169.254.169.254/book.pdf"] {
            assert!(!direct_url(&Url::parse(text).unwrap()), "{text}");
        }
        for text in ["https://example.org/page?file=book.pdf", "https://example.org/encoded%2Fbook.pdf", "https://example.org/file.exe"] {
            assert!(direct_filename(&Url::parse(text).unwrap()).is_none(), "{text}");
        }
    }

    #[test]
    fn only_completed_books_have_readable_ids() {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let directory = std::env::temp_dir().join(format!("kairos-archive-test-{nonce}"));
        fs::create_dir(&directory).unwrap();
        let root = directory.canonicalize().unwrap();
        assert!(start_download(&root, HOME.parse().unwrap(), Path::new("test.exe")).is_err());
        let transfer = start_download(&root, HOME.parse().unwrap(), Path::new("电子书.PDF")).unwrap();
        let folder = transfer.temp.parent().unwrap();
        let id = folder.file_name().unwrap().to_str().unwrap();
        fs::write(&transfer.temp, b"%PDF-1.7").unwrap();
        assert!(ready_book(&root, id).is_none());
        assert!(ready_book(&root, "../test").is_none());
        fs::rename(&transfer.temp, &transfer.ready).unwrap();
        let (book, path) = ready_book(&root, id).unwrap();
        assert_eq!(book.name, "电子书.pdf");
        assert_eq!(path, transfer.ready);
        fs::remove_file(path).unwrap();
        fs::remove_file(folder.join("name.txt")).unwrap();
        fs::remove_dir(folder).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
