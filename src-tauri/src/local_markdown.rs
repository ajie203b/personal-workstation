use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{collections::HashMap, fs, io::Read, path::{Path, PathBuf}, sync::Mutex};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct LocalMarkdownState {
    /// 目录授权按窗口隔离：文档窗口之间、文档窗口与主窗口互不越权
    roots: Mutex<HashMap<String, Vec<PathBuf>>>,
    /// 冷启动时主窗口晚于文档窗口创建，记下标签等主窗口就绪后再置顶
    pub main_ready: Mutex<bool>,
    pub pending_focus: Mutex<Vec<String>>,
}

fn is_markdown(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).map(|s| matches!(s.to_ascii_lowercase().as_str(), "md" | "markdown")).unwrap_or(false)
}

fn covered(roots: &[PathBuf], path: &Path) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}

fn scoped(roots: &[PathBuf], path: &Path) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path).map_err(|_| "文件已移动、删除或无法访问".to_string())?;
    if !covered(roots, &path) { return Err("此链接超出已打开的文件夹，请通过打开文件选择它".into()); }
    Ok(path)
}

fn roots(state: &LocalMarkdownState, label: &str) -> Result<Vec<PathBuf>, String> {
    state.roots.lock().map_err(|_| "文件夹状态不可用")?.get(label).filter(|roots| !roots.is_empty()).cloned().ok_or_else(|| "请先打开本地文件或文件夹".into())
}

fn grant(state: &LocalMarkdownState, label: &str, directory: PathBuf) -> Result<(), String> {
    let mut map = state.roots.lock().map_err(|_| "文件夹状态不可用")?;
    let roots = map.entry(label.to_owned()).or_default();
    // 新目录覆盖旧授权时合并，避免同一窗口重复堆积父子目录
    roots.retain(|root| !directory.starts_with(root));
    if !roots.iter().any(|root| root.starts_with(&directory)) { roots.push(directory); }
    Ok(())
}

/// 文件路径进 URL 查询串：只保留 unreserved 字符，其余按 UTF-8 百分号编码
fn encode_component(value: &str) -> String {
    let mut out = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => out.push(*byte as char),
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

fn window_label(path: &Path) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in path.to_string_lossy().as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("md-{:016x}", hash)
}

