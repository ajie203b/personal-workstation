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

const TEXT_EXTENSIONS: &[&str] = &["md", "markdown", "txt", "csv", "tsv", "json", "html", "htm"];
const PREVIEW_EXTENSIONS: &[&str] = &["pdf", "docx", "pptx", "epub"];
const TEXT_LIMIT: usize = 8 * 1024 * 1024;
const PREVIEW_LIMIT: usize = 32 * 1024 * 1024;

fn has_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension().and_then(|ext| ext.to_str())
        .is_some_and(|ext| extensions.iter().any(|allowed| ext.eq_ignore_ascii_case(allowed)))
}

fn is_document(path: &Path) -> bool {
    has_extension(path, TEXT_EXTENSIONS) || has_extension(path, PREVIEW_EXTENSIONS)
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
    // 只保留最宽的授权：新目录里的旧授权被它取代，已被更宽授权覆盖的新目录不再追加
    roots.retain(|root| !root.starts_with(&directory));
    if !roots.iter().any(|root| directory.starts_with(root)) { roots.push(directory); }
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
        if !is_document(&path) { continue; }
        let Ok(path) = fs::canonicalize(&path) else { continue };
        if !path.is_file() || !is_document(&path) { continue; }
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
    if restore_main && !opened && !args.iter().skip(1).any(|arg| is_document(Path::new(arg))) {
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
pub struct Document {
    path: String,
    markdown: String,
    version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    base64: Option<String>,
}

fn version_of(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|_| "无法读取文件信息")?;
    let stamp = metadata.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
    Ok(format!("{}-{}", stamp, metadata.len()))
}

fn list(directory: &Path) -> Result<Folder, String> {
    let directory = fs::canonicalize(directory).map_err(|_| "文件已移动、删除或无法访问".to_string())?;
    let mut entries = Vec::new();
    for item in fs::read_dir(&directory).map_err(|_| "无法读取文件夹")? {
        let Ok(item) = item else { continue };
        let path = item.path();
        let Ok(canonical) = fs::canonicalize(&path) else { continue };
        let is_dir = canonical.is_dir();
        if !is_dir && (!canonical.is_file() || !is_document(&canonical)) { continue; }
        entries.push(Entry { name: item.file_name().to_string_lossy().into_owned(), path: canonical.to_string_lossy().into_owned(), directory: is_dir });
    }
    entries.sort_by(|a, b| b.directory.cmp(&a.directory).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    // 目录浏览不要求已授权：列目录只返回名字；读、写、图片仍按授权范围校验
    let parent = directory.parent().map(|p| p.to_string_lossy().into_owned());
    Ok(Folder { directory: directory.to_string_lossy().into_owned(), parent, entries })
}

#[tauri::command]
pub async fn local_markdown_pick(app: tauri::AppHandle, window: tauri::Window, folder: bool) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_title(if folder { "打开本地文件夹" } else { "打开本地文档" }).set_parent(&window);
        if let Ok(roots) = roots(&app.state::<LocalMarkdownState>(), window.label()) { dialog = dialog.set_directory(&roots[0]); }
        let extensions = [TEXT_EXTENSIONS, PREVIEW_EXTENSIONS].concat();
        let selection = if folder { dialog.blocking_pick_folder() } else { dialog.add_filter("支持的文档", &extensions).blocking_pick_file() };
        let Some(selection) = selection else { return Ok(None) };
        let path = selection.into_path().map_err(|_| "无法打开此路径")?;
        let path = fs::canonicalize(path).map_err(|_| "无法打开此路径")?;
        if !folder && (!path.is_file() || !is_document(&path)) { return Err("请选择支持的文档格式".into()); }
        let directory = if folder { path.clone() } else { path.parent().map(Path::to_path_buf).unwrap_or_else(|| path.clone()) };
        grant(&app.state::<LocalMarkdownState>(), window.label(), directory)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn local_markdown_list(window: tauri::Window, directory: String) -> Result<Folder, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = window.state::<LocalMarkdownState>();
        let folder = list(Path::new(&directory))?;
        // 显式浏览过的目录纳入本窗口授权，其中的文档才能打开阅读
        grant(&state, window.label(), PathBuf::from(&folder.directory))?;
        Ok(folder)
    }).await.map_err(|e| e.to_string())?
}

/// 读文件仍按本窗口授权范围校验；范围由用户浏览（list）逐步授予，越界链接直接拒绝。
#[tauri::command]
pub async fn local_markdown_read(app: tauri::AppHandle, window: tauri::Window, path: String, known_version: Option<String>) -> Result<Option<Document>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let roots = roots(&app.state::<LocalMarkdownState>(), window.label())?;
        let path = scoped(&roots, Path::new(&path))?;
        read_document(&path, known_version.as_deref())
    }).await.map_err(|e| e.to_string())?
}

