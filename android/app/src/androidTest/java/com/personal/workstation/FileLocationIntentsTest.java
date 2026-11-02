package com.personal.workstation;

import android.app.DownloadManager;
import android.content.Intent;
import android.provider.DocumentsContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

@RunWith(AndroidJUnit4.class)
public class FileLocationIntentsTest {
    @Test public void directoryIntentPointsToSavedFolderWithoutTryingToGrantUnownedUri() {
        Intent intent = FileLocationIntents.directory("Download/个人工作站", "com.android.documentsui");
        assertEquals(Intent.ACTION_VIEW, intent.getAction());
        assertEquals(DocumentsContract.Document.MIME_TYPE_DIR, intent.getType());
        assertEquals("com.android.externalstorage.documents", intent.getData().getAuthority());
        assertEquals("primary:Download/个人工作站", DocumentsContract.getDocumentId(intent.getData()));
        assertEquals("com.android.documentsui", intent.getPackage());
        assertEquals(0, intent.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
    }

    @Test public void genericDirectoryIntentDoesNotForceAFileManager() {
        assertNull(FileLocationIntents.directory("Download/个人工作站", null).getPackage());
    }

    @Test public void downloadsFallbackUsesThePlatformDownloadsAction() {
        assertEquals(DownloadManager.ACTION_VIEW_DOWNLOADS, FileLocationIntents.downloads().getAction());
    }
}
