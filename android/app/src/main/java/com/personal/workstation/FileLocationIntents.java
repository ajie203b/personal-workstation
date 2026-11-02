package com.personal.workstation;

import android.app.DownloadManager;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;

/** 文件管理器目录跳转，不尝试转授当前应用并未持有的 DocumentsProvider 权限。 */
final class FileLocationIntents {
    private FileLocationIntents() {}

    static Intent directory(String relativePath, String packageName) {
        Uri uri = DocumentsContract.buildDocumentUri(
            "com.android.externalstorage.documents", "primary:" + relativePath
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, DocumentsContract.Document.MIME_TYPE_DIR);
        if (packageName != null) intent.setPackage(packageName);
        return intent;
    }

    static Intent downloads() {
        return new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS);
    }
}