/// 资源管理器递入的每个文件各开一个独立窗口；同一文件复用已有窗口。不触碰主窗口。
/// restore_main 只在运行中的单实例回调里开：没带文件而主窗口已被关闭时，把主窗口找回来。
/// 冷启动 setup 阶段配置主窗口尚未创建，不能在那里抢建同标签窗口。
pub fn open_files(app: &tauri::AppHandle, args: &[String], cwd: &Path, restore_main: bool) {
    let mut opened = false;
    for arg in args.iter().skip(1) {
        let path = PathBuf::from(arg);
        let path = if path.is_absolute() { path } else { cwd.join(path) };
        if !is_markdown(&path) { continue; }
        let Ok(path) = fs::canonicalize(&path) else { continue };
        if !path.is_file() { continue; }
        let label = window_label(&path);
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.unminimize();
            let _ = window.set_focus();
            opened = true;
            continue;
        }
        let state = app.state::<LocalMarkdownState>();
        if grant(&state, &label, path.parent().map(Path::to_path_buf).unwrap_or_else(|| path.clone())).is_err() { continue; }
        let title = format!("{} — Kairos", path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Markdown".into()));
        let url = format!("index.html#/local-markdown?file={}", encode_component(&path.to_string_lossy()));
        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
            .title(title).inner_size(1100.0, 800.0).min_inner_size(380.0, 560.0).center().build();
        let Ok(window) = window else { continue };
        opened = true;
        let main_ready = state.main_ready.lock().map(|ready| *ready).unwrap_or(true);
        if main_ready {
            let _ = window.set_focus();
        } else if let Ok(mut pending) = state.pending_focus.lock() {
            pending.push(label);
        }
    }
    if restore_main && !opened && !args.iter().skip(1).any(|arg| is_markdown(Path::new(arg))) {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.unminimize();
            let _ = main.set_focus();
        } else {
            let state = app.state::<LocalMarkdownState>();
            if let Ok(mut ready) = state.main_ready.lock() { *ready = false; }
            let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Kairos").inner_size(1280.0, 820.0).min_inner_size(380.0, 560.0).center().build();
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry { name: String, path: String, directory: bool }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder { directory: String, parent: Option<String>, entries: Vec<Entry> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document { path: String, markdown: String, version: String }

fn version_of(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|_| "无法读取文件信息")?;
    let stamp = metadata.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
    Ok(format!("{}-{}", stamp, metadata.len()))
}

fn list(roots: &[PathBuf], directory: &Path) -> Result<Folder, String> {
    let directory = scoped(roots, directory)?;
    let mut entries = Vec::new();
    for item in fs::read_dir(&directory).map_err(|_| "无法读取文件夹")? {
        let Ok(item) = item else { continue };
        let path = item.path();
        let Ok(canonical) = scoped(roots, &path) else { continue };
        let is_dir = canonical.is_dir();
        if !is_dir && !is_markdown(&canonical) { continue; }
        entries.push(Entry { name: item.file_name().to_string_lossy().into_owned(), path: canonical.to_string_lossy().into_owned(), directory: is_dir });
    }
    entries.sort_by(|a, b| b.directory.cmp(&a.directory).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    let parent = directory.parent().filter(|p| covered(roots, p)).map(|p| p.to_string_lossy().into_owned());
    Ok(Folder { directory: directory.to_string_lossy().into_owned(), parent, entries })
}

#[tauri::command]
pub async fn local_markdown_pick(app: tauri::AppHandle, window: tauri::Window, folder: bool) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_title(if folder { "打开 Markdown 文件夹" } else { "打开 Markdown 文件" }).set_parent(&window);
        if let Ok(roots) = roots(&app.state::<LocalMarkdownState>(), window.label()) { dialog = dialog.set_directory(&roots[0]); }
        let selection = if folder { dialog.blocking_pick_folder() } else { dialog.add_filter("Markdown", &["md", "markdown"]).blocking_pick_file() };
        let Some(selection) = selection else { return Ok(None) };
        let path = selection.into_path().map_err(|_| "无法打开此路径")?;
        let path = fs::canonicalize(path).map_err(|_| "无法打开此路径")?;
        if !folder && !is_markdown(&path) { return Err("请选择 Markdown 文件".into()); }
        let directory = if folder { path.clone() } else { path.parent().map(Path::to_path_buf).unwrap_or_else(|| path.clone()) };
        grant(&app.state::<LocalMarkdownState>(), window.label(), directory)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn local_markdown_list(app: tauri::AppHandle, window: tauri::Window, directory: String) -> Result<Folder, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let roots = roots(&app.state::<LocalMarkdownState>(), window.label())?;
        list(&roots, Path::new(&directory))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn local_markdown_read(app: tauri::AppHandle, window: tauri::Window, path: String, known_version: Option<String>) -> Result<Option<Document>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let roots = roots(&app.state::<LocalMarkdownState>(), window.label())?;
        let path = scoped(&roots, Path::new(&path))?;
        if !is_markdown(&path) { return Err("只能阅读 Markdown 文件".into()); }
        let mut file = fs::File::open(&path).map_err(|_| "无法读取文件")?;
        let version = version_of(&path)?;
        if known_version.as_ref() == Some(&version) { return Ok(None); }
        const LIMIT: u64 = 8 * 1024 * 1024;
        let mut data = Vec::new();
        (&mut file).take(LIMIT + 1).read_to_end(&mut data).map_err(|_| "读取文件失败")?;
        if data.len() as u64 > LIMIT { return Err("文件超过 8 MB，请通过文档库导入阅读".into()); }
        let markdown = String::from_utf8(data).map_err(|_| "文件不是 UTF-8 编码，请另存为 UTF-8 后重试")?.trim_start_matches('\u{feff}').to_owned();
        Ok(Some(Document { path: path.to_string_lossy().into_owned(), markdown, version }))
    }).await.map_err(|e| e.to_string())?
}

/// 写回原文件：expected_version 不符说明磁盘已被外部修改，拒绝覆盖，由前端决定刷新或强制保存。
fn write_document(path: &Path, markdown: &str, expected_version: Option<&str>) -> Result<Document, String> {
    if !is_markdown(path) { return Err("只能编辑 Markdown 文件".into()); }
    const LIMIT: usize = 8 * 1024 * 1024;
    if markdown.len() > LIMIT { return Err("内容超过 8 MB，无法保存".into()); }
    if let Some(expected) = expected_version {
        if version_of(path)? != expected { return Err("文件已被外部修改，请刷新后重试".into()); }
    }
    fs::write(path, markdown.as_bytes()).map_err(|_| "无法写入文件，可能被其他程序占用或设为只读")?;
    let version = version_of(path)?;
    Ok(Document { path: path.to_string_lossy().into_owned(), markdown: markdown.to_owned(), version })
}

