// 发布版不弹黑色控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod local_markdown;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .manage(local_markdown::LocalMarkdownState::default())
        // 资源管理器再开文件：各开独立文档窗口，不打断主窗口正在进行的工作
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            local_markdown::open_files(app, &args, std::path::Path::new(&cwd), true);
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            local_markdown::local_markdown_pick,
            local_markdown::local_markdown_list,
            local_markdown::local_markdown_read,
            local_markdown::local_markdown_write,
            local_markdown::local_markdown_image,
            local_markdown::local_markdown_defaults,
        ])
        // 前端的 WebDAV 请求走这里：由 Rust 发出，不受浏览器跨域限制（坚果云不给 CORS）
        .plugin(tauri_plugin_http::init())
        // 外部链接、发布页跳转用系统默认浏览器打开
        .plugin(tauri_plugin_opener::init())
        // 应用内更新装完后重启（前端 relaunch）
        .plugin(tauri_plugin_process::init())
        // 冷启动带文件时主窗口在 setup 之后才创建，会盖住文档窗口；等它加载完再把文档窗口置顶
        .on_page_load(|window, payload| {
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
