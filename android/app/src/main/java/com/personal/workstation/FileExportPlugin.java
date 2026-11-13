package com.personal.workstation;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

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
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * 把前端导出或下载的文件写进系统「下载/个人工作站」目录，并支持分享与流式下载。
 */
@CapacitorPlugin(
    name = "FileExport",
    permissions = @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage")
)
@SuppressWarnings("deprecation") // 旧系统（Android 6–9）路径要用 getExternalStoragePublicDirectory，弃用是刻意的
public class FileExportPlugin extends Plugin {

    private static final String DIR_NAME = "个人工作站";
    private static final long SHARE_CACHE_TTL_MS = 24L * 60 * 60 * 1000;
    private static final OkHttpClient DOWNLOAD_CLIENT = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build();

    private final ExecutorService executor = Executors.newCachedThreadPool();

    private interface StreamWriter {
        void write(OutputStream out) throws IOException;
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdown();
        super.handleOnDestroy();
    }

    private static String sanitizeFileName(String raw) {
        if (raw == null) return null;
        String name = raw.replace('\\', '/');
        int slash = name.lastIndexOf('/');
        if (slash >= 0) name = name.substring(slash + 1);
        name = name.replaceAll("[\\r\\n\\u0000]", "").trim();
        if (name.isEmpty() || ".".equals(name) || "..".equals(name) || name.contains("..")) return null;
        return name;
    }

    private static File resolveSafeChild(File dir, String fileName) throws IOException {
        File file = new File(dir, fileName);
        String dirPath = dir.getCanonicalPath() + File.separator;
        if (!file.getCanonicalPath().startsWith(dirPath)) {
            throw new IOException("非法文件名");
        }
        return file;
    }

