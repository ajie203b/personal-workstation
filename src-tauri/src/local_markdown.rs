use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{fs, io::Read, path::{Path, PathBuf}, sync::Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct LocalMarkdownState {
    root: Mutex<Option<PathBuf>>,
    pending: Mutex<Option<PathBuf>>,
}

fn is_markdown(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).map(|s| matches!(s.to_ascii_lowercase().as_str(), "md" | "markdown")).unwrap_or(false)
}

fn scoped(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path).map_err(|_| "文件已移动、删除或无法访问".to_string())?;
    if !path.starts_with(root) { return Err("此链接超出已打开的文件夹，请通过打开文件选择它".into()); }
    Ok(path)
}

fn root(state: &LocalMarkdownState) -> Result<PathBuf, String> {
    state.root.lock().map_err(|_| "文件夹状态不可用")?.clone().ok_or_else(|| "请先打开本地文件或文件夹".into())
}

pub fn queue_open(app: &tauri::AppHandle, args: &[String], cwd: &Path) {
    for arg in args.iter().skip(1) {
        let path = PathBuf::from(arg);
        let path = if path.is_absolute() { path } else { cwd.join(path) };
        if !is_markdown(&path) { continue; }
        let Ok(path) = fs::canonicalize(path) else { continue };
        if !path.is_file() { continue; }
        let state = app.state::<LocalMarkdownState>();
        if let (Ok(mut root), Ok(mut pending)) = (state.root.lock(), state.pending.lock()) {
            *root = path.parent().map(Path::to_path_buf);
            *pending = Some(path);
        }
        let _ = app.emit("local-markdown-open", ());
        break;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry { name: String, path: String, directory: bool }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder { root: String, directory: String, parent: Option<String>, entries: Vec<Entry> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document { path: String, markdown: String, version: String }

fn list(state: &LocalMarkdownState, directory: &Path) -> Result<Folder, String> {
    let root = root(state)?;
    let directory = scoped(&root, directory)?;
    let mut entries = Vec::new();
    for item in fs::read_dir(&directory).map_err(|_| "无法读取文件夹")? {
        let Ok(item) = item else { continue };
        let path = item.path();
        let Ok(canonical) = scoped(&root, &path) else { continue };
        let is_dir = canonical.is_dir();
        if !is_dir && !is_markdown(&canonical) { continue; }
        entries.push(Entry { name: item.file_name().to_string_lossy().into_owned(), path: canonical.to_string_lossy().into_owned(), directory: is_dir });
    }
    entries.sort_by(|a, b| b.directory.cmp(&a.directory).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    let parent = directory.parent().filter(|p| p.starts_with(&root)).map(|p| p.to_string_lossy().into_owned());
    Ok(Folder { root: root.to_string_lossy().into_owned(), directory: directory.to_string_lossy().into_owned(), parent, entries })
}

#[tauri::command]
pub async fn local_markdown_pick(app: tauri::AppHandle, folder: bool) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_title(if folder { "打开 Markdown 文件夹" } else { "打开 Markdown 文件" });
        if let Some(window) = app.get_webview_window("main") { dialog = dialog.set_parent(&window); }
        if let Ok(directory) = root(&app.state::<LocalMarkdownState>()) { dialog = dialog.set_directory(directory); }
        let selection = if folder { dialog.blocking_pick_folder() } else { dialog.add_filter("Markdown", &["md", "markdown"]).blocking_pick_file() };
        let Some(selection) = selection else { return Ok(None) };
        let path = selection.into_path().map_err(|_| "无法打开此路径")?;
        let path = fs::canonicalize(path).map_err(|_| "无法打开此路径")?;
        if !folder && !is_markdown(&path) { return Err("请选择 Markdown 文件".into()); }
        let state = app.state::<LocalMarkdownState>();
        *state.root.lock().map_err(|_| "文件夹状态不可用")? = if folder { Some(path.clone()) } else { path.parent().map(Path::to_path_buf) };
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn local_markdown_pending(state: tauri::State<LocalMarkdownState>) -> Result<Option<String>, String> {
    Ok(state.pending.lock().map_err(|_| "打开请求不可用")?.take().map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn local_markdown_list(app: tauri::AppHandle, directory: String) -> Result<Folder, String> {
    tauri::async_runtime::spawn_blocking(move || list(&app.state::<LocalMarkdownState>(), Path::new(&directory))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn local_markdown_read(app: tauri::AppHandle, path: String, known_version: Option<String>) -> Result<Option<Document>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LocalMarkdownState>();
        let path = scoped(&root(&state)?, Path::new(&path))?;
        if !is_markdown(&path) { return Err("只能阅读 Markdown 文件".into()); }
        let mut file = fs::File::open(&path).map_err(|_| "无法读取文件")?;
        let metadata = file.metadata().map_err(|_| "无法读取文件信息")?;
        let stamp = metadata.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
        let version = format!("{}-{}", stamp, metadata.len());
        if known_version.as_ref() == Some(&version) { return Ok(None); }
        const LIMIT: u64 = 8 * 1024 * 1024;
        let mut data = Vec::new();
        (&mut file).take(LIMIT + 1).read_to_end(&mut data).map_err(|_| "读取文件失败")?;
        if data.len() as u64 > LIMIT { return Err("文件超过 8 MB，请通过文档库导入阅读".into()); }
        let markdown = String::from_utf8(data).map_err(|_| "文件不是 UTF-8 编码，请另存为 UTF-8 后重试")?.trim_start_matches('\u{feff}').to_owned();
        Ok(Some(Document { path: path.to_string_lossy().into_owned(), markdown, version }))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn local_markdown_image(app: tauri::AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = scoped(&root(&app.state::<LocalMarkdownState>())?, Path::new(&path))?;
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
        assert!(scoped(&root, &root.join("src")).is_ok());
        assert!(scoped(&root, &root.join("..")).is_err());
    }
}
