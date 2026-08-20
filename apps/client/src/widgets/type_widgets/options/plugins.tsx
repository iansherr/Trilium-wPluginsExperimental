import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import "./plugins.css";

import appContext from "../../../components/app_context";
import type FNote from "../../../entities/fnote";
import { removeOwnedAttributesByNameOrType, setLabel } from "../../../services/attributes";
import { closeActiveDialog } from "../../../services/dialog";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { reconcileEnabledPackageActivations } from "../../../services/package_activation";
import search from "../../../services/search";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { randomString } from "../../../services/utils";
import Button from "../../react/Button";
import Dropdown from "../../react/Dropdown";
import FormTextBox from "../../react/FormTextBox";
import { FormListItem } from "../../react/FormList";
import { useTriliumEvent } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import OptionsPageHeader from "./components/OptionsPageHeader";
import OptionsRow, { OptionsRowWithButton, OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";
import StateBadge from "./components/StateBadge";

const COMMUNITY_PACKAGES_MANAGER_NOTE_ID = "_sd_community-packages-manager_render";
const PACKAGE_PINNED_LABEL = "packagePinned";
const PACKAGE_ENABLED_LABEL = "packageEnabled";
const PACKAGE_MANIFEST_LABEL = "packageManifest";
const PACKAGE_ARTIFACT_LABEL = "packageArtifact";
const PACKAGE_ACTIVATION_LABELS = ["widget", "appCss", "appTheme", "run", "customRequestHandler", "launcherType"];
const PACKAGE_TRANSACTION_LABEL = "packageTransaction";
const PACKAGE_SOURCES_LABEL = "packageSources";
const PACKAGE_REGISTRY_URL_LABEL = "packageRegistryUrl";
const PACKAGE_REGISTRY_URLS_LABEL = "packageRegistryUrls";
const PACKAGE_DIRECT_MANIFEST_URLS_LABEL = "packageDirectManifestUrls";
const LEGACY_PACKAGE_SOURCE_LABELS = [
    PACKAGE_REGISTRY_URL_LABEL,
    PACKAGE_REGISTRY_URLS_LABEL,
    PACKAGE_DIRECT_MANIFEST_URLS_LABEL
];
const PACKAGE_CHECK_UPDATES_LABEL = "packageCheckForUpdates";
const PACKAGE_UPDATE_INTERVAL_LABEL = "packageUpdateIntervalHours";
const PACKAGE_ALLOWED_SOURCE_HOSTS_LABEL = "packageAllowedSourceHosts";
const PACKAGE_INCLUDE_DEPRECATED_LABEL = "packageIncludeDeprecated";
const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const PACKAGE_ARTIFACT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const PACKAGE_SETTING_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
const PACKAGE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PACKAGE_VERSION_RANGE_PATTERN = /^(?:[<>=~^]*\s*)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface PackageSummary {
    id: string;
    title: string;
    version: string;
    enabled: boolean;
    pinned: boolean;
    noteId: string;
    artifactIds: string[];
    artifactNotes: FNote[];
    health: "healthy" | "broken" | "unknown";
    healthMessage: string;
    settings: Record<string, unknown>;
    archived?: boolean;
    /** Manifest embedded by direct/local installers; usable without a catalog source. */
    cachedManifest?: CatalogPackage;
}

type PackageSettingType = "boolean" | "number" | "string" | "secret" | "select";

export interface PackageSettingDefinition {
    key: string;
    type: PackageSettingType;
    title: string;
    description?: string;
    default?: unknown;
    options?: string[];
}

export type PackageSurfaceType = "page" | "settings" | "modal" | "deeplink";

export interface PackageSurface {
    id: string;
    type: PackageSurfaceType;
    title: string;
    description?: string;
    icon?: string;
    artifact?: string;
    settingKeys?: string[];
    command?: string;
    options?: Record<string, unknown>;
    url?: string;
}

export interface PackageDependency {
    id: string;
    version: string;
    optional?: boolean;
}

export interface PackageCompatibility {
    minTriliumVersion: string;
    maxTriliumVersion?: string;
}

export interface PackageArtifact {
    id: string;
    type: "frontend" | "backend" | "widget" | "launcher" | "render" | "css" | "theme" | "endpoint" | "resource";
    source: string;
    integrity: string;
    title?: string;
    activation?: "manual" | "startup" | "launcher" | "event" | "schedule" | "request";
    route?: string;
    schedule?: "hourly" | "daily";
}

export interface CatalogPackage {
    id: string;
    name: string;
    description: string;
    version: string;
    repository?: string;
    permissions: string[];
    settings: PackageSettingDefinition[];
    surfaces: PackageSurface[];
    artifacts: PackageArtifact[];
    dependencies: PackageDependency[];
    compatibility: PackageCompatibility | null;
    author?: string;
    maintainer?: string;
    homepage?: string;
    license?: string;
    deprecated?: boolean;
    deprecationMessage?: string;
    maintenance?: "active" | "slow" | "unmaintained";
    securityStatus?: "unreviewed" | "reviewed" | "warning";
    lastValidatedAt?: string;
}

export interface RawCatalogPackage {
    id?: string;
    name?: string;
    description?: string;
    version?: string;
    repository?: string;
    permissions?: unknown;
    settings?: unknown;
    surfaces?: unknown;
    artifacts?: unknown;
    dependencies?: unknown;
    compatibility?: unknown;
    author?: string;
    maintainer?: string;
    homepage?: string;
    license?: string;
    deprecated?: boolean;
    deprecationMessage?: string;
    maintenance?: CatalogPackage["maintenance"];
    securityStatus?: CatalogPackage["securityStatus"];
    lastValidatedAt?: string;
}

interface PluginsState {
    manager: FNote | null;
    settings: FNote | null;
    packages: PackageSummary[];
    archivedPackages: PackageSummary[];
    catalog: CatalogPackage[];
    sources: string[];
    allowNetworkPackages: boolean;
    allowedSourceHosts: string[];
    checkForUpdates: boolean;
    updateCheckIntervalHours: number;
    includeDeprecatedPackages: boolean;
    interruptedTransactionCount: number;
    updateCount: number | null;
    registryError: string | null;
    loading: boolean;
    error: string | null;
}

const EMPTY_STATE: PluginsState = {
    manager: null,
    settings: null,
    packages: [],
    archivedPackages: [],
    catalog: [],
    sources: [],
    allowNetworkPackages: false,
    allowedSourceHosts: [],
    checkForUpdates: false,
    updateCheckIntervalHours: 24,
    includeDeprecatedPackages: false,
    interruptedTransactionCount: 0,
    updateCount: null,
    registryError: null,
    loading: true,
    error: null
};

export default function PluginsSettings() {
    const [state, setState] = useState<PluginsState>(EMPTY_STATE);
    const [savingSettings, setSavingSettings] = useState(false);
    const [savingPackage, setSavingPackage] = useState("");
    const [configuredPackage, setConfiguredPackage] = useState("");
    const [archivedExpanded, setArchivedExpanded] = useState(false);
    const [editingSourceIndex, setEditingSourceIndex] = useState<number | null>(null);
    const [sourceDraft, setSourceDraft] = useState("");
    const [editingHostIndex, setEditingHostIndex] = useState<number | null>(null);
    const [hostDraft, setHostDraft] = useState("");
    const refreshPromiseRef = useRef<Promise<void> | null>(null);

    const refresh = useCallback(async () => {
        if (refreshPromiseRef.current) return refreshPromiseRef.current;

        const refreshPromise = (async () => {
            try {
                // Re-check activation on every manager refresh. This catches labels changed by
                // another plugin, a manual edit, or a late entity reload after the one-shot startup
                // reconciliation. The reconciler only changes explicitly enabled packages and skips
                // transactions, so refreshing this page remains safe during package operations.
                try {
                    const repairs = await reconcileEnabledPackageActivations();
                    if (repairs.length) {
                        const repairedNoteCount = repairs.reduce((total, repair) => total + repair.repairedNoteIds.length, 0);
                        toast.showMessage(translateText("plugins.activation_repaired", { count: repairedNoteCount }));
                    }
                } catch (error) {
                    // Health display and manual repair remain available even if a refresh cannot
                    // write notes (for example while the server is reconnecting).
                    console.warn("Could not reconcile community package activation state during refresh:", error);
                }

                const [manager, packageNotes, archivedPackageNotes, transactionNotes] = await Promise.all([
                    findPackageManager(),
                    search.searchForNotesIncludingHidden("#packageManaged"),
                    search.searchForNotesIncludingHidden("#packageManaged #archived", true),
                    search.searchForNotesIncludingHidden(`#${PACKAGE_TRANSACTION_LABEL}`)
                ]);
                const settings = (await search.searchForNotesIncludingHidden("#packageManagerSettings"))[0] || null;
                const sources = parseConfiguredPluginSources((labelName) => settings?.getOwnedLabelValue(labelName));
                const allowNetworkPackages = settings?.getOwnedLabelValue("packageAllowNetwork") === "true";
                const allowedSourceHosts = parseSourceHosts(settings?.getOwnedLabelValue(PACKAGE_ALLOWED_SOURCE_HOSTS_LABEL) || "");
                const checkForUpdates = settings?.getOwnedLabelValue(PACKAGE_CHECK_UPDATES_LABEL) === "true";
                const updateCheckIntervalHours = Math.max(1, Number(settings?.getOwnedLabelValue(PACKAGE_UPDATE_INTERVAL_LABEL)) || 24);
                const includeDeprecatedPackages = settings?.getOwnedLabelValue(PACKAGE_INCLUDE_DEPRECATED_LABEL) === "true";
                const packages = buildPackageSummaries(packageNotes, false);
                const archivedPackages = buildPackageSummaries(archivedPackageNotes, true);

                const { catalog, updateCount, registryError } = await loadCatalog(sources, packages, includeDeprecatedPackages);
                const packagesWithSettings = packages.map((pkg) => {
                    const note = packageNotes.find((candidate) => candidate.noteId === pkg.noteId);
                    const manifest = catalog.find((candidate) => candidate.id === pkg.id) || pkg.cachedManifest;
                    return { ...pkg, ...combinedPackageHealth(pkg, manifest), settings: note && manifest ? readPackageSettings(note, manifest) : {} };
                });
                const archivedWithSettings = archivedPackages.map((pkg) => {
                    const note = archivedPackageNotes.find((candidate) => candidate.noteId === pkg.noteId);
                    const manifest = catalog.find((candidate) => candidate.id === pkg.id) || pkg.cachedManifest;
                    return { ...pkg, ...combinedPackageHealth(pkg, manifest), settings: note && manifest ? readPackageSettings(note, manifest) : {} };
                });
                const interruptedTransactionCount = new Set(transactionNotes
                    .filter((note) => !note.isArchived)
                    .map((note) => note.getOwnedLabelValue(PACKAGE_TRANSACTION_LABEL))
                    .filter(Boolean)).size;
                setState({ manager, settings, packages: packagesWithSettings, archivedPackages: archivedWithSettings, catalog, sources, allowNetworkPackages, allowedSourceHosts, checkForUpdates, updateCheckIntervalHours, includeDeprecatedPackages, interruptedTransactionCount, updateCount, registryError, loading: false, error: null });
            } catch (error) {
                setState({ ...EMPTY_STATE, loading: false, error: error instanceof Error ? error.message : String(error) });
            }
        })();

        refreshPromiseRef.current = refreshPromise;
        try {
            await refreshPromise;
        } finally {
            if (refreshPromiseRef.current === refreshPromise) refreshPromiseRef.current = null;
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useTriliumEvent("entitiesReloaded", useCallback(() => {
        void refresh();
    }, [refresh]));

    useEffect(() => {
        if (!shouldScheduleUpdateChecks(state.loading, state.checkForUpdates, state.sources)) return;
        const intervalHours = Math.max(1, state.updateCheckIntervalHours || 24);
        const timer = window.setInterval(() => void refresh(), intervalHours * 60 * 60 * 1000);
        return () => window.clearInterval(timer);
    }, [refresh, state.checkForUpdates, state.loading, state.sources, state.updateCheckIntervalHours]);

    async function openCatalog() {
        if (state.manager) {
            await appContext.tabManager.openContextWithNote(state.manager.noteId, { activate: true, hoistedNoteId: "root" });
            closeActiveDialog();
        }
    }

    async function openPackageArtifact(noteId: string) {
        await appContext.tabManager.openContextWithNote(noteId, { activate: true, hoistedNoteId: "root" });
        closeActiveDialog();
    }

    async function openPackageSurface(pkg: PackageSummary, surface: PackageSurface) {
        if (surface.type === "page") {
            const note = pkg.artifactNotes.find((candidate) => candidate.getOwnedLabelValue("packageArtifact") === surface.artifact && candidate.type === "render")
                || pkg.artifactNotes.find((candidate) => candidate.getOwnedLabelValue("packageArtifact") === surface.artifact);
            if (!note) {
                toast.showError(`The package page “${surface.title}” is not available.`);
                return;
            }
            await openPackageArtifact(note.noteId);
        } else if (surface.type === "settings") {
            setConfiguredPackage(pkg.id);
        } else if (surface.type === "modal" && surface.command) {
            closeActiveDialog();
            appContext.triggerCommand(surface.command as never, surface.options as never);
        } else if (surface.type === "deeplink" && surface.url) {
            window.open(surface.url, "_blank", "noopener,noreferrer");
        }
    }

    async function saveSettings() {
        if (!state.settings) {
            await openCatalog();
            return;
        }

        setSavingSettings(true);
        try {
            const sources = normalizePluginSources(state.sources);
            await setLabel(state.settings.noteId, PACKAGE_SOURCES_LABEL, JSON.stringify(sources));
            // Keep the legacy labels as a compatibility mirror. Older embedded
            // package managers do not understand packageSources, and deleting
            // these labels makes a newer Plugins screen silently disconnect an
            // older manager after the user saves settings.
            const legacySources = buildLegacyPluginSourceLabels(sources);
            await setLabel(state.settings.noteId, PACKAGE_REGISTRY_URL_LABEL, legacySources.packageRegistryUrl);
            await setLabel(state.settings.noteId, PACKAGE_REGISTRY_URLS_LABEL, legacySources.packageRegistryUrls);
            await setLabel(state.settings.noteId, PACKAGE_DIRECT_MANIFEST_URLS_LABEL, legacySources.packageDirectManifestUrls);
            await setLabel(state.settings.noteId, "packageAllowNetwork", state.allowNetworkPackages ? "true" : "false");
            await setLabel(state.settings.noteId, PACKAGE_ALLOWED_SOURCE_HOSTS_LABEL, normalizeSourceHosts(state.allowedSourceHosts.join("\n")));
            await setLabel(state.settings.noteId, PACKAGE_CHECK_UPDATES_LABEL, state.checkForUpdates ? "true" : "false");
            await setLabel(state.settings.noteId, PACKAGE_UPDATE_INTERVAL_LABEL, String(Math.max(1, state.updateCheckIntervalHours || 24)));
            await setLabel(state.settings.noteId, PACKAGE_INCLUDE_DEPRECATED_LABEL, state.includeDeprecatedPackages ? "true" : "false");
            await froca.reloadNotes([state.settings.noteId]);
            toast.showMessage(t("plugins.package_settings_saved"));
            await refresh();
        } catch (error) {
            toast.showError(error instanceof Error ? error.message : String(error));
        } finally {
            setSavingSettings(false);
        }
    }

    async function savePackageSettings(pkg: PackageSummary) {
        const manifest = state.catalog.find((candidate) => candidate.id === pkg.id);
        if (!manifest || !manifest.settings.length) return;

        setSavingPackage(pkg.id);
        try {
            for (const setting of manifest.settings) {
                await setLabel(pkg.noteId, settingLabelName(setting.key), serializeSetting(pkg.settings[setting.key]));
            }
            await froca.reloadNotes([pkg.noteId]);
            toast.showMessage(translateText("plugins.plugin_settings_saved", { title: pkg.title }));
            await refresh();
        } catch (error) {
            toast.showError(error instanceof Error ? error.message : String(error));
        } finally {
            setSavingPackage("");
        }
    }

    async function savePackagePin(pkg: PackageSummary, pinned: boolean) {
        setSavingPackage(pkg.id);
        try {
            await setLabel(pkg.noteId, PACKAGE_PINNED_LABEL, pinned ? "true" : "false");
            await froca.reloadNotes([pkg.noteId]);
            toast.showMessage(t(pinned ? "plugins.updates_pinned" : "plugins.updates_unpinned", { title: pkg.title }));
            await refresh();
        } catch (error) {
            toast.showError(error instanceof Error ? error.message : String(error));
        } finally {
            setSavingPackage("");
        }
    }

    async function setPackageEnabled(pkg: PackageSummary, enabled: boolean) {
        setSavingPackage(pkg.id);
        try {
            await setPackageArtifactActivation(pkg.id, enabled);
            await setLabel(pkg.noteId, PACKAGE_ENABLED_LABEL, enabled ? "true" : "false");
            toast.showMessage(t(enabled ? "plugins.plugin_enabled" : "plugins.plugin_disabled", { title: pkg.title }));
            await refresh();
        } catch (error) {
            toast.showError(error instanceof Error ? error.message : String(error));
        } finally {
            setSavingPackage("");
        }
    }

    async function setPackageArchived(pkg: PackageSummary, archived: boolean) {
        const action = archived ? t("plugins.archive") : t("plugins.restore");
        if (!window.confirm(translateText("plugins.lifecycle_confirm", { action, title: pkg.title }))) return;
        setSavingPackage(pkg.id);
        try {
            const notes = await search.searchForNotesIncludingHidden(`#packageOwner="${pkg.id}"${archived ? "" : " #archived"}`, !archived);
            const packageNotes = notes.filter((note) => !note.getOwnedLabelValue(PACKAGE_TRANSACTION_LABEL));
            if (!packageNotes.length) throw new Error(`No package-owned notes found for ${pkg.id}`);
            await setPackageArtifactActivation(pkg.id, false, packageNotes);
            for (const note of packageNotes) {
                if (archived) await setLabel(note.noteId, "archived");
                else await removeOwnedAttributesByNameOrType(note, "label", "archived");
                if (note.getOwnedLabelValue("packageArtifact") === "manifest") await setLabel(note.noteId, PACKAGE_ENABLED_LABEL, "false");
            }
            await froca.reloadNotes(packageNotes.map((note) => note.noteId));
            toast.showMessage(translateText(archived ? "plugins.plugin_archived" : "plugins.plugin_restored", { title: pkg.title }));
            await refresh();
        } catch (error) {
            toast.showError(error instanceof Error ? error.message : String(error));
        } finally {
            setSavingPackage("");
        }
    }

    async function deletePackageNotes(pkg: PackageSummary) {
        const [active, archived] = await Promise.all([
            search.searchForNotesIncludingHidden(`#packageOwner="${pkg.id}"`),
            search.searchForNotesIncludingHidden(`#packageOwner="${pkg.id}" #archived`, true)
        ]);
        const packageNotes = [...new Map([...active, ...archived].map((note) => [note.noteId, note])).values()]
            .filter((note) => !note.getOwnedLabelValue(PACKAGE_TRANSACTION_LABEL));
        const packageNoteIds = new Set(packageNotes.map((note) => note.noteId));
        const notes = packageNotes.filter((note) =>
            !note.getParentBranches().some((branch) => packageNoteIds.has(branch.parentNoteId))
        );
        const taskId = randomString(12);
        for (const [index, note] of notes.entries()) {
            await server.remove(`notes/${note.noteId}?taskId=${taskId}&eraseNotes=false&last=${index === notes.length - 1 ? "true" : "false"}`);
        }
    }

    async function deletePackage(pkg: PackageSummary) {
        if (!window.confirm(translateText("plugins.delete_plugin_confirm", { title: pkg.title }))) return;
        setSavingPackage(pkg.id);
        try {
            await deletePackageNotes(pkg);
            toast.showMessage(translateText("plugins.plugin_deleted", { title: pkg.title }));
            await refresh();
        } catch (error) {
            toast.showError(error instanceof Error ? error.message : String(error));
        } finally {
            setSavingPackage("");
        }
    }

    async function deleteArchivedPackages() {
        if (!state.archivedPackages.length) return;
        if (!window.confirm(translateText("plugins.delete_archived_confirm", { count: state.archivedPackages.length }))) return;
        setSavingPackage("__archived_cleanup__");
        try {
            for (const pkg of state.archivedPackages) await deletePackageNotes(pkg);
            toast.showMessage(translateText("plugins.archived_deleted", { count: state.archivedPackages.length }));
            await refresh();
        } catch (error) {
            toast.showError(error instanceof Error ? error.message : String(error));
        } finally {
            setSavingPackage("");
        }
    }

    async function setPackageArtifactActivation(packageId: string, enabled: boolean, knownNotes?: FNote[]) {
        const notes = knownNotes || await search.searchForNotesIncludingHidden(`#packageOwner="${packageId}"`);
        for (const note of notes) {
            for (const labelName of PACKAGE_ACTIVATION_LABELS) {
                const disabledName = `disabled:${labelName}`;
                const disabledValues = note.getOwnedLabels(disabledName).map((attribute) => attribute.value);
                const activeValues = note.getOwnedLabels(labelName).map((attribute) => attribute.value);
                if (enabled) {
                    await removeOwnedAttributesByNameOrType(note, "label", disabledName);
                    for (const value of disabledValues) await setLabel(note.noteId, labelName, value);
                } else {
                    await removeOwnedAttributesByNameOrType(note, "label", labelName);
                    for (const value of activeValues) await setLabel(note.noteId, disabledName, value);
                }
            }

            if (note.type === "launcher") await setLauncherVisibility(note, enabled);
        }
        await froca.reloadNotes(notes.map((note) => note.noteId));
    }

    async function setLauncherVisibility(note: FNote, enabled: boolean) {
        const targetParentNoteId = enabled ? "_lbVisibleLaunchers" : "_lbAvailableLaunchers";
        const sourceBranch = note.getParentBranches().find((branch) =>
            branch.parentNoteId === "_lbVisibleLaunchers" || branch.parentNoteId === "_lbAvailableLaunchers"
        );
        if (!sourceBranch || sourceBranch.parentNoteId === targetParentNoteId) return;

        const targetParent = await froca.getNote(targetParentNoteId, true);
        const targetBranch = targetParent?.getParentBranches()[0];
        if (!targetBranch) throw new Error(`Could not find the parent branch for ${targetParentNoteId}`);
        await server.put(`branches/${sourceBranch.branchId}/move-to/${targetBranch.branchId}`);
    }

    function updatePackageSetting(packageId: string, key: string, value: unknown) {
        setState((current) => ({
            ...current,
            packages: current.packages.map((pkg) => pkg.id === packageId
                ? { ...pkg, settings: { ...pkg.settings, [key]: value } }
                : pkg)
        }));
    }

    const installedPackageIds = new Set(state.packages.map((pkg) => pkg.id));
    const availablePackages = state.catalog.filter((pkg) => !installedPackageIds.has(pkg.id) && (!pkg.deprecated || state.includeDeprecatedPackages));

    return (
        <>
            <OptionsPageHeader />

            <OptionsSection
                title={t("plugins.updates_title")}
                description={t("plugins.updates_description")}
            >
                {state.registryError && <p role="alert">{formatPluginUpdateError(state.registryError)}</p>}
                {!state.loading && state.updateCount === null && !state.registryError && <p>{t("plugins.configure_source")}</p>}
                {!state.loading && state.updateCount === 0 && !state.registryError && <NoItems icon="bx bx-check" text={t("plugins.up_to_date")} />}
                {!state.loading && state.updateCount !== null && state.updateCount > 0 && (
                    <OptionsRowWithButton
                        label={translateText("plugins.updates_available", { count: state.updateCount })}
                        description={t("plugins.review_updates_description")}
                        buttonText={t("plugins.review_updates")}
                        onClick={() => void openCatalog()}
                    />
                )}
            </OptionsSection>

            <OptionsSection
                title={t("plugins.available_title")}
                description={t("plugins.available_description")}
            >
                {!state.loading && state.interruptedTransactionCount > 0 && (
                    <OptionsRowWithButton
                        label={t("plugins.incomplete_operation_label")}
                        description={translateText("plugins.incomplete_operation_description", { count: state.interruptedTransactionCount })}
                        icon="bx-error"
                        buttonText={t("plugins.open_recovery")}
                        buttonClassName="btn-warning"
                        onClick={() => void openCatalog()}
                    />
                )}
                {!state.loading && state.manager && availablePackages.length > 0 && (
                    <OptionsRowWithButton
                        label={translateText("plugins.available_count", { count: availablePackages.length })}
                        description={availablePackages.map((pkg) => pkg.name).join(", ")}
                        icon="bx-package"
                        buttonText={t("plugins.browse_available")}
                        buttonClassName="btn-primary"
                        onClick={() => void openCatalog()}
                    />
                )}
                {!state.loading && state.manager && availablePackages.length === 0 && (
                    <OptionsRowWithButton
                        label={t("plugins.catalog")}
                        description={t("plugins.catalog_description")}
                        icon="bx-package"
                        buttonText={t("plugins.browse_catalog")}
                        onClick={() => void openCatalog()}
                    />
                )}
                {!state.loading && !state.manager && !state.error && (
                    <p>{t("plugins.catalog_not_available")}</p>
                )}
            </OptionsSection>

            <OptionsSection
                title={t("plugins.installed_title")}
                description={t("plugins.installed_description")}
            >
                {state.error && <p role="alert">{translateText("plugins.load_error", { error: state.error })}</p>}
                {state.loading && <p>{t("plugins.loading")}</p>}
                {!state.loading && !state.packages.length && <NoItems icon="bx bx-package" text={t("plugins.no_installed")} />}
                {state.packages.map((pkg) => (
                    <div key={pkg.noteId}>
                        <OptionsRow name={`community-package-${pkg.noteId}`} label={<span style={{ display: "inline-flex", alignItems: "center", gap: "0.5em" }}><span>{pkg.title}</span><StateBadge enabled={pkg.enabled} /></span>} description={formatInstalledPackageDescription(pkg)}>
                            <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "0.4em" }}>
                                <Button
                                    text={pkg.enabled ? t("plugins.disable") : t("plugins.enable")}
                                    kind={pkg.enabled ? undefined : "primary"}
                                    size="micro"
                                    disabled={savingPackage === pkg.id}
                                    onClick={() => void setPackageEnabled(pkg, !pkg.enabled)}
                                />
                                <Button
                                    text={configuredPackage === pkg.id ? t("plugins.hide_settings") : t("plugins.settings_button")}
                                    icon="bx-cog"
                                    size="micro"
                                    disabled={savingPackage === pkg.id}
                                    onClick={() => setConfiguredPackage((current) => current === pkg.id ? "" : pkg.id)}
                                    title={t("plugins.details_title")}
                                />
                            </span>
                        </OptionsRow>
                        {configuredPackage === pkg.id && <InstalledPackageDetails
                            pkg={pkg}
                            manifest={state.catalog.find((candidate) => candidate.id === pkg.id) || pkg.cachedManifest}
                            onChange={(key, value) => updatePackageSetting(pkg.id, key, value)}
                            onSave={() => void savePackageSettings(pkg)}
                            onPinChange={(pinned) => void savePackagePin(pkg, pinned)}
                            onRepair={() => void openCatalog()}
                            onOpenArtifact={(noteId) => void openPackageArtifact(noteId)}
                            onArchive={() => void setPackageArchived(pkg, true)}
                            onDelete={() => void deletePackage(pkg)}
                            onOpenSurface={(surface) => void openPackageSurface(pkg, surface)}
                            disabled={savingPackage === pkg.id}
                        />}
                    </div>
                ))}
            </OptionsSection>

            {state.archivedPackages.length > 0 && <OptionsSection
                title={t("plugins.archived_title")}
                description={t("plugins.archived_description")}
                actions={<Button
                    text={archivedExpanded ? t("plugins.hide_archived") : translateText("plugins.show_archived", { count: state.archivedPackages.length })}
                    icon={archivedExpanded ? "bx-chevron-up" : "bx-chevron-down"}
                    size="small"
                    aria-expanded={archivedExpanded}
                    onClick={() => setArchivedExpanded((expanded) => !expanded)}
                    disabled={Boolean(savingPackage)}
                />}
            >
                {archivedExpanded && <>
                    <OptionsRowWithButton
                        label={t("plugins.cleanup_archived_label")}
                        description={t("plugins.cleanup_archived_description")}
                        buttonText={t("plugins.cleanup_archived")}
                        buttonClassName="btn-warning"
                        disabled={Boolean(savingPackage)}
                        onClick={() => void deleteArchivedPackages()}
                    />
                    {state.archivedPackages.map((pkg) => (
                        <OptionsRow
                            key={pkg.noteId}
                            name={`community-package-archived-${pkg.noteId}`}
                            label={pkg.title}
                            description={formatInstalledPackageDescription(pkg)}
                        >
                            <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "0.4em" }}>
                                <Button
                                    text={t("plugins.restore")}
                                    kind="primary"
                                    size="micro"
                                    disabled={Boolean(savingPackage)}
                                    onClick={() => void setPackageArchived(pkg, false)}
                                />
                                <Button
                                    text={t("plugins.delete_plugin")}
                                    size="micro"
                                    disabled={Boolean(savingPackage)}
                                    onClick={() => void deletePackage(pkg)}
                                />
                            </span>
                        </OptionsRow>
                    ))}
                </>}
            </OptionsSection>
            }

            <OptionsSection
                title={t("plugins.advanced_title")}
                description={t("plugins.advanced_description")}
            >
                {!state.loading && state.settings ? <>
                    <OptionsRow name="community-package-sources" label={t("plugins.sources_label")} description={t("plugins.sources_description")} stacked>
                        <EditablePluginList
                            values={state.sources}
                            editingIndex={editingSourceIndex}
                            draftValue={sourceDraft}
                            inputType="url"
                            inputPlaceholder={t("plugins.sources_placeholder")}
                            rowLabel={(index) => t("plugins.source_row_label", { number: index + 1 })}
                            addLabel={t("plugins.add_source")}
                            editLabel={t("plugins.edit_source")}
                            deleteLabel={t("plugins.delete_source")}
                            saveLabel={t("plugins.save_source")}
                            cancelLabel={t("plugins.cancel_source")}
                            menuLabel={t("plugins.source_actions")}
                            onAdd={() => {
                                if (editingSourceIndex !== null) return;
                                setState((current) => ({ ...current, sources: [...current.sources, ""] }));
                                setEditingSourceIndex(state.sources.length);
                                setSourceDraft("");
                            }}
                            onEdit={(index) => {
                                setEditingSourceIndex(index);
                                setSourceDraft(state.sources[index] || "");
                            }}
                            onDelete={(index) => {
                                setState((current) => ({ ...current, sources: current.sources.filter((_, currentIndex) => currentIndex !== index) }));
                                setEditingSourceIndex(null);
                                setSourceDraft("");
                            }}
                            onDraftChange={setSourceDraft}
                            onSave={() => {
                                if (editingSourceIndex === null) return;
                                const index = editingSourceIndex;
                                const value = sourceDraft.trim();
                                if (!value) {
                                    setState((current) => ({ ...current, sources: current.sources.filter((_, currentIndex) => currentIndex !== index) }));
                                } else {
                                    setState((current) => ({ ...current, sources: current.sources.map((source, currentIndex) => currentIndex === index ? value : source) }));
                                }
                                setEditingSourceIndex(null);
                                setSourceDraft("");
                            }}
                            onCancel={() => {
                                if (editingSourceIndex !== null && !state.sources[editingSourceIndex]) {
                                    setState((current) => ({ ...current, sources: current.sources.filter((_, currentIndex) => currentIndex !== editingSourceIndex) }));
                                }
                                setEditingSourceIndex(null);
                                setSourceDraft("");
                            }}
                        />
                    </OptionsRow>
                    <OptionsRow name="community-package-source-hosts" label={t("plugins.download_hosts_label")} description={t("plugins.download_hosts_description")} stacked>
                        <EditablePluginList
                            values={state.allowedSourceHosts}
                            editingIndex={editingHostIndex}
                            draftValue={hostDraft}
                            inputType="text"
                            inputPlaceholder={t("plugins.download_hosts_placeholder")}
                            rowLabel={(index) => t("plugins.download_host_row_label", { number: index + 1 })}
                            addLabel={t("plugins.add_download_host")}
                            editLabel={t("plugins.edit_download_host")}
                            deleteLabel={t("plugins.delete_download_host")}
                            saveLabel={t("plugins.save_download_host")}
                            cancelLabel={t("plugins.cancel_download_host")}
                            menuLabel={t("plugins.download_host_actions")}
                            onAdd={() => {
                                if (editingHostIndex !== null) return;
                                setState((current) => ({ ...current, allowedSourceHosts: [...current.allowedSourceHosts, ""] }));
                                setEditingHostIndex(state.allowedSourceHosts.length);
                                setHostDraft("");
                            }}
                            onEdit={(index) => {
                                setEditingHostIndex(index);
                                setHostDraft(state.allowedSourceHosts[index] || "");
                            }}
                            onDelete={(index) => {
                                setState((current) => ({ ...current, allowedSourceHosts: current.allowedSourceHosts.filter((_, currentIndex) => currentIndex !== index) }));
                                setEditingHostIndex(null);
                                setHostDraft("");
                            }}
                            onDraftChange={setHostDraft}
                            onSave={() => {
                                if (editingHostIndex === null) return;
                                const index = editingHostIndex;
                                const value = hostDraft.trim();
                                if (!value) {
                                    setState((current) => ({ ...current, allowedSourceHosts: current.allowedSourceHosts.filter((_, currentIndex) => currentIndex !== index) }));
                                } else {
                                    setState((current) => ({ ...current, allowedSourceHosts: current.allowedSourceHosts.map((host, currentIndex) => currentIndex === index ? value : host) }));
                                }
                                setEditingHostIndex(null);
                                setHostDraft("");
                            }}
                            onCancel={() => {
                                if (editingHostIndex !== null && !state.allowedSourceHosts[editingHostIndex]) {
                                    setState((current) => ({ ...current, allowedSourceHosts: current.allowedSourceHosts.filter((_, currentIndex) => currentIndex !== editingHostIndex) }));
                                }
                                setEditingHostIndex(null);
                                setHostDraft("");
                            }}
                        />
                    </OptionsRow>
                    <OptionsRowWithToggle
                        name="community-package-network"
                        label={t("plugins.network_label")}
                        description={t("plugins.network_description")}
                        currentValue={state.allowNetworkPackages}
                        onChange={(value) => setState((current) => ({ ...current, allowNetworkPackages: value }))}
                    />
                    <OptionsRowWithToggle
                        name="community-package-check-updates"
                        label={t("plugins.check_updates_label")}
                        description={t("plugins.check_updates_description")}
                        currentValue={state.checkForUpdates}
                        onChange={(value) => setState((current) => ({ ...current, checkForUpdates: value }))}
                    />
                    <OptionsRowWithToggle
                        name="community-package-include-deprecated"
                        label={t("plugins.include_deprecated_label")}
                        description={t("plugins.include_deprecated_description")}
                        currentValue={state.includeDeprecatedPackages}
                        onChange={(value) => setState((current) => ({ ...current, includeDeprecatedPackages: value }))}
                    />
                    <OptionsRow name="community-package-update-interval" label={t("plugins.interval_label")} description={t("plugins.interval_description")}>
                        <FormTextBox
                            type="number"
                            currentValue={String(state.updateCheckIntervalHours)}
                            onChange={(value) => setState((current) => ({ ...current, updateCheckIntervalHours: Math.max(1, Number(value) || 24) }))}
                        />
                    </OptionsRow>
                    <OptionsRowWithButton
                        label={t("plugins.save_advanced_label")}
                        description={t("plugins.save_advanced_description")}
                        buttonText={t("plugins.save_settings")}
                        disabled={savingSettings || editingSourceIndex !== null || editingHostIndex !== null}
                        onClick={() => void saveSettings()}
                    />
                </> : !state.loading && <p>{t("plugins.initialize_advanced")}</p>}
            </OptionsSection>
        </>
    );
}

