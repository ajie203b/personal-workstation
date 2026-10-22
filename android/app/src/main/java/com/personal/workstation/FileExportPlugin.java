package com.personal.workstation;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * 把前端导出的文件写进系统「下载/个人工作站」目录。
 *
 * WebView 对 blob: 的 &lt;a download&gt; 不会触发任何下载（Capacitor 的 Bridge 也没接
 * DownloadListener），点了会被静默丢弃——前端 toast 照样说「已导出」，但文件哪都没有。
 * 所以导出必须由前端把字节读成 base64 传过来、原生侧写文件，用户才真能在
 * 「文件管理 → 下载」里找到。
 */
@CapacitorPlugin(
    name = "FileExport",
    permissions = @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage")
)
@SuppressWarnings("deprecation") // 旧系统（Android 6–9）路径要用 getExternalStoragePublicDirectory，弃用是刻意的
public class FileExportPlugin extends Plugin {

    private static final String DIR_NAME = "个人工作站";

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String dataBase64 = call.getString("dataBase64");
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (dataBase64 == null || dataBase64.isEmpty() || fileName == null || fileName.isEmpty()) {
            call.reject("缺少文件内容或文件名");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            writeMediaStore(call, fileName, mimeType, dataBase64);
            return;
        }
        // Android 6–9：写公共下载目录要存储权限，先申请再落盘
        if (!hasRequiredPermissions()) {
            requestPermissionForAlias("storage", call, "onStoragePermission");
            return;
        }
        writeLegacy(call, fileName, mimeType, dataBase64);
    }

    @PermissionCallback
    public void onStoragePermission(PluginCall call) {
        if (!hasRequiredPermissions()) {
            call.reject("没有存储权限，无法保存到「下载」");
            return;
        }
        writeLegacy(
            call,
            call.getString("fileName"),
            call.getString("mimeType", "application/octet-stream"),
            call.getString("dataBase64")
        );
    }

    /** Android 10+：走 MediaStore，免运行时权限，保存后文件管理的「下载」里立刻可见 */
    private void writeMediaStore(PluginCall call, String fileName, String mimeType, String dataBase64) {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
        values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + File.separator + DIR_NAME);
        Uri uri = null;
        try {
            uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("系统拒绝创建文件");
                return;
            }
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) {
                    throw new IOException("打开输出流失败");
                }
                out.write(Base64.decode(dataBase64, Base64.DEFAULT));
            }
            JSObject ret = new JSObject();
            ret.put("path", Environment.DIRECTORY_DOWNLOADS + "/" + DIR_NAME + "/" + queryDisplayName(resolver, uri, fileName));
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            // 半截文件别留在下载目录里
            if (uri != null) {
                try {
                    resolver.delete(uri, null, null);
                } catch (Exception ignored) {
                    // 清理失败就算了，以原始报错为准
                }
            }
            call.reject("写入失败：" + e.getMessage(), e);
        }
    }

    /** 重名时 MediaStore 会自动加「 (1)」后缀，返回的路径要以实际落盘名为准 */
    private String queryDisplayName(ContentResolver resolver, Uri uri, String fallback) {
        try (android.database.Cursor cursor = resolver.query(uri, new String[] { MediaStore.MediaColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String actual = cursor.getString(0);
                if (actual != null && !actual.isEmpty()) {
                    return actual;
                }
            }
        } catch (Exception ignored) {
            // 查不到就退回请求时的文件名
        }
        return fallback;
    }

    /** Android 6–9：直接写公共下载目录，媒体扫描后文件管理可见 */
    private void writeLegacy(PluginCall call, String fileName, String mimeType, String dataBase64) {
        try {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), DIR_NAME);
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("无法创建「下载/" + DIR_NAME + "」目录");
                return;
            }
            File file = new File(dir, fileName);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(Base64.decode(dataBase64, Base64.DEFAULT));
            }
            MediaScannerConnection.scanFile(
                getContext(),
                new String[] { file.getAbsolutePath() },
                new String[] { mimeType },
                null
            );
            JSObject ret = new JSObject();
            ret.put("path", Environment.DIRECTORY_DOWNLOADS + "/" + DIR_NAME + "/" + fileName);
            ret.put("uri", "file://" + file.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("写入失败：" + e.getMessage(), e);
        }
    }
}
