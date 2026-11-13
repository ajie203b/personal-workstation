# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in the default Android SDK proguard file.

# Keep Capacitor bridge, plugins, and @PluginMethod/@PermissionCallback reflection targets
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep @com.getcapacitor.annotation.NativePlugin class * { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}

# Keep all app plugins, widgets, activities, receivers, and WebView interfaces
-keep class com.personal.workstation.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# OkHttp / Okio optional JVM/conscrypt references
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.codehaus.mojo.animal_sniffer.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