interface EditablePluginListProps {
    values: string[];
    editingIndex: number | null;
    draftValue: string;
    inputType: "url" | "text";
    inputPlaceholder: string;
    rowLabel: (index: number) => string;
    addLabel: string;
    editLabel: string;
    deleteLabel: string;
    saveLabel: string;
    cancelLabel: string;
    menuLabel: string;
    onAdd: () => void;
    onEdit: (index: number) => void;
    onDelete: (index: number) => void;
    onDraftChange: (value: string) => void;
    onSave: () => void;
    onCancel: () => void;
}

function EditablePluginList({ values, editingIndex, draftValue, inputType, inputPlaceholder, rowLabel, addLabel, editLabel, deleteLabel, saveLabel, cancelLabel, menuLabel, onAdd, onEdit, onDelete, onDraftChange, onSave, onCancel }: EditablePluginListProps) {
    return (
        <div className="plugin-list-editor">
            {values.map((value, index) => editingIndex === index ? (
                <div key={index} className="plugin-list-editor-row is-editing">
                    <FormTextBox
                        type={inputType}
                        currentValue={draftValue}
                        placeholder={inputPlaceholder}
                        aria-label={rowLabel(index)}
                        style={{ flex: 1 }}
                        onChange={onDraftChange}
                        onBlur={(nextValue) => onDraftChange(nextValue.trim())}
                    />
                    <Button text={saveLabel} icon="bx-check" size="micro" onClick={onSave} />
                    <Button text="" icon="bx-x" size="micro" title={cancelLabel} aria-label={cancelLabel} onClick={onCancel} />
                </div>
            ) : (
                <div key={index} className="plugin-list-editor-row">
                    <span aria-label={rowLabel(index)} className="plugin-list-editor-value">{value || "—"}</span>
                    <Dropdown
                        className="plugin-list-editor-actions"
                        iconAction
                        buttonClassName="bx bx-dots-vertical-rounded"
                        hideToggleArrow
                        noDropdownListStyle
                        portalToBody
                        title={menuLabel}
                        buttonProps={{ "aria-label": menuLabel }}
                    >
                        <FormListItem icon="bx bx-edit" onClick={() => onEdit(index)}>{editLabel}</FormListItem>
                        <FormListItem icon="bx bx-trash" onClick={() => onDelete(index)}>{deleteLabel}</FormListItem>
                    </Dropdown>
                </div>
            ))}
            <Button text={addLabel} icon="bx-plus" size="small" disabled={editingIndex !== null} onClick={onAdd} />
        </div>
    );
}

