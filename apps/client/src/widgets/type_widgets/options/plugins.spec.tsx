import { describe, expect, it } from "vitest";
import i18next from "i18next";

import {
    compareVersions,
    compatibilityStatus,
    buildLegacyPluginSourceLabels,
    formatCompatibility,
    formatDependency,
    formatInstalledPackageDescription,
    formatPluginUpdateError,
    isCatalogPackageEntry,
    isNewerVersion,
    isPackageArtifact,
    isPackageCompatibility,
    isPackageDependency,
    isPackageSettingDefinition,
    isPackageSurface,
    isRelativePackageSource,
    isSecurePackageUrl,
    manifestStatus,
    normalizePluginSourceUrl,
    normalizePluginSources,
    parseConfiguredPluginSources,
    parseSourceHosts,
    normalizeSourceHosts,
    packageActivationHealth,
    packageHealth,
    parseCachedPackageManifest,
    parseRegistryUrls,
    parseSettingValue,
    serializeSetting,
    settingLabelName,
    shouldScheduleUpdateChecks
} from "./plugins";

const integrity = `sha256-${"A".repeat(43)}=`;

const manifest = {
    id: "example/plugin",
    name: "Example plugin",
    description: "A plugin used by the validation tests.",
    version: "1.2.3",
    repository: "https://example.com/example/plugin",
    permissions: ["network"],
    settings: [{ key: "enabled", type: "boolean" as const, title: "Enabled", default: false }],
    surfaces: [],
    artifacts: [{ id: "manifest", type: "resource" as const, source: "https://example.com/plugin.json", integrity }],
    dependencies: [{ id: "example/dependency", version: ">=1.0.0" }],
    compatibility: { minTriliumVersion: "0.100.0", maxTriliumVersion: "0.110.0" }
};

