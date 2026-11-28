package com.personal.workstation;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int MAX_SHARE_CHARS = 16_384;

    private static String clampShareText(String value) {
        if (value == null) return "";
        String trimmed = value.trim();
        return trimmed.length() > MAX_SHARE_CHARS ? trimmed.substring(0, MAX_SHARE_CHARS) : trimmed;
    }

    /** 将系统 ACTION_SEND(text/plain) 转为统一深链，复用 Capacitor App.getLaunchUrl / appUrlOpen */
    private static Intent normalizeShareIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return intent;
        String type = intent.getType();
        if (type == null || !type.startsWith("text/")) return intent;
        String title = clampShareText(intent.getStringExtra(Intent.EXTRA_SUBJECT));
        String text = clampShareText(intent.getStringExtra(Intent.EXTRA_TEXT));
        if (TextUtils.isEmpty(title) && TextUtils.isEmpty(text)) return intent;
        Uri.Builder uri = new Uri.Builder()
            .scheme("com.personal.workstation")
            .authority("share");
        if (!TextUtils.isEmpty(title)) uri.appendQueryParameter("title", title);
        if (!TextUtils.isEmpty(text)) uri.appendQueryParameter("text", text);
        Intent view = new Intent(Intent.ACTION_VIEW, uri.build());
        view.setFlags(intent.getFlags());
        return view;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        setIntent(normalizeShareIntent(getIntent()));
        // 本地插件必须在 super.onCreate 之前注册，Bridge 创建时才会带上它
        registerPlugin(TaskWidgetPlugin.class);
        registerPlugin(FileExportPlugin.class);
        registerPlugin(WebdavPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(ArchiveBrowserPlugin.class);
        registerPlugin(HtmlPreviewPlugin.class);
        super.onCreate(savedInstanceState);
        // 整页缩放会把 UI 一起放大，且不同机型表现不一致；文档内的缩放由前端自己实现。
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(normalizeShareIntent(intent));
    }
}