function buildPackageSummaries(notes: FNote[], archived: boolean): PackageSummary[] {
    const artifactIdsByPackage = new Map<string, string[]>();
    const artifactNotesByPackage = new Map<string, FNote[]>();
    notes
        .filter((note) => note.isArchived === archived && !note.getOwnedLabelValue(PACKAGE_TRANSACTION_LABEL))
        .forEach((note) => {
            const packageId = note.getOwnedLabelValue("packageOwner");
            const artifactId = note.getOwnedLabelValue("packageArtifact");
            if (!packageId || !artifactId) return;
            const artifactIds = artifactIdsByPackage.get(packageId) || [];
            if (!artifactIds.includes(artifactId)) artifactIds.push(artifactId);
            artifactIdsByPackage.set(packageId, artifactIds);
            const artifactNotes = artifactNotesByPackage.get(packageId) || [];
            artifactNotes.push(note);
            artifactNotesByPackage.set(packageId, artifactNotes);
        });

    return notes
        .filter((note) => note.getOwnedLabelValue("packageArtifact") === "manifest" && note.isArchived === archived && !note.getOwnedLabelValue(PACKAGE_TRANSACTION_LABEL))
        .map((note) => {
            const packageId = note.getOwnedLabelValue("packageOwner") || note.noteId;
            return {
                id: packageId,
                title: note.title,
                version: note.getOwnedLabelValue("packageVersion") || "unknown",
                enabled: note.getOwnedLabelValue(PACKAGE_ENABLED_LABEL) === "true",
                pinned: note.getOwnedLabelValue(PACKAGE_PINNED_LABEL) === "true",
                noteId: note.noteId,
                artifactIds: artifactIdsByPackage.get(packageId) || [],
                artifactNotes: artifactNotesByPackage.get(packageId) || [],
                health: "unknown" as const,
                healthMessage: "not checked",
                settings: {},
                archived,
                cachedManifest: parseCachedPackageManifest(note.getOwnedLabelValue(PACKAGE_MANIFEST_LABEL))
            };
        })
        .sort((left, right) => left.title.localeCompare(right.title));
}