describe("plugin manager validation helpers", () => {
    it("parses JSON and legacy newline-separated sources consistently", () => {
        expect(parseRegistryUrls('[" https://one.example/index.json ", "https://two.example/index.json"]')).toEqual([
            "https://one.example/index.json",
            "https://two.example/index.json"
        ]);
        expect(parseRegistryUrls("https://one.example/index.json\n\n https://two.example/index.json")).toEqual([
            "https://one.example/index.json",
            "https://two.example/index.json"
        ]);
        expect(parseRegistryUrls(null)).toEqual([]);
    });

    it("surfaces legacy source labels alongside canonical sources", () => {
        const labels: Record<string, string> = {
            packageSources: '["https://catalog.example/registry.json"]',
            packageDirectManifestUrls: "https://github.example/retired/trilium-package.json\nhttps://catalog.example/registry.json",
            packageRegistryUrls: "[]",
            packageRegistryUrl: ""
        };
        expect(parseConfiguredPluginSources((labelName) => labels[labelName])).toEqual([
            "https://catalog.example/registry.json",
            "https://github.example/retired/trilium-package.json"
        ]);
    });

    it("normalizes source hosts to one host per line", () => {
        expect(normalizeSourceHosts(" github.com, raw.githubusercontent.com\ngitlab.com ")).toBe(
            "github.com\nraw.githubusercontent.com\ngitlab.com"
        );
        expect(parseSourceHosts("github.com, raw.githubusercontent.com\ngithub.com")).toEqual([
            "github.com",
            "raw.githubusercontent.com"
        ]);
    });

    it("only accepts HTTPS sources, except for local development hosts", () => {
        expect(isSecurePackageUrl("https://example.com/plugin.json")).toBe(true);
        expect(isSecurePackageUrl("http://localhost:39125/plugin.json")).toBe(true);
        expect(isSecurePackageUrl("http://127.0.0.1:39125/plugin.json")).toBe(true);
        expect(isSecurePackageUrl("file:///Users/test/package.json")).toBe(true);
        expect(isSecurePackageUrl("http://example.com/plugin.json")).toBe(false);
        expect(isSecurePackageUrl("javascript:alert(1)")).toBe(false);
    });

    it("accepts safe relative artifact paths and normalizes GitHub repositories", () => {
        expect(isRelativePackageSource("src/index.js")).toBe(true);
        expect(isRelativePackageSource("../outside.js")).toBe(false);
        expect(isRelativePackageSource("/absolute.js")).toBe(false);
        expect(normalizePluginSourceUrl("https://github.com/timeworthy/ikmal_tools_trilium")).toBe(
            "https://raw.githubusercontent.com/timeworthy/ikmal_tools_trilium/main/trilium-package.json"
        );
        expect(normalizePluginSourceUrl("https://github.com/timeworthy/ikmal_tools_trilium/blob/main/trilium-package.json")).toBe(
            "https://raw.githubusercontent.com/timeworthy/ikmal_tools_trilium/main/trilium-package.json"
        );
        expect(normalizePluginSourceUrl("github.com/timeworthy/ikmal_tools_trilium")).toBe(
            "https://raw.githubusercontent.com/timeworthy/ikmal_tools_trilium/main/trilium-package.json"
        );
        expect(normalizePluginSourceUrl("raw.githubusercontent.com/timeworthy/ikmal_tools_trilium/main/trilium-package.json")).toBe(
            "https://raw.githubusercontent.com/timeworthy/ikmal_tools_trilium/main/trilium-package.json"
        );
        expect(normalizePluginSources([" https://example.com/a.json ", "https://example.com/a.json", ""])).toEqual(["https://example.com/a.json"]);
        expect(normalizePluginSources([
            "https://github.com/timeworthy/ikmal_tools_trilium",
            "https://raw.githubusercontent.com/timeworthy/ikmal_tools_trilium/main/trilium-package.json"
        ])).toEqual(["https://github.com/timeworthy/ikmal_tools_trilium"]);
    });

    it("writes compatible aliases for older package managers", () => {
        expect(buildLegacyPluginSourceLabels([
            "github.com/timeworthy/ikmal_tools_trilium",
            "http://127.0.0.1:39125/registry.json"
        ])).toEqual({
            packageRegistryUrl: "https://raw.githubusercontent.com/timeworthy/ikmal_tools_trilium/main/trilium-package.json",
            packageRegistryUrls: JSON.stringify([
                "https://raw.githubusercontent.com/timeworthy/ikmal_tools_trilium/main/trilium-package.json",
                "http://127.0.0.1:39125/registry.json"
            ]),
            packageDirectManifestUrls: JSON.stringify([
                "https://raw.githubusercontent.com/timeworthy/ikmal_tools_trilium/main/trilium-package.json",
                "http://127.0.0.1:39125/registry.json"
            ])
        });
    });

    it("validates package settings, dependencies, artifacts, and compatibility", () => {
        expect(isPackageSettingDefinition(manifest.settings[0])).toBe(true);
        expect(isPackageSettingDefinition({ key: "bad", type: "unknown", title: "Bad" })).toBe(false);
        expect(isPackageSettingDefinition({ key: "unsafe:key", type: "string", title: "Bad" })).toBe(false);
        expect(isPackageDependency(manifest.dependencies[0])).toBe(true);
        expect(isPackageDependency({ id: "example/dependency" })).toBe(false);
        expect(isPackageDependency({ id: "example/dependency", version: "not-semver" })).toBe(false);
        expect(isPackageArtifact(manifest.artifacts[0])).toBe(true);
        expect(isPackageArtifact({ ...manifest.artifacts[0], id: "unsafe/id" })).toBe(false);
        expect(isPackageArtifact({ ...manifest.artifacts[0], source: "http://example.com/plugin.js" })).toBe(false);
        expect(isPackageArtifact({ ...manifest.artifacts[0], integrity: "sha256-invalid" })).toBe(false);
        expect(isPackageCompatibility(manifest.compatibility)).toBe(true);
        expect(isPackageCompatibility({ minTriliumVersion: 1 })).toBe(false);
        expect(isPackageCompatibility({ minTriliumVersion: "0.110.0", maxTriliumVersion: "0.100.0" })).toBe(false);
        expect(isPackageSurface({ id: "dashboard", type: "page", title: "Dashboard", artifact: "manifest" })).toBe(true);
        expect(isPackageSurface({ id: "preferences", type: "settings", title: "Preferences", settingKeys: ["enabled"] })).toBe(true);
        expect(isPackageSurface({ id: "about", type: "modal", title: "About", command: "showInfoDialog", options: {} })).toBe(true);
        expect(isPackageSurface({ id: "unsafe", type: "deeplink", title: "Unsafe", url: "javascript:alert(1)" })).toBe(false);
    });

    it("rejects incomplete or unsafe catalog entries", () => {
        expect(isCatalogPackageEntry(manifest)).toBe(true);
        expect(isCatalogPackageEntry({ ...manifest, id: "Example/Plugin" })).toBe(false);
        expect(isCatalogPackageEntry({ ...manifest, repository: "http://example.com/plugin" })).toBe(false);
        expect(isCatalogPackageEntry({ ...manifest, artifacts: [] })).toBe(false);
        expect(isCatalogPackageEntry({ ...manifest, compatibility: null })).toBe(false);
    });

    it("uses an embedded manifest when no registry source is configured", () => {
        const cached = parseCachedPackageManifest(JSON.stringify(manifest));
        expect(cached?.id).toBe("example/plugin");
        expect(cached?.settings).toEqual(manifest.settings);
    });

    it("detects activation drift separately from missing artifacts", () => {
        const cssManifest = {
            ...manifest,
            artifacts: [{ id: "style", type: "css" as const, source: "style.css", integrity }]
        };
        const fakeNote = (labels: Record<string, string[]>) => ({
            getOwnedLabelValue: (name: string) => name === "packageArtifact" ? "style" : null,
            getOwnedLabels: (name: string) => (labels[name] || []).map((value, index) => ({ attributeId: String(index), value }))
        });

        expect(packageActivationHealth([fakeNote({ "disabled:appCss": [""] }) as any], true, cssManifest).health).toBe("broken");
        expect(packageActivationHealth([fakeNote({ appCss: [""] }) as any], true, cssManifest)).toEqual({ health: "healthy", healthMessage: "all artifacts active" });
        expect(packageActivationHealth([fakeNote({ appCss: [""] }) as any], false, cssManifest).health).toBe("broken");
        expect(packageActivationHealth([fakeNote({ "disabled:appCss": [""] }) as any], false, cssManifest)).toEqual({ health: "healthy", healthMessage: "all artifacts active" });
    });
});