fn read_bytes(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|_| "无法读取文件")?;
    let mut data = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut data).map_err(|_| "读取文件失败")?;
    if data.len() > limit { return Err(format!("文件超过 {} MB，无法在本地文档窗口打开", limit / (1024 * 1024))); }
    Ok(data)
}

fn decode_text(data: &[u8]) -> Result<String, String> {
    if data.starts_with(&[0xff, 0xfe]) || data.starts_with(&[0xfe, 0xff]) {
        let little_endian = data[0] == 0xff;
        if data.len() % 2 != 0 { return Err("UTF-16 文件不完整".into()); }
        let units = data[2..].chunks_exact(2).map(|pair| {
            let bytes = [pair[0], pair[1]];
            if little_endian { u16::from_le_bytes(bytes) } else { u16::from_be_bytes(bytes) }
        }).collect::<Vec<_>>();
        return String::from_utf16(&units).map_err(|_| "UTF-16 文件无法解码".into());
    }
    std::str::from_utf8(data.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(data))
        .map(str::to_owned).map_err(|_| "请将文本文件另存为 UTF-8 或带 BOM 的 UTF-16".into())
}

fn read_document(path: &Path, known_version: Option<&str>) -> Result<Option<Document>, String> {
    if !path.is_file() || !is_document(path) { return Err("不支持此文档格式".into()); }
    let version = version_of(path)?;
    if known_version == Some(&version) { return Ok(None); }
    let binary = has_extension(path, PREVIEW_EXTENSIONS);
    let data = read_bytes(path, if binary { PREVIEW_LIMIT } else { TEXT_LIMIT })?;
    let (markdown, base64) = if binary { (String::new(), Some(STANDARD.encode(data))) } else { (decode_text(&data)?, None) };
    Ok(Some(Document { path: path.to_string_lossy().into_owned(), markdown, version, base64 }))
}