async function findPackageManager() {
    const deployedManager = await froca.getNote(COMMUNITY_PACKAGES_MANAGER_NOTE_ID, true);
    if (deployedManager?.type === "render") {
        return deployedManager;
    }

    const candidates = await search.searchForNotesIncludingHidden("Community Packages");
    return candidates.find((note) => note.type === "render" && note.title === "Community Packages") || null;
}

export function packageHealth(artifactIds: string[], manifest?: CatalogPackage) {
    if (!manifest) return { health: "unknown" as const, healthMessage: "not in registry" };
    const expected = [...new Set(["manifest", ...manifest.artifacts.map((artifact) => artifact.id)])];
    const missing = expected.filter((artifactId) => !artifactIds.includes(artifactId));
    return missing.length
        ? { health: "broken" as const, healthMessage: `missing ${missing.join(", ")}` }
        : { health: "healthy" as const, healthMessage: "all artifacts present" };
}

function combinedPackageHealth(pkg: PackageSummary, manifest?: CatalogPackage) {
    const artifactHealth = packageHealth(pkg.artifactIds, manifest);
    const activationHealth = packageActivationHealth(pkg.artifactNotes, pkg.enabled, manifest);
    return activationHealth.health === "broken" ? activationHealth : artifactHealth;
}

export function packageActivationHealth(artifactNotes: FNote[], enabled: boolean, manifest?: CatalogPackage) {
    if (!manifest) return { health: "unknown" as const, healthMessage: "not in registry" };

    const issues: string[] = [];
    const notesByArtifact = new Map(artifactNotes.map((note) => [note.getOwnedLabelValue(PACKAGE_ARTIFACT_LABEL), note]));
    for (const artifact of manifest.artifacts) {
        const note = notesByArtifact.get(artifact.id);
        if (!note) continue;

        for (const [labelName, expectedValue] of expectedActivationLabels(artifact)) {
            const active = note.getOwnedLabels(labelName).some((attribute) => attribute.value === expectedValue);
            const disabled = note.getOwnedLabels(`disabled:${labelName}`).some((attribute) => attribute.value === expectedValue);
            if (enabled && (!active || disabled)) issues.push(`${artifact.id}:${labelName}`);
            if (!enabled && active) issues.push(`${artifact.id}:${labelName}`);
        }
    }

    return issues.length
        ? { health: "broken" as const, healthMessage: `activation mismatch: ${issues.slice(0, 6).join(", ")}` }
        : { health: "healthy" as const, healthMessage: "all artifacts active" };
}