describe("plugin manager state helpers", () => {
    it("keeps package IDs and update URLs readable in translated text", async () => {
        await i18next.init({
            lng: "en",
            resources: {
                en: {
                    translation: {
                        plugins: {
                            installed_summary: "{{id}} · v{{version}} · {{state}}{{pinned}} · {{health}}{{healthMessage}}",
                            enabled: "enabled",
                            health_unknown: "unknown",
                            health_not_in_registry: "not in registry",
                            update_error: "Could not check for updates: {{error}}"
                        }
                    }
                }
            }
        });
        const pkg = {
            id: "iansherr/ikmal_tools_trilium",
            title: "Ikmal Tools for Trilium",
            version: "1.0.29",
            enabled: true,
            pinned: false,
            noteId: "package-note",
            artifactIds: ["manifest"],
            artifactNotes: [],
            health: "unknown" as const,
            healthMessage: "not in registry",
            settings: {}
        };
        expect(formatInstalledPackageDescription(pkg)).toContain("iansherr/ikmal_tools_trilium");
        expect(formatInstalledPackageDescription(pkg)).not.toContain("&#x2F;");

        const updateError = formatPluginUpdateError("https://raw.githubusercontent.com/iansherr/ikmal_tools_trilium/main/trilium-package.json is not a valid plugin manifest");
        expect(updateError).toContain("https://raw.githubusercontent.com/iansherr/ikmal_tools_trilium/main/trilium-package.json");
        expect(updateError).not.toContain("&#x2F;");
    });

    it("schedules update checks for registry or direct-manifest sources only when enabled", () => {
        expect(shouldScheduleUpdateChecks(true, true, ["https://example.com/registry.json"], [])).toBe(false);
        expect(shouldScheduleUpdateChecks(false, false, ["https://example.com/registry.json"], [])).toBe(false);
        expect(shouldScheduleUpdateChecks(false, true, [], [])).toBe(false);
        expect(shouldScheduleUpdateChecks(false, true, ["https://example.com/registry.json"], [])).toBe(true);
    });

    it("reports healthy, broken, and unknown package states", () => {
        expect(packageHealth(["manifest"], manifest)).toEqual({ health: "healthy", healthMessage: "all artifacts present" });
        expect(packageHealth([], manifest)).toEqual({ health: "broken", healthMessage: "missing manifest" });
        expect(packageHealth(["manifest"], undefined)).toEqual({ health: "unknown", healthMessage: "not in registry" });
    });

    it("compares compatible versions and detects updates", () => {
        const originalVersion = window.glob.triliumVersion;
        window.glob.triliumVersion = "0.104.1";
        try {
            expect(compareVersions("0.104.1", "0.104.1")).toBe(0);
            expect(compareVersions("0.105.0", "0.104.9")).toBe(1);
            expect(compareVersions("0.103.9", "0.104.0")).toBe(-1);
            expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(-1);
            expect(compareVersions("1.0.0", "1.0.0-beta")).toBe(1);
            expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
            expect(compareVersions("not-a-version", "0.104.0")).toBeNull();
            expect(isNewerVersion("1.1.0", "1.0.9")).toBe(true);
            expect(isNewerVersion("1.0.9", "1.1.0")).toBe(false);
            expect(isNewerVersion("1.0.0-beta.2", "1.0.0-beta.1")).toBe(true);
            expect(compatibilityStatus(manifest.compatibility)).toBe("compatible");
            expect(compatibilityStatus({ minTriliumVersion: "0.105.0" })).toContain("incompatible");
        } finally {
            window.glob.triliumVersion = originalVersion;
        }
    });

    it("formats manifest metadata for the details view", () => {
        expect(formatDependency(manifest.dependencies[0])).toBe("example/dependency >=1.0.0");
        expect(formatCompatibility(manifest.compatibility)).toBe("0.100.0 – 0.110.0");
        expect(manifestStatus({ ...manifest, securityStatus: "warning", maintenance: "slow", deprecated: true, deprecationMessage: "Use the replacement." })).toContain("Deprecated: Use the replacement.");
        expect(manifestStatus({ ...manifest, securityStatus: "warning", maintenance: "slow" })).toContain("Security review warning");
    });

    it("round-trips package settings using stable labels", () => {
        const booleanSetting = manifest.settings[0];
        const numberSetting = { key: "limit", type: "number" as const, title: "Limit" };
        expect(parseSettingValue("true", booleanSetting)).toBe(true);
        expect(parseSettingValue("42", numberSetting)).toBe(42);
        expect(parseSettingValue('"secret"', { key: "token", type: "secret", title: "Token" })).toBe("secret");
        expect(serializeSetting({ value: 42 })).toBe('{"value":42}');
        expect(settingLabelName("token")).toBe("packageSetting:token");
    });
});
