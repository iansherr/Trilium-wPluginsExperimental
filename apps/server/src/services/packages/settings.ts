import type { PackageManifest } from "./package-manifest.js";

export interface PackageInstallState {
    packageId: string;
    version: string;
    enabled: boolean;
    pinned: boolean;
    installedAt: string;
    updatedAt: string;
    settings: Record<string, unknown>;
    grantedPermissions: string[];
    health: "unknown" | "healthy" | "warning" | "broken";
    healthMessage?: string;
}

export interface PackageManagerSettings {
    enabled: boolean;
    registryUrls: string[];
    checkForUpdates: boolean;
    updateCheckIntervalHours: number;
    includeBetaPackages: boolean;
    includeDeprecatedPackages: boolean;
    allowNetworkPackages: boolean;
    allowedSourceHosts: string[];
    installed: Record<string, PackageInstallState>;
}

export const DEFAULT_PACKAGE_MANAGER_SETTINGS: PackageManagerSettings = {
    enabled: true,
    registryUrls: [],
    checkForUpdates: false,
    updateCheckIntervalHours: 24,
    includeBetaPackages: false,
    includeDeprecatedPackages: false,
    allowNetworkPackages: false,
    allowedSourceHosts: [],
    installed: {}
};

export function defaultPackageSettings(manifest: PackageManifest): Record<string, unknown> {
    return Object.fromEntries((manifest.settings ?? []).map((setting) => [setting.key, setting.default]));
}

export function mergePackageSettings(
    manifest: PackageManifest,
    current: Record<string, unknown> | undefined
): Record<string, unknown> {
    return { ...defaultPackageSettings(manifest), ...(current ?? {}) };
}

export function canInstall(manifest: PackageManifest, settings: PackageManagerSettings): string[] {
    const errors: string[] = [];
    if (!settings.enabled) errors.push("package manager is disabled");
    if ((manifest.permissions ?? []).includes("network") && !settings.allowNetworkPackages) {
        errors.push("package requests network access, which is disabled in package settings");
    }
    return errors;
}

export function serializeManagerSettings(settings: PackageManagerSettings): string {
    return JSON.stringify(settings, null, 2);
}

export function parseManagerSettings(content: string): PackageManagerSettings {
    try {
        const parsed = JSON.parse(content) as Partial<PackageManagerSettings>;
        return {
            ...DEFAULT_PACKAGE_MANAGER_SETTINGS,
            ...parsed,
            registryUrls: Array.isArray(parsed.registryUrls)
                ? parsed.registryUrls.filter((url): url is string => typeof url === "string")
                : DEFAULT_PACKAGE_MANAGER_SETTINGS.registryUrls,
            allowedSourceHosts: Array.isArray(parsed.allowedSourceHosts)
                ? parsed.allowedSourceHosts.filter((host): host is string => typeof host === "string")
                : DEFAULT_PACKAGE_MANAGER_SETTINGS.allowedSourceHosts,
            includeDeprecatedPackages: parsed.includeDeprecatedPackages === true,
            installed: parsed.installed && typeof parsed.installed === "object"
                ? Object.fromEntries(Object.entries(parsed.installed).map(([id, state]) => [id, { ...state, pinned: state.pinned === true }]))
                : {}
        };
    } catch {
        return structuredClone(DEFAULT_PACKAGE_MANAGER_SETTINGS);
    }
}

export function createInstallState(
    manifest: PackageManifest,
    grantedPermissions: string[],
    now = new Date().toISOString()
): PackageInstallState {
    return {
        packageId: manifest.id,
        version: manifest.version,
        enabled: false,
        pinned: false,
        installedAt: now,
        updatedAt: now,
        settings: defaultPackageSettings(manifest),
        grantedPermissions: [ ...new Set(grantedPermissions) ],
        health: "unknown"
    };
}

export function setPackageEnabled(
    settings: PackageManagerSettings,
    packageId: string,
    enabled: boolean
): PackageManagerSettings {
    const current = settings.installed[packageId];
    if (!current) return settings;
    return {
        ...settings,
        installed: {
            ...settings.installed,
            [packageId]: { ...current, enabled }
        }
    };
}

export function setPackagePinned(
    settings: PackageManagerSettings,
    packageId: string,
    pinned: boolean
): PackageManagerSettings {
    const current = settings.installed[packageId];
    if (!current) return settings;
    return {
        ...settings,
        installed: {
            ...settings.installed,
            [packageId]: { ...current, pinned }
        }
    };
}

export function removePackage(
    settings: PackageManagerSettings,
    packageId: string
): PackageManagerSettings {
    const installed = { ...settings.installed };
    delete installed[packageId];
    return { ...settings, installed };
}