function expectedActivationLabels(artifact: PackageArtifact) {
    const labels: Array<[string, string]> = [];
    if (artifact.type === "widget") labels.push(["widget", ""]);
    if (artifact.type === "launcher") labels.push(["launcherType", "customWidget"]);
    if (artifact.type === "css") labels.push(["appCss", ""]);
    if (artifact.type === "theme") labels.push(["appTheme", artifact.title || "community"]);
    if (artifact.activation === "startup") labels.push(["run", artifact.type === "backend" ? "backendStartup" : "frontendStartup"]);
    if (artifact.activation === "schedule" && artifact.schedule) labels.push(["run", artifact.schedule]);
    if (artifact.activation === "request" && artifact.route) labels.push(["customRequestHandler", artifact.route]);
    return labels;
}

async function loadCatalog(sources: string[], packages: PackageSummary[], includeDeprecatedPackages: boolean) {
    const configuredSources = normalizePluginSources(sources);
    const cachedCatalog = packages
        .map((pkg) => pkg.cachedManifest)
        .filter((manifest): manifest is CatalogPackage => Boolean(manifest));
    if (!configuredSources.length) {
        return { catalog: cachedCatalog, updateCount: null, registryError: null };
    }

    const sourceResults = configuredSources.map(async (source): Promise<RawCatalogPackage[]> => {
        let resolvedSource: string;
        try {
            resolvedSource = normalizePluginSourceUrl(source);
        } catch {
            throw new Error(`${source} is not a permitted plugin source URL (use HTTPS or a localhost HTTP URL)`);
        }
        if (!isSecurePackageUrl(resolvedSource)) throw new Error(`${source} is not a permitted plugin source URL`);
        const response = await fetch(resolvedSource);
        if (!response.ok) throw new Error(`${source} returned HTTP ${response.status}`);
        if (!isSecurePackageUrl(response.url || resolvedSource)) throw new Error(`${source} redirected to a non-permitted URL`);
        const payload = await response.json() as { packages?: RawCatalogPackage[] } | RawCatalogPackage;
        if ("packages" in payload && Array.isArray(payload.packages)) return payload.packages;
        if (isCatalogPackageEntry(payload as RawCatalogPackage)) return [payload as RawCatalogPackage];
        throw new Error(`${source} is neither a plugin registry nor a valid plugin manifest`);
    });
    const results = await Promise.allSettled(sourceResults);
    const indexes = results
        .filter((result): result is PromiseFulfilledResult<RawCatalogPackage[]> => result.status === "fulfilled")
        .map((result) => result.value);
    const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
    if (!indexes.length) {
        return { catalog: cachedCatalog, updateCount: null, registryError: failures.join("; ") || "No plugin sources could be loaded." };
    }

    const seen = new Set<string>();
    const catalogFromSources = indexes.flat()
        .filter(isCatalogPackageEntry)
        .filter((entry) => {
            if (seen.has(entry.id!)) return false;
            seen.add(entry.id!);
            return true;
        })
        .map(normalizeCatalogPackage);
    const catalogIds = new Set(catalogFromSources.map((entry) => entry.id));
    const catalog = [
        ...catalogFromSources,
        ...cachedCatalog.filter((entry) => !catalogIds.has(entry.id))
    ];
    const versions = new Map(catalog.map((entry) => [entry.id, entry.version]));
    const updateCount = packages.filter((pkg) => {
        if (pkg.pinned) return false;
        const candidate = versions.get(pkg.id);
        const manifest = catalog.find((entry) => entry.id === pkg.id);
        if (manifest?.deprecated && !includeDeprecatedPackages) return false;
        return candidate && manifest?.compatibility && compatibilityStatus(manifest.compatibility) === "compatible"
            ? isNewerVersion(candidate, pkg.version)
            : false;
    }).length;
    return { catalog, updateCount, registryError: failures.length ? `Some plugin sources could not be loaded: ${failures.join("; ")}` : null };
}

