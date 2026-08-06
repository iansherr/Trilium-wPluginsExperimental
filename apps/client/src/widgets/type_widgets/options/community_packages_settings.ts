import type { PackageCatalogEntry } from "./registry.js";
import type { PackageInstallState, PackageManagerSettings } from "./settings.js";

export const PLUGINS_SETTINGS_TAB = {
    id: "plugins",
    title: "Plugins",
    icon: "bx bx-extension",
    order: 80
} as const;

export type PluginSettingsSection = "installed" | "available" | "updates" | "general";

export type PluginSettingsAction =
    | "install"
    | "update"
    | "enable"
    | "disable"
    | "configure"
    | "uninstall"
    | "check-for-updates";

export interface PluginSettingsTabModel {
    tab: typeof PLUGINS_SETTINGS_TAB;
    sections: PluginSettingsSection[];
    manager: PackageManagerSettings;
    installed: PackageInstallState[];
    available: PackageCatalogEntry[];
    updates: PackageCatalogEntry[];
}

/**
 * Stable UI boundary for the Trilium adapter. The adapter owns rendering and navigation;
 * this package owns the data shown by the Plugins tab.
 */
export function createPluginSettingsTabModel(
    manager: PackageManagerSettings,
    available: PackageCatalogEntry[]
): PluginSettingsTabModel {
    const installed = Object.values(manager.installed);
    const updates = available.filter((candidate) => {
        const current = manager.installed[candidate.id];
        return current && current.version !== candidate.version;
    });

    return {
        tab: PLUGINS_SETTINGS_TAB,
        sections: ["installed", "available", "updates", "general"],
        manager,
        installed,
        available,
        updates
    };
}
