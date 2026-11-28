// 发布版不弹黑色控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod local_markdown;
mod archive;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// 记录本会话经原生「另存为」对话框落盘的文件路径，限制 reveal_saved_file 仅定位已保存位置。
#[derive(Default)]
struct SavedPathsState(Mutex<HashSet<PathBuf>>);

fn record_saved_path(state: &SavedPathsState, path: &PathBuf) {
    if let Ok(mut guard) = state.0.lock() {
        guard.insert(path.clone());
        if let Ok(canon) = std::fs::canonicalize(path) {
            guard.insert(canon);
        }
    }
}

fn filter_for_name(name: &str) -> Option<(&'static str, &'static [&'static str])> {
    let ext = std::path::Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())?;
    match ext.as_str() {
        "zip" => Some(("ZIP 压缩包", &["zip"])),
        "pdf" => Some(("PDF 文档", &["pdf"])),
        "docx" => Some(("Word 文档", &["docx"])),
        "epub" => Some(("EPUB 电子书", &["epub"])),
        "md" | "markdown" => Some(("Markdown", &["md", "markdown"])),
        "json" => Some(("JSON", &["json"])),
        "txt" => Some(("纯文本", &["txt"])),
        "png" => Some(("PNG 图片", &["png"])),
        "jpg" | "jpeg" => Some(("JPEG 图片", &["jpg", "jpeg"])),
        "svg" => Some(("SVG 矢量图", &["svg"])),
        "vcf" => Some(("名片 vCard", &["vcf"])),
        _ => None,
    }
}

/// 导出文本到用户选择的位置（桌面「分享/导出」）：弹另存为对话框，取消返回 None。
#[tauri::command]
async fn save_text_file(
    app: tauri::AppHandle,
    window: tauri::Window,
    saved_paths: tauri::State<'_, SavedPathsState>,
    default_name: String,
    content: String,
) -> Result<Option<String>, String> {
    let chosen = tauri::async_runtime::spawn_blocking(move || -> Result<Option<PathBuf>, String> {
        let selection = app.dialog().file()
            .set_title("导出 Markdown")
            .set_file_name(&default_name)
            .add_filter("Markdown", &["md"])
            .set_parent(&window)
            .blocking_save_file();
        let Some(selection) = selection else { return Ok(None) };
        let path = selection.into_path().map_err(|_| "无法保存到此路径".to_owned())?;
        std::fs::write(&path, content.as_bytes()).map_err(|_| "写入文件失败，可能被占用或设为只读".to_owned())?;
        Ok(Some(path))
    }).await.map_err(|e| e.to_string())??;
    if let Some(path) = chosen {
        record_saved_path(&saved_paths, &path);
        return Ok(Some(path.to_string_lossy().into_owned()));
    }
    Ok(None)
}

/// 导出任意文件到用户选择的位置（桌面版统一原生另存为对话框），取消返回 None。
#[tauri::command]
async fn save_binary_file(
    app: tauri::AppHandle,
    window: tauri::Window,
    saved_paths: tauri::State<'_, SavedPathsState>,
    default_name: String,
    data_base64: String,
) -> Result<Option<String>, String> {
    let bytes = STANDARD.decode(data_base64.trim()).map_err(|_| "文件数据编码无效".to_owned())?;
    let chosen = tauri::async_runtime::spawn_blocking(move || -> Result<Option<PathBuf>, String> {
        let mut dialog = app.dialog().file()
            .set_title("保存文件")
            .set_file_name(&default_name)
            .set_parent(&window);
        if let Some((label, exts)) = filter_for_name(&default_name) {
            dialog = dialog.add_filter(label, exts);
        }
        let Some(selection) = dialog.blocking_save_file() else { return Ok(None) };
        let path = selection.into_path().map_err(|_| "无法保存到此路径".to_owned())?;
        let tmp = path.with_extension(format!(
            "{}.kairos-tmp",
            path.extension().and_then(|s| s.to_str()).unwrap_or("tmp")
        ));
        if std::fs::write(&tmp, &bytes).is_ok() {
            if std::fs::rename(&tmp, &path).is_err() {
                let _ = std::fs::remove_file(&tmp);
                std::fs::write(&path, &bytes).map_err(|_| "写入文件失败，可能被占用或设为只读".to_owned())?;
            }
        } else {
            std::fs::write(&path, &bytes).map_err(|_| "写入文件失败，可能被占用或设为只读".to_owned())?;
        }
        Ok(Some(path))
    }).await.map_err(|e| e.to_string())??;
    if let Some(path) = chosen {
        record_saved_path(&saved_paths, &path);
        return Ok(Some(path.to_string_lossy().into_owned()));
    }
    Ok(None)
}

