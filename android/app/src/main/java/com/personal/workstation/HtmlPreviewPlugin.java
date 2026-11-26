package com.personal.workstation;

import android.app.Dialog;
import android.util.Base64;
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

import java.nio.charset.StandardCharsets;

/** Imported scripts run in their own offline WebView, without Capacitor plugins. */
@CapacitorPlugin(name = "HtmlPreview")
public class HtmlPreviewPlugin extends Plugin {
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
                    return true;
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    return true;
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
            String encoded = Base64.encodeToString(html.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
            web.loadData(encoded, "text/html; charset=utf-8", "base64");
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (preview != null) preview.dismiss();
        super.handleOnDestroy();
    }
}
