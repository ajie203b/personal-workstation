// 发布版不弹黑色控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        // 前端的 WebDAV 请求走这里：由 Rust 发出，不受浏览器跨域限制（坚果云不给 CORS）
        .plugin(tauri_plugin_http::init())
        // 外部链接、发布页跳转用系统默认浏览器打开
        .plugin(tauri_plugin_opener::init())
        // 应用内更新装完后重启（前端 relaunch）
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // 应用内更新：读 Release 上的 latest.json，校验签名后下载安装（配置见 tauri.conf.json 的 plugins.updater）
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Kairos 启动失败");
}
