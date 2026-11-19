package com.personal.workstation;

import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Toast;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

@CapacitorPlugin(name = "ArchiveBrowser")
public class ArchiveBrowserPlugin extends Plugin {
    private static final String HOME = "https://annas-archive.gd/";
    private static final String LOCAL_DIR_NAME = "个人工作站";
    private static final long MAX_APP_BYTES = 150L * 1024 * 1024;
    private static final long MAX_LOCAL_BYTES = 500L * 1024 * 1024;
    private static final Object TRANSFER_LOCK = new Object();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
        .followRedirects(false).callTimeout(10, TimeUnit.MINUTES).readTimeout(45, TimeUnit.SECONDS).build();

    private static final Set<String> BLOCKED_EXTENSIONS = new HashSet<>(Arrays.asList(
        ".apk", ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".dll",
        ".sh", ".vbs", ".js", ".jar", ".ps1", ".pif", ".reg", ".lnk"
    ));

    private static final Set<String> KAIROS_READABLE_EXTENSIONS = new HashSet<>(Arrays.asList(
        ".epub", ".pdf", ".txt", ".md", ".markdown", ".docx", ".pptx"
    ));

    private static final Pattern DISPOSITION_UTF8 = Pattern.compile("filename\\*\\s*=\\s*(?:UTF-8|utf-8)''([^;]+)");
    private static final Pattern DISPOSITION_PLAIN = Pattern.compile("filename\\s*=\\s*\"?([^\";]+)\"?");

    private static boolean downloading;
    private static String lastError;
    private static String lastSavedPath;
    private Dialog dialog;
    private WebView web;
    private PluginCall browserCall;

