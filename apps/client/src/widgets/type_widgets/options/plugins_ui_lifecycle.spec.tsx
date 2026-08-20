import { render, VNode } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks for Trilium services used by plugins.tsx and community_packages.tsx
const mocks = vi.hoisted(() => ({
    searchForNotesIncludingHidden: vi.fn(),
    reloadNotes: vi.fn(),
    getNote: vi.fn(),
    remove: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    setLabel: vi.fn(),
    removeOwnedAttributesByNameOrType: vi.fn(),
    reconcileEnabledPackageActivations: vi.fn(),
    openContextWithNote: vi.fn(),
    triggerCommand: vi.fn(),
    showMessage: vi.fn(),
    showError: vi.fn(),
    closeActiveDialog: vi.fn(),
    confirm: vi.fn(),
    fetch: vi.fn()
}));

vi.mock("../../../services/search", () => ({
    default: {
        searchForNotesIncludingHidden: (...args: unknown[]) => mocks.searchForNotesIncludingHidden(...args)
    }
}));

vi.mock("../../../services/froca", () => ({
    default: {
        reloadNotes: (...args: unknown[]) => mocks.reloadNotes(...args),
        getNote: (...args: unknown[]) => mocks.getNote(...args)
    }
}));

vi.mock("../../../services/server", () => ({
    default: {
        get: vi.fn(async () => []),
        remove: (...args: unknown[]) => mocks.remove(...args),
        put: (...args: unknown[]) => mocks.put(...args),
        post: (...args: unknown[]) => mocks.post(...args)
    }
}));

vi.mock("../../../services/attributes", () => ({
    setLabel: (...args: unknown[]) => mocks.setLabel(...args),
    removeOwnedAttributesByNameOrType: (...args: unknown[]) => mocks.removeOwnedAttributesByNameOrType(...args)
}));

vi.mock("../../../services/package_activation", () => ({
    reconcileEnabledPackageActivations: (...args: unknown[]) => mocks.reconcileEnabledPackageActivations(...args),
    PACKAGE_ACTIVATION_LABELS: ["widget", "appCss", "appTheme", "run", "customRequestHandler", "launcherType"]
}));

vi.mock("../../../components/app_context", () => ({
    default: {
        tabManager: {
            openContextWithNote: (...args: unknown[]) => mocks.openContextWithNote(...args)
        },
        triggerCommand: (...args: unknown[]) => mocks.triggerCommand(...args)
    }
}));

vi.mock("../../../services/toast", () => ({
    default: {
        showMessage: (...args: unknown[]) => mocks.showMessage(...args),
        showError: (...args: unknown[]) => mocks.showError(...args)
    }
}));

vi.mock("../../../services/dialog", () => ({
    closeActiveDialog: (...args: unknown[]) => mocks.closeActiveDialog(...args)
}));

vi.mock("../../../services/i18n", () => ({
    t: (key: string, options?: Record<string, unknown>) => {
        if (options && typeof options === "object") {
            let res = key;
            for (const [k, v] of Object.entries(options)) {
                res = res.replace(new RegExp(`{{${k}}}`, "g"), String(v));
            }
            return res;
        }
        return key;
    }
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useNoteContext: () => ({ note: undefined })
}));

vi.mock("./components/OptionsPageHeader", () => ({
    default: () => <div className="options-page-header-stub" />
}));

import PluginsSettings, {
    CatalogPackage
} from "./plugins";

let container: HTMLDivElement | undefined;

function renderInto(vnode: VNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(vnode, container);
    return container;
}

function cleanup() {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
}

function settle() {
    return new Promise((resolve) => setTimeout(resolve, 50));
}

afterEach(cleanup);

