package com.personal.workstation;

import org.junit.Test;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import static org.junit.Assert.assertEquals;

public class FileLocationNavigatorTest {
    private static class FakeLauncher implements FileLocationNavigator.Launcher {
        final List<String> attempts = new ArrayList<>();
        String workingDirectoryHandler;
        boolean downloadsAvailable;
        boolean throwFirst;

        @Override public boolean openDirectory(String packageName) {
            attempts.add(packageName == null ? "generic" : packageName);
            if (throwFirst && attempts.size() == 1) throw new SecurityException("no access");
            return (packageName == null ? "generic" : packageName).equals(workingDirectoryHandler);
        }
        @Override public boolean openDownloads() {
            attempts.add("downloads");
            return downloadsAvailable;
        }
    }

    @Test public void opensTargetFolderInSystemFileManagerFirst() {
        FakeLauncher launcher = new FakeLauncher();
        launcher.workingDirectoryHandler = "com.google.android.documentsui";
        assertEquals("folder", FileLocationNavigator.open(launcher));
        assertEquals(Arrays.asList("com.google.android.documentsui"), launcher.attempts);
    }

    @Test public void triesOtherFileManagersIfOneIsMissingOrDenied() {
        FakeLauncher launcher = new FakeLauncher();
        launcher.throwFirst = true;
        launcher.workingDirectoryHandler = "generic";
        assertEquals("folder", FileLocationNavigator.open(launcher));
        assertEquals(Arrays.asList("com.google.android.documentsui", "com.android.documentsui", "generic"), launcher.attempts);
    }

    @Test public void fallsBackToDownloadsWhenNoFolderHandlerExists() {
        FakeLauncher launcher = new FakeLauncher();
        launcher.downloadsAvailable = true;
        assertEquals("downloads", FileLocationNavigator.open(launcher));
        assertEquals(Arrays.asList("com.google.android.documentsui", "com.android.documentsui", "generic", "downloads"), launcher.attempts);
    }

    @Test public void reportsUnavailableWhenNoActivityCanOpen() {
        assertEquals("unavailable", FileLocationNavigator.open(new FakeLauncher()));
    }
}
