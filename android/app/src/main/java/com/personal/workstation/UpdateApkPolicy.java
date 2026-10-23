package com.personal.workstation;

import java.io.IOException;
import java.util.Set;

/** 安装包身份规则；与 Android IO 分离，方便在 JVM 上验证错误镜像的处理。 */
final class UpdateApkPolicy {
    private UpdateApkPolicy() {}

    static void validate(String packageName, String expectedPackage, String versionName,
                         String expectedVersion, long versionCode, long installedVersionCode,
                         Set<String> signers, Set<String> installedSigners) throws IOException {
        if (!expectedPackage.equals(packageName)) throw new IOException("安装包不属于本应用");
        if (expectedVersion == null || !expectedVersion.equals(versionName)) {
            throw new IOException("安装包版本与目标版本不一致");
        }
        if (versionCode <= installedVersionCode) throw new IOException("安装包版本码未高于当前版本");
        if (signers == null || signers.isEmpty() || !signers.equals(installedSigners)) {
            throw new IOException("安装包签名与当前应用不一致");
        }
    }
}