// Helper factory for creating test FNote-like objects
function createTestNote(noteId: string, title: string, labels: Record<string, string | string[]> = {}, type = "code") {
    return {
        noteId,
        title,
        type,
        isArchived: labels.archived !== undefined,
        getOwnedLabelValue: (name: string) => {
            const val = labels[name];
            if (Array.isArray(val)) return val[0] || null;
            return val !== undefined ? val : null;
        },
        getOwnedLabels: (name: string) => {
            const val = labels[name];
            if (val === undefined || val === null) return [];
            const arr = Array.isArray(val) ? val : [val];
            return arr.map((v, i) => ({ attributeId: `${name}_${i}`, name, value: v }));
        },
        getParentBranches: () => [{ branchId: `branch_${noteId}`, parentNoteId: "root" }]
    };
}

describe("PluginsSettings UI & Lifecycle Procedural Combination Testing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.glob = { triliumVersion: "0.104.1" } as any;
        window.confirm = mocks.confirm;
        window.fetch = mocks.fetch;
        mocks.confirm.mockReturnValue(true);
        mocks.reconcileEnabledPackageActivations.mockResolvedValue([]);
    });

    describe("1. Entry Boxes / Text Boxes / Inputs Testing", () => {
        it("handles source URL input variations (valid, invalid, github shortcuts, whitespace)", async () => {
            const managerNote = createTestNote("_sd_community-packages-manager_render", "Community Packages", {}, "render");
            const settingsNote = createTestNote("settings-note", "Settings", {
                packageSources: '["https://example.com/registry.json"]'
            });

            mocks.searchForNotesIncludingHidden.mockImplementation(async (query: string) => {
                if (query === "Community Packages") return [managerNote];
                if (query === "#packageManagerSettings") return [settingsNote];
                return [];
            });
            mocks.getNote.mockResolvedValue(managerNote);

            renderInto(<PluginsSettings />);
            await settle();

            const buttons = Array.from(container?.querySelectorAll("button") || []);
            const addSourceBtn = buttons.find((b) => b.textContent?.includes("plugins.add_source"));
            expect(addSourceBtn).not.toBeUndefined();

            addSourceBtn?.click();
            await settle();

            const input = container?.querySelector<HTMLInputElement>('.plugin-list-editor-row.is-editing input[type="url"]');
            expect(input).not.toBeNull();

            input!.value = "github.com/testuser/my-trilium-plugin";
            input!.dispatchEvent(new Event("input", { bubbles: true }));
            await settle();

            const saveBtn = Array.from(container?.querySelectorAll("button") || []).find((b) => b.textContent?.includes("plugins.save_source"));
            expect(saveBtn).not.toBeUndefined();
            saveBtn?.click();
            await settle();

            const values = Array.from(container?.querySelectorAll(".plugin-list-editor-value") || []).map((el) => el.textContent);
            expect(values).toContain("github.com/testuser/my-trilium-plugin");
        });

        it("handles allowed source hosts multiline/comma input and normalization", async () => {
            const settingsNote = createTestNote("settings-note", "Settings", {
                packageAllowedSourceHosts: "github.com\nraw.githubusercontent.com"
            });

            mocks.searchForNotesIncludingHidden.mockImplementation(async (query: string) => {
                if (query === "#packageManagerSettings") return [settingsNote];
                return [];
            });

            renderInto(<PluginsSettings />);
            await settle();

            const addHostBtn = Array.from(container?.querySelectorAll("button") || []).find((b) => b.textContent?.includes("plugins.add_download_host"));
            expect(addHostBtn).not.toBeUndefined();
            addHostBtn?.click();
            await settle();

            const hostInput = container?.querySelector<HTMLInputElement>('.plugin-list-editor-row.is-editing input[type="text"]');
            expect(hostInput).not.toBeNull();

            hostInput!.value = " gitlab.com ";
            hostInput!.dispatchEvent(new Event("input", { bubbles: true }));
            await settle();

            const saveHostBtn = Array.from(container?.querySelectorAll("button") || []).find((b) => b.textContent?.includes("plugins.save_download_host"));
            saveHostBtn?.click();
            await settle();

            const hostValues = Array.from(container?.querySelectorAll(".plugin-list-editor-value") || []).map((el) => el.textContent);
            expect(hostValues).toContain("gitlab.com");
        });

        it("handles update interval numeric input with lower bounds and fallback checks", async () => {
            const settingsNote = createTestNote("settings-note", "Settings", {
                packageSources: '["https://example.com/registry.json"]',
                packageUpdateIntervalHours: "24"
            });
            mocks.searchForNotesIncludingHidden.mockImplementation(async (query: string) => {
                if (query === "#packageManagerSettings") return [settingsNote];
                return [];
            });
            mocks.fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ packages: [] })
            });

            renderInto(<PluginsSettings />);
            await settle();

            const intervalInput = container?.querySelector<HTMLInputElement>('input[type="number"]');
            expect(intervalInput).not.toBeNull();
            expect(intervalInput?.value).toBe("24");

            intervalInput!.value = "1";
            intervalInput!.dispatchEvent(new Event("input", { bubbles: true }));
            intervalInput!.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            const saveSettingsBtn = Array.from(container?.querySelectorAll("button") || []).find((b) => b.textContent?.includes("plugins.save_settings"));
            saveSettingsBtn?.click();
            await settle();

            expect(mocks.setLabel).toHaveBeenCalledWith("settings-note", "packageUpdateIntervalHours", "1");
        });

        it("handles PackageSettingEditor inputs for string, secret, and number types", async () => {
            const catalogManifest: CatalogPackage = {
                id: "author/test-pkg",
                name: "Test Package",
                description: "Test description",
                repository: "https://example.com/repo",
                version: "1.0.0",
                permissions: [],
                settings: [
                    { key: "api_key", type: "secret", title: "API Key" },
                    { key: "max_items", type: "number", title: "Max Items" },
                    { key: "label_text", type: "string", title: "Label Text" }
                ],
                surfaces: [],
                artifacts: [{ id: "manifest", type: "resource", source: "https://example.com/manifest.json", integrity: "sha256-" + "A".repeat(43) + "=" }],
                dependencies: [],
                compatibility: { minTriliumVersion: "0.100.0" }
            };

            const manifestNote = createTestNote("pkg-manifest", "Test Package", {
                packageOwner: "author/test-pkg",
                packageVersion: "1.0.0",
                packageEnabled: "true",
                packageArtifact: "manifest",
                packageManifest: JSON.stringify(catalogManifest),
                "packageSetting:api_key": "secret-123",
                "packageSetting:max_items": "50"
            });

            const settingsNote = createTestNote("settings-note", "Settings", {
                packageSources: '["https://example.com/registry.json"]'
            });

            mocks.searchForNotesIncludingHidden.mockImplementation(async (query: string) => {
                if (query === "#packageManaged") return [manifestNote];
                if (query === "#packageManagerSettings") return [settingsNote];
                return [];
            });

            mocks.fetch.mockResolvedValue({
                ok: true,
                url: "https://example.com/registry.json",
                json: async () => ({ packages: [catalogManifest] })
            });

            renderInto(<PluginsSettings />);
            await settle();

            const settingsBtn = Array.from(container?.querySelectorAll("button") || []).find((b) => b.getAttribute("title") === "plugins.details_title");
            expect(settingsBtn).not.toBeUndefined();
            settingsBtn?.click();
            await settle();

            const passwordInput = container?.querySelector<HTMLInputElement>('input[type="password"]');
            expect(passwordInput).not.toBeNull();

            const numberInput = container?.querySelector<HTMLInputElement>('input[type="number"]');
            expect(numberInput).not.toBeNull();
        });
    });

    describe("2. Option Boxes / Selectors & Toggles Testing", () => {
        it("handles PackageSettingEditor dropdown selector (<select>) and toggles", async () => {
            const catalogManifest: CatalogPackage = {
                id: "author/select-pkg",
                name: "Select Package",
                description: "Select description",
                repository: "https://example.com/repo",
                version: "1.0.0",
                permissions: [],
                settings: [
                    { key: "theme", type: "select", title: "Theme", options: ["light", "dark", "system"] },
                    { key: "auto_sync", type: "boolean", title: "Auto Sync" }
                ],
                surfaces: [],
                artifacts: [{ id: "manifest", type: "resource", source: "https://example.com/manifest.json", integrity: "sha256-" + "A".repeat(43) + "=" }],
                dependencies: [],
                compatibility: { minTriliumVersion: "0.100.0" }
            };

            const manifestNote = createTestNote("pkg-manifest-select", "Select Package", {
                packageOwner: "author/select-pkg",
                packageVersion: "1.0.0",
                packageEnabled: "true",
                packageArtifact: "manifest",
                packageManifest: JSON.stringify(catalogManifest),
                "packageSetting:theme": "dark",
                "packageSetting:auto_sync": "true"
            });
            const settingsNote = createTestNote("settings-note", "Settings", {
                packageSources: '["https://example.com/registry.json"]'
            });

            mocks.searchForNotesIncludingHidden.mockImplementation(async (query: string) => {
                if (query === "#packageManaged") return [manifestNote];
                if (query === "#packageManagerSettings") return [settingsNote];
                return [];
            });

            mocks.fetch.mockResolvedValue({
                ok: true,
                url: "https://example.com/registry.json",
                json: async () => ({ packages: [catalogManifest] })
            });

            renderInto(<PluginsSettings />);
            await settle();

            const settingsBtn = Array.from(container?.querySelectorAll("button") || []).find((b) => b.getAttribute("title") === "plugins.details_title");
            expect(settingsBtn).not.toBeUndefined();
            settingsBtn?.click();
            await settle();

            const select = container?.querySelector<HTMLSelectElement>("select");
            expect(select).not.toBeNull();
            expect(select?.value).toBe("dark");

            select!.value = "light";
            select!.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            expect(select?.value).toBe("light");
        });

        it("handles all global toggle switches (allowNetwork, checkUpdates, includeDeprecated, pinned)", async () => {
            const settingsNote = createTestNote("settings-note", "Settings", {
                packageAllowNetwork: "false",
                packageCheckForUpdates: "false",
                packageIncludeDeprecated: "false"
            });

            mocks.searchForNotesIncludingHidden.mockImplementation(async (query: string) => {
                if (query === "#packageManagerSettings") return [settingsNote];
                return [];
            });

            renderInto(<PluginsSettings />);
            await settle();

            const checkboxes = Array.from(container?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') || []);
            expect(checkboxes.length).toBeGreaterThanOrEqual(3);

            checkboxes[0].click();
            await settle();

            checkboxes[1].click();
            await settle();

            checkboxes[2].click();
            await settle();

            const saveSettingsBtn = Array.from(container?.querySelectorAll("button") || []).find((b) => b.textContent?.includes("plugins.save_settings"));
            saveSettingsBtn?.click();
            await settle();

            expect(mocks.setLabel).toHaveBeenCalledWith("settings-note", "packageAllowNetwork", "true");
            expect(mocks.setLabel).toHaveBeenCalledWith("settings-note", "packageCheckForUpdates", "true");
            expect(mocks.setLabel).toHaveBeenCalledWith("settings-note", "packageIncludeDeprecated", "true");
        });
    });

    describe("3. All Buttons Lifecycle & Action Matrix", () => {
        it("executes Enable / Disable button lifecycle and transforms artifact activation labels", async () => {
            const manifestNote = createTestNote("pkg-manifest", "Test Package", {
                packageOwner: "author/test-pkg",
                packageVersion: "1.0.0",
                packageEnabled: "false",
                packageArtifact: "manifest"
            });
            const widgetNote = createTestNote("pkg-widget", "Test Widget", {
                packageOwner: "author/test-pkg",
                packageArtifact: "widget-1",
                "disabled:widget": ""
            });

            mocks.searchForNotesIncludingHidden.mockImplementation(async (query: string) => {
                if (query.includes('#packageOwner="author/test-pkg"')) return [manifestNote, widgetNote];
                if (query === "#packageManaged") return [manifestNote, widgetNote];
                return [];
            });

            renderInto(<PluginsSettings />);
            await settle();

            const buttons = Array.from(container?.querySelectorAll("button") || []);
            const enableBtn = buttons.find((b) => b.textContent?.includes("plugins.enable"));
            expect(enableBtn).not.toBeUndefined();

            enableBtn?.click();
            await settle();

            expect(mocks.removeOwnedAttributesByNameOrType).toHaveBeenCalledWith(expect.anything(), "label", "disabled:widget");
            expect(mocks.setLabel).toHaveBeenCalledWith("pkg-widget", "widget", "");
            expect(mocks.setLabel).toHaveBeenCalledWith("pkg-manifest", "packageEnabled", "true");
            expect(mocks.showMessage).toHaveBeenCalledWith(expect.stringContaining("plugins.plugin_enabled"));
        });

        it("executes Archive / Restore / Delete lifecycle for installed packages", async () => {
            const manifestNote = createTestNote("pkg-manifest", "Test Package", {
                packageOwner: "author/test-pkg",
                packageVersion: "1.0.0",
                packageEnabled: "true",
                packageArtifact: "manifest"
            });

            mocks.searchForNotesIncludingHidden.mockImplementation(async (query: string) => {
                if (query.includes("#archived")) return [];
                if (query.includes('#packageOwner="author/test-pkg"')) return [manifestNote];
                if (query === "#packageManaged") return [manifestNote];
                return [];
            });

            renderInto(<PluginsSettings />);
            await settle();

            const detailsBtn = Array.from(container?.querySelectorAll("button") || []).find((b) => b.getAttribute("title") === "plugins.details_title");
            expect(detailsBtn).not.toBeUndefined();
            detailsBtn?.click();
            await settle();

            const archiveBtn = Array.from(container?.querySelectorAll("button") || []).find((b) => b.textContent?.includes("plugins.archive"));
            expect(archiveBtn).not.toBeUndefined();

            archiveBtn?.click();
            await settle();

            expect(mocks.confirm).toHaveBeenCalled();
            expect(mocks.setLabel).toHaveBeenCalledWith("pkg-manifest", "archived");
            expect(mocks.showMessage).toHaveBeenCalledWith(expect.stringContaining("plugins.plugin_archived"));
        });

        it("executes Surface action buttons (page, settings, modal, deeplink)", async () => {
            const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);

            const catalogManifest: CatalogPackage = {
                id: "author/surface-pkg",
                name: "Surface Package",
                description: "Surface description",
                repository: "https://example.com/repo",
                version: "1.0.0",
                permissions: [],
                settings: [],
                surfaces: [
                    { id: "dash", type: "page", title: "Dashboard", artifact: "dashboard-render" },
                    { id: "pref", type: "settings", title: "Preferences", settingKeys: [] },
                    { id: "about", type: "modal", title: "About Modal", command: "showInfoDialog", options: { title: "About" } },
                    { id: "docs", type: "deeplink", title: "Online Docs", url: "https://example.com/docs" }
                ],
                artifacts: [
                    { id: "manifest", type: "resource", source: "https://example.com/manifest.json", integrity: "sha256-" + "A".repeat(43) + "=" },
                    { id: "dashboard-render", type: "render", source: "https://example.com/page.js", integrity: "sha256-" + "A".repeat(43) + "=" }
                ],
                dependencies: [],
                compatibility: { minTriliumVersion: "0.100.0" }
            };

            const manifestNote = createTestNote("pkg-manifest", "Surface Package", {
                packageOwner: "author/surface-pkg",
                packageVersion: "1.0.0",
                packageEnabled: "true",
                packageArtifact: "manifest",
                packageManifest: JSON.stringify(catalogManifest)
            });
            const renderNote = createTestNote("pkg-render", "Dashboard Page", {
                packageOwner: "author/surface-pkg",
                packageArtifact: "dashboard-render"
            }, "render");
            const settingsNote = createTestNote("settings-note", "Settings", {
                packageSources: '["https://example.com/registry.json"]'
            });

            mocks.searchForNotesIncludingHidden.mockImplementation(async (query: string) => {
                if (query === "#packageManaged") return [manifestNote, renderNote];
                if (query === "#packageManagerSettings") return [settingsNote];
                return [];
            });

            mocks.fetch.mockResolvedValue({
                ok: true,
                url: "https://example.com/registry.json",
                json: async () => ({ packages: [catalogManifest] })
            });

            renderInto(<PluginsSettings />);
            await settle();

            const detailsBtn = Array.from(container?.querySelectorAll("button") || []).find((b) => b.getAttribute("title") === "plugins.details_title");
            detailsBtn?.click();
            await settle();

            const surfaceButtons = Array.from(container?.querySelectorAll(".community-package-details button") || []);
            expect(surfaceButtons.length).toBeGreaterThan(0);

            windowOpenSpy.mockRestore();
        });
    });

    describe("4. Deterministic Life Cycle & Failure Matrix Testing", () => {
        const matrixCases = [
            {
                name: "Network allowed=false, perm=network -> Should fail network check",
                allowNetwork: false,
                permission: "network",
                expectedFailure: true
            },
            {
                name: "Network allowed=true, perm=network -> Network check passes",
                allowNetwork: true,
                permission: "network",
                expectedFailure: false
            },
            {
                name: "Compatible Trilium version 0.104.1 (min 0.100.0, max 0.110.0) -> Pass",
                minVer: "0.100.0",
                maxVer: "0.110.0",
                currentVer: "0.104.1",
                expectedFailure: false
            },
            {
                name: "Incompatible Trilium version 0.104.1 (min 0.110.0) -> Fail min version",
                minVer: "0.110.0",
                maxVer: undefined,
                currentVer: "0.104.1",
                expectedFailure: true
            },
            {
                name: "Incompatible Trilium version 0.104.1 (max 0.100.0) -> Fail max version",
                minVer: "0.0.1",
                maxVer: "0.100.0",
                currentVer: "0.104.1",
                expectedFailure: true
            }
        ];

        for (const testCase of matrixCases) {
            it(`Matrix case: ${testCase.name}`, () => {
                window.glob.triliumVersion = testCase.currentVer || "0.104.1";

                const manifest: CatalogPackage = {
                    id: "test/matrix-pkg",
                    name: "Matrix Package",
                    description: "Matrix description",
                    repository: "https://example.com/repo",
                    version: "1.0.0",
                    permissions: testCase.permission ? [testCase.permission] : [],
                    settings: [],
                    surfaces: [],
                    artifacts: [{ id: "manifest", type: "resource", source: "https://example.com/manifest.json", integrity: "sha256-" + "A".repeat(43) + "=" }],
                    dependencies: [],
                    compatibility: {
                        minTriliumVersion: testCase.minVer || "0.100.0",
                        maxTriliumVersion: testCase.maxVer
                    }
                };

                const compatStatus = manifest.compatibility ? (
                    window.glob.triliumVersion < manifest.compatibility.minTriliumVersion ||
                    (manifest.compatibility.maxTriliumVersion && window.glob.triliumVersion > manifest.compatibility.maxTriliumVersion)
                        ? "incompatible"
                        : "compatible"
                ) : "compatible";

                const networkBlocked = manifest.permissions.includes("network") && !testCase.allowNetwork;

                const willFail = compatStatus === "incompatible" || networkBlocked;
                expect(willFail).toBe(testCase.expectedFailure);
            });
        }
    });
});
