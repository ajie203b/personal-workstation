fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "save_text_file",
            "local_markdown_pick", "local_markdown_list", "local_markdown_read",
            "local_markdown_write", "local_markdown_image", "local_document_open_with",
            "local_markdown_defaults",
            "archive_browser", "archive_downloads", "archive_download_read", "archive_download_remove", "archive_download_link",
        ])),
    ).expect("Kairos 权限清单生成失败");
}
