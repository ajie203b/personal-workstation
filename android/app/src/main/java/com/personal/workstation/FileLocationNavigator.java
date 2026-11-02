package com.personal.workstation;

/** 打开保存目录时优先使用系统文件管理器，不依赖包可见性查询。 */
final class FileLocationNavigator {
    interface Launcher {
        boolean openDirectory(String packageName);
        boolean openDownloads();
    }

    private FileLocationNavigator() {}

    static String open(Launcher launcher) {
        String[] systemFileManagers = { "com.google.android.documentsui", "com.android.documentsui", null };
        for (String packageName : systemFileManagers) {
            try {
                if (launcher.openDirectory(packageName)) return "folder";
            } catch (RuntimeException ignored) {
                // 某些设备不包含指定包，或禁止打开该 Activity；继续尝试其他处理器。
            }
        }
        try {
            if (launcher.openDownloads()) return "downloads";
        } catch (RuntimeException ignored) {
            // 保存已成功，即便所有打开方式都不可用，也不能把导出误报为失败。
        }
        return "unavailable";
    }
}