    @PluginMethod
    public void open(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (browserCall != null) {
                call.reject("浏览器已经打开");
                return;
            }
            try {
                if (dialog == null) createBrowser();
                browserCall = call;
                dialog.show();
                if (dialog.getWindow() != null) {
                    dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
                    dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
                }
            } catch (RuntimeException exception) {
                browserCall = null;
                call.reject("无法启动内嵌浏览器，请检查 Android System WebView");
            }
        });
    }

    private void createBrowser() {
        dialog = new Dialog(getActivity(), android.R.style.Theme_Material_Light_NoActionBar) {
            @Override
            public void onBackPressed() {
                if (web != null && web.canGoBack()) web.goBack();
                else dismiss();
            }
        };
        dialog.setOnDismissListener(ignored -> {
            PluginCall call = browserCall;
            browserCall = null;
            if (call != null) call.resolve();
        });
        LinearLayout body = new LinearLayout(getActivity());
        body.setOrientation(LinearLayout.VERTICAL);
        ViewCompat.setOnApplyWindowInsetsListener(body, (view, insets) -> {
            var bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        LinearLayout toolbar = new LinearLayout(getActivity());
        body.addView(toolbar);
        addButton(toolbar, "上一页", () -> { if (web.canGoBack()) web.goBack(); });
        addButton(toolbar, "首页", () -> web.loadUrl(HOME));
        addButton(toolbar, "刷新", () -> web.reload());
        addButton(toolbar, "下载列表", dialog::dismiss);

        // 独立 WebView 不注册 Capacitor 或任何网页可调用的原生接口。
        web = new WebView(getActivity());
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !(browserUrl(uri) || "about:blank".equals(uri.toString()) || "about:srcdoc".equals(uri.toString()));
            }
        });
        web.setDownloadListener(this::requestDownload);
        body.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        dialog.setContentView(body);
        web.loadUrl(HOME);
    }

    private void addButton(LinearLayout toolbar, String text, Runnable action) {
        Button button = new Button(getActivity());
        button.setText(text);
        button.setOnClickListener(view -> action.run());
        toolbar.addView(button, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
    }

    private static boolean browserUrl(Uri uri) {
        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo() != null || host == null) return false;
        host = host.toLowerCase(Locale.ROOT).replaceFirst("\\.$", "");
        return host.matches("[a-z0-9.-]+\\.[a-z][a-z0-9-]*") && !host.endsWith(".localhost")
            && !host.endsWith(".local") && !host.endsWith(".internal");
    }

    private static File downloadDirectory(Context context) throws IOException {
        File directory = new File(context.getFilesDir(), "archive-books");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建下载目录");
        return directory.getCanonicalFile();
    }

    private static String sanitizeName(String raw) {
        if (raw == null) return "";
        String cleaned = raw.replace('\\', '/');
        int slash = cleaned.lastIndexOf('/');
        if (slash >= 0) cleaned = cleaned.substring(slash + 1);
        cleaned = cleaned.replaceAll("[\\p{Cntrl}:*?\"<>|]", " ").replaceAll("\\s+", " ").trim();
        while (cleaned.startsWith(".")) cleaned = cleaned.substring(1).trim();
        return cleaned;
    }

    private static String extractExtension(String name) {
        int dot = name.lastIndexOf('.');
        if (dot <= 0 || dot >= name.length() - 1) return "";
        String ext = name.substring(dot).toLowerCase(Locale.ROOT);
        if (!ext.matches("\\.[a-z0-9]{1,10}")) return "";
        return ext;
    }

    private static String extensionFromMime(String mime) {
        if (mime == null) return "";
        String m = mime.toLowerCase(Locale.ROOT);
        if (m.contains("epub")) return ".epub";
        if (m.contains("pdf")) return ".pdf";
        if (m.contains("mobipocket")) return ".mobi";
        if (m.contains("amazon.ebook") || m.contains("azw")) return ".azw3";
        if (m.contains("djvu")) return ".djvu";
        if (m.contains("fictionbook") || m.contains("fb2")) return ".fb2";
        if (m.contains("wordprocessingml")) return ".docx";
        if (m.contains("presentationml")) return ".pptx";
        if (m.contains("msword")) return ".doc";
        if (m.contains("rtf")) return ".rtf";
        if (m.contains("text/markdown")) return ".md";
        if (m.contains("text/plain")) return ".txt";
        if (m.contains("application/zip")) return ".zip";
        if (m.contains("x-rar") || m.contains("vnd.rar")) return ".rar";
        if (m.contains("x-7z")) return ".7z";
        return "";
    }

    private static String mimeForExtension(String ext, String fallback) {
        switch (ext) {
            case ".epub": return "application/epub+zip";
            case ".pdf": return "application/pdf";
            case ".mobi": return "application/x-mobipocket-ebook";
            case ".azw":
            case ".azw3": return "application/vnd.amazon.ebook";
            case ".txt": return "text/plain";
            case ".md":
            case ".markdown": return "text/markdown";
            case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case ".pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            case ".djvu": return "image/vnd.djvu";
            case ".fb2": return "application/x-fictionbook+xml";
            case ".zip":
            case ".cbz": return "application/zip";
            default:
                if (fallback != null && !fallback.trim().isEmpty() && !fallback.toLowerCase(Locale.ROOT).startsWith("text/html")) {
                    return fallback;
                }
                return "application/octet-stream";
        }
    }

    private static String resolveDownloadName(String url, String disposition, String mime) {
        String candidate = null;
        if (disposition != null && !disposition.isEmpty()) {
            Matcher utf8 = DISPOSITION_UTF8.matcher(disposition);
            if (utf8.find()) {
                candidate = sanitizeName(Uri.decode(utf8.group(1).trim()));
            } else {
                Matcher plain = DISPOSITION_PLAIN.matcher(disposition);
                if (plain.find()) {
                    candidate = sanitizeName(Uri.decode(plain.group(1).trim()));
                }
            }
        }
        if (candidate == null || candidate.isEmpty() || extractExtension(candidate).isEmpty()) {
            Uri uri = Uri.parse(url);
            String leaf = sanitizeName(uri.getLastPathSegment());
            if (!leaf.isEmpty() && !extractExtension(leaf).isEmpty()) {
                candidate = leaf;
            }
        }
        if (candidate == null || candidate.isEmpty()) {
            candidate = sanitizeName(URLUtil.guessFileName(url, disposition, mime));
        }
        if (candidate.isEmpty()) candidate = "book";

        String ext = extractExtension(candidate);
        if (ext.isEmpty() || ".bin".equals(ext)) {
            String mimeExt = extensionFromMime(mime);
            if (!mimeExt.isEmpty()) {
                String stem = ext.isEmpty() ? candidate : candidate.substring(0, candidate.length() - ext.length());
                candidate = stem + mimeExt;
                ext = mimeExt;
            }
        }
        if (candidate.length() > 240) {
            if (!ext.isEmpty() && candidate.length() > ext.length()) {
                candidate = candidate.substring(0, 240 - ext.length()) + ext;
            } else {
                candidate = candidate.substring(0, 240);
            }
        }
        return candidate;
    }

    private static String formatBytes(long bytes) {
        if (bytes <= 0) return "";
        if (bytes < 1024 * 1024) return String.format(Locale.US, "%.1f KB", bytes / 1024.0);
        return String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0));
    }

    private void requestDownload(String url, String userAgent, String disposition, String mime, long bytes) {
        Uri uri = Uri.parse(url);
        if (!browserUrl(uri)) {
            showError("该下载地址无法在 Kairos 内打开");
            return;
        }
        String name = resolveDownloadName(url, disposition, mime);
        String extension = extractExtension(name);
        if (BLOCKED_EXTENSIONS.contains(extension)) {
            showError("出于安全限制，暂不支持下载 " + extension + " 格式");
            return;
        }
        if (bytes > MAX_LOCAL_BYTES) {
            showError("文件超过 500 MB，无法下载");
            return;
        }
        synchronized (TRANSFER_LOCK) {
            if (downloading) {
                showError("请等当前文件下载完成后再试");
                return;
            }
        }

        boolean readableInApp = KAIROS_READABLE_EXTENSIONS.contains(extension);
        String sizeText = formatBytes(bytes);
        StringBuilder message = new StringBuilder();
        message.append(name);
        if (!sizeText.isEmpty()) message.append("（").append(sizeText).append("）");
        message.append("\n\n");
        if (readableInApp) {
            message.append("可下载到 Kairos 软件内直接导入阅读，或保存到手机本地「下载/个人工作站」目录。");
        } else {
            message.append("该格式暂不支持在 Kairos 内直接阅读，推荐保存到手机本地后用其他阅读器打开；也可先存入软件下载列表。");
        }

        String resolvedMime = mimeForExtension(extension, mime);
        getActivity().runOnUiThread(() -> {
            if (getActivity().isFinishing()) return;
            AlertDialog.Builder builder = new AlertDialog.Builder(getActivity())
                .setTitle("选择下载位置")
                .setMessage(message.toString())
                .setNegativeButton("取消", null);
            if (readableInApp) {
                builder.setPositiveButton("下载到 Kairos", (d, w) -> beginDownload(url, userAgent, name, extension, resolvedMime, bytes, false));
                builder.setNeutralButton("保存到本地", (d, w) -> beginDownload(url, userAgent, name, extension, resolvedMime, bytes, true));
            } else {
                builder.setPositiveButton("保存到本地", (d, w) -> beginDownload(url, userAgent, name, extension, resolvedMime, bytes, true));
                builder.setNeutralButton("存到软件列表", (d, w) -> beginDownload(url, userAgent, name, extension, resolvedMime, bytes, false));
            }
            builder.show();
        });
    }

    private void beginDownload(String url, String userAgent, String name, String extension, String mime, long bytes, boolean toLocal) {
        if (!toLocal && bytes > MAX_APP_BYTES) {
            showError("文件超过 150 MB，请改为保存到本地");
            return;
        }
        synchronized (TRANSFER_LOCK) {
            if (downloading) {
                showError("请等当前文件下载完成后再试");
                return;
            }
            downloading = true;
            lastError = null;
            if (toLocal) lastSavedPath = null;
        }
        Context context = getContext().getApplicationContext();
        if (toLocal) {
            new Thread(() -> downloadToLocal(context, url, userAgent, name, extension, mime), "archive-download-local").start();
            Toast.makeText(context, "已开始下载到本地：下载/" + LOCAL_DIR_NAME, Toast.LENGTH_SHORT).show();
        } else {
            new Thread(() -> downloadToApp(context, url, userAgent, name, extension), "archive-download-app").start();
            Toast.makeText(context, "已开始下载到 Kairos，可在下载列表查看", Toast.LENGTH_SHORT).show();
        }
    }

    private void showError(String message) {
        synchronized (TRANSFER_LOCK) { lastError = message; }
        MAIN.post(() -> Toast.makeText(getContext(), message, Toast.LENGTH_SHORT).show());
    }

    private static boolean looksLikeHtmlErrorPage(String extension, byte[] header, int len) {
        if (".html".equals(extension) || ".htm".equals(extension) || ".xml".equals(extension)) return false;
        if (len <= 0) return true;
        String head = new String(header, 0, Math.min(len, 512), StandardCharsets.UTF_8).trim().toLowerCase(Locale.ROOT);
        return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head") || head.startsWith("<!--") && head.contains("<html");
    }

    private static void downloadToApp(Context context, String url, String userAgent, String name, String extension) {
        File directory = null;
        boolean saved = false;
        String error = "下载未完成，请回到网页重试";
        String storedExt = extension.isEmpty() ? ".bin" : extension;
        try {
            directory = new File(downloadDirectory(context), UUID.randomUUID().toString());
            if (!directory.mkdir()) throw new IOException();
            File temp = new File(directory, "partial");
            try (Response response = requestFile(url, userAgent)) {
                ResponseBody body = response.body();
                if (!response.isSuccessful() || body == null) throw new IOException();
                if (body.contentLength() > MAX_APP_BYTES) throw new FileTooLarge();
                byte[] header = new byte[1024];
                int headerLen = 0;
                try (InputStream input = body.byteStream(); FileOutputStream output = new FileOutputStream(temp)) {
                    byte[] buffer = new byte[64 * 1024];
                    long total = 0;
                    int size;
                    while ((size = input.read(buffer)) != -1) {
                        total += size;
                        if (total > MAX_APP_BYTES) throw new FileTooLarge();
                        if (headerLen < header.length) {
                            int take = Math.min(size, header.length - headerLen);
                            System.arraycopy(buffer, 0, header, headerLen, take);
                            headerLen += take;
                        }
                        output.write(buffer, 0, size);
                    }
                    if (total == 0) throw new IOException();
                }
                if (looksLikeHtmlErrorPage(extension, header, headerLen)) throw new InvalidBookContent();
            }
            try (FileOutputStream output = new FileOutputStream(new File(directory, "name.txt"))) {
                output.write(name.getBytes(StandardCharsets.UTF_8));
            }
            if (!temp.renameTo(new File(directory, "book" + storedExt))) throw new IOException();
            saved = true;
            MAIN.post(() -> Toast.makeText(context, "下载完成，可在下载列表查看：" + name, Toast.LENGTH_SHORT).show());
        } catch (FileTooLarge exception) {
            error = "文件超过 150 MB，请改为保存到本地";
        } catch (InvalidBookContent exception) {
            error = "服务器返回了网页而非文件，请回到页面重试或更换下载线路";
        } catch (IOException | RuntimeException ignored) {
            // 保留统一的失败提示，下载链接可能含短期令牌。
        } finally {
            if (!saved && directory != null) {
                new File(directory, "partial").delete();
                new File(directory, "name.txt").delete();
                directory.delete();
            }
            synchronized (TRANSFER_LOCK) {
                downloading = false;
                lastError = saved ? null : error;
            }
            if (!saved) {
                String finalError = error;
                MAIN.post(() -> Toast.makeText(context, finalError, Toast.LENGTH_LONG).show());
            }
        }
    }

    private static void downloadToLocal(Context context, String url, String userAgent, String name, String extension, String mime) {
        boolean saved = false;
        String savedPath = null;
        String error = "下载未完成，请回到网页重试";
        File temp = null;
        try {
            temp = File.createTempFile("archive-local-", ".part", context.getCacheDir());
            try (Response response = requestFile(url, userAgent)) {
                ResponseBody body = response.body();
                if (!response.isSuccessful() || body == null) throw new IOException();
                if (body.contentLength() > MAX_LOCAL_BYTES) throw new FileTooLarge();
                byte[] header = new byte[1024];
                int headerLen = 0;
                try (InputStream input = body.byteStream(); FileOutputStream output = new FileOutputStream(temp)) {
                    byte[] buffer = new byte[64 * 1024];
                    long total = 0;
                    int size;
                    while ((size = input.read(buffer)) != -1) {
                        total += size;
                        if (total > MAX_LOCAL_BYTES) throw new FileTooLarge();
                        if (headerLen < header.length) {
                            int take = Math.min(size, header.length - headerLen);
                            System.arraycopy(buffer, 0, header, headerLen, take);
                            headerLen += take;
                        }
                        output.write(buffer, 0, size);
                    }
                    if (total == 0) throw new IOException();
                }
                if (looksLikeHtmlErrorPage(extension, header, headerLen)) throw new InvalidBookContent();
            }
            savedPath = copyFileToLocalDownloads(context, temp, name, mime);
            saved = true;
            String finalPath = savedPath;
            MAIN.post(() -> Toast.makeText(context, "已保存到本地：" + finalPath, Toast.LENGTH_LONG).show());
        } catch (FileTooLarge exception) {
            error = "文件超过 500 MB，无法下载";
        } catch (InvalidBookContent exception) {
            error = "服务器返回了网页而非文件，请回到页面重试或更换下载线路";
        } catch (IOException | RuntimeException exception) {
            error = "保存到本地失败，请重试";
        } finally {
            if (temp != null) temp.delete();
            synchronized (TRANSFER_LOCK) {
                downloading = false;
                lastError = saved ? null : error;
                if (saved) lastSavedPath = savedPath;
            }
            if (!saved) {
                String finalError = error;
                MAIN.post(() -> Toast.makeText(context, finalError, Toast.LENGTH_LONG).show());
            }
        }
    }

    private static String copyFileToLocalDownloads(Context context, File source, String fileName, String mimeType) throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = context.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + File.separator + LOCAL_DIR_NAME);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = null;
            try {
                uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("系统拒绝创建文件");
                try (InputStream in = new FileInputStream(source); OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new IOException("无法打开输出流");
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(uri, done, null, null);
                String actual = queryDisplayName(resolver, uri, fileName);
                return Environment.DIRECTORY_DOWNLOADS + "/" + LOCAL_DIR_NAME + "/" + actual;
            } catch (Exception e) {
                if (uri != null) {
                    try { resolver.delete(uri, null, null); } catch (Exception ignored) {}
                }
                throw e instanceof IOException ? (IOException) e : new IOException(e);
            }
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), LOCAL_DIR_NAME);
        if (!dir.exists() && !dir.mkdirs()) {
            dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) throw new IOException("无法访问下载目录");
        }
        File target = uniqueTargetFile(dir, fileName);
        try (InputStream in = new FileInputStream(source); FileOutputStream out = new FileOutputStream(target)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        }
        MediaScannerConnection.scanFile(context, new String[] { target.getAbsolutePath() }, new String[] { mimeType }, null);
        return Environment.DIRECTORY_DOWNLOADS + "/" + LOCAL_DIR_NAME + "/" + target.getName();
    }

    private static File uniqueTargetFile(File dir, String fileName) {
        File candidate = new File(dir, fileName);
        if (!candidate.exists()) return candidate;
        String ext = extractExtension(fileName);
        String stem = ext.isEmpty() ? fileName : fileName.substring(0, fileName.length() - ext.length());
        for (int i = 1; i < 1000; i++) {
            File next = new File(dir, stem + " (" + i + ")" + ext);
            if (!next.exists()) return next;
        }
        return new File(dir, stem + "-" + System.currentTimeMillis() + ext);
    }

    private static String queryDisplayName(ContentResolver resolver, Uri uri, String fallback) {
        try (android.database.Cursor cursor = resolver.query(uri, new String[] { MediaStore.MediaColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String actual = cursor.getString(0);
                if (actual != null && !actual.isEmpty()) return actual;
            }
        } catch (Exception ignored) {}
        return fallback;
    }

    private static final class FileTooLarge extends IOException {}
    private static final class InvalidBookContent extends IOException {}

    private static Response requestFile(String url, String userAgent) throws IOException {
        // 每次重定向重新按目标域名取 Cookie，避免把上一个站点的会话传给合作下载节点。
        for (int redirects = 0; redirects <= 5; redirects++) {
            if (!browserUrl(Uri.parse(url))) throw new IOException();
            Request.Builder request = new Request.Builder().url(url);
            if (userAgent != null && !userAgent.trim().isEmpty()) request.header("User-Agent", userAgent);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null && !cookies.trim().isEmpty()) request.header("Cookie", cookies);
            Response response = HTTP.newCall(request.build()).execute();
            if (!response.isRedirect()) return response;
            try (response) {
                String location = response.header("Location");
                var next = location == null ? null : response.request().url().resolve(location);
                if (next == null) throw new IOException();
                url = next.toString();
            }
        }
        throw new IOException();
    }

    private record Download(String name, File file) {}

    private static Download find(File root, String id) throws IOException {
        if (id == null || !id.matches("[a-f0-9-]{36}")) return null;
        File dir = new File(root, id);
        if (!dir.isDirectory() || !dir.equals(dir.getCanonicalFile())) return null;
        File nameFile = new File(dir, "name.txt");
        if (!nameFile.isFile() || !nameFile.equals(nameFile.getCanonicalFile()) || nameFile.length() > 4096) return null;
        String bookName;
        try (InputStream input = new FileInputStream(nameFile)) {
            byte[] bytes = new byte[(int) nameFile.length()];
            int offset = 0;
            while (offset < bytes.length) {
                int read = input.read(bytes, offset, bytes.length - offset);
                if (read < 0) return null;
                offset += read;
            }
            bookName = new String(bytes, StandardCharsets.UTF_8);
        }
        String ext = extractExtension(bookName);
        String storedExt = ext.isEmpty() ? ".bin" : ext;
        File file = new File(dir, "book" + storedExt);
        if (!file.isFile()) {
            File[] candidates = dir.listFiles((d, n) -> n.startsWith("book.") && !n.equals("book.part"));
            if (candidates != null && candidates.length == 1) file = candidates[0];
        }
        if (!file.isFile() || !file.equals(file.getCanonicalFile()) || file.length() == 0 || file.length() > MAX_APP_BYTES) return null;
        return new Download(bookName, file);
    }

    private JSObject snapshot() throws IOException {
        File root = downloadDirectory(getContext());
        File[] directories = root.listFiles(File::isDirectory);
        if (directories == null) throw new IOException();
        Arrays.sort(directories, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        JSArray items = new JSArray();
        for (File directory : directories) {
            String id = directory.getName();
            Download item = find(root, id);
            if (item != null) items.put(new JSObject().put("id", id).put("name", item.name()).put("size", item.file().length()));
        }
        synchronized (TRANSFER_LOCK) {
            return new JSObject()
                .put("items", items)
                .put("downloading", downloading)
                .put("error", lastError)
                .put("lastSavedPath", lastSavedPath);
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        try { call.resolve(snapshot()); }
        catch (Exception exception) { call.reject("无法读取下载列表"); }
    }

    @PluginMethod
    public void file(PluginCall call) {
        try {
            Download item = find(downloadDirectory(getContext()), call.getString("id"));
            if (item == null) { call.reject("下载的文件已不存在"); return; }
            call.resolve(new JSObject().put("uri", Uri.fromFile(item.file()).toString()));
        } catch (Exception exception) { call.reject("无法读取下载文件"); }
    }

    @PluginMethod
    public void saveToLocal(PluginCall call) {
        String id = call.getString("id");
        Context context = getContext().getApplicationContext();
        new Thread(() -> {
            try {
                Download item = find(downloadDirectory(context), id);
                if (item == null) {
                    call.reject("下载的文件已不存在");
                    return;
                }
                String ext = extractExtension(item.name());
                String mime = mimeForExtension(ext, null);
                String savedPath = copyFileToLocalDownloads(context, item.file(), item.name(), mime);
                synchronized (TRANSFER_LOCK) {
                    lastSavedPath = savedPath;
                }
                call.resolve(new JSObject().put("path", savedPath));
            } catch (Exception exception) {
                call.reject("保存到本地失败，请重试");
            }
        }, "archive-save-local").start();
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            Download item = find(downloadDirectory(getContext()), call.getString("id"));
            if (item == null) { call.reject("下载的文件已不存在"); return; }
            if (!item.file().delete()) { call.reject("无法清理下载文件"); return; }
            File directory = item.file().getParentFile();
            new File(directory, "name.txt").delete();
            directory.delete();
            call.resolve();
        } catch (Exception exception) { call.reject("无法清理下载文件"); }
    }

    @Override
    protected void handleOnDestroy() {
        if (dialog != null) dialog.dismiss();
        if (web != null) {
            if (web.getParent() instanceof ViewGroup parent) parent.removeView(web);
            web.destroy();
        }
    }
}
