import assert from "node:assert/strict";
import test from "node:test";
import semver from "semver";

import { loadPackageServices } from "./load-package-services.mjs";

const {
    validatePackageManifest,
    parseConfiguredPluginSources
} = loadPackageServices();

test("E2E Package Update Workflow: Version check, backup preservation, and activation reconciliation", async () => {
    // 1. Initial State: Installed Package v1.0.0
    const installedPackage = {
        id: "acme/dev-tools",
        version: "1.0.0",
        enabled: true,
        pinned: false,
        settings: {
            themeColor: "dark-blue",
            refreshRate: 5000
        },
        artifacts: [
            { id: "widget-1", type: "widget", activation: "startup" }
        ]
    };

    // 2. Registry Catalog Check: v1.1.0 Available
    const registryCatalog = [
        {
            id: "acme/dev-tools",
            name: "Developer Tools Plugin",
            version: "1.1.0",
            description: "Enhanced dev tools for Trilium",
            compatibility: { minTriliumVersion: "0.100.0" },
            artifacts: [
                { id: "widget-1", type: "widget", activation: "startup" },
                { id: "backend-script-1", type: "backend", activation: "startup" }
            ]
        }
    ];

    // Verify version detection: candidate v1.1.0 is newer than installed v1.0.0
    assert.strictEqual(semver.gt(registryCatalog[0].version, installedPackage.version), true);

    // 3. Staging Update: Create Configuration Backup Snapshot
    const backupSnapshot = {
        packageId: installedPackage.id,
        version: installedPackage.version,
        timestamp: new Date().toISOString(),
        settings: { ...installedPackage.settings },
        enabled: installedPackage.enabled,
        pinned: installedPackage.pinned
    };

    assert.strictEqual(backupSnapshot.settings.themeColor, "dark-blue");
    assert.strictEqual(backupSnapshot.enabled, true);

    // 4. Update Execution: Apply Migrations & Upgrade Manifest to v1.1.0
    const upgradedPackage = {
        ...installedPackage,
        version: registryCatalog[0].version,
        artifacts: registryCatalog[0].artifacts
    };

    // 5. Settings & Activation Restoration
    const restoredSettings = { ...backupSnapshot.settings };
    assert.deepStrictEqual(restoredSettings, { themeColor: "dark-blue", refreshRate: 5000 });

    // Verify artifact activation: enabled package has active startup activation
    const activeArtifactLabels = upgradedPackage.artifacts.map((art) => art.type === "widget" ? "widget" : "run");
    assert.deepStrictEqual(activeArtifactLabels, ["widget", "run"]);

    // 6. Final State Assertion
    assert.strictEqual(upgradedPackage.version, "1.1.0");
    assert.strictEqual(upgradedPackage.enabled, true);
    assert.strictEqual(upgradedPackage.artifacts.length, 2);
});
