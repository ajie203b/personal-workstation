package com.personal.workstation;

import org.junit.Test;
import java.io.IOException;
import java.util.Collections;
import java.util.Set;
import static org.junit.Assert.assertThrows;

public class UpdateApkPolicyTest {
    private void verify(String name, String version, long code, Set<String> signers) throws IOException {
        UpdateApkPolicy.validate(name, "com.personal.workstation", version, "3.4.1", code, 64,
            signers, Set.of("trusted-certificate"));
    }

    @Test public void acceptsExpectedNewerReleaseWithSameCertificate() throws Exception {
        verify("com.personal.workstation", "3.4.1", 65, Set.of("trusted-certificate"));
    }

    @Test public void rejectsAnotherPackage() {
        assertThrows(IOException.class, () -> verify("other.app", "3.4.1", 65, Set.of("trusted-certificate")));
    }

    @Test public void rejectsWrongVersionFromMirror() {
        assertThrows(IOException.class, () -> verify("com.personal.workstation", "3.4.0", 65, Set.of("trusted-certificate")));
    }

    @Test public void rejectsNullVersion() {
        assertThrows(IOException.class, () -> verify("com.personal.workstation", null, 65, Set.of("trusted-certificate")));
    }

    @Test public void rejectsSameOrOlderVersionCode() {
        assertThrows(IOException.class, () -> verify("com.personal.workstation", "3.4.1", 64, Set.of("trusted-certificate")));
        assertThrows(IOException.class, () -> verify("com.personal.workstation", "3.4.1", 63, Set.of("trusted-certificate")));
    }

    @Test public void rejectsWrongSigningCertificate() {
        assertThrows(IOException.class, () -> verify("com.personal.workstation", "3.4.1", 65, Set.of("wrong-certificate")));
    }

    @Test public void rejectsMissingCertificate() {
        assertThrows(IOException.class, () -> verify("com.personal.workstation", "3.4.1", 65, Collections.emptySet()));
    }

    @Test public void rejectsPartialOrExtraSigners() {
        assertThrows(IOException.class, () -> verify("com.personal.workstation", "3.4.1", 65, Set.of("trusted-certificate", "other")));
    }
}