/// 在系统文件管理器中定位本会话通过保存对话框落盘的文件。
#[tauri::command]
async fn reveal_saved_file(
    saved_paths: tauri::State<'_, SavedPathsState>,
    path: String,
) -> Result<(), String> {
    let candidate = PathBuf::from(&path);
    let canon = std::fs::canonicalize(&candidate).ok();
    let allowed = saved_paths
        .0
        .lock()
        .map(|guard| guard.contains(&candidate) || canon.as_ref().is_some_and(|c| guard.contains(c)))
        .unwrap_or(false);
    if !allowed {
        return Err("仅支持打开本应用刚保存的文件位置".to_owned());
    }
    let target_path = canon.unwrap_or(candidate);
    #[cfg(target_os = "windows")]
    let status = {
        let raw = target_path.to_string_lossy();
        let clean = raw.strip_prefix(r"\\?\").unwrap_or(&raw);
        std::process::Command::new("explorer").arg(format!("/select,{clean}")).spawn()
    };
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").arg("-R").arg(&target_path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = {
        let dir = target_path.parent().unwrap_or(&target_path);
        std::process::Command::new("xdg-open").arg(dir).spawn()
    };
    status.map_err(|_| "无法打开文件所在目录".to_owned())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(SavedPathsState::default())
        .manage(local_markdown::LocalMarkdownState::default())
        .manage(archive::ArchiveState::default())
        .manage(archive::ArchiveHistory::default())
        // 资源管理器再开文件：各开独立文档窗口，不打断主窗口正在进行的工作
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            local_markdown::open_files(app, &args, std::path::Path::new(&cwd), true);
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_text_file,
            save_binary_file,
            reveal_saved_file,
            local_markdown::local_markdown_pick,
            local_markdown::local_markdown_list,
            local_markdown::local_markdown_read,
            local_markdown::local_markdown_write,
            local_markdown::local_markdown_image,
            local_markdown::local_document_open_with,
            local_markdown::local_markdown_defaults,
            archive::archive_browser,
            archive::archive_downloads,
            archive::archive_download_read,
            archive::archive_download_remove,
            archive::archive_download_link,
            archive::archive_set_target,
            archive::archive_download_save_local,
            archive::archive_open_downloads_dir,
        ])
        // 前端的 WebDAV 请求走这里：由 Rust 发出，不受浏览器跨域限制（坚果云不给 CORS）
        .plugin(tauri_plugin_http::init())
        // 外部链接、发布页跳转用系统默认浏览器打开
        .plugin(tauri_plugin_opener::init())
        // 应用内更新装完后重启（前端 relaunch）
        .plugin(tauri_plugin_process::init())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                local_markdown::revoke_window(&window.state::<local_markdown::LocalMarkdownState>(), window.label());
            }
        })
        // 冷启动带文件时主窗口在 setup 之后才创建，会盖住文档窗口；等它加载完再把文档窗口置顶
        .on_page_load(|window, payload| {
            if window.label() == "archive-browser" {
                archive::record_page(window, payload.url());
                return;
            }
            if window.label() != "main" || !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) { return; }
            let state = window.state::<local_markdown::LocalMarkdownState>();
            if let Ok(mut ready) = state.main_ready.lock() { *ready = true; }
            let labels = state.pending_focus.lock().map(|mut pending| std::mem::take(&mut *pending)).unwrap_or_default();
            for label in labels.iter().rev() {
                if let Some(doc) = window.app_handle().get_webview_window(label) {
                    let _ = doc.unminimize();
                    let _ = doc.set_focus();
                }
            }
        })
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            local_markdown::open_files(app.handle(), &args, &std::env::current_dir().unwrap_or_default(), false);
            // 应用内更新：读 Release 上的 latest.json，校验签名后下载安装（配置见 tauri.conf.json 的 plugins.updater）
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Kairos 启动失败");
}