#[tauri::command]
pub async fn local_markdown_write(app: tauri::AppHandle, window: tauri::Window, path: String, markdown: String, expected_version: Option<String>) -> Result<Document, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let roots = roots(&app.state::<LocalMarkdownState>(), window.label())?;
        let path = scoped(&roots, Path::new(&path))?;
        write_document(&path, &markdown, expected_version.as_deref())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn local_markdown_image(app: tauri::AppHandle, window: tauri::Window, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let roots = roots(&app.state::<LocalMarkdownState>(), window.label())?;
        let path = scoped(&roots, Path::new(&path))?;
        let mime = match path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
            "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp", "avif" => "image/avif", _ => return Err("不支持的本地图片格式".into()),
        };
        let file = fs::File::open(path).map_err(|_| "图片不存在或无法访问")?;
        let mut data = Vec::new();
        file.take(12 * 1024 * 1024 + 1).read_to_end(&mut data).map_err(|_| "读取图片失败")?;
        if data.len() > 12 * 1024 * 1024 { return Err("图片超过 12 MB".into()); }
        Ok(format!("data:{};base64,{}", mime, STANDARD.encode(data)))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn local_markdown_defaults() -> Result<(), String> {
    #[cfg(windows)]
    { std::process::Command::new("explorer.exe").arg("ms-settings:defaultapps").spawn().map_err(|_| "无法打开系统默认应用设置")?; Ok(()) }
    #[cfg(not(windows))]
    { Err("请在系统的打开方式中选择 Kairos".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_markdown_extensions_only() {
        assert!(is_markdown(Path::new("中文.MD")));
        assert!(is_markdown(Path::new("readme.markdown")));
        assert!(!is_markdown(Path::new("readme.md.exe")));
    }
    #[test]
    fn cannot_escape_granted_folder() {
        let root = fs::canonicalize(std::env::current_dir().unwrap()).unwrap();
        let roots = [root.clone()];
        assert!(scoped(&roots, &root.join("src")).is_ok());
        assert!(scoped(&roots, &root.join("..")).is_err());
    }
    #[test]
    fn grants_are_per_window_and_merge_nested() {
        let state = LocalMarkdownState::default();
        let a = PathBuf::from("C:/notes");
        let b = PathBuf::from("C:/other");
        grant(&state, "md-a", a.clone()).unwrap();
        grant(&state, "md-b", b.clone()).unwrap();
        grant(&state, "md-a", a.join("sub")).unwrap();
        let map = state.roots.lock().unwrap();
        assert_eq!(map.get("md-a").unwrap(), &[a.clone()]);
        assert_eq!(map.get("md-b").unwrap(), &[b.clone()]);
        assert!(covered(map.get("md-a").unwrap(), Path::new("C:/notes/sub/x.md")));
        assert!(!covered(map.get("md-a").unwrap(), Path::new("C:/other/x.md")));
        drop(map);
        grant(&state, "md-a", PathBuf::from("C:/")).unwrap();
        assert_eq!(state.roots.lock().unwrap().get("md-a").unwrap(), &[PathBuf::from("C:/")]);
    }
    #[test]
    fn file_urls_encode_reserved_bytes() {
        assert_eq!(encode_component("C:\\我的 笔记#a?.md"), "C%3A%5C%E6%88%91%E7%9A%84%20%E7%AC%94%E8%AE%B0%23a%3F.md");
        assert_eq!(encode_component("a-b_c.~d"), "a-b_c.~d");
        assert_eq!(window_label(Path::new("C:/x/a.md")), window_label(Path::new("C:/x/a.md")));
        assert_ne!(window_label(Path::new("C:/x/a.md")), window_label(Path::new("C:/x/b.md")));
    }
    #[test]
    fn write_back_detects_external_change() {
        let dir = std::env::temp_dir().join(format!("kairos-md-write-{}-{}", std::process::id(), line!()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        fs::write(&file, "# old").unwrap();
        let version = version_of(&file).unwrap();
        let saved = write_document(&file, "# new content", Some(&version)).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "# new content");
        assert_ne!(saved.version, version);
        fs::write(&file, "# external change").unwrap();
        assert!(write_document(&file, "# mine", Some(&saved.version)).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "# external change");
        assert!(write_document(&file, "# mine", None).is_ok());
        assert!(write_document(&dir.join("note.txt"), "x", None).is_err());
        fs::remove_dir_all(&dir).ok();
    }
}
