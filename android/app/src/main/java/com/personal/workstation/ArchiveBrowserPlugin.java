package com.personal.workstation;

import android.app.Dialog;
import android.content.Context;
import android.net.Uri;
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
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

@CapacitorPlugin(name = "ArchiveBrowser")
public class ArchiveBrowserPlugin extends Plugin {
    private static final String HOME = "https://annas-archive.gd/";
    private static final long MAX_BYTES = 150L * 1024 * 1024;
    private static final Object TRANSFER_LOCK = new Object();
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
        .followRedirects(false).callTimeout(5, TimeUnit.MINUTES).readTimeout(30, TimeUnit.SECONDS).build();
    private static boolean downloading;
    private static String lastError;
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

    private void requestDownload(String url, String userAgent, String disposition, String mime, long bytes) {
        Uri uri = Uri.parse(url);
        if (!browserUrl(uri)) {
            showError("该下载地址无法在 Kairos 内打开");
            return;
        }
        String guessedName = URLUtil.guessFileName(url, disposition, mime).replaceAll("\\p{Cntrl}", "");
        String lowerName = guessedName.toLowerCase(Locale.ROOT);
        String extension;
        if (lowerName.endsWith(".epub")) extension = ".epub";
        else if (lowerName.endsWith(".pdf")) extension = ".pdf";
        else {
            showError("请选择 EPUB 或 PDF 格式的电子书");
            return;
        }
        if (bytes > MAX_BYTES) {
            showError("文件超过 150 MB，无法导入");
            return;
        }
        String name = guessedName.substring(0, Math.min(240, guessedName.length() - extension.length())) + extension;
        synchronized (TRANSFER_LOCK) {
            if (downloading) {
                showError("请等当前电子书下载完成后再试");
                return;
            }
            downloading = true;
            lastError = null;
        }
        Context context = getContext().getApplicationContext();
        new Thread(() -> download(context, url, userAgent, name, extension), "archive-download").start();
        Toast.makeText(context, "已开始下载，可在下载列表查看", Toast.LENGTH_SHORT).show();
    }

    private void showError(String message) {
        synchronized (TRANSFER_LOCK) { lastError = message; }
        Toast.makeText(getContext(), message, Toast.LENGTH_SHORT).show();
    }

    private static void download(Context context, String url, String userAgent, String name, String extension) {
        File directory = null;
        boolean saved = false;
        String error = "下载未完成，请回到网页重试";
        try {
            directory = new File(downloadDirectory(context), UUID.randomUUID().toString());
            if (!directory.mkdir()) throw new IOException();
            File temp = new File(directory, "partial");
            try (Response response = requestFile(url, userAgent)) {
                ResponseBody body = response.body();
                if (!response.isSuccessful() || body == null) throw new IOException();
                if (body.contentLength() > MAX_BYTES) throw new FileTooLarge();
                try (InputStream input = body.byteStream(); FileOutputStream output = new FileOutputStream(temp)) {
                    byte[] buffer = new byte[64 * 1024];
                    long total = 0;
                    int size;
                    while ((size = input.read(buffer)) != -1) {
                        total += size;
                        if (total > MAX_BYTES) throw new FileTooLarge();
                        output.write(buffer, 0, size);
                    }
                    if (total == 0) throw new IOException();
                }
            }
            try (FileOutputStream output = new FileOutputStream(new File(directory, "name.txt"))) {
                output.write(name.getBytes(StandardCharsets.UTF_8));
            }
            if (!temp.renameTo(new File(directory, "book" + extension))) throw new IOException();
            saved = true;
        } catch (FileTooLarge exception) {
            error = "文件超过 150 MB，无法导入";
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
        }
    }

    private static final class FileTooLarge extends IOException {}

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
        File file = new File(dir, "book.epub");
        if (!file.isFile()) file = new File(dir, "book.pdf");
        if (!file.isFile() || !file.equals(file.getCanonicalFile()) || file.length() == 0 || file.length() > MAX_BYTES) return null;
        File name = new File(dir, "name.txt");
        if (!name.isFile() || !name.equals(name.getCanonicalFile()) || name.length() > 4096) return null;
        try (InputStream input = new FileInputStream(name)) {
            byte[] bytes = new byte[(int) name.length()];
            int offset = 0;
            while (offset < bytes.length) {
                int read = input.read(bytes, offset, bytes.length - offset);
                if (read < 0) return null;
                offset += read;
            }
            return new Download(new String(bytes, StandardCharsets.UTF_8), file);
        }
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
            return new JSObject().put("items", items).put("downloading", downloading).put("error", lastError);
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
            if (item == null) { call.reject("下载的电子书已不存在"); return; }
            call.resolve(new JSObject().put("uri", Uri.fromFile(item.file()).toString()));
        } catch (Exception exception) { call.reject("无法读取电子书"); }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            Download item = find(downloadDirectory(getContext()), call.getString("id"));
            if (item == null) { call.reject("下载的电子书已不存在"); return; }
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
