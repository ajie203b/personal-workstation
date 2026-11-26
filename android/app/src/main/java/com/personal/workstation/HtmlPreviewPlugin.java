package com.personal.workstation;

import android.app.Dialog;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Imported scripts run in their own offline WebView, without Capacitor plugins. */
@CapacitorPlugin(name = "HtmlPreview")
public class HtmlPreviewPlugin extends Plugin {
    private static final String DOCUMENT_URL = "https://html-preview.invalid/document";
    private Dialog preview;

    @PluginMethod
    public void open(PluginCall call) {
        String html = call.getString("html");
        if (html == null) {
            call.reject("缺少 HTML 内容");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (preview != null) preview.dismiss();
            Dialog dialog = new Dialog(getActivity(), android.R.style.Theme_DeviceDefault_Light_NoActionBar);
            preview = dialog;
            dialog.setTitle(call.getString("title", "HTML"));
            LinearLayout layout = new LinearLayout(getActivity());
            layout.setOrientation(LinearLayout.VERTICAL);
            layout.setFitsSystemWindows(true);
            Button close = new Button(getActivity());
            close.setText("返回文档");
            close.setOnClickListener(v -> dialog.dismiss());
            layout.addView(close);
            WebView web = new WebView(getActivity());
            WebSettings settings = web.getSettings();
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setBlockNetworkLoads(true);
            settings.setJavaScriptEnabled(true);
            web.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return !request.isForMainFrame() || !request.getUrl().toString().startsWith(DOCUMENT_URL + "#");
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    return !url.startsWith(DOCUMENT_URL + "#");
                }
            });
            layout.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
            dialog.setContentView(layout);
            dialog.setOnDismissListener(ignored -> {
                layout.removeView(web);
                web.destroy();
                if (preview == dialog) preview = null;
            });
            dialog.show();
            web.loadDataWithBaseURL(DOCUMENT_URL, html, "text/html", "UTF-8", DOCUMENT_URL);
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (preview != null) preview.dismiss();
        super.handleOnDestroy();
    }
}
