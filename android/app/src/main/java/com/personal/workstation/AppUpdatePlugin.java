package com.personal.workstation;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * 应用内更新：查 GitHub 最新版、下载 APK、拉起系统安装器。
 *
 * - checkUpdate：原生 GET（前端 fetch 失败时的兜底，不受 WebView 跨域 / 超时影响）
 * - downloadApk：下载到应用私有缓存 cache/updates/，通过 downloadProgress 事件回传进度；
 *   GitHub 直连 20 秒没响应 / 出错，就依次换镜像前缀；下载完校验是本应用的安装包
 *   （镜像返回 HTML 错误页时不会被当成 APK）
 * - installApk：FileProvider（authority = 包名.fileprovider，file_paths.xml 已含 cache-path）
 *   + ACTION_VIEW 拉起系统安装器；Android 8+ 没有「安装未知应用」权限时先跳设置页
 *
 * 下载放独立线程：Capacitor 所有插件共用一个调用线程，长下载会卡住坚果云同步等其他调用。
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String MIME_APK = "application/vnd.android.package-archive";
    private static final String UPDATE_DIR = "updates";
    private static final String USER_AGENT = "Kairos-Android-Updater";
    private static final long PROGRESS_INTERVAL_MS = 200;

    private static final OkHttpClient BASE_CLIENT = new OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .retryOnConnectionFailure(true)
        .build();

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloading = new AtomicBoolean(false);

    @PluginMethod
    public void checkUpdate(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("缺少或非法的 url");
            return;
        }
        executor.execute(() -> {
            Request req = new Request.Builder()
                .url(url)
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", USER_AGENT)
                .build();
            try (Response res = BASE_CLIENT.newCall(req).execute()) {
                ResponseBody body = res.body();
                JSObject out = new JSObject();
                out.put("status", res.code());
                out.put("body", body != null ? body.string() : "");
                call.resolve(out);
            } catch (Exception e) {
                call.reject("检查更新失败：" + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void downloadApk(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("缺少或非法的下载地址");
            return;
        }
        final String fileName = sanitizeFileName(call.getString("fileName", "update.apk"));
        final int timeoutMs = Math.max(5000, call.getInt("timeoutMs", 20000));
        final List<String> sources = new ArrayList<>();
        sources.add(url);
        JSArray mirrors = call.getArray("mirrors", new JSArray());
        for (int i = 0; i < mirrors.length(); i++) {
            String prefix = mirrors.optString(i, "");
            if (prefix.startsWith("https://")) {
                sources.add((prefix.endsWith("/") ? prefix : prefix + "/") + url);
            }
        }

        if (!downloading.compareAndSet(false, true)) {
            call.reject("已有更新正在下载");
            return;
        }
        executor.execute(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), UPDATE_DIR);
                if (!dir.exists() && !dir.mkdirs()) {
                    call.reject("无法创建下载目录");
                    return;
                }
                cleanDir(dir);
                File target = new File(dir, fileName);
                Exception last = null;
                for (String src : sources) {
                    try {
                        downloadOnce(src, target, timeoutMs);
                        PackageInfo info = verifyApk(target);
                        JSObject out = new JSObject();
                        out.put("path", target.getAbsolutePath());
                        out.put("size", target.length());
                        out.put("source", src);
                        if (info.versionName != null) out.put("versionName", info.versionName);
                        call.resolve(out);
                        return;
                    } catch (Exception e) {
                        last = e;
                        //noinspection ResultOfMethodCallIgnored
                        target.delete();
                    }
                }
                call.reject("下载失败（已尝试 GitHub 与镜像）：" + (last != null ? last.getMessage() : "未知错误"));
            } finally {
                downloading.set(false);
            }
        });
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("缺少安装包路径");
            return;
        }
        final Context ctx = getContext();
        final File file = new File(path);
        try {
            File dir = new File(ctx.getCacheDir(), UPDATE_DIR);
            // 只允许安装自己下载到缓存目录里的包
            if (!file.getCanonicalPath().startsWith(dir.getCanonicalPath() + File.separator) || !file.isFile()) {
                call.reject("安装包不存在，请重新下载");
                return;
            }
        } catch (IOException e) {
            call.reject("安装包路径无效：" + e.getMessage());
            return;
        }

        if (!canInstall(ctx)) {
            openUnknownSourcesSettings();
            JSObject out = new JSObject();
            out.put("status", "needPermission");
            call.resolve(out);
            return;
        }

        final Uri uri;
        try {
            uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
        } catch (IllegalArgumentException e) {
            call.reject("无法共享安装包：" + e.getMessage());
            return;
        }
        getActivity().runOnUiThread(() -> {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, MIME_APK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getActivity().startActivity(intent);
            } catch (ActivityNotFoundException e) {
                // 个别 ROM 不响应 ACTION_VIEW + APK 类型时，退回已废弃但仍可用的 ACTION_INSTALL_PACKAGE
                try {
                    @SuppressWarnings("deprecation")
                    Intent legacy = new Intent(Intent.ACTION_INSTALL_PACKAGE);
                    legacy.setData(uri);
                    legacy.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    getActivity().startActivity(legacy);
                } catch (ActivityNotFoundException e2) {
                    call.reject("系统没有可用的安装器");
                    return;
                }
            }
            JSObject out = new JSObject();
            out.put("status", "started");
            call.resolve(out);
        });
    }

    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        JSObject out = new JSObject();
        out.put("granted", canInstall(getContext()));
        call.resolve(out);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        openUnknownSourcesSettings();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    // ---------- 内部 ----------

    private static boolean canInstall(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return ctx.getPackageManager().canRequestPackageInstalls();
    }

    private void openUnknownSourcesSettings() {
        final Context ctx = getContext();
        getActivity().runOnUiThread(() -> {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + ctx.getPackageName()));
            } else {
                intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getActivity().startActivity(intent);
            } catch (ActivityNotFoundException e) {
                Intent fallback = new Intent(Settings.ACTION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    getActivity().startActivity(fallback);
                } catch (ActivityNotFoundException ignored) {
                    // 实在打不开就算了，前端会提示手动去设置里开
                }
            }
        });
    }

    /** 下载一个来源；连接 / 读取 timeoutMs 内没进展就抛错，交给下一个来源 */
    private void downloadOnce(String src, File target, int timeoutMs) throws IOException {
        OkHttpClient client = BASE_CLIENT.newBuilder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .build();
        Request req = new Request.Builder()
            .url(src)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/octet-stream, */*")
            .build();
        File part = new File(target.getParentFile(), target.getName() + ".part");
        try (Response res = client.newCall(req).execute()) {
            if (!res.isSuccessful()) throw new IOException("HTTP " + res.code() + "（" + hostOf(src) + "）");
            ResponseBody body = res.body();
            if (body == null) throw new IOException("响应为空（" + hostOf(src) + "）");
            long total = body.contentLength();
            long downloaded = 0;
            long lastEmit = 0;
            byte[] buf = new byte[64 * 1024];
            try (InputStream in = body.byteStream(); OutputStream out = new FileOutputStream(part)) {
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new IOException("下载已取消");
                    out.write(buf, 0, n);
                    downloaded += n;
                    long now = System.currentTimeMillis();
                    if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
                        lastEmit = now;
                        emitProgress(downloaded, total, src);
                    }
                }
            }
            if (total > 0 && downloaded != total) {
                throw new IOException("下载不完整（" + downloaded + "/" + total + "）");
            }
            emitProgress(downloaded, total > 0 ? total : downloaded, src);
            if (target.exists() && !target.delete()) throw new IOException("无法覆盖旧安装包");
            if (!part.renameTo(target)) throw new IOException("无法保存安装包");
        } finally {
            if (part.exists()) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
            }
        }
    }

    /** 必须是能解析的 APK，且包名与当前应用一致（签名是否一致由系统安装器把关） */
    private PackageInfo verifyApk(File apk) throws IOException {
        PackageManager pm = getContext().getPackageManager();
        PackageInfo info = pm.getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        if (info == null) throw new IOException("下载的文件不是有效的安装包");
        if (!getContext().getPackageName().equals(info.packageName)) {
            throw new IOException("安装包不属于本应用（" + info.packageName + "）");
        }
        return info;
    }

    private void emitProgress(long downloaded, long total, String src) {
        JSObject data = new JSObject();
        data.put("downloaded", downloaded);
        data.put("total", total);
        data.put("source", hostOf(src));
        notifyListeners("downloadProgress", data);
    }

    private static void cleanDir(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    private static String sanitizeFileName(String name) {
        String safe = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (safe.isEmpty() || safe.startsWith(".") || !safe.toLowerCase().endsWith(".apk")) return "update.apk";
        return safe;
    }

    /** 进度里只回传域名，方便界面显示「正在从镜像下载」，不暴露完整地址 */
    private static String hostOf(String url) {
        try {
            String host = Uri.parse(url).getHost();
            return host != null ? host : url;
        } catch (Exception e) {
            return url;
        }
    }
}
