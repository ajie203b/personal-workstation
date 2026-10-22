package com.personal.workstation;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Iterator;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * WebDAV 专用请求（MKCOL / PROPFIND 等）。
 *
 * CapacitorHttp 底层是 HttpURLConnection，只认 GET/POST/PUT/DELETE 等 8 个标准方法，
 * 坚果云建目录要用的 MKCOL 会直接抛「Expected one of [...] but was MKCOL」。
 * OkHttp 不限制方法名，所以这类请求走这里；GET/PUT 仍走 CapacitorHttp。
 */
@CapacitorPlugin(name = "WebdavNative")
public class WebdavPlugin extends Plugin {

    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .followRedirects(false)
        .build();

    @PluginMethod
    public void request(PluginCall call) {
        String url = call.getString("url");
        String method = call.getString("method");
        if (url == null || method == null) {
            call.reject("缺少 url 或 method");
            return;
        }
        String body = call.getString("body");
        String contentType = "application/xml; charset=utf-8";

        Request.Builder rb = new Request.Builder().url(url);
        JSObject headers = call.getObject("headers", new JSObject());
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            String v = headers.getString(k);
            if (v == null) continue;
            if ("content-type".equalsIgnoreCase(k)) contentType = v;
            rb.header(k, v);
        }
        RequestBody reqBody = body != null
            ? RequestBody.create(body, MediaType.parse(contentType))
            : null;
        rb.method(method.toUpperCase(), reqBody);

        try (Response res = CLIENT.newCall(rb.build()).execute()) {
            ResponseBody rbody = res.body();
            JSObject out = new JSObject();
            out.put("status", res.code());
            out.put("data", rbody != null ? rbody.string() : "");
            String etag = res.header("ETag");
            if (etag != null) out.put("etag", etag);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("网络请求失败：" + e.getMessage());
        }
    }
}
