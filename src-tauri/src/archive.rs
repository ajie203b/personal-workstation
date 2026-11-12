use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
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
struct Transfers {
    active: Option<Transfer>,
    error: Option<&'static str>,
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
    error: Option<&'static str>,
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

fn browser_url(url: &Url) -> bool {
    url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
        && url.domain().is_some_and(|domain| {
            let host = domain.trim_end_matches('.');
            host.contains('.') && !host.ends_with(".localhost")
                && !host.ends_with(".local") && !host.ends_with(".internal")
        })
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
            if transfers.active.is_some() {
                transfers.error = Some("请等当前电子书下载完成后再试");
                return false;
            }
            if !browser_url(&url) {
                transfers.error = Some("该下载地址无法在 Kairos 内打开");
                return false;
            }
            let Ok(root) = archive_root(webview.app_handle()) else {
                transfers.error = Some("无法打开电子书下载目录");
                return false;
            };
            match start_download(&root, url, destination) {
                Ok(transfer) => {
                    *destination = transfer.temp.clone();
                    transfers.active = Some(transfer);
                    transfers.error = None;
                    true
                }
                Err(error) => { transfers.error = Some(error); false }
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
            transfers.error = error;
            if error.is_some() {
                let _ = fs::remove_file(&task.temp);
                if let Some(dir) = task.temp.parent() {
                    let _ = fs::remove_file(dir.join("name.txt"));
                    let _ = fs::remove_dir(dir);
                }
            }
            true
        }
        _ => true,
    }
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
pub async fn archive_browser(app: AppHandle, action: BrowserAction, bounds: Option<Bounds>) -> Result<(), String> {
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
            let builder = WebviewBuilder::new(VIEW, WebviewUrl::External(HOME.parse::<Url>().unwrap()))
                .data_directory(profile)
                .devtools(false)
                .on_navigation(|url| browser_url(url) || url.as_str() == "about:blank" || url.as_str() == "about:srcdoc")
                .on_new_window(move |url, _| {
                    if browser_url(&url) {
                        if let Some(child) = popup_app.get_webview(VIEW) {
                            tauri::async_runtime::spawn(async move { let _ = child.navigate(url); });
                        }
                    }
                    NewWindowResponse::Deny
                })
                .on_download(download_event);
            window.add_child(builder, position, size).map_err(|_| "无法启动内嵌浏览器，请检查 WebView2 是否正常")?;
        }
        return Ok(());
    }
    let Some(child) = child else { return Ok(()) };
    match action {
        BrowserAction::Hide => child.hide(),
        BrowserAction::Back => child.eval("history.back()"),
        BrowserAction::Reload => child.reload(),
        BrowserAction::Home => child.navigate(HOME.parse::<Url>().unwrap()),
        BrowserAction::Show | BrowserAction::Resize => unreachable!(),
    }.map_err(|_| "浏览器操作失败".into())
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
    Ok(Downloads { items, downloading: transfers.active.is_some(), error: transfers.error })
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