const MAX_CACHED_MANIFEST_LENGTH = 256 * 1024;

export function parseCachedPackageManifest(value: string | null | undefined): CatalogPackage | undefined {
    if (!value || value.length > MAX_CACHED_MANIFEST_LENGTH) return undefined;
    try {
        const manifest = JSON.parse(value) as RawCatalogPackage;
        return isCatalogPackageEntry(manifest) ? normalizeCatalogPackage(manifest) : undefined;
    } catch {
        return undefined;
    }
}

function normalizeCatalogPackage(entry: RawCatalogPackage): CatalogPackage {
    return {
        id: entry.id!,
        name: entry.name!,
        description: entry.description || "",
        version: entry.version!,
        permissions: Array.isArray(entry.permissions) ? entry.permissions.filter((permission): permission is string => typeof permission === "string") : [],
        settings: Array.isArray(entry.settings) ? entry.settings.filter(isPackageSettingDefinition) : [],
        surfaces: Array.isArray(entry.surfaces) ? entry.surfaces.filter(isPackageSurface) : [],
        artifacts: Array.isArray(entry.artifacts) ? entry.artifacts.filter(isPackageArtifact) : [],
        dependencies: Array.isArray(entry.dependencies) ? entry.dependencies.filter(isPackageDependency) : [],
        compatibility: isPackageCompatibility(entry.compatibility) ? entry.compatibility : null,
        author: entry.author,
        maintainer: entry.maintainer,
        homepage: entry.homepage,
        license: entry.license,
        deprecated: entry.deprecated,
        deprecationMessage: entry.deprecationMessage,
        maintenance: entry.maintenance,
        securityStatus: entry.securityStatus,
        lastValidatedAt: entry.lastValidatedAt
    };
}

export function parseRegistryUrls(value: string | null | undefined) {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.filter((url): url is string => typeof url === "string" && Boolean(url.trim())).map((url) => url.trim());
    } catch {
        // Legacy and hand-edited values are accepted as newline-separated URLs.
    }
    return value.split(/[\r\n]+/).map((url) => url.trim()).filter(Boolean);
}

export function normalizePluginSources(sources: string[]) {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
        const trimmedSource = source.trim();
        if (!trimmedSource) continue;
        let identity = trimmedSource;
        try {
            identity = normalizePluginSourceUrl(trimmedSource);
        } catch {
            // Preserve invalid values so the UI can report the exact entry.
        }
        if (seen.has(identity)) continue;
        seen.add(identity);
        result.push(trimmedSource);
    }
    return result;
}

export function buildLegacyPluginSourceLabels(sources: string[]) {
    const normalizedSources = normalizePluginSources(sources).map((source) => {
        try {
            return normalizePluginSourceUrl(source);
        } catch {
            return source;
        }
    });
    const serializedSources = JSON.stringify(normalizedSources);
    return {
        // The singular label is still used by the oldest package manager.
        packageRegistryUrl: normalizedSources[0] || "",
        packageRegistryUrls: serializedSources,
        packageDirectManifestUrls: serializedSources
    };
}

export function parseConfiguredPluginSources(getLabelValue: (labelName: string) => string | null | undefined) {
    return normalizePluginSources([
        ...parseRegistryUrls(getLabelValue(PACKAGE_SOURCES_LABEL)),
        ...LEGACY_PACKAGE_SOURCE_LABELS.flatMap((labelName) => parseRegistryUrls(getLabelValue(labelName)))
    ]);
}

export function parseSourceHosts(value: string | null | undefined) {
    return value
        ? [...new Set(value.split(/[\s,]+/).map((host) => host.trim()).filter(Boolean))]
        : [];
}

export function normalizeSourceHosts(value: string) {
    return parseSourceHosts(value).join("\n");
}

export function shouldScheduleUpdateChecks(loading: boolean, checkForUpdates: boolean, sources: string[], directManifestUrls: string[] = []) {
    return !loading && checkForUpdates && (Boolean(sources.length) || Boolean(directManifestUrls.length));
}

function translateText(key: string, values: Record<string, unknown>) {
    // Values are rendered as React text nodes, where React performs the escaping.
    // i18next's default HTML escaping would otherwise leak entities such as
    // "&#x2F;" into the visible UI for package IDs and URLs.
    return t(key, { ...values, interpolation: { escapeValue: false } });
}

export function formatInstalledPackageDescription(pkg: PackageSummary) {
    return translateText("plugins.installed_summary", {
        id: pkg.id,
        version: pkg.version,
        state: t(pkg.enabled ? "plugins.enabled" : "plugins.disabled"),
        pinned: pkg.pinned ? ` · ${t("plugins.pinned")}` : "",
        health: t(`plugins.health_${pkg.health}`),
        healthMessage: pkg.healthMessage ? ` (${formatHealthMessage(pkg.healthMessage)})` : ""
    });
}

export function formatPluginUpdateError(error: string) {
    return translateText("plugins.update_error", { error });
}

function formatHealthMessage(message: string) {
    if (message === "all artifacts present") return t("plugins.health_all_artifacts");
    if (message === "not checked") return t("plugins.health_not_checked");
    if (message === "not in registry") return t("plugins.health_not_in_registry");
    if (message.startsWith("missing ")) return translateText("plugins.health_missing", { artifacts: message.slice("missing ".length) });
    if (message.startsWith("activation mismatch: ")) return translateText("plugins.health_activation", { artifacts: message.slice("activation mismatch: ".length) });
    return message;
}