    private static void pruneStaleShareFiles(File dir, long nowMs) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.isFile() && nowMs - f.lastModified() > SHARE_CACHE_TTL_MS) {
                // 清理过期临时分享文件，失败则下次再清
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String dataBase64 = call.getString("dataBase64");
        String fileName = sanitizeFileName(call.getString("fileName"));
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (dataBase64 == null || dataBase64.isEmpty() || fileName == null) {
            call.reject("缺少文件内容或文件名不合法");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && !hasRequiredPermissions()) {
            requestPermissionForAlias("storage", call, "onStoragePermission");
            return;
        }
        dispatchSaveBase64(call, fileName, mimeType, dataBase64);
    }

    /** 流式下载远端媒体直写入「下载/个人工作站」，避免大文件 base64 过桥占内存。 */
    @PluginMethod
    public void downloadToDownloads(PluginCall call) {
        String url = call.getString("url");
        String fileName = sanitizeFileName(call.getString("fileName"));
        if (url == null || (!url.startsWith("https://") && !url.startsWith("http://")) || fileName == null) {
            call.reject("下载地址或文件名不合法");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && !hasRequiredPermissions()) {
            requestPermissionForAlias("storage", call, "onStoragePermission");
            return;
        }
        dispatchStreamDownload(call, url, fileName);
    }

    private void dispatchSaveBase64(PluginCall call, String fileName, String mimeType, String dataBase64) {
        executor.execute(() -> writeToDownloads(call, fileName, mimeType, out -> {
            byte[] bytes = Base64.decode(dataBase64, Base64.DEFAULT);
            out.write(bytes);
        }));
    }

    private void dispatchStreamDownload(PluginCall call, String url, String fileName) {
        String mimeType = call.getString("mimeType", "application/octet-stream");
        JSObject headers = call.getObject("headers", new JSObject());
        executor.execute(() -> {
            Request.Builder rb = new Request.Builder().url(url);
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                String v = headers.getString(k);
                if (v != null) rb.header(k, v);
            }
            try (Response res = DOWNLOAD_CLIENT.newCall(rb.build()).execute()) {
                if (!res.isSuccessful()) {
                    call.reject("HTTP " + res.code());
                    return;
                }
                ResponseBody body = res.body();
                if (body == null) {
                    call.reject("空响应");
                    return;
                }
                writeToDownloads(call, fileName, mimeType, out -> {
                    byte[] buf = new byte[32 * 1024];
                    try (InputStream in = body.byteStream()) {
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            out.write(buf, 0, n);
                        }
                    }
                });
            } catch (Exception e) {
                call.reject("下载失败：" + e.getMessage(), e);
            }
        });
    }

    /** 调起系统分享面板，把导出的文件发给其他应用（微信、QQ、邮件等）。 */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String dataBase64 = call.getString("dataBase64");
        String fileName = sanitizeFileName(call.getString("fileName"));
        String title = call.getString("title", "分享文档");
        if (dataBase64 == null || dataBase64.isEmpty() || fileName == null) {
            call.reject("缺少分享内容或文件名不合法");
            return;
        }
        executor.execute(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "shared");
                if (!dir.exists() && !dir.mkdirs()) {
                    call.reject("无法创建分享缓存目录");
                    return;
                }
                pruneStaleShareFiles(dir, System.currentTimeMillis());
                File file = resolveSafeChild(dir, fileName);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(Base64.decode(dataBase64, Base64.DEFAULT));
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                Intent intent = new Intent(Intent.ACTION_SEND);
                // */* 让接收方按文件处理，兼容大多数 IM 与文件管理器；纯文本目标也能收到 .md 附件
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_STREAM, uri);
                intent.putExtra(Intent.EXTRA_TITLE, title);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(intent, title);
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().runOnUiThread(() -> {
                    try {
                        getContext().startActivity(chooser);
                        call.resolve();
                    } catch (Exception e) {
                        call.reject("分享失败：" + e.getMessage(), e);
                    }
                });
            } catch (Exception e) {
                call.reject("分享失败：" + e.getMessage(), e);
            }
        });
    }

    /** 优先打开实际保存目录；系统不支持时打开下载列表，保存结果不会丢失。 */
    @PluginMethod
    public void openSavedLocation(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String path = Environment.DIRECTORY_DOWNLOADS + File.separator + DIR_NAME;
            String location = FileLocationNavigator.open(new FileLocationNavigator.Launcher() {
                @Override public boolean openDirectory(String packageName) {
                    getActivity().startActivity(FileLocationIntents.directory(path, packageName));
                    return true;
                }

                @Override public boolean openDownloads() {
                    getActivity().startActivity(FileLocationIntents.downloads());
                    return true;
                }
            });
            JSObject result = new JSObject();
            result.put("location", location);
            call.resolve(result);
        });
    }

    @PermissionCallback
    public void onStoragePermission(PluginCall call) {
        if (!hasRequiredPermissions()) {
            call.reject("没有存储权限，无法保存到「下载」");
            return;
        }
        String fileName = sanitizeFileName(call.getString("fileName"));
        if (fileName == null) {
            call.reject("文件名不合法");
            return;
        }
        String url = call.getString("url");
        if (url != null) {
            if (!url.startsWith("https://") && !url.startsWith("http://")) {
                call.reject("下载地址不合法");
                return;
            }
            dispatchStreamDownload(call, url, fileName);
            return;
        }
        String dataBase64 = call.getString("dataBase64");
        if (dataBase64 == null || dataBase64.isEmpty()) {
            call.reject("缺少文件内容");
            return;
        }
        dispatchSaveBase64(call, fileName, call.getString("mimeType", "application/octet-stream"), dataBase64);
    }

    private void writeToDownloads(PluginCall call, String fileName, String mimeType, StreamWriter writer) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            writeMediaStore(call, fileName, mimeType, writer);
        } else {
            writeLegacy(call, fileName, mimeType, writer);
        }
    }

    /** Android 10+：走 MediaStore，免运行时权限，保存后文件管理的「下载」里立刻可见 */
    private void writeMediaStore(PluginCall call, String fileName, String mimeType, StreamWriter writer) {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
        values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + File.separator + DIR_NAME);
        values.put(MediaStore.Downloads.IS_PENDING, 1);
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
                writer.write(out);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            JSObject ret = new JSObject();
            ret.put("path", Environment.DIRECTORY_DOWNLOADS + "/" + DIR_NAME + "/" + queryDisplayName(resolver, uri, fileName));
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
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
    private void writeLegacy(PluginCall call, String fileName, String mimeType, StreamWriter writer) {
        try {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), DIR_NAME);
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("无法创建「下载/" + DIR_NAME + "」目录");
                return;
            }
            File file = resolveSafeChild(dir, fileName);
            try (FileOutputStream out = new FileOutputStream(file)) {
                writer.write(out);
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