/// 写回原文件：expected_version 不符说明磁盘已被外部修改，拒绝覆盖，由前端决定刷新或强制保存。
fn write_document(path: &Path, markdown: &str, expected_version: Option<&str>) -> Result<Document, String> {
    if !has_extension(path, TEXT_EXTENSIONS) { return Err("此格式需要用其他应用编辑".into()); }
    if markdown.len() > TEXT_LIMIT * 2 { return Err("内容超过 8 MB，无法保存".into()); }
    if let Some(expected) = expected_version {
        if version_of(path)? != expected { return Err("文件已被外部修改，请刷新后重试".into()); }
    }
    let original = read_bytes(path, TEXT_LIMIT)?;
    let old_text = decode_text(&original)?;
    let text = if old_text.contains("\r\n") && !old_text.replace("\r\n", "").contains('\n') {
        markdown.replace("\r\n", "\n").replace('\n', "\r\n")
    } else { markdown.to_owned() };
    let mut data = Vec::new();
    if original.starts_with(&[0xff, 0xfe]) || original.starts_with(&[0xfe, 0xff]) {
        let little_endian = original[0] == 0xff;
        data.extend_from_slice(&original[..2]);
        for unit in text.encode_utf16() {
            data.extend_from_slice(&if little_endian { unit.to_le_bytes() } else { unit.to_be_bytes() });
        }
    } else {
        if original.starts_with(&[0xef, 0xbb, 0xbf]) { data.extend_from_slice(&original[..3]); }
        data.extend_from_slice(text.as_bytes());
    }
    if data.len() > TEXT_LIMIT { return Err("内容超过 8 MB，无法保存".into()); }
    if let Some(expected) = expected_version {
        if version_of(path)? != expected { return Err("文件已被外部修改，请刷新后重试".into()); }
    }
    fs::write(path, data).map_err(|_| "无法写入文件，可能被其他程序占用或设为只读")?;
    let version = version_of(path)?;
    Ok(Document { path: path.to_string_lossy().into_owned(), markdown: markdown.to_owned(), version, base64: None })
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
pub async fn local_document_open_with(window: tauri::Window, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = scoped(&roots(&window.state::<LocalMarkdownState>(), window.label())?, Path::new(&path))?;
        if !path.is_file() || !has_extension(&path, PREVIEW_EXTENSIONS) { return Err("不支持用其他应用打开此文件".into()); }
        #[cfg(windows)]
        {
            let (send, receive) = std::sync::mpsc::sync_channel(1);
            let parent = window.clone();
            window.run_on_main_thread(move || {
                let _ = send.send(show_open_with(&parent, &path));
            }).map_err(|e| e.to_string())?;
            receive.recv().map_err(|_| "无法打开应用选择窗口".to_string())?
        }
        #[cfg(not(windows))]
        { Err("请通过系统文件管理器选择编辑应用".into()) }
    }).await.map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn show_open_with(window: &tauri::Window, path: &Path) -> Result<(), String> {
    use std::{ffi::c_void, os::windows::ffi::OsStrExt};

    #[repr(C)]
    struct OpenAsInfo { file: *const u16, class: *const u16, flags: u32 }

    #[link(name = "shell32")]
    extern "system" { fn SHOpenWithDialog(parent: *mut c_void, info: *const OpenAsInfo) -> i32; }

    let path_str = path.to_string_lossy();
    let display_path = if let Some(unc) = path_str.strip_prefix(r"\\?\UNC\") { format!(r"\\{}", unc) }
        else { path_str.strip_prefix(r"\\?\").unwrap_or(&path_str).to_owned() };
    let filename: Vec<u16> = std::ffi::OsStr::new(&display_path).encode_wide().chain([0]).collect();
    let info = OpenAsInfo { file: filename.as_ptr(), class: std::ptr::null(), flags: 0x04 }; // OAIF_EXEC
    let parent = window.hwnd().map_err(|e| e.to_string())?;
    // The filename buffer remains valid throughout the system dialog call.
    let result = unsafe { SHOpenWithDialog(parent.0 as *mut c_void, &info) };
    if result >= 0 || result as u32 == 0x800704c7 { Ok(()) } else { Err("无法打开应用选择窗口".into()) }
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
    fn accepts_supported_document_extensions_only() {
        assert!(is_document(Path::new("中文.MD")));
        assert!(is_document(Path::new("readme.markdown")));
        assert!(is_document(Path::new("报告.DOCX")));
        assert!(is_document(Path::new("表格.csv")));
        assert!(!is_document(Path::new("readme.md.exe")));
    }
    #[test]
    fn cannot_escape_granted_folder() {
        let root = fs::canonicalize(std::env::current_dir().unwrap()).unwrap();
        let roots = [root.clone()];
        assert!(scoped(&roots, &root.join("src")).is_ok());
        assert!(scoped(&roots, &root.join("..")).is_err());
    }
    #[test]
    fn list_reports_parent_for_upward_navigation() {
        let base = std::env::temp_dir().join(format!("kairos-md-list-{}-{}", std::process::id(), line!()));
        let child = base.join("child");
        fs::create_dir_all(&child).unwrap();
        fs::write(child.join("a.md"), "# a").unwrap();
        fs::write(child.join("b.exe"), "ignored").unwrap();
        let folder = list(&child).unwrap();
        // 上一级始终可用（直到文件系统根），不再被授权范围裁掉
        assert_eq!(folder.parent.as_deref(), Some(fs::canonicalize(&base).unwrap().to_string_lossy().as_ref()));
        assert_eq!(folder.entries.len(), 1);
        assert_eq!(folder.entries[0].name, "a.md");
        assert!(list(&base).unwrap().parent.is_some());
        fs::remove_dir_all(&base).ok();
    }
    #[test]
    fn grants_are_per_window_and_merge_nested() {
        // starts_with 按路径组件比较：Windows 的盘符相对路径（C:/x）首组件是盘符前缀，
        // 与根目录路径互不为前缀，测试必须用各平台的原生绝对路径（生产里全是 canonicalize 产物）
        #[cfg(windows)]
        let (a, b, wide) = (PathBuf::from("C:\\notes"), PathBuf::from("C:\\other"), PathBuf::from("C:\\"));
        #[cfg(not(windows))]
        let (a, b, wide) = (PathBuf::from("/notes"), PathBuf::from("/other"), PathBuf::from("/"));
        let state = LocalMarkdownState::default();
        grant(&state, "md-a", a.clone()).unwrap();
        grant(&state, "md-b", b.clone()).unwrap();
        grant(&state, "md-a", a.join("sub")).unwrap();
        let map = state.roots.lock().unwrap();
        assert_eq!(map.get("md-a").unwrap(), &[a.clone()]);
        assert_eq!(map.get("md-b").unwrap(), &[b.clone()]);
        assert!(covered(map.get("md-a").unwrap(), &a.join("sub").join("x.md")));
        assert!(!covered(map.get("md-a").unwrap(), &b.join("x.md")));
        drop(map);
        grant(&state, "md-a", wide.clone()).unwrap();
        assert_eq!(state.roots.lock().unwrap().get("md-a").unwrap(), &[wide]);
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
        assert!(write_document(&dir.join("note.pdf"), "x", None).is_err());
        fs::remove_dir_all(&dir).ok();
    }
    #[test]
    fn text_write_preserves_utf16_bom_and_crlf() {
        let dir = std::env::temp_dir().join(format!("kairos-local-text-{}-{}", std::process::id(), line!()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("notes.txt");
        let mut original = vec![0xff, 0xfe];
        original.extend("原文\r\n".encode_utf16().flat_map(u16::to_le_bytes));
        fs::write(&file, original).unwrap();
        let opened = read_document(&file, None).unwrap().unwrap();
        assert_eq!(opened.markdown, "原文\r\n");
        write_document(&file, "修改\n正文", Some(&opened.version)).unwrap();
        let saved = fs::read(&file).unwrap();
        assert!(saved.starts_with(&[0xff, 0xfe]));
        assert_eq!(decode_text(&saved).unwrap(), "修改\r\n正文");
        fs::remove_dir_all(&dir).ok();
    }
}