function InstalledPackageDetails({ pkg, manifest, onChange, onSave, onPinChange, onRepair, onOpenArtifact, onArchive, onDelete, onOpenSurface, disabled }: { pkg: PackageSummary; manifest?: CatalogPackage; onChange: (key: string, value: unknown) => void; onSave: () => void; onPinChange: (pinned: boolean) => void; onRepair: () => void; onOpenArtifact: (noteId: string) => void; onArchive: () => void; onDelete: () => void; onOpenSurface: (surface: PackageSurface) => void; disabled: boolean }) {
    return (
        <div className="community-package-details options-section-card">
            <h5>{t("plugins.settings_panel_heading")}</h5>
            <p className="options-section-description">{t("plugins.settings_panel_description")}</p>
            <OptionsRow name={`community-package-health-${pkg.noteId}`} label={t("plugins.health_label")} description={t("plugins.health_description")}>
                <span>{t(`plugins.health_${pkg.health}`)}{pkg.healthMessage ? ` (${formatHealthMessage(pkg.healthMessage)})` : ""}</span>
            </OptionsRow>
            {pkg.health === "broken" && <OptionsRowWithButton
                label={t("plugins.repair_label")}
                description={t("plugins.repair_description")}
                buttonText={t("plugins.open_repair")}
                buttonClassName="btn-primary"
                disabled={disabled}
                onClick={onRepair}
            />}
            {manifest ? <>
                {manifest.surfaces.length > 0 && <OptionsRow name={`community-package-surfaces-${pkg.noteId}`} label={t("plugins.entry_points_label")} description={t("plugins.entry_points_description")} stacked>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5em" }}>
                        {manifest.surfaces.map((surface) => <div key={surface.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75em" }}>
                            <span><strong>{surface.title}</strong>{surface.description && <><br /><small>{surface.description}</small></>}</span>
                            <Button text={surface.type === "settings" ? t("plugins.open_settings") : t("plugins.open_entry_point")} icon={surface.icon} size="micro" onClick={() => onOpenSurface(surface)} disabled={disabled} />
                        </div>)}
                    </div>
                </OptionsRow>}
                {pkg.artifactNotes.filter((note) => note.type === "render").length > 0 && <OptionsRow name={`community-package-pages-${pkg.noteId}`} label="Open package pages" description="Open a package dashboard or standalone render page in a Trilium tab.">
                    <div className="community-package-page-links">
                        {pkg.artifactNotes.filter((note) => note.type === "render").map((note) => <Button key={note.noteId} text={note.title} size="micro" onClick={() => onOpenArtifact(note.noteId)} />)}
                    </div>
                </OptionsRow>}
                <OptionsRow name={`community-package-maintenance-${pkg.noteId}`} label={t("plugins.registry_status_label")} description={t("plugins.registry_status_description")}>
                    <span>{[manifestStatus(manifest), manifest.maintainer && translateText("plugins.maintainer", { maintainer: manifest.maintainer }), manifest.license && translateText("plugins.license", { license: manifest.license })].filter(Boolean).join(" · ") || t("plugins.no_registry_metadata")}</span>
                </OptionsRow>
                <OptionsRow name={`community-package-permissions-${pkg.noteId}`} label={t("plugins.permissions_label")} description={t("plugins.permissions_description")}>
                    <span>{manifest.permissions.length ? manifest.permissions.join(", ") : t("plugins.none_declared")}</span>
                </OptionsRow>
                <OptionsRow name={`community-package-dependencies-${pkg.noteId}`} label={t("plugins.dependencies_label")} description={t("plugins.dependencies_description")}>
                    <span>{manifest.dependencies.length ? manifest.dependencies.map(formatDependency).join(", ") : t("plugins.none_declared")}</span>
                </OptionsRow>
                {manifest.compatibility && <OptionsRow name={`community-package-compatibility-${pkg.noteId}`} label={t("plugins.compatibility_label")} description={t("plugins.compatibility_description")}>
                    <span>{formatCompatibility(manifest.compatibility)} · {compatibilityStatus(manifest.compatibility)}</span>
                </OptionsRow>}
                {manifest.surfaces.filter((surface) => surface.type === "settings").map((surface) => <OptionsRow key={surface.id} name={`community-package-surface-settings-${pkg.noteId}-${surface.id}`} label={surface.title} description={surface.description} stacked>
                    <div>
                        {surface.settingKeys?.map((key) => manifest.settings.find((setting) => setting.key === key)).filter(Boolean).map((setting) => <PackageSettingEditor
                            key={setting!.key}
                            packageId={pkg.id}
                            setting={setting!}
                            value={pkg.settings[setting!.key]}
                            onChange={(value) => onChange(setting!.key, value)}
                            disabled={disabled}
                        />)}
                    </div>
                </OptionsRow>)}
                {manifest.settings.filter((setting) => !manifest.surfaces.some((surface) => surface.type === "settings" && surface.settingKeys?.includes(setting.key))).map((setting) => <PackageSettingEditor
                    key={setting.key}
                    packageId={pkg.id}
                    setting={setting}
                    value={pkg.settings[setting.key]}
                    onChange={(value) => onChange(setting.key, value)}
                    disabled={disabled}
                />)}
                {manifest.settings.length > 0 && <OptionsRowWithButton
                    label={t("plugins.package_settings_label")}
                    description={t("plugins.package_settings_description")}
                    buttonText={t("plugins.save_package_settings")}
                    disabled={disabled}
                    onClick={onSave}
                />}
            </> : <p className="text-muted">{t("plugins.manifest_unavailable")}</p>}
            <OptionsRowWithToggle
                name={`community-package-pinned-${pkg.noteId}`}
                label={t("plugins.pin_label")}
                description={t("plugins.pin_description")}
                currentValue={pkg.pinned}
                onChange={onPinChange}
                disabled={disabled}
            />
            <OptionsRowWithButton
                label={t("plugins.archive_label")}
                description={t("plugins.archive_description")}
                buttonText={t("plugins.archive")}
                disabled={disabled}
                onClick={onArchive}
            />
            <OptionsRowWithButton
                label={t("plugins.delete_plugin")}
                description={t("plugins.delete_plugin_description")}
                buttonText={t("plugins.delete_plugin")}
                disabled={disabled}
                onClick={onDelete}
            />
        </div>
    );
}

function PackageSettingEditor({ packageId, setting, value, onChange, disabled }: { packageId: string; setting: PackageSettingDefinition; value: unknown; onChange: (value: unknown) => void; disabled: boolean }) {
    const name = `community-package-${packageId}-${setting.key}`;
    if (setting.type === "boolean") {
        return <OptionsRowWithToggle name={name} label={setting.title} description={setting.description} currentValue={Boolean(value)} onChange={onChange} disabled={disabled} />;
    }
    if (setting.type === "select") {
        return (
            <OptionsRow name={name} label={setting.title} description={setting.description}>
                <select value={String(value ?? "")} onChange={(event) => onChange(event.currentTarget.value)} disabled={disabled}>
                    {(setting.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
            </OptionsRow>
        );
    }
    return (
        <OptionsRow name={name} label={setting.title} description={setting.description}>
            <FormTextBox
                type={setting.type === "secret" ? "password" : setting.type === "number" ? "number" : "text"}
                currentValue={value === undefined || value === null ? "" : String(value)}
                onChange={(newValue) => onChange(setting.type === "number" ? Number(newValue) : newValue)}
                disabled={disabled}
            />
        </OptionsRow>
    );
}

export function isPackageSettingDefinition(value: unknown): value is PackageSettingDefinition {
    if (!value || typeof value !== "object") return false;
    const setting = value as Partial<PackageSettingDefinition>;
    return typeof setting.key === "string"
        && PACKAGE_SETTING_KEY_PATTERN.test(setting.key)
        && typeof setting.title === "string"
        && ["boolean", "number", "string", "secret", "select"].includes(setting.type || "")
        && (setting.options === undefined || (Array.isArray(setting.options) && setting.options.every((option) => typeof option === "string")));
}

export function isPackageDependency(value: unknown): value is PackageDependency {
    if (!value || typeof value !== "object") return false;
    const dependency = value as Partial<PackageDependency>;
    return typeof dependency.id === "string"
        && PACKAGE_ID_PATTERN.test(dependency.id)
        && typeof dependency.version === "string"
        && PACKAGE_VERSION_RANGE_PATTERN.test(dependency.version);
}

const PACKAGE_MODAL_COMMANDS = new Set(["showInfoDialog", "showConfirmDialog", "showPromptDialog", "showImportDialog", "showExportDialog"]);

export function isPackageSurface(value: unknown): value is PackageSurface {
    if (!value || typeof value !== "object") return false;
    const surface = value as Partial<PackageSurface>;
    if (typeof surface.id !== "string" || !PACKAGE_ARTIFACT_ID_PATTERN.test(surface.id)
        || typeof surface.title !== "string" || !surface.title.trim()
        || !["page", "settings", "modal", "deeplink"].includes(surface.type || "")) return false;
    if (surface.type === "page") return typeof surface.artifact === "string" && PACKAGE_ARTIFACT_ID_PATTERN.test(surface.artifact);
    if (surface.type === "settings") return Array.isArray(surface.settingKeys) && surface.settingKeys.length > 0 && surface.settingKeys.every((key) => typeof key === "string" && PACKAGE_SETTING_KEY_PATTERN.test(key));
    if (surface.type === "modal") return typeof surface.command === "string" && PACKAGE_MODAL_COMMANDS.has(surface.command)
        && (surface.options === undefined || (!!surface.options && typeof surface.options === "object" && !Array.isArray(surface.options)));
    return typeof surface.url === "string" && isSafePackageSurfaceUrl(surface.url);
}

function isSafePackageSurfaceUrl(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) || url.protocol === "trilium:" || url.protocol === "trilium-next:";
    } catch {
        return false;
    }
}

export function isPackageArtifact(value: unknown): value is PackageArtifact {
    if (!value || typeof value !== "object") return false;
    const artifact = value as Partial<PackageArtifact>;
    return typeof artifact.id === "string"
        && PACKAGE_ARTIFACT_ID_PATTERN.test(artifact.id)
        && typeof artifact.type === "string"
        && typeof artifact.source === "string"
        && (isSecurePackageUrl(artifact.source) || isRelativePackageSource(artifact.source))
        && typeof artifact.integrity === "string"
        && /^sha256-[A-Za-z0-9+/]{43}=$/.test(artifact.integrity);
}

export function isCatalogPackageEntry(value: RawCatalogPackage): value is RawCatalogPackage & Required<Pick<RawCatalogPackage, "id" | "name" | "version" | "description" | "repository" | "artifacts">> {
    return Boolean(
        value
        && typeof value.id === "string"
        && PACKAGE_ID_PATTERN.test(value.id)
        && typeof value.name === "string"
        && typeof value.version === "string"
        && PACKAGE_VERSION_PATTERN.test(value.version)
        && typeof value.description === "string"
        && typeof value.repository === "string"
        && isSecurePackageUrl(value.repository)
        && isPackageCompatibility(value.compatibility)
        && Array.isArray(value.artifacts)
        && value.artifacts.length > 0
        && value.artifacts.every(isPackageArtifact)
    );
}

export function isSecurePackageUrl(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname));
    } catch {
        return false;
    }
}

export function isRelativePackageSource(value: string) {
    if (!value || value.startsWith("/") || value.startsWith("\\") || value.startsWith("//")) return false;
    const segments = value.replaceAll("\\", "/").split("/");
    if (segments.includes("..")) return false;
    try {
        const resolved = new URL(value, "https://plugin-source.invalid/");
        return resolved.origin === "https://plugin-source.invalid";
    } catch {
        return false;
    }
}

export function normalizePluginSourceUrl(source: string) {
    const trimmedSource = source.trim();
    const normalizedInput = /^(?:www\.)?github\.com\//i.test(trimmedSource)
        ? `https://${trimmedSource}`
        : /^(?:www\.)?raw\.githubusercontent\.com\//i.test(trimmedSource)
            ? `https://${trimmedSource}`
            : trimmedSource;
    const parsed = new URL(normalizedInput);
    if (parsed.hostname.toLowerCase().replace(/^www\./, "") !== "github.com") return normalizedInput;

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return normalizedInput;
    const owner = segments[0];
    const repository = segments[1].replace(/\.git$/, "");
    if (!owner || !repository) return normalizedInput;

    if (segments[2] === "blob" && segments[3] && segments.length > 4) {
        return `https://raw.githubusercontent.com/${owner}/${repository}/${segments[3]}/${segments.slice(4).join("/")}`;
    }
    if (segments[2] === "tree" && segments[3]) {
        const path = segments.slice(4).join("/");
        return `https://raw.githubusercontent.com/${owner}/${repository}/${segments[3]}/${path ? `${path}/` : ""}trilium-package.json`;
    }
    return `https://raw.githubusercontent.com/${owner}/${repository}/main/trilium-package.json`;
}

export function isPackageCompatibility(value: unknown): value is PackageCompatibility {
    if (!value || typeof value !== "object") return false;
    const compatibility = value as Partial<PackageCompatibility>;
    return typeof compatibility.minTriliumVersion === "string"
        && PACKAGE_VERSION_PATTERN.test(compatibility.minTriliumVersion)
        && (compatibility.maxTriliumVersion === undefined || PACKAGE_VERSION_PATTERN.test(compatibility.maxTriliumVersion))
        && (!compatibility.maxTriliumVersion
            || (compareVersions(compatibility.minTriliumVersion, compatibility.maxTriliumVersion) ?? -1) <= 0);
}

export function formatDependency(dependency: PackageDependency) {
    return `${dependency.id} ${dependency.version}${dependency.optional ? " (optional)" : ""}`;
}

export function formatCompatibility(compatibility: PackageCompatibility) {
    return compatibility.maxTriliumVersion
        ? `${compatibility.minTriliumVersion} – ${compatibility.maxTriliumVersion}`
        : `${compatibility.minTriliumVersion}+`;
}

export function compatibilityStatus(compatibility: PackageCompatibility) {
    const currentVersion = window.glob.triliumVersion;
    const minimumComparison = compareVersions(currentVersion, compatibility.minTriliumVersion);
    if (minimumComparison === null || !currentVersion) return "compatibility unknown";
    if (minimumComparison < 0) return `incompatible with ${currentVersion}`;
    if (compatibility.maxTriliumVersion) {
        const maximumComparison = compareVersions(currentVersion, compatibility.maxTriliumVersion);
        if (maximumComparison === null) return "compatibility unknown";
        if (maximumComparison > 0) return `incompatible with ${currentVersion}`;
    }
    return "compatible";
}

export function manifestStatus(manifest: CatalogPackage) {
    const status: string[] = [];
    if (manifest.deprecated) status.push(`Deprecated${manifest.deprecationMessage ? `: ${manifest.deprecationMessage}` : ""}`);
    if (manifest.maintenance && manifest.maintenance !== "active") status.push(`Maintenance: ${manifest.maintenance}`);
    if (manifest.securityStatus === "warning") status.push("Security review warning");
    else if (manifest.securityStatus === "unreviewed") status.push("Security: unreviewed");
    if (manifest.lastValidatedAt) status.push(`Validated ${manifest.lastValidatedAt.slice(0, 10)}`);
    return status.join(" · ");
}

function readPackageSettings(note: FNote, manifest: CatalogPackage) {
    return Object.fromEntries(manifest.settings.map((setting) => {
        const stored = note.getOwnedLabelValue(settingLabelName(setting.key));
        return [setting.key, stored === null ? setting.default : parseSettingValue(stored, setting)];
    }));
}

export function parseSettingValue(value: string, setting: PackageSettingDefinition) {
    try {
        return JSON.parse(value);
    } catch {
        if (setting.type === "boolean") return value === "true";
        if (setting.type === "number") return Number(value);
        return value;
    }
}

export function serializeSetting(value: unknown) {
    return value === undefined ? "" : JSON.stringify(value);
}

export function settingLabelName(key: string) {
    return `packageSetting:${key}`;
}

export function isNewerVersion(candidate: string, installed: string) {
    return compareVersions(candidate, installed) === 1;
}

export function compareVersions(left: string, right: string) {
    const leftParts = parseVersion(left);
    const rightParts = parseVersion(right);
    if (!leftParts || !rightParts) return null;
    for (let index = 0; index < 3; index++) {
        if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
    }
    return comparePrerelease(leftParts[3], rightParts[3]);
}

type ParsedVersion = [number, number, number, string[]];

function parseVersion(version: string): ParsedVersion | null {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    if (!match) return null;
    const core = match.slice(1, 4).map(Number);
    if (core.some((part) => !Number.isInteger(part) || part < 0)) return null;
    const prerelease = match[4] ? match[4].split(".") : [];
    if (prerelease.some((identifier) => !identifier || !/^[0-9A-Za-z-]+$/.test(identifier))) return null;
    return [core[0], core[1], core[2], prerelease];
}

function comparePrerelease(left: string[], right: string[]) {
    if (!left.length && !right.length) return 0;
    if (!left.length) return 1;
    if (!right.length) return -1;
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
        if (left[index] === undefined) return -1;
        if (right[index] === undefined) return 1;
        const leftNumeric = /^\d+$/.test(left[index]);
        const rightNumeric = /^\d+$/.test(right[index]);
        if (leftNumeric && rightNumeric) {
            const leftNumber = left[index].replace(/^0+/, "") || "0";
            const rightNumber = right[index].replace(/^0+/, "") || "0";
            if (leftNumber.length !== rightNumber.length) return leftNumber.length > rightNumber.length ? 1 : -1;
            if (leftNumber !== rightNumber) return leftNumber > rightNumber ? 1 : -1;
        } else if (leftNumeric !== rightNumeric) {
            return leftNumeric ? -1 : 1;
        } else if (left[index] !== right[index]) {
            return left[index] > right[index] ? 1 : -1;
        }
    }
    return 0;
}
