// @ts-nocheck
/**
 * @trilium-script
 *
 * id: community-packages-manager
 * type: render
 * title: Community Packages
 */

declare const api: any;
declare const window: any;

import { showMessage, triggerCommand } from "trilium:api";
import { Admonition, Button, LoadingSpinner, useEffect, useState } from "trilium:preact";

const SOURCES_LABEL = "packageSources";
const LEGACY_REGISTRY_URL_LABEL = "packageRegistryUrl";
const LEGACY_REGISTRY_URLS_LABEL = "packageRegistryUrls";
const LEGACY_DIRECT_MANIFEST_URLS_LABEL = "packageDirectManifestUrls";
const ROOT_LABEL = "communityPackagesRoot";
const SETTINGS_LABEL = "packageManagerSettings";
const MANAGED_LABEL = "packageManaged";
const OWNER_LABEL = "packageOwner";
const VERSION_LABEL = "packageVersion";
const ARTIFACT_LABEL = "packageArtifact";
const ENABLED_LABEL = "packageEnabled";
const PINNED_LABEL = "packagePinned";
const TRANSACTION_LABEL = "packageTransaction";
const INTEGRITY_LABEL = "packageIntegrity";
const MIGRATION_TRANSACTION_LABEL = "packageMigrationTransaction";
const MIGRATION_FROM_OWNER_LABEL = "packageMigrationFromOwner";
const MIGRATION_FROM_ARTIFACT_LABEL = "packageMigrationFromArtifact";
const MIGRATION_FROM_VERSION_LABEL = "packageMigrationFromVersion";
const MIGRATION_FROM_INTEGRITY_LABEL = "packageMigrationFromIntegrity";
const MIGRATION_TO_OWNER_LABEL = "packageMigrationToOwner";
const MIGRATION_TO_ARTIFACT_LABEL = "packageMigrationToArtifact";
const MIGRATION_TO_VERSION_LABEL = "packageMigrationToVersion";
const MIGRATION_FROM_PARENT_LABEL = "packageMigrationFromParent";
const MIGRATION_TO_PARENT_LABEL = "packageMigrationToParent";
const CONFIG_BACKUP_LABEL = "packageConfigBackup";
const CONFIG_BACKUP_VERSION_LABEL = "packageBackupVersion";
const CONFIG_BACKUP_CREATED_AT_LABEL = "packageBackupCreatedAt";
const CONFIG_BACKUP_RETENTION = 5;
const CONFIG_BACKUP_SCHEMA_VERSION = 1;
const MIGRATION_LABELS = [
    MIGRATION_TRANSACTION_LABEL,
    MIGRATION_FROM_OWNER_LABEL,
    MIGRATION_FROM_ARTIFACT_LABEL,
    MIGRATION_FROM_VERSION_LABEL,
    MIGRATION_FROM_INTEGRITY_LABEL,
    MIGRATION_TO_OWNER_LABEL,
    MIGRATION_TO_ARTIFACT_LABEL,
    MIGRATION_TO_VERSION_LABEL,
    MIGRATION_FROM_PARENT_LABEL,
    MIGRATION_TO_PARENT_LABEL
];
const CHECK_UPDATES_LABEL = "packageCheckForUpdates";
const UPDATE_INTERVAL_LABEL = "packageUpdateIntervalHours";
const ALLOWED_SOURCE_HOSTS_LABEL = "packageAllowedSourceHosts";
const INCLUDE_DEPRECATED_LABEL = "packageIncludeDeprecated";
const ACTIVATION_LABELS = ["widget", "appCss", "appTheme", "run", "customRequestHandler", "launcherType"];
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const MAX_REGISTRY_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
let packageOperationActive = false;
let packageOperationToken = "";
let packageOperationRenewalTimer = 0;
let packageOperationLeaseLost = false;

async function beginPackageOperation(setError) {
    if (packageOperationActive) {
        setError("Another package operation is already in progress. Wait for it to finish before trying again.");
        return false;
    }
    try {
        const response = await packageRequest("POST", "package-operation-lock", { action: "acquire", name: "community-packages" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Could not acquire the package operation lock (${response.status})`);
        packageOperationToken = result.token;
        if (!packageOperationToken) throw new Error("The server returned an invalid package operation lock");
        packageOperationActive = true;
        packageOperationLeaseLost = false;
        packageOperationRenewalTimer = window.setInterval(() => {
            void renewPackageOperation(setError);
        }, 60_000);
        return true;
    } catch (cause) {
        setError(errorMessage(cause));
        return false;
    }
}

async function renewPackageOperation(setError) {
    if (!packageOperationToken) return;
    try {
        const response = await packageRequest("POST", "package-operation-lock", { action: "renew", name: "community-packages", token: packageOperationToken });
        if (!response.ok) throw new Error(`The package operation lock could not be renewed (${response.status})`);
    } catch (cause) {
        packageOperationLeaseLost = true;
        setError(`${errorMessage(cause)} The current operation will finish conservatively, but another operation may proceed after the lease expires.`);
    }
}

async function endPackageOperation() {
    if (packageOperationRenewalTimer) window.clearInterval(packageOperationRenewalTimer);
    packageOperationRenewalTimer = 0;
    const token = packageOperationToken;
    packageOperationToken = "";
    packageOperationActive = false;
    if (!token || packageOperationLeaseLost) {
        packageOperationLeaseLost = false;
        return;
    }
    try {
        await packageRequest("POST", "package-operation-lock", { action: "release", name: "community-packages", token });
    } catch {
        // Lease expiry and transaction recovery protect against a failed release request.
    }
    packageOperationLeaseLost = false;
}

export default function CommunityPackages() {
    const [sources, setSources] = useState([]);
    const [allowNetworkPackages, setAllowNetworkPackages] = useState(false);
    const [allowedSourceHosts, setAllowedSourceHosts] = useState("");
    const [checkForUpdates, setCheckForUpdates] = useState(false);
    const [updateCheckIntervalHours, setUpdateCheckIntervalHours] = useState(24);
    const [includeDeprecatedPackages, setIncludeDeprecatedPackages] = useState(false);
    const [packages, setPackages] = useState([]);
    const [installed, setInstalled] = useState({});
    const [loading, setLoading] = useState(true);
    const [busyPackage, setBusyPackage] = useState("");
    const [error, setError] = useState("");
    const [detailsPackage, setDetailsPackage] = useState("");
    const [bundleSelections, setBundleSelections] = useState({});
    const [searchQuery, setSearchQuery] = useState("");
    const [interruptedTransactions, setInterruptedTransactions] = useState([]);
    const [storageSummary, setStorageSummary] = useState(null);

    useEffect(() => {
        void initialize();
    }, []);

    useEffect(() => {
        if (!checkForUpdates || !sources.length) return;
        const intervalHours = Math.max(1, Number(updateCheckIntervalHours) || 24);
        const timer = window.setInterval(() => void refresh(sources), intervalHours * 60 * 60 * 1000);
        return () => window.clearInterval(timer);
    }, [checkForUpdates, updateCheckIntervalHours, sources]);

    async function initialize() {
        const settings = await readSettings();
        setSources(settings.sources);
        setAllowNetworkPackages(settings.allowNetworkPackages);
        setAllowedSourceHosts(normalizeSourceHosts(settings.allowedSourceHosts));
        setCheckForUpdates(settings.checkForUpdates);
        setUpdateCheckIntervalHours(settings.updateCheckIntervalHours);
        setIncludeDeprecatedPackages(settings.includeDeprecatedPackages);
        await refresh(settings.sources);
    }

    async function refresh(configuredSources = sources) {
        setLoading(true);
        setError("");
        try {
            const installedPackages = await readInstalledPackages();
            setInstalled(installedPackages);
            setInterruptedTransactions(await readInterruptedTransactions());
            setStorageSummary(await readPackageStorageSummary());
            const sourceUrls = [...new Set(configuredSources.filter(Boolean))];
            if (!sourceUrls.length) {
                setPackages([]);
                return;
            }

            const results = await Promise.allSettled(sourceUrls.map((url) => loadCatalogSource(url)));
            const responses = results
                .filter((result) => result.status === "fulfilled")
                .map((result) => result.value);
            const failures = results
                .filter((result) => result.status === "rejected")
                .map((result) => errorMessage(result.reason));
            if (!responses.length) {
                throw new Error(failures.join("; ") || "No plugin sources could be loaded.");
            }
            const seen = new Set();
            const catalog = responses.flat().filter((manifest) => {
                if (seen.has(manifest.id)) return false;
                seen.add(manifest.id);
                return true;
            });
            setPackages(catalog);
            setInstalled(withCatalogManifests(installedPackages, catalog));
            if (failures.length) setError(`Some plugin sources could not be loaded: ${failures.join("; ")}`);
        } catch (cause) {
            setPackages([]);
            setError(errorMessage(cause));
        } finally {
            setLoading(false);
        }
    }

    async function install(manifest) {
        if (isBundleEntry(manifest)) {
            await installBundle(manifest);
            return;
        }
        if (installed[manifest.id]) return;
        const dependencyResolution = resolveDependencies(manifest, installed, packages);
        if (dependencyResolution.errors.length) {
            setError(`${manifest.name} dependencies: ${dependencyResolution.errors.join("; ")}`);
            return;
        }
        const compatibilityErrors = compatibilityProblems([manifest, ...dependencyResolution.packages]);
        if (compatibilityErrors.length) {
            setError(compatibilityErrors.join("; "));
            return;
        }
        const permissionErrors = networkPermissionProblems([manifest, ...dependencyResolution.packages], allowNetworkPackages);
        if (permissionErrors.length) {
            setError(permissionErrors.join("; "));
            return;
        }
        const sourceHostErrors = sourceHostProblems([manifest, ...dependencyResolution.packages], allowedSourceHosts);
        if (sourceHostErrors.length) {
            setError(sourceHostErrors.join("; "));
            return;
        }
        if (!confirmPackageAction("Install", manifest, dependencyResolution.packages)) return;
        if (!(await beginPackageOperation(setError))) return;

        setBusyPackage(manifest.id);
        setError("");
        try {
            await installPackageSafely([...dependencyResolution.packages, manifest], allowedSourceHosts, packages);
            showMessage(`${manifest.name} installed disabled. Enable it here when ready.`);
            await refresh(sources);
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            await endPackageOperation();
            setBusyPackage("");
        }
    }

    async function installBundle(bundle) {
        const references = bundle.components || [];
        const selectedIds = new Set(bundleSelections[bundle.id] || defaultBundleSelection(bundle));
        const selected = references.filter((reference) => selectedIds.has(reference.id));
        const missing = selected.filter((reference) => !catalogPackageById(packages, reference.id));
        const missingRequired = references.filter((reference) => reference.required && !catalogPackageById(packages, reference.id));
        if (missing.length || missingRequired.length) {
            const ids = [...new Set([...missing, ...missingRequired].map((reference) => reference.id))];
            setError(`${bundle.name} cannot be installed yet; these selected components are not published in the same catalog: ${ids.join(", ")}`);
            return;
        }

        const selectedPackages = selected
            .map((reference) => catalogPackageById(packages, reference.id))
            .filter(Boolean)
            .filter((manifest) => !installed[manifest.id]);
        if (!selectedPackages.length) {
            showMessage(`${bundle.name} has no new components to install.`);
            return;
        }

        const planned = [];
        for (const manifest of selectedPackages) {
            const resolution = resolveDependencies(manifest, installed, packages);
            if (resolution.errors.length) {
                setError(`${manifest.name} dependencies: ${resolution.errors.join("; ")}`);
                return;
            }
            planned.push(...resolution.packages, manifest);
        }
        const manifests = [...new Map(planned.map((manifest) => [manifest.id, manifest])).values()];
        const compatibilityErrors = compatibilityProblems(manifests);
        if (compatibilityErrors.length) {
            setError(compatibilityErrors.join("; "));
            return;
        }
        const permissionErrors = networkPermissionProblems(manifests, allowNetworkPackages);
        if (permissionErrors.length) {
            setError(permissionErrors.join("; "));
            return;
        }
        const sourceHostErrors = sourceHostProblems(manifests, allowedSourceHosts);
        if (sourceHostErrors.length) {
            setError(sourceHostErrors.join("; "));
            return;
        }
        if (!confirmBundleAction(bundle, manifests)) return;
        if (!(await beginPackageOperation(setError))) return;

        setBusyPackage(bundle.id);
        setError("");
        try {
            await installPackageSafely(manifests, allowedSourceHosts, packages);
            showMessage(`${bundle.name} components installed disabled. Enable them in Settings → Plugins when ready.`);
            await refresh(sources);
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            await endPackageOperation();
            setBusyPackage("");
        }
    }

    async function update(manifest) {
        const dependencyResolution = resolveDependencies(manifest, installed, packages);
        if (dependencyResolution.errors.length) {
            setError(`${manifest.name} dependencies: ${dependencyResolution.errors.join("; ")}`);
            return;
        }
        const compatibilityErrors = compatibilityProblems([manifest, ...dependencyResolution.packages]);
        if (compatibilityErrors.length) {
            setError(compatibilityErrors.join("; "));
            return;
        }
        const permissionErrors = networkPermissionProblems([manifest, ...dependencyResolution.packages], allowNetworkPackages);
        if (permissionErrors.length) {
            setError(permissionErrors.join("; "));
            return;
        }
        const sourceHostErrors = sourceHostProblems([manifest, ...dependencyResolution.packages], allowedSourceHosts);
        if (sourceHostErrors.length) {
            setError(sourceHostErrors.join("; "));
            return;
        }
        if (!confirmPackageAction("Update", manifest, dependencyResolution.packages)) return;
        if (!(await beginPackageOperation(setError))) return;
        setBusyPackage(manifest.id);
        setError("");
        try {
            await replacePackage(manifest, false, allowedSourceHosts, dependencyResolution.packages, packages);
            showMessage(`${manifest.name} updated disabled. Enable it here when ready.`);
            await refresh(sources);
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            await endPackageOperation();
            setBusyPackage("");
        }
    }

    async function repair(entry) {
        const manifest = entry.manifest;
        if (!manifest) return;
        const dependencyResolution = resolveDependencies(manifest, installed, packages);
        if (dependencyResolution.errors.length) {
            setError(`${manifest.name} dependencies: ${dependencyResolution.errors.join("; ")}`);
            return;
        }
        const compatibilityErrors = compatibilityProblems([manifest, ...dependencyResolution.packages]);
        if (compatibilityErrors.length) {
            setError(compatibilityErrors.join("; "));
            return;
        }
        const permissionErrors = networkPermissionProblems([manifest, ...dependencyResolution.packages], allowNetworkPackages);
        if (permissionErrors.length) {
            setError(permissionErrors.join("; "));
            return;
        }
        const sourceHostErrors = sourceHostProblems([manifest, ...dependencyResolution.packages], allowedSourceHosts);
        if (sourceHostErrors.length) {
            setError(sourceHostErrors.join("; "));
            return;
        }
        if (!confirmPackageAction("Repair", manifest, dependencyResolution.packages)) return;
        if (!(await beginPackageOperation(setError))) return;

        setBusyPackage(manifest.id);
        setError("");
        try {
            await replacePackage(manifest, true, allowedSourceHosts, dependencyResolution.packages, packages);
            showMessage(`${manifest.name} repaired.`);
            await refresh(sources);
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            await endPackageOperation();
            setBusyPackage("");
        }
    }

    async function recoverInterruptedTransactions() {
        if (!(await beginPackageOperation(setError))) return;
        setBusyPackage("recovery");
        setError("");
        try {
            const transactionIds = await readInterruptedTransactions();
            let promoted = 0;
            let discarded = 0;
            for (const transactionId of transactionIds) {
                await rollbackPackageMigrations(transactionId);
                const notes = await transactionNotes(transactionId);
                const packageIds = [...new Set(notes.map((note) => note.getOwnedLabelValue(OWNER_LABEL)).filter(Boolean))];
                const manifests = packageIds.map((packageId) => packages.find((manifest) => manifest.id === packageId));
                const currentPackages = await Promise.all(packageIds.map((packageId) => packageNotes(packageId)));
                const canPromote = packageIds.length > 0 && manifests.every(Boolean) && currentPackages.every((owned) => owned.length === 0);
                if (canPromote) {
                    try {
                        for (const manifest of manifests) verifyStagedPackage(notes, manifest);
                        await applyEnabledState(notes, false);
                        await clearTransaction(transactionId, notes);
                        promoted++;
                        continue;
                    } catch {
                        // An incomplete or unverifiable stage is safer to discard.
                    }
                }
                await archiveTransactionNotes(transactionId);
                discarded++;
            }
            showMessage(`Recovered ${promoted} staged package operation${promoted === 1 ? "" : "s"}; discarded ${discarded} incomplete operation${discarded === 1 ? "" : "s"}.`);
            await refresh(sources);
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            await endPackageOperation();
            setBusyPackage("");
        }
    }

    const search = searchQuery.trim().toLowerCase();
    const matchesPackage = (manifest) => !search || [manifest.name, manifest.id, manifest.description, manifest.author, manifest.maintainer].filter(Boolean).join(" ").toLowerCase().includes(search);
    const catalog = packages
        .filter((manifest) => !manifest.deprecated || includeDeprecatedPackages)
        .filter(matchesPackage);
    const hasConfiguredSources = sources.length > 0;

    function openPluginSettings() {
        triggerCommand("closePopupEditor");
        triggerCommand("showOptions", { section: "_optionsPlugins" });
    }

    return (
        <div className="options community-packages-shell">
            <style>{`
                .community-packages-shell {
                    width: 100%;
                    max-width: 960px;
                    margin: 0 auto;
                    box-sizing: border-box;
                    padding: clamp(0.75rem, 3vw, 1.5rem);
                    container-type: inline-size;
                    container-name: community-packages;
                }
                .community-packages-title-area {
                    display: grid;
                    grid-template-columns: 1fr auto 1fr;
                    grid-template-rows: auto;
                    align-items: center;
                    gap: 0.75rem;
                    margin-top: -0.625rem;
                    margin-bottom: 0.75rem;
                }
                .community-packages-title {
                    grid-column: 2;
                    grid-row: 1;
                    margin: 0;
                    text-align: center;
                }
                .community-packages-back {
                    grid-column: 1;
                    grid-row: 1;
                    justify-self: start;
                    align-self: start;
                    width: 40px;
                    min-width: 40px !important;
                    height: 34px;
                    padding: 0;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                }
                .community-packages-actions {
                    display: flex;
                    flex-wrap: wrap;
                    justify-content: flex-end;
                    gap: 0.4em;
                }
                @container community-packages (max-width: 700px) {
                    .community-packages-shell {
                        padding: 0.75rem;
                    }
                    .community-packages-title-area {
                        gap: 0.5rem;
                    }
                    .community-packages-title {
                        font-size: 1.45rem;
                    }
                    .community-packages-shell .btn {
                        min-width: 0 !important;
                        padding: 0.25rem 0.55rem;
                        font-size: 0.9rem;
                    }
                    .community-packages-actions {
                        justify-content: center;
                    }
                }
                @container community-packages (max-width: 480px) {
                    .community-packages-title-area {
                        grid-template-columns: 1fr auto 1fr;
                        grid-template-rows: auto;
                    }
                    .community-packages-back {
                        grid-column: 1;
                        grid-row: 1;
                        justify-self: start;
                    }
                    .community-packages-title {
                        grid-column: 2;
                        grid-row: 1;
                        font-size: 1.25rem;
                    }
                    .community-packages-actions {
                        display: grid;
                        grid-template-columns: repeat(2, minmax(0, auto));
                        justify-content: center;
                    }
                }
            `}</style>
            <div className="community-packages-title-area">
                <Button className="community-packages-back" text="" icon="bx-arrow-back" title="Back to plugin settings" onClick={openPluginSettings} />
                <h1 className="community-packages-title">Plugin Catalog</h1>
            </div>
            <p>Search and install community extensions. Already-installed plugins are marked here; manage their settings and lifecycle from Settings → Plugins.</p>

            {error && <Admonition type="warning">{error}</Admonition>}
            <section className="options-section">
                <div className="options-section-header">
                    <h4>Search plugins</h4>
                    <span>
                        {searchQuery && <Button text="Clear" size="small" onClick={() => setSearchQuery("")} />}
                        <Button text="Refresh" icon="bx-refresh" size="small" onClick={() => refresh()} disabled={loading} />
                    </span>
                </div>
                <div className="options-section-card">
                    <input
                        id="community-package-search"
                        className="form-control"
                        type="search"
                        value={searchQuery}
                        placeholder="Search by name, author, or description"
                        aria-label="Search plugins"
                        onInput={(event) => setSearchQuery(event.currentTarget.value)}
                    />
                </div>
            </section>

            <section className="options-section">
                <div className="options-section-header">
                    <h4>Catalog ({catalog.length})</h4>
                </div>
                <p className="options-section-description">Discover and install plugins. Already-installed plugins are marked here; manage their settings and lifecycle from Settings → Plugins.</p>
                <div className="options-section-card">
                    {loading && <LoadingSpinner />}
                    {!loading && !hasConfiguredSources && <p>Configure a plugin source in Settings → Plugins.</p>}
                    {!loading && hasConfiguredSources && !catalog.length && <p>{search ? `No packages match “${searchQuery}”.` : "No packages found in the configured sources."}</p>}
                    {catalog.map((manifest) => {
                        if (isBundleEntry(manifest)) {
                            const componentManifests = bundleComponents(manifest, packages);
                            const selectedIds = new Set(bundleSelections[manifest.id] || defaultBundleSelection(manifest));
                            return <div key={manifest.id}>
                                <BundleCatalogRow
                                    bundle={manifest}
                                    componentManifests={componentManifests}
                                    selectedIds={selectedIds}
                                    detailsOpen={detailsPackage === manifest.id}
                                    busy={Boolean(busyPackage)}
                                    busyThis={busyPackage === manifest.id}
                                    onToggleDetails={() => setDetailsPackage((current) => current === manifest.id ? "" : manifest.id)}
                                    onSelectionChange={(ids) => setBundleSelections({ ...bundleSelections, [manifest.id]: ids })}
                                    onInstall={() => install(manifest)}
                                />
                                {detailsPackage === manifest.id && <BundleDetails bundle={manifest} componentManifests={componentManifests} />}
                            </div>;
                        }
                        const entry = installed[manifest.id];
                        const updateAvailable = entry && isNewerVersion(manifest.version, entry.version);
                        const status = !entry
                            ? "Available"
                            : entry.health === "broken"
                                ? "Repair needed"
                                : updateAvailable
                                    ? "Update available"
                                    : "Installed";
                        return <div key={manifest.id}>
                            <PackageRow
                                title={manifest.name}
                                status={status}
                                description={packageSummary(manifest, entry)}
                                action={
                                    <span className="community-packages-actions">
                                        <Button
                                            text={detailsPackage === manifest.id ? "Hide details" : "Details"}
                                            size="small"
                                            onClick={() => setDetailsPackage((current) => current === manifest.id ? "" : manifest.id)}
                                            disabled={Boolean(busyPackage)}
                                        />
                                        {entry ? (
                                            <Button text="Manage in Plugins" size="small" onClick={openPluginSettings} disabled={Boolean(busyPackage)} />
                                        ) : (
                                            <Button
                                                text={busyPackage === manifest.id ? "Installing…" : "Install"}
                                                size="small"
                                                kind="primary"
                                                onClick={() => install(manifest)}
                                                disabled={Boolean(busyPackage)}
                                            />
                                        )}
                                    </span>
                                }
                            />
                            {detailsPackage === manifest.id && <PackageDetails manifest={manifest} />}
                        </div>;
                    })}
                </div>
            </section>
        </div>
    );
}

function PackageRow({ title, status, description, action }) {
    const statusColor = status === "Enabled" || status === "Update available"
        ? "var(--accent-color)"
        : "var(--muted-text-color)";

    return (
        <div className="option-row">
            <div className="option-row-label">
                <label style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.35em" }}>
                    {title}
                    <span className="badge" style={{ marginInlineStart: 0, color: statusColor }} aria-label={`Status: ${status}`}>{status}</span>
                </label>
                <small className="option-row-description">{description}</small>
            </div>
            <div className="option-row-input">{action}</div>
        </div>
    );
}

function BundleCatalogRow({ bundle, componentManifests, selectedIds, detailsOpen, busy, busyThis, onToggleDetails, onSelectionChange, onInstall }) {
    const availableIds = new Set(componentManifests.map((manifest) => manifest.id));
    const selectedAvailableCount = [...selectedIds].filter((id) => availableIds.has(id)).length;
    const nextSelection = (id, checked) => {
        const next = new Set(selectedIds);
        if (checked) next.add(id);
        else next.delete(id);
        for (const reference of bundle.components || []) if (reference.required) next.add(reference.id);
        onSelectionChange([...next]);
    };

    return <>
        <PackageRow
            title={bundle.name}
            status="Bundle"
            description={packageSummary(bundle, null)}
            action={
                <span className="community-packages-actions">
                    <Button text={detailsOpen ? "Hide details" : "Details"} size="small" onClick={onToggleDetails} disabled={busy} />
                    <Button text={busyThis ? "Installing…" : `Install selected (${selectedAvailableCount})`} size="small" kind="primary" onClick={onInstall} disabled={busy || selectedAvailableCount === 0} />
                </span>
            }
        />
        <div className="options-section-card" style={{ margin: "0 0 0.5em", background: "var(--main-background-color)" }}>
            <small>Select the apps you want from this bundle. Required components stay selected; each selected app keeps its own settings and lifecycle.</small>
            <div style={{ display: "grid", gap: "0.35em", marginTop: "0.6em" }}>
                {(bundle.components || []).map((reference) => {
                    const component = componentManifests.find((manifest) => manifest.id === reference.id);
                    const available = Boolean(component);
                    return <label key={reference.id} style={{ display: "flex", alignItems: "center", gap: "0.45em" }}>
                        <input
                            type="checkbox"
                            checked={selectedIds.has(reference.id)}
                            disabled={busy || reference.required || !available}
                            onChange={(event) => nextSelection(reference.id, event.currentTarget.checked)}
                        />
                        <span>{component?.name || reference.id}{reference.required ? " · required" : ""}{!available ? " · unavailable in this source" : ""}</span>
                    </label>;
                })}
            </div>
        </div>
    </>;
}

function packageSummary(manifest, entry) {
    const author = manifest.author || manifest.maintainer;
    const authorText = author ? `By ${author}` : "";
    if (!entry) return [manifest.description, `v${manifest.version}`, authorText].filter(Boolean).join(" · ");
    const version = isNewerVersion(manifest.version, entry.version)
        ? `${entry.version} → ${manifest.version}`
        : `v${entry.version}`;
    return [authorText, version, "installed"].filter(Boolean).join(" · ");
}

function PackageDetails({ manifest }) {
    const dependencyText = (manifest.dependencies || []).length
        ? manifest.dependencies.map((dependency) => `${dependency.id} ${dependency.version}${dependency.optional ? " (optional)" : ""}`).join(", ")
        : "None declared";
    const artifactText = (manifest.artifacts || []).length
        ? manifest.artifacts.map((artifact) => `${artifact.title || artifact.id} (${artifact.type})`).join(", ")
        : "None declared";
    const compatibilityText = manifest.compatibility
        ? `${manifest.compatibility.minTriliumVersion || "any"}${manifest.compatibility.maxTriliumVersion ? `–${manifest.compatibility.maxTriliumVersion}` : "+"}`
        : "Not declared";
    const rows = [
        ["Permissions", (manifest.permissions || []).length ? manifest.permissions.join(", ") : "None declared"],
        ["Compatibility", compatibilityText],
        ["Dependencies", dependencyText],
        ["Artifacts", artifactText],
        ["Source", manifest.repository],
        ["Status", manifestStatus(manifest) || "No additional registry metadata"]
    ];

    return (
        <div className="options-section-card" style={{ margin: "0 0 0.5em", background: "var(--main-background-color)" }}>
            <p style={{ marginTop: 0 }}>{manifest.description}</p>
            {rows.map(([label, value]) => (
                <div className="option-row" key={label}>
                    <div className="option-row-label"><label>{label}</label></div>
                    <div className="option-row-input" style={{ maxWidth: "70%", textAlign: "end", overflowWrap: "anywhere" }}>{value}</div>
                </div>
            ))}
        </div>
    );
}

function BundleDetails({ bundle, componentManifests }) {
    const componentText = (bundle.components || []).map((reference) => {
        const component = componentManifests.find((manifest) => manifest.id === reference.id);
        return `${component?.name || reference.id}${reference.required ? " (required)" : ""}`;
    }).join(", ");
    const rows = [
        ["Components", componentText || "None declared"],
        ["Source", bundle.repository],
        ["Status", manifestStatus(bundle) || "No additional registry metadata"]
    ];
    return <div className="options-section-card" style={{ margin: "0 0 0.5em", background: "var(--main-background-color)" }}>
        <p style={{ marginTop: 0 }}>{bundle.description}</p>
        {rows.map(([label, value]) => <div className="option-row" key={label}>
            <div className="option-row-label"><label>{label}</label></div>
            <div className="option-row-input" style={{ maxWidth: "70%", textAlign: "end", overflowWrap: "anywhere" }}>{value}</div>
        </div>)}
    </div>;
}

function manifestStatus(manifest) {
    const status = [];
    if (manifest.maintainer || manifest.author) status.push(`Maintainer: ${manifest.maintainer || manifest.author}`);
    if (manifest.license) status.push(`License: ${manifest.license}`);
    if (manifest.deprecated) status.push(`Deprecated${manifest.deprecationMessage ? `: ${manifest.deprecationMessage}` : ""}`);
    if (manifest.maintenance && manifest.maintenance !== "active") status.push(`Maintenance: ${manifest.maintenance}`);
    if (manifest.securityStatus === "warning") status.push("Security review warning");
    else if (manifest.securityStatus === "unreviewed") status.push("Security: unreviewed");
    if (manifest.lastValidatedAt) status.push(`Validated ${manifest.lastValidatedAt.slice(0, 10)}`);
    return status.join(" · ");
}

async function readSettings() {
    let note = (await searchPackageNotes(`#${SETTINGS_LABEL}`))[0] || null;
    if (note) {
        await api.reloadNotes([note.noteId]);
        note = await api.getNote(note.noteId);
    }
    return {
        sources: parseConfiguredSources(note),
        allowNetworkPackages: note?.getOwnedLabelValue("packageAllowNetwork") === "true",
        checkForUpdates: note?.getOwnedLabelValue(CHECK_UPDATES_LABEL) === "true",
        updateCheckIntervalHours: Math.max(1, Number(note?.getOwnedLabelValue(UPDATE_INTERVAL_LABEL)) || 24),
        allowedSourceHosts: normalizeSourceHosts(note?.getOwnedLabelValue(ALLOWED_SOURCE_HOSTS_LABEL) || ""),
        includeDeprecatedPackages: note?.getOwnedLabelValue(INCLUDE_DEPRECATED_LABEL) === "true"
    };
}

function parseRegistryUrls(value) {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.filter((url) => typeof url === "string" && url.trim()).map((url) => url.trim());
    } catch {
        // Legacy and hand-edited values are accepted as newline-separated URLs.
    }
    return String(value).split(/[\r\n]+/).map((url) => url.trim()).filter(Boolean);
}

function parseConfiguredSources(note) {
    const values = [
        note?.getOwnedLabelValue(SOURCES_LABEL),
        note?.getOwnedLabelValue(LEGACY_REGISTRY_URL_LABEL),
        note?.getOwnedLabelValue(LEGACY_REGISTRY_URLS_LABEL),
        note?.getOwnedLabelValue(LEGACY_DIRECT_MANIFEST_URLS_LABEL)
    ].flatMap(parseRegistryUrls);
    return [...new Set(values)];
}

function normalizeSourceHosts(value) {
    return String(value).split(/[\s,]+/).map((host) => host.trim()).filter(Boolean).join("\n");
}

async function readInstalledPackages() {
    const notes = await searchPackageNotes(`#${MANAGED_LABEL}`);
    const result = {};
    for (const note of notes) {
        if (note.isArchived || isTransactionNote(note)) continue;
        const id = note.getOwnedLabelValue(OWNER_LABEL);
        if (!id) continue;
        const artifactId = note.getOwnedLabelValue(ARTIFACT_LABEL);
        const entry = result[id] || {
            id,
            noteId: note.noteId,
            name: note.title,
            version: "unknown",
            enabled: false,
            pinned: false,
            artifactIds: [],
            health: "unknown",
            healthMessage: "configure a registry to check",
            manifest: null
        };
        if (artifactId && !entry.artifactIds.includes(artifactId)) entry.artifactIds.push(artifactId);
        if (artifactId === "manifest") {
            entry.noteId = note.noteId;
            entry.name = note.title;
            entry.version = note.getOwnedLabelValue(VERSION_LABEL) || "unknown";
            entry.enabled = note.getOwnedLabelValue(ENABLED_LABEL) === "true";
            entry.pinned = note.getOwnedLabelValue(PINNED_LABEL) === "true";
        }
        result[id] = entry;
    }
    return result;
}

async function readPackageStorageSummary() {
    const [managedNotes, activeBackups, archivedBackups] = await Promise.all([
        searchPackageNotes(`#${MANAGED_LABEL}`),
        searchPackageNotes(`#${CONFIG_BACKUP_LABEL}`),
        searchPackageNotes(`#${CONFIG_BACKUP_LABEL} #archived`)
    ]);
    const activeManifests = managedNotes.filter((note) => !note.isArchived && !isTransactionNote(note) && note.getOwnedLabelValue(ARTIFACT_LABEL) === "manifest");
    const archivedManaged = managedNotes.filter((note) => note.isArchived && note.getOwnedLabelValue(ARTIFACT_LABEL));
    const generations = (notes) => new Set(notes.map((note) => `${note.getOwnedLabelValue(OWNER_LABEL)}@${note.getOwnedLabelValue(VERSION_LABEL)}`));
    return {
        activeGenerations: generations(activeManifests).size,
        archivedGenerations: generations(archivedManaged.filter((note) => note.getOwnedLabelValue(ARTIFACT_LABEL) === "manifest")).size,
        archivedManagedNotes: archivedManaged.length,
        configBackups: activeBackups.filter((note) => !note.isArchived).length,
        archivedConfigBackups: archivedBackups.filter((note) => note.isArchived).length
    };
}

function withCatalogManifests(installedPackages, catalog) {
    const byId = Object.fromEntries(catalog.map((manifest) => [manifest.id, manifest]));
    return Object.fromEntries(Object.entries(installedPackages).map(([id, entry]) => [
        id,
        { ...entry, manifest: byId[id] || null, ...packageHealth(entry, byId[id]) }
    ]));
}

function packageHealth(entry, manifest) {
    if (!manifest) return { health: "unknown", healthMessage: "not in registry" };
    const expected = ["manifest", ...(manifest.artifacts || []).map((artifact) => artifact.id)];
    const missing = expected.filter((artifactId) => !entry.artifactIds.includes(artifactId));
    return missing.length
        ? { health: "broken", healthMessage: `missing ${missing.join(", ")}` }
        : { health: "healthy", healthMessage: "all artifacts present" };
}

async function ensureRootNote() {
    const existing = (await searchPackageNotes(`#${ROOT_LABEL}`))[0] || null;
    if (existing) {
        await moveNoteToParent(existing, "_hidden", (branch) => branch.parentNoteId === "root");
        return existing;
    }
    const root = await createNote("root", {
        title: "Community Packages",
        type: "book",
        content: "Packages installed by the Community Packages manager.",
        attributes: [{ type: "label", name: ROOT_LABEL }]
    });
    await api.reloadNotes([root.noteId]);
    const created = await api.getNote(root.noteId);
    await moveNoteToParent(created, "_hidden", (branch) => branch.parentNoteId === "root");
    return created;
}

async function createNote(parentNoteId, options) {
    const response = await packageRequest("POST", `notes/${parentNoteId}/children?target=into&targetBranchId=`, { ...options, activate: false });
    const result = await response.json();
    if (!response.ok) throw new Error(`Could not create note (${response.status})${result?.message ? `: ${result.message}` : ""}`);
    if (!result.note) throw new Error(`Could not create note: ${options.title || "untitled"}`);
    return result.note;
}

async function packageRequest(method, path, body) {
    const headers = {
        "x-csrf-token": window.glob.csrfToken,
        "trilium-component-id": window.glob.componentId,
        ...(body ? { "content-type": "application/json" } : {})
    };
    let response = await fetch(`${window.glob.baseApiUrl}${path}`, {
        method,
        credentials: "same-origin",
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    if (response.status === 403) {
        const bootstrap = await fetch(`./bootstrap${window.location.search}`, { credentials: "same-origin", cache: "no-store" });
        if (bootstrap.ok) {
            const json = await bootstrap.json();
            window.glob.csrfToken = json.csrfToken;
            headers["x-csrf-token"] = json.csrfToken;
            response = await fetch(`${window.glob.baseApiUrl}${path}`, {
                method,
                credentials: "same-origin",
                headers,
                body: body ? JSON.stringify(body) : undefined
            });
        }
    }

    return response;
}

async function searchPackageNotes(searchString) {
    const response = await packageRequest("GET", `quick-search/${encodeURIComponent(searchString)}`);
    if (!response.ok) throw new Error(`Could not search package notes (${response.status})`);
    const result = await response.json();
    const noteIds = Array.isArray(result.searchResultNoteIds) ? result.searchResultNoteIds : [];
    const notes = await Promise.all(noteIds.map((noteId) => api.getNote(noteId)));
    return notes.filter(Boolean);
}

async function setLauncherVisibility(note, enabled) {
    if (note.type !== "launcher") return;

    const targetParentNoteId = enabled ? "_lbVisibleLaunchers" : "_lbAvailableLaunchers";
    await moveNoteToParent(note, targetParentNoteId, (branch) =>
        branch.parentNoteId === "_lbVisibleLaunchers" || branch.parentNoteId === "_lbAvailableLaunchers"
    );
}

async function moveNoteToParent(note, targetParentNoteId, branchFilter: (branch: any) => boolean = () => true) {
    const sourceBranch = note.getParentBranches().find(branchFilter);
    if (!sourceBranch || sourceBranch.parentNoteId === targetParentNoteId) return;

    const targetParentNote = await api.getNote(targetParentNoteId);
    const targetParentBranch = targetParentNote?.getParentBranches()[0];
    if (!targetParentBranch) throw new Error(`Could not find the parent branch for ${targetParentNoteId}`);

    const response = await packageRequest("PUT", `branches/${sourceBranch.branchId}/move-to/${targetParentBranch.branchId}`);
    if (!response.ok) throw new Error(`Could not move ${note.title} (${response.status})`);
    await api.reloadNotes([note.noteId]);
}

async function replacePackage(manifest, preserveEnabled, allowedSourceHosts, dependencies = [], catalog = []) {
    const transactionId = createTransactionId();
    let previousNotes = [];
    let previousEnabled = false;
    let previousPinned = false;
    let previousSettings = {};
    let transferredNotes = [];
    try {
        previousNotes = await packageNotes(manifest.id);
        const previousManifest = previousNotes.find((note) => note.getOwnedLabelValue(ARTIFACT_LABEL) === "manifest");
        previousEnabled = previousManifest?.getOwnedLabelValue(ENABLED_LABEL) === "true";
        previousPinned = previousManifest?.getOwnedLabelValue(PINNED_LABEL) === "true";
        previousSettings = previousManifest
            ? packageSettingsSnapshot(previousManifest, manifest)
            : (await readLatestConfigBackup(manifest.id))?.settings || {};
        if (previousManifest) {
            await backupPackageConfiguration(manifest, previousManifest, previousSettings, previousEnabled, previousPinned);
        }

        const migrationTargets = await migrationTargetManifests([manifest, ...dependencies], catalog);
        const manifests = [...new Map([...dependencies, manifest, ...migrationTargets].map((entry) => [entry.id, entry])).values()];
        await stagePackages(manifests, transactionId, allowedSourceHosts);
        const stagedNotes = await transactionNotes(transactionId);
        for (const stagedManifest of manifests) verifyStagedPackage(stagedNotes, stagedManifest);
        transferredNotes = await applyPackageMigrations(manifests, stagedNotes, catalog, transactionId);
        const stagedPackageNotes = stagedNotes.filter((note) => note.getOwnedLabelValue(OWNER_LABEL) === manifest.id);
        await restorePackageSettings(stagedPackageNotes, manifest, previousSettings);
        await restorePackagePinned(stagedPackageNotes, previousPinned);
        await archiveNotes(previousNotes.filter((note) => !transferredNotes.includes(note)));
        if (preserveEnabled && previousEnabled) await applyEnabledState(stagedPackageNotes, true);
        await clearTransaction(transactionId, stagedNotes);
        await clearPackageMigrations(transactionId, transferredNotes);
        try {
            await pruneConfigBackups(manifest.id);
        } catch {
            // Backup retention is housekeeping; never turn a completed package replacement into a failed update.
        }
    } catch (cause) {
        const rollbackErrors = [];
        try {
            await rollbackPackageMigrations(transactionId);
        } catch (rollbackCause) {
            rollbackErrors.push(`migration rollback failed: ${errorMessage(rollbackCause)}`);
        }
        try {
            await archiveTransactionNotes(transactionId);
        } catch (rollbackCause) {
            rollbackErrors.push(`new package cleanup failed: ${errorMessage(rollbackCause)}`);
        }
        try {
            await restorePackageNotes(previousNotes, previousEnabled);
        } catch (rollbackCause) {
            rollbackErrors.push(`previous package restore failed: ${errorMessage(rollbackCause)}`);
        }
        throw new Error(`Update failed: ${errorMessage(cause)}${rollbackErrors.length ? ` Rollback warning: ${rollbackErrors.join("; ")}` : " The previous package was restored."}`);
    }
}

async function installPackageSafely(manifests, allowedSourceHosts, catalog = []) {
    const transactionId = createTransactionId();
    let transferredNotes = [];
    const migrationTargets = await migrationTargetManifests(manifests, catalog);
    manifests = [...new Map([...manifests, ...migrationTargets].map((entry) => [entry.id, entry])).values()];
    try {
        await stagePackages(manifests, transactionId, allowedSourceHosts);
        const stagedNotes = await transactionNotes(transactionId);
        for (const manifest of manifests) verifyStagedPackage(stagedNotes, manifest);
        transferredNotes = await applyPackageMigrations(manifests, stagedNotes, catalog, transactionId);
        for (const manifest of manifests) {
            const backup = await readLatestConfigBackup(manifest.id);
            if (!backup) continue;
            const stagedPackageNotes = stagedNotes.filter((note) => note.getOwnedLabelValue(OWNER_LABEL) === manifest.id);
            await restorePackageSettings(stagedPackageNotes, manifest, backup.settings || {});
            await restorePackagePinned(stagedPackageNotes, Boolean(backup.pinned));
        }
        await clearTransaction(transactionId, stagedNotes);
        await clearPackageMigrations(transactionId, transferredNotes);
    } catch (cause) {
        const rollbackErrors = [];
        try {
            await rollbackPackageMigrations(transactionId);
        } catch (rollbackCause) {
            rollbackErrors.push(`migration rollback failed: ${errorMessage(rollbackCause)}`);
        }
        try {
            await archiveTransactionNotes(transactionId);
        } catch (rollbackCause) {
            rollbackErrors.push(`cleanup failed: ${errorMessage(rollbackCause)}`);
        }
        const packageNames = manifests.map((manifest) => manifest.name).join(", ");
        throw new Error(`Installing ${packageNames} failed: ${errorMessage(cause)}${rollbackErrors.length ? ` Rollback warning: ${rollbackErrors.join("; ")}` : " Partial notes were archived."}`);
    }
}

async function stagePackages(manifests, transactionId, allowedSourceHosts) {
    for (const manifest of manifests) await installPackage(manifest, transactionId, allowedSourceHosts);
}

function verifyStagedPackage(notes, manifest) {
    const packageNotes = notes.filter((note) => note.getOwnedLabelValue(OWNER_LABEL) === manifest.id);
    const artifactIds = new Set(packageNotes.map((note) => note.getOwnedLabelValue(ARTIFACT_LABEL)));
    const expectedArtifactIds = ["manifest", ...(manifest.artifacts || []).map((artifact) => artifact.id)];
    const missing = expectedArtifactIds.filter((artifactId) => !artifactIds.has(artifactId));
    const unexpected = [...artifactIds].filter((artifactId) => !expectedArtifactIds.includes(artifactId));
    if (missing.length || unexpected.length) {
        const details = [];
        if (missing.length) details.push(`missing ${missing.join(", ")}`);
        if (unexpected.length) details.push(`unexpected ${unexpected.join(", ")}`);
        throw new Error(`${manifest.name} staged package verification failed: ${details.join("; ")}`);
    }
}

async function installPackage(manifest, transactionId = "", allowedSourceHosts = "") {
    const root = await ensureRootNote();
    const packageRoot = await createNote(root.noteId, {
        title: manifest.name,
        type: "doc",
        content: manifest.description || "",
        attributes: [
            ...packageAttributes(manifest, "manifest", transactionId),
            { type: "label", name: ENABLED_LABEL, value: "false" },
            ...packageSettingAttributes(manifest)
        ]
    });

    for (const artifact of manifest.artifacts) {
        const sourceUrl = resolveSource(manifest.repository, artifact.source);
        const payload = await downloadArtifact(manifest, artifact, sourceUrl, allowedSourceHosts);
        await verifyArtifactIntegrity(manifest, artifact, payload);
        const source = new TextDecoder("utf-8", { fatal: true }).decode(payload);
        await installArtifact(packageRoot.noteId, manifest, artifact, source, transactionId);
    }
}

async function verifyArtifactIntegrity(manifest, artifact, payload) {
    if (!artifact.integrity) throw new Error(`${manifest.name} artifact ${artifact.id} has no integrity hash`);
    // WebCrypto is unavailable when Trilium is served over plain HTTP. Keep the
    // integrity check active there with the small self-contained implementation
    // below instead of treating an insecure development context as an exception.
    const digest = globalThis.crypto?.subtle
        ? await globalThis.crypto.subtle.digest("SHA-256", payload)
        : sha256Digest(payload);
    const actual = `sha256-${arrayBufferToBase64(digest)}`;
    if (actual !== artifact.integrity) {
        throw new Error(`${manifest.name} artifact ${artifact.id} failed integrity verification (expected ${artifact.integrity}, received ${actual})`);
    }
}

// Render notes are bundled by Trilium's script service, which only provides
// the Trilium-specific imports. Keep this fallback dependency-free so package
// verification also works in a plain-HTTP render-note context.
function sha256Digest(input) {
    const roundConstants = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const paddedLength = Math.ceil((input.byteLength + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(input);
    padded[input.byteLength] = 0x80;
    const paddedView = new DataView(padded.buffer);
    const bitLength = input.byteLength * 8;
    paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    paddedView.setUint32(paddedLength - 4, bitLength >>> 0);

    const rotateRight = (value, bits) => (value >>> bits) | (value << (32 - bits));
    for (let offset = 0; offset < paddedLength; offset += 64) {
        const words = new Uint32Array(64);
        for (let index = 0; index < 16; index++) words[index] = paddedView.getUint32(offset + index * 4);
        for (let index = 16; index < 64; index++) {
            const value = words[index - 15];
            const smallSigma0 = rotateRight(value, 7) ^ rotateRight(value, 18) ^ (value >>> 3);
            const nextValue = words[index - 2];
            const smallSigma1 = rotateRight(nextValue, 17) ^ rotateRight(nextValue, 19) ^ (nextValue >>> 10);
            words[index] = (words[index - 16] + smallSigma0 + words[index - 7] + smallSigma1) >>> 0;
        }

        let [a, b, c, d, e, f, g, h] = hash;
        for (let index = 0; index < 64; index++) {
            const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choose = (e & f) ^ (~e & g);
            const first = (h + bigSigma1 + choose + roundConstants[index] + words[index]) >>> 0;
            const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const second = (bigSigma0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + first) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (first + second) >>> 0;
        }
        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }

    const digest = new Uint8Array(32);
    const digestView = new DataView(digest.buffer);
    hash.forEach((value, index) => digestView.setUint32(index * 4, value));
    return digest;
}

async function downloadArtifact(manifest, artifact, sourceUrl, allowedSourceHosts) {
    const sourceProblem = downloadUrlProblem(sourceUrl, allowedSourceHosts);
    if (sourceProblem) throw new Error(`${manifest.name} artifact ${artifact.id}: ${sourceProblem}`);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(sourceUrl, { signal: controller.signal });
        if (!response.ok) throw new Error(`Could not download ${artifact.id} (${response.status})`);
        const finalUrl = response.url || sourceUrl;
        const finalProblem = downloadUrlProblem(finalUrl, allowedSourceHosts, sourceUrl);
        if (finalProblem) throw new Error(`${manifest.name} artifact ${artifact.id}: ${finalProblem}`);

        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_ARTIFACT_BYTES) {
            throw new Error(`${manifest.name} artifact ${artifact.id} exceeds the ${MAX_ARTIFACT_BYTES} byte download limit`);
        }

        if (!response.body) {
            const payload = new Uint8Array(await response.arrayBuffer());
            if (payload.byteLength > MAX_ARTIFACT_BYTES) throw new Error(`${manifest.name} artifact ${artifact.id} exceeds the ${MAX_ARTIFACT_BYTES} byte download limit`);
            return payload;
        }

        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
            const result = await reader.read();
            if (result.done) break;
            total += result.value.byteLength;
            if (total > MAX_ARTIFACT_BYTES) {
                await reader.cancel();
                throw new Error(`${manifest.name} artifact ${artifact.id} exceeds the ${MAX_ARTIFACT_BYTES} byte download limit`);
            }
            chunks.push(result.value);
        }
        const payload = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            payload.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return payload;
    } catch (cause) {
        if (cause?.name === "AbortError") throw new Error(`${manifest.name} artifact ${artifact.id} download timed out after ${DOWNLOAD_TIMEOUT_MS} ms`);
        throw cause;
    } finally {
        window.clearTimeout(timeout);
    }
}

async function fetchJsonSource(url) {
    const sourceProblem = downloadUrlProblem(url, "");
    if (sourceProblem) throw new Error(`${url}: ${sourceProblem}`);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
        const redirectProblem = downloadUrlProblem(response.url || url, "", url);
        if (redirectProblem) throw new Error(`${url}: ${redirectProblem}`);
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_REGISTRY_BYTES) throw new Error(`${url} exceeds the ${MAX_REGISTRY_BYTES} byte registry limit`);
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > MAX_REGISTRY_BYTES) throw new Error(`${url} exceeds the ${MAX_REGISTRY_BYTES} byte registry limit`);
        try {
            return JSON.parse(text);
        } catch {
            throw new Error(`${url} returned invalid JSON`);
        }
    } catch (cause) {
        if (cause?.name === "AbortError") throw new Error(`${url} timed out after ${DOWNLOAD_TIMEOUT_MS} ms`);
        throw cause;
    } finally {
        window.clearTimeout(timeout);
    }
}

async function loadCatalogSource(sourceUrl) {
    const sourceProblem = downloadUrlProblem(sourceUrl, "");
    if (sourceProblem) throw new Error(`${sourceUrl}: ${sourceProblem}`);
    const resolvedUrl = normalizePluginSourceUrl(sourceUrl);
    try {
        const payload = await fetchJsonSource(resolvedUrl);
        if (Array.isArray(payload?.packages)) return payload.packages.filter(isCatalogEntry);
        if (isCatalogEntry(payload)) return [payload];
        throw new Error("source is neither a plugin registry nor a valid plugin manifest");
    } catch (cause) {
        const message = errorMessage(cause);
        if (message.startsWith(`${sourceUrl}:`)) throw cause;
        throw new Error(`${sourceUrl}: ${message}`);
    }
}

function normalizePluginSourceUrl(source) {
    const parsed = new URL(source);
    if (parsed.hostname.toLowerCase() !== "github.com") return source;

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return source;
    const owner = segments[0];
    const repository = segments[1].replace(/\.git$/, "");
    if (!owner || !repository) return source;

    if (segments[2] === "blob" && segments[3] && segments.length > 4) {
        return `https://raw.githubusercontent.com/${owner}/${repository}/${segments[3]}/${segments.slice(4).join("/")}`;
    }
    if (segments[2] === "tree" && segments[3]) {
        const path = segments.slice(4).join("/");
        return `https://raw.githubusercontent.com/${owner}/${repository}/${segments[3]}/${path ? `${path}/` : ""}trilium-package.json`;
    }
    return `https://raw.githubusercontent.com/${owner}/${repository}/main/trilium-package.json`;
}

function arrayBufferToBase64(buffer) {
    let binary = "";
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    return btoa(binary);
}

async function packageNotes(packageId) {
    const notes = await searchPackageNotes(`#${OWNER_LABEL}`);
    return notes.filter((note) => note.getOwnedLabelValue(OWNER_LABEL) === packageId && !note.isArchived && !isTransactionNote(note) && !isMigrationNote(note));
}

async function migrationTargetManifests(manifests, catalog) {
    const targets = new Map();
    for (const manifest of manifests) {
        for (const migration of manifest.migrations || []) {
            if (migration.fromPackageId === migration.toPackageId) throw new Error(`${manifest.name} migration cannot keep the same package owner`);
            const target = catalogPackageById(catalog, migration.toPackageId);
            if (!target) throw new Error(`${manifest.name} migration target ${migration.toPackageId} is not present in the catalog`);
            const existing = await packageNotes(target.id);
            if (existing.length && !manifests.some((candidate) => candidate.id === target.id)) {
                throw new Error(`${manifest.name} migration target ${target.id} is already installed; remove it before transferring ownership`);
            }
            const targetArtifact = (target.artifacts || []).find((artifact) => artifact.id === migration.toArtifactId);
            if (!targetArtifact || targetArtifact.integrity !== migration.toIntegrity) {
                throw new Error(`${manifest.name} migration target ${target.id}:${migration.toArtifactId} does not match its declared integrity`);
            }
            targets.set(target.id, target);
        }
    }
    return [...targets.values()];
}

async function applyPackageMigrations(manifests, stagedNotes, catalog, transactionId) {
    const transferredNotes = [];
    const sourceNoteTargets = new Map();
    const migrationContexts = [];
    for (const ownerManifest of manifests) {
        for (const migration of ownerManifest.migrations || []) {
            const stagedSourceManifest = manifests.find((manifest) => manifest.id === migration.fromPackageId);
            if (!stagedSourceManifest) {
                throw new Error(`${ownerManifest.name} migration requires an updated ${migration.fromPackageId} package in the same transaction`);
            }
            if ((stagedSourceManifest.artifacts || []).some((artifact) => artifact.id === migration.fromArtifactId)) {
                throw new Error(`${ownerManifest.name} migration cannot transfer ${migration.fromPackageId}:${migration.fromArtifactId} while the updated source still declares it`);
            }

            const targetManifest = manifests.find((manifest) => manifest.id === migration.toPackageId);
            const targetArtifact = targetManifest?.artifacts?.find((artifact) => artifact.id === migration.toArtifactId);
            if (!targetManifest || !targetArtifact || targetArtifact.integrity !== migration.toIntegrity) {
                throw new Error(`${ownerManifest.name} migration destination ${migration.toPackageId}:${migration.toArtifactId} is not staged with the declared integrity`);
            }

            const sourceNotes = await packageNotes(migration.fromPackageId);
            const sourceRoot = sourceNotes.find((note) => note.getOwnedLabelValue(ARTIFACT_LABEL) === "manifest");
            const targetNotes = stagedNotes.filter((note) => note.getOwnedLabelValue(OWNER_LABEL) === migration.toPackageId);
            const targetRoot = targetNotes.find((note) => note.getOwnedLabelValue(ARTIFACT_LABEL) === "manifest");
            const sourceArtifacts = sourceNotes.filter((note) => note.getOwnedLabelValue(ARTIFACT_LABEL) === migration.fromArtifactId);
            if (!sourceRoot || !sourceArtifacts.length) {
                throw new Error(`${ownerManifest.name} migration source ${migration.fromPackageId}:${migration.fromArtifactId} is not installed`);
            }
            if (!targetRoot) throw new Error(`${ownerManifest.name} migration destination ${migration.toPackageId} has no staged manifest`);
            const targetArtifactNotes = targetNotes.filter((note) => note.getOwnedLabelValue(ARTIFACT_LABEL) === migration.toArtifactId);
            if (!targetArtifactNotes.length) throw new Error(`${ownerManifest.name} migration destination ${migration.toPackageId}:${migration.toArtifactId} has no staged artifact note`);
            const targetArtifactNote = targetArtifactNotes.find((note) => note.getParentBranches().some((branch) => branch.parentNoteId === targetRoot.noteId)) || targetArtifactNotes[0];

            migrationContexts.push({ migration, targetManifest, targetNotes, targetArtifactNotes, targetArtifactNote, sourceRoot, targetRoot, sourceArtifacts });
            for (const sourceArtifact of sourceArtifacts) sourceNoteTargets.set(sourceArtifact.noteId, targetArtifactNote.noteId);
        }
    }

    for (const context of migrationContexts) {
        const { migration, targetManifest, targetNotes, sourceRoot, targetRoot, sourceArtifacts } = context;

        const sourceEnabled = sourceRoot.getOwnedLabelValue(ENABLED_LABEL) === "true";
        for (const note of sourceArtifacts) {
            const recordedIntegrity = note.getOwnedLabelValue(INTEGRITY_LABEL);
            if (recordedIntegrity && recordedIntegrity !== migration.fromIntegrity) {
                throw new Error(`${migration.fromPackageId}:${migration.fromArtifactId} has an unexpected integrity record`);
            }
            const sourceBranch = note.getParentBranches().find((branch) => branch.parentNoteId === sourceRoot.noteId || sourceNoteTargets.has(branch.parentNoteId));
            const fromParent = sourceBranch?.parentNoteId || sourceRoot.noteId;
            const toParent = sourceBranch?.parentNoteId === sourceRoot.noteId
                ? targetRoot.noteId
                : sourceNoteTargets.get(sourceBranch?.parentNoteId) || targetRoot.noteId;
            await markMigrationNote(note, migration, transactionId, fromParent, toParent, targetManifest.version);
            await replaceAttribute(note, "label", OWNER_LABEL, migration.toPackageId);
            await replaceAttribute(note, "label", VERSION_LABEL, targetManifest.version);
            await replaceAttribute(note, "label", ARTIFACT_LABEL, migration.toArtifactId);
            if (note.getOwnedLabels(INTEGRITY_LABEL).length) await replaceAttribute(note, "label", INTEGRITY_LABEL, migration.toIntegrity);
            else await addAttribute(note, "label", INTEGRITY_LABEL, migration.toIntegrity);
            if (sourceBranch) await moveNoteToParent(note, toParent, (branch) => branch.parentNoteId === fromParent);
            transferredNotes.push(note);
        }
        await applyEnabledState(targetNotes, sourceEnabled);
        await applyEnabledState(sourceArtifacts, sourceEnabled);
    }
    const stagedReplacements = [...new Set(migrationContexts.flatMap((context) => context.targetArtifactNotes))];
    await archiveNotes(stagedReplacements);
    return [...new Set(transferredNotes)];
}

async function markMigrationNote(note, migration, transactionId, fromParent, toParent, toVersion) {
    const values = [
        [MIGRATION_TRANSACTION_LABEL, transactionId],
        [MIGRATION_FROM_OWNER_LABEL, migration.fromPackageId],
        [MIGRATION_FROM_ARTIFACT_LABEL, migration.fromArtifactId],
        [MIGRATION_FROM_VERSION_LABEL, note.getOwnedLabelValue(VERSION_LABEL) || ""],
        [MIGRATION_FROM_INTEGRITY_LABEL, migration.fromIntegrity],
        [MIGRATION_TO_OWNER_LABEL, migration.toPackageId],
        [MIGRATION_TO_ARTIFACT_LABEL, migration.toArtifactId],
        [MIGRATION_TO_VERSION_LABEL, toVersion],
        [MIGRATION_FROM_PARENT_LABEL, fromParent],
        [MIGRATION_TO_PARENT_LABEL, toParent]
    ];
    for (const [name, value] of values) await addAttribute(note, "label", name, value);
}

async function migrationNotes(transactionId) {
    const notes = await searchPackageNotes(`#${MIGRATION_TRANSACTION_LABEL}`);
    return notes.filter((note) => note.getOwnedLabelValue(MIGRATION_TRANSACTION_LABEL) === transactionId && !note.isArchived);
}

async function clearPackageMigrations(transactionId, knownNotes) {
    const notes = knownNotes || await migrationNotes(transactionId);
    for (const note of notes) {
        for (const labelName of MIGRATION_LABELS) {
            for (const attribute of note.getOwnedLabels(labelName)) await removeAttribute(note, attribute);
        }
    }
    if (notes.length) await api.reloadNotes(notes.map((note) => note.noteId));
}

async function rollbackPackageMigrations(transactionId) {
    const notes = await migrationNotes(transactionId);
    for (const note of notes) {
        const fromOwner = note.getOwnedLabelValue(MIGRATION_FROM_OWNER_LABEL);
        const fromArtifact = note.getOwnedLabelValue(MIGRATION_FROM_ARTIFACT_LABEL);
        const fromVersion = note.getOwnedLabelValue(MIGRATION_FROM_VERSION_LABEL);
        const fromIntegrity = note.getOwnedLabelValue(MIGRATION_FROM_INTEGRITY_LABEL);
        const toOwner = note.getOwnedLabelValue(MIGRATION_TO_OWNER_LABEL);
        const fromParent = note.getOwnedLabelValue(MIGRATION_FROM_PARENT_LABEL);
        const toParent = note.getOwnedLabelValue(MIGRATION_TO_PARENT_LABEL);
        if (fromOwner && note.getOwnedLabelValue(OWNER_LABEL) === toOwner) {
            await replaceAttribute(note, "label", OWNER_LABEL, fromOwner);
            await replaceAttribute(note, "label", ARTIFACT_LABEL, fromArtifact);
            await replaceAttribute(note, "label", VERSION_LABEL, fromVersion);
            if (fromIntegrity) {
                if (note.getOwnedLabels(INTEGRITY_LABEL).length) await replaceAttribute(note, "label", INTEGRITY_LABEL, fromIntegrity);
                else await addAttribute(note, "label", INTEGRITY_LABEL, fromIntegrity);
            }
        }
        if (fromParent && toParent) await moveNoteToParent(note, fromParent, (branch) => branch.parentNoteId === toParent);
        for (const labelName of MIGRATION_LABELS) {
            for (const attribute of note.getOwnedLabels(labelName)) await removeAttribute(note, attribute);
        }
    }
    if (notes.length) await api.reloadNotes(notes.map((note) => note.noteId));
}

function isTransactionNote(note) {
    return Boolean(note.getOwnedLabelValue(TRANSACTION_LABEL));
}

function isMigrationNote(note) {
    return Boolean(note.getOwnedLabelValue(MIGRATION_TRANSACTION_LABEL));
}

async function archiveNotes(notes) {
    if (!notes.length) return;
    await applyEnabledState(notes, false);
    for (const note of notes) {
        if (!note.getOwnedLabels("archived").length) await addAttribute(note, "label", "archived");
    }
    await api.reloadNotes(notes.map((note) => note.noteId));
}

async function transactionNotes(transactionId) {
    const notes = await searchPackageNotes(`#${TRANSACTION_LABEL}`);
    return notes.filter((note) => note.getOwnedLabelValue(TRANSACTION_LABEL) === transactionId && !note.isArchived);
}

async function readInterruptedTransactions() {
    const [transactionNotesList, migrationNotesList] = await Promise.all([
        searchPackageNotes(`#${TRANSACTION_LABEL}`),
        searchPackageNotes(`#${MIGRATION_TRANSACTION_LABEL}`)
    ]);
    return [...new Set([
        ...transactionNotesList.filter((note) => !note.isArchived).map((note) => note.getOwnedLabelValue(TRANSACTION_LABEL)),
        ...migrationNotesList.filter((note) => !note.isArchived).map((note) => note.getOwnedLabelValue(MIGRATION_TRANSACTION_LABEL))
    ].filter(Boolean))];
}

async function archiveTransactionNotes(transactionId) {
    const notes = await transactionNotes(transactionId);
    await archiveNotes(notes);
    await clearTransaction(transactionId, notes);
}

async function clearTransaction(transactionId, knownNotes) {
    const notes = knownNotes || await transactionNotes(transactionId);
    for (const note of notes) {
        for (const attribute of note.getOwnedLabels(TRANSACTION_LABEL)) await removeAttribute(note, attribute);
    }
    if (notes.length) await api.reloadNotes(notes.map((note) => note.noteId));
}

async function restorePackageNotes(notes, enabled) {
    if (!notes.length) return;
    for (const note of notes) {
        for (const attribute of note.getOwnedLabels("archived")) await removeAttribute(note, attribute);
    }
    await api.reloadNotes(notes.map((note) => note.noteId));
    await applyEnabledState(notes, enabled);
}

async function restorePackageSettings(notes, manifest, values) {
    const manifestNote = notes.find((note) => note.getOwnedLabelValue(ARTIFACT_LABEL) === "manifest");
    if (!manifestNote) throw new Error(`Staged package manifest not found: ${manifest.id}`);
    for (const setting of manifest.settings || []) {
        if (Object.prototype.hasOwnProperty.call(values, setting.key)) {
            const value = normalizeSettingValue(values[setting.key], setting);
            await replaceAttribute(manifestNote, "label", settingLabelName(setting.key), serializeSetting(value));
        }
    }
}

async function restorePackagePinned(notes, pinned) {
    const manifestNote = notes.find((note) => note.getOwnedLabelValue(ARTIFACT_LABEL) === "manifest");
    if (!manifestNote) throw new Error("Staged package manifest not found while restoring pin state");
    await replaceAttribute(manifestNote, "label", PINNED_LABEL, pinned ? "true" : "false");
}

function createTransactionId() {
    return `update-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function applyEnabledState(notes, enabled) {
    for (const note of notes) {
        for (const labelName of ACTIVATION_LABELS) {
            const disabled = note.getOwnedLabels(`disabled:${labelName}`);
            const active = note.getOwnedLabels(labelName);
            if (enabled) {
                for (const attribute of disabled) {
                    await removeAttribute(note, attribute);
                    await addAttribute(note, "label", labelName, attribute.value);
                }
            } else {
                for (const attribute of active) {
                    await removeAttribute(note, attribute);
                    await addAttribute(note, "label", `disabled:${labelName}`, attribute.value);
                }
            }
        }
        if (note.getOwnedLabelValue(ARTIFACT_LABEL) === "manifest") {
            await replaceAttribute(note, "label", ENABLED_LABEL, enabled ? "true" : "false");
        }
        await setLauncherVisibility(note, enabled);
    }
    await api.reloadNotes(notes.map((note) => note.noteId));
}

function packageSettingsFromNote(note, manifest) {
    return Object.fromEntries((manifest.settings || []).map((setting) => {
        const stored = note.getOwnedLabelValue(settingLabelName(setting.key));
        return [setting.key, stored === null ? setting.default : normalizeSettingValue(parseSettingValue(stored, setting), setting)];
    }));
}

function packageSettingsSnapshot(note, manifest) {
    const values = packageSettingsFromNote(note, manifest);
    for (const attribute of note.getOwnedLabels().filter((candidate) => candidate.name.startsWith("packageSetting:"))) {
        const key = attribute.name.slice("packageSetting:".length);
        if (!Object.prototype.hasOwnProperty.call(values, key)) {
            values[key] = parseSettingValue(attribute.value, { type: "string" });
        }
    }
    return values;
}

function normalizeSettingValue(value, setting) {
    if (setting.type === "boolean") return typeof value === "boolean" ? value : value === "true";
    if (setting.type === "number") return typeof value === "number" && Number.isFinite(value) ? value : Number.isFinite(Number(value)) ? Number(value) : setting.default;
    if (setting.type === "select") return typeof value === "string" && (!setting.options?.length || setting.options.includes(value)) ? value : setting.default;
    return typeof value === "string" ? value : value === undefined || value === null ? setting.default : String(value);
}

async function backupPackageConfiguration(manifest, previousManifest, settings, enabled, pinned) {
    const root = await ensureRootNote();
    const createdAt = new Date().toISOString();
    await createNote(root.noteId, {
        title: `${manifest.name} configuration backup ${createdAt}`,
        type: "code",
        mime: "application/json",
        content: JSON.stringify({
            schemaVersion: CONFIG_BACKUP_SCHEMA_VERSION,
            packageId: manifest.id,
            packageVersion: previousManifest.getOwnedLabelValue(VERSION_LABEL) || "unknown",
            capturedAt: createdAt,
            settings,
            enabled: Boolean(enabled),
            pinned: Boolean(pinned)
        }, null, 2),
        attributes: [
            { type: "label", name: CONFIG_BACKUP_LABEL },
            { type: "label", name: OWNER_LABEL, value: manifest.id },
            { type: "label", name: CONFIG_BACKUP_VERSION_LABEL, value: previousManifest.getOwnedLabelValue(VERSION_LABEL) || "unknown" },
            { type: "label", name: CONFIG_BACKUP_CREATED_AT_LABEL, value: createdAt }
        ]
    });
}

async function readLatestConfigBackup(packageId) {
    const notes = (await searchPackageNotes(`#${CONFIG_BACKUP_LABEL}`))
        .filter((note) => !note.isArchived && note.getOwnedLabelValue(OWNER_LABEL) === packageId)
        .sort((left, right) => String(right.getOwnedLabelValue(CONFIG_BACKUP_CREATED_AT_LABEL) || "").localeCompare(String(left.getOwnedLabelValue(CONFIG_BACKUP_CREATED_AT_LABEL) || "")));
    for (const note of notes) {
        try {
            const value = JSON.parse(await note.getContent());
            if (value?.schemaVersion === CONFIG_BACKUP_SCHEMA_VERSION && value.packageId === packageId && value.settings && typeof value.settings === "object") return value;
        } catch {
            // Ignore a damaged backup and try the next retained snapshot.
        }
    }
    return null;
}

async function pruneConfigBackups(packageId) {
    const notes = (await searchPackageNotes(`#${CONFIG_BACKUP_LABEL}`))
        .filter((note) => !note.isArchived && note.getOwnedLabelValue(OWNER_LABEL) === packageId)
        .sort((left, right) => String(right.getOwnedLabelValue(CONFIG_BACKUP_CREATED_AT_LABEL) || "").localeCompare(String(left.getOwnedLabelValue(CONFIG_BACKUP_CREATED_AT_LABEL) || "")));
    const stale = notes.slice(CONFIG_BACKUP_RETENTION);
    for (const note of stale) await addAttribute(note, "label", "archived");
    if (stale.length) await api.reloadNotes(stale.map((note) => note.noteId));
}

async function installArtifact(parentNoteId, manifest, artifact, source, transactionId = "") {
    const title = artifact.title || `${manifest.name}: ${artifact.id}`;
    const attributes = [...packageAttributes(manifest, artifact.id, transactionId), ...activationAttributes(artifact)];
    const mime = artifactMime(artifact.type);

    if (artifact.type === "render") {
        const render = await createNote(parentNoteId, {
            title,
            type: "render",
            content: "",
            attributes: packageAttributes(manifest, artifact.id, transactionId)
        });
        const code = await createNote(render.noteId, { title, type: "code", mime: "text/jsx", content: source, attributes });
        await replaceAttribute(render, "relation", "renderNote", code.noteId);
        return;
    }

    const code = await createNote(parentNoteId, { title, type: "code", mime, content: source, attributes });
    if (artifact.type === "launcher") {
        await createNote("_lbAvailableLaunchers", {
            title: `${title} launcher`,
            type: "launcher",
            content: "",
            attributes: [
                ...packageAttributes(manifest, artifact.id, transactionId),
                ...activationAttributes(artifact),
                { type: "relation", name: "widget", value: code.noteId }
            ]
        });
    }
}

function packageAttributes(manifest, artifactId = "manifest", transactionId = "") {
    const artifact = (manifest.artifacts || []).find((candidate) => candidate.id === artifactId);
    return [
        { type: "label", name: MANAGED_LABEL },
        { type: "label", name: OWNER_LABEL, value: manifest.id },
        { type: "label", name: VERSION_LABEL, value: manifest.version },
        { type: "label", name: ARTIFACT_LABEL, value: artifactId },
        ...(artifact?.integrity ? [{ type: "label", name: INTEGRITY_LABEL, value: artifact.integrity }] : []),
        ...(transactionId ? [{ type: "label", name: TRANSACTION_LABEL, value: transactionId }] : [])
    ];
}

function packageSettingAttributes(manifest) {
    return (manifest.settings || []).map((setting) => ({
        type: "label",
        name: settingLabelName(setting.key),
        value: serializeSetting(setting.default)
    }));
}

async function addAttribute(note, type, name, value = "") {
    await attributeRequest("PUT", `notes/${note.noteId}/attribute`, { type, name, value, isInheritable: false });
}

async function replaceAttribute(note, type, name, value = "") {
    await attributeRequest("PUT", `notes/${note.noteId}/set-attribute`, { type, name, value, isInheritable: false });
}

async function removeAttribute(note, attribute) {
    await attributeRequest("DELETE", `notes/${note.noteId}/attributes/${attribute.attributeId}`);
}

async function attributeRequest(method, path, body) {
    const headers: Record<string, string> = {
        "x-csrf-token": window.glob.csrfToken || "",
        "trilium-component-id": window.glob.componentId || "",
        ...(body ? { "content-type": "application/json" } : {})
    };
    let response = await fetch(`${window.glob.baseApiUrl}${path}`, {
        method,
        credentials: "same-origin",
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    if (response.status === 403) {
        const bootstrap = await fetch(`./bootstrap${window.location.search}`, { credentials: "same-origin", cache: "no-store" });
        if (bootstrap.ok) {
            const json = await bootstrap.json();
            window.glob.csrfToken = json.csrfToken;
            headers["x-csrf-token"] = json.csrfToken;
            response = await fetch(`${window.glob.baseApiUrl}${path}`, {
                method,
                credentials: "same-origin",
                headers,
                body: body ? JSON.stringify(body) : undefined
            });
        }
    }

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`${method} ${path} failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }
}

function settingLabelName(key) {
    return `packageSetting:${key}`;
}

function parseSettingValue(value, setting) {
    try {
        return JSON.parse(value);
    } catch {
        if (setting.type === "boolean") return value === "true";
        if (setting.type === "number") return Number(value);
        return value;
    }
}

function serializeSetting(value) {
    return value === undefined ? "" : JSON.stringify(value);
}

function isNewerVersion(candidate, installed) {
    const candidateParts = candidate.split(/[.-]/).slice(0, 3).map(Number);
    const installedParts = installed.split(/[.-]/).slice(0, 3).map(Number);
    if (candidateParts.length !== 3 || installedParts.length !== 3 || [...candidateParts, ...installedParts].some(Number.isNaN)) return false;
    for (let index = 0; index < 3; index++) {
        if (candidateParts[index] !== installedParts[index]) return candidateParts[index] > installedParts[index];
    }
    return false;
}

function isBundleEntry(entry) {
    return Boolean(entry && typeof entry === "object" && entry.kind === "bundle");
}

function isCatalogEntry(value) {
    return manifestProblems(value).length === 0 || bundleProblems(value).length === 0;
}

function catalogPackageById(catalog, id) {
    return catalog.find((entry) => !isBundleEntry(entry) && entry.id === id) || null;
}

function bundleComponents(bundle, catalog) {
    return (bundle.components || [])
        .map((reference) => catalogPackageById(catalog, reference.id))
        .filter(Boolean);
}

function defaultBundleSelection(bundle) {
    return (bundle.components || [])
        .filter((reference) => reference.required || reference.defaultEnabled)
        .map((reference) => reference.id);
}

function resolveDependencies(manifest, installed, catalog) {
    const packages = [];
    const problems = [];
    const planned = new Set();
    const visiting = new Set([manifest.id]);

    function visit(current, chain) {
        for (const dependency of current.dependencies || []) {
            const installedPackage = installed[dependency.id];
            if (installedPackage) {
                if (!versionSatisfies(dependency.version, installedPackage.version)) {
                    problems.push(`${dependency.id} requires ${dependency.version}, installed ${installedPackage.version}`);
                }
                continue;
            }
            if (dependency.optional) continue;

            const available = catalog.find((candidate) => candidate.id === dependency.id);
            if (!available) {
                problems.push(`${dependency.id} ${dependency.version} is not available in the registry`);
                continue;
            }
            if (visiting.has(dependency.id)) {
                problems.push(`${dependency.id} has a dependency cycle (${[...chain, dependency.id].join(" → ")})`);
                continue;
            }
            if (planned.has(dependency.id)) continue;

            visiting.add(dependency.id);
            visit(available, [...chain, dependency.id]);
            visiting.delete(dependency.id);
            planned.add(dependency.id);
            packages.push(available);
        }
    }

    visit(manifest, [manifest.id]);
    return { packages, errors: [...new Set(problems)] };
}

function networkPermissionProblems(manifests, allowNetworkPackages) {
    if (allowNetworkPackages) return [];
    return [...new Set(manifests
        .filter((manifest) => (manifest.permissions || []).includes("network"))
        .map((manifest) => `${manifest.name} requests network access. Enable it in package settings before installing.`))];
}

function compatibilityProblems(manifests) {
    const currentVersion = window.glob?.triliumVersion;
    return [...new Set(manifests.flatMap((manifest) => {
        const compatibility = manifest.compatibility;
        if (!compatibility?.minTriliumVersion) return [`${manifest.name} does not declare a minimum Trilium version.`];
        if (!currentVersion) return [`Cannot verify ${manifest.name}: the current Trilium version is unavailable.`];

        const minimumComparison = compareVersions(currentVersion, compatibility.minTriliumVersion);
        if (minimumComparison === null) return [`${manifest.name} has an invalid minimum Trilium version: ${compatibility.minTriliumVersion}.`];
        if (minimumComparison < 0) return [`${manifest.name} requires Trilium ${compatibility.minTriliumVersion} or newer (running ${currentVersion}).`];

        if (compatibility.maxTriliumVersion) {
            const maximumComparison = compareVersions(currentVersion, compatibility.maxTriliumVersion);
            if (maximumComparison === null) return [`${manifest.name} has an invalid maximum Trilium version: ${compatibility.maxTriliumVersion}.`];
            if (maximumComparison > 0) return [`${manifest.name} supports Trilium ${compatibility.maxTriliumVersion} or older (running ${currentVersion}).`];
        }
        return [];
    }))];
}

function sourceHostProblems(manifests, allowedSourceHosts) {
    const problems = [];
    for (const manifest of manifests) {
        for (const artifact of manifest.artifacts || []) {
            try {
                const sourceUrl = resolveSource(manifest.repository, artifact.source);
                const problem = downloadUrlProblem(sourceUrl, allowedSourceHosts);
                if (problem) problems.push(`${manifest.name} artifact ${artifact.id}: ${problem}`);
            } catch {
                problems.push(`${manifest.name} has an invalid source URL for ${artifact.id}.`);
            }
        }
    }
    return [...new Set(problems)];
}

function downloadUrlProblem(url, allowedSourceHosts, redirectFrom = "") {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return "source URL is invalid";
    }
    const isLocalHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !isLocalHttp) return "source URL must use HTTPS (HTTP is only allowed for localhost development)";

    const allowed = String(allowedSourceHosts || "")
        .split(/[\s,]+/)
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean);
    const hostname = parsed.hostname.toLowerCase();
    const isAllowed = (host) => allowed.some((entry) => entry.startsWith("*.")
        ? host === entry.slice(2) || host.endsWith(`.${entry.slice(2)}`)
        : host === entry);
    if (allowed.length && !isAllowed(hostname)) return `downloads from ${hostname}, which is not in the source-host allowlist`;

    if (redirectFrom) {
        let original;
        try {
            original = new URL(redirectFrom);
        } catch {
            return "original source URL is invalid";
        }
        if (original.hostname.toLowerCase() !== hostname && !isAllowed(hostname)) {
            return `redirected from ${original.hostname} to ${hostname}; add the destination host to the source-host allowlist before continuing`;
        }
    }
    return "";
}

function confirmPackageAction(action, manifest, dependencies) {
    const packages = [manifest, ...dependencies];
    const permissions = [...new Set(packages.flatMap((entry) => entry.permissions || []))];
    const lines = [`${action} ${manifest.name} v${manifest.version}?`];
    if (dependencies.length) lines.push(`Required dependencies (installed disabled): ${dependencies.map((entry) => `${entry.name} v${entry.version}`).join(", ")}`);
    lines.push(`Permissions: ${permissions.length ? permissions.join(", ") : "none declared"}`);
    lines.push("Package artifacts will be downloaded from their declared repositories.");
    return window.confirm(lines.join("\n"));
}

function confirmBundleAction(bundle, manifests) {
    const permissions = [...new Set(manifests.flatMap((entry) => entry.permissions || []))];
    const names = manifests.map((entry) => `${entry.name} v${entry.version}`).join(", ");
    const lines = [`Install selected apps from ${bundle.name}?`, `Apps: ${names}`, `Permissions: ${permissions.length ? permissions.join(", ") : "none declared"}`];
    lines.push("Each app will be installed disabled and can be managed independently in Settings → Plugins.");
    lines.push("Package artifacts will be downloaded from their declared repositories.");
    return window.confirm(lines.join("\n"));
}

function compareVersions(left, right) {
    const leftParts = parseVersionParts(left);
    const rightParts = parseVersionParts(right);
    if (!leftParts || !rightParts) return null;
    return compareVersionParts(leftParts, rightParts);
}

function parseVersionParts(version) {
    const parts = String(version || "").split(/[.-]/).slice(0, 3).map(Number);
    return parts.length === 3 && parts.every((part) => Number.isInteger(part) && part >= 0) ? parts : null;
}

function versionSatisfies(range, version) {
    const normalized = String(range || "").trim();
    if (normalized === "*" || normalized === "latest") return true;
    const caret = normalized.startsWith("^");
    const wanted = caret ? normalized.slice(1) : normalized;
    const candidateParts = version.split(/[.-]/).slice(0, 3).map(Number);
    const wantedParts = wanted.split(/[.-]/).slice(0, 3).map(Number);
    if (candidateParts.length !== 3 || wantedParts.length !== 3 || [...candidateParts, ...wantedParts].some(Number.isNaN)) return false;
    const comparison = compareVersionParts(candidateParts, wantedParts);
    return caret ? comparison >= 0 && candidateParts[0] === wantedParts[0] : comparison === 0;
}

function compareVersionParts(left, right) {
    for (let index = 0; index < 3; index++) {
        if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
    }
    return 0;
}

function activationAttributes(artifact) {
    const attributes = [];
    const disabled = (name, value) => attributes.push({ type: "label", name: `disabled:${name}`, value });
    if (artifact.type === "widget") disabled("widget");
    if (artifact.type === "launcher") disabled("launcherType", "customWidget");
    if (artifact.type === "css") disabled("appCss");
    if (artifact.type === "theme") disabled("appTheme", artifact.title || "community");
    if (artifact.activation === "startup") disabled("run", artifact.type === "backend" ? "backendStartup" : "frontendStartup");
    if (artifact.activation === "schedule" && artifact.schedule) disabled("run", artifact.schedule);
    if (artifact.activation === "request" && artifact.route) disabled("customRequestHandler", artifact.route);
    return attributes;
}

function artifactMime(type) {
    if (type === "css" || type === "theme") return "text/css";
    if (type === "launcher" || type === "render") return "text/jsx";
    if (["backend", "endpoint", "resource"].includes(type)) return "application/javascript;env=backend";
    return "application/javascript;env=frontend";
}

function resolveSource(repository, source) {
    if (/^https?:\/\//i.test(source)) return source;
    const base = repository.replace(/\.git\/?$/, "").replace(/\/$/, "");
    const github = base.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)$/i);
    if (github) return `https://raw.githubusercontent.com/${github[1]}/HEAD/${source.replace(/^\//, "")}`;
    return new URL(`${source.replace(/^\//, "")}`, `${base}/`).href;
}

function manifestProblems(value) {
    const errors: string[] = [];
    if (!value || typeof value !== "object") return ["manifest must be an object"];
    if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(value.id)) errors.push("id must use the author/name format");
    if (typeof value.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)) errors.push("version must use semantic versioning");
    for (const key of ["name", "description", "repository"]) {
        if (typeof value[key] !== "string" || !value[key].trim()) errors.push(`${key} is required`);
    }
    if (typeof value.repository === "string") {
        const problem = downloadUrlProblem(value.repository, "");
        if (problem) errors.push(`repository: ${problem}`);
    }
    if (!value.compatibility || typeof value.compatibility.minTriliumVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.compatibility.minTriliumVersion)) {
        errors.push("compatibility.minTriliumVersion is required and must use semantic versioning");
    }
    if (!Array.isArray(value.artifacts) || !value.artifacts.length) errors.push("at least one artifact is required");

    const artifactIds = new Set();
    for (const [index, artifact] of (value.artifacts || []).entries()) {
        if (!artifact || typeof artifact !== "object") {
            errors.push(`artifacts[${index}] must be an object`);
            continue;
        }
        if (typeof artifact.id !== "string" || !artifact.id.trim()) errors.push(`artifacts[${index}].id is required`);
        if (artifactIds.has(artifact.id)) errors.push(`artifacts[${index}].id is duplicated: ${artifact.id}`);
        artifactIds.add(artifact.id);
        if (!artifact.source || typeof artifact.source !== "string") errors.push(`artifacts[${index}].source is required`);
        if (!artifact.integrity || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(artifact.integrity)) errors.push(`artifacts[${index}].integrity must be a sha256-... SRI hash`);
        if (artifact.source && /^https?:\/\//i.test(artifact.source)) {
            const problem = downloadUrlProblem(artifact.source, "");
            if (problem) errors.push(`artifacts[${index}].source: ${problem}`);
        }
    }
    const artifactIdsForSurfaces = new Set((value.artifacts || []).map((artifact) => artifact?.id));
    const settingKeysForSurfaces = new Set((value.settings || []).map((setting) => setting?.key));
    const surfaceIds = new Set();
    const modalCommands = new Set(["showInfoDialog", "showConfirmDialog", "showPromptDialog", "showImportDialog", "showExportDialog"]);
    for (const [index, surface] of (value.surfaces || []).entries()) {
        if (!surface || typeof surface !== "object") {
            errors.push(`surfaces[${index}] must be an object`);
            continue;
        }
        if (typeof surface.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(surface.id)) errors.push(`surfaces[${index}].id is invalid`);
        if (surfaceIds.has(surface.id)) errors.push(`surfaces[${index}].id is duplicated: ${surface.id}`);
        surfaceIds.add(surface.id);
        if (!["page", "settings", "modal", "deeplink"].includes(surface.type)) errors.push(`surfaces[${index}].type is invalid`);
        if (typeof surface.title !== "string" || !surface.title.trim()) errors.push(`surfaces[${index}].title is required`);
        if (surface.type === "page" && (!artifactIdsForSurfaces.has(surface.artifact))) errors.push(`surfaces[${index}].artifact must reference a declared artifact`);
        if (surface.type === "settings" && (!Array.isArray(surface.settingKeys) || !surface.settingKeys.length || surface.settingKeys.some((key) => !settingKeysForSurfaces.has(key)))) errors.push(`surfaces[${index}].settingKeys must reference declared settings`);
        if (surface.type === "modal" && (!modalCommands.has(surface.command) || (surface.options !== undefined && (!surface.options || typeof surface.options !== "object" || Array.isArray(surface.options))))) errors.push(`surfaces[${index}] has an invalid modal command or options object`);
        if (surface.type === "deeplink" && (typeof surface.url !== "string" || !isSafePackageSurfaceUrl(surface.url))) errors.push(`surfaces[${index}].url is not a permitted deep link`);
    }
    const migrationKeys = new Set();
    for (const [index, migration] of (value.migrations || []).entries()) {
        if (!migration || typeof migration !== "object") {
            errors.push(`migrations[${index}] must be an object`);
            continue;
        }
        for (const key of ["fromPackageId", "fromArtifactId", "toPackageId", "toArtifactId"]) {
            if (typeof migration[key] !== "string" || !migration[key].trim()) errors.push(`migrations[${index}].${key} is required`);
        }
        for (const key of ["fromPackageId", "toPackageId"]) {
            if (typeof migration[key] === "string" && !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(migration[key])) errors.push(`migrations[${index}].${key} is invalid`);
        }
        if (migration.fromPackageId === migration.toPackageId) errors.push(`migrations[${index}] cannot keep the same package owner`);
        for (const key of ["fromIntegrity", "toIntegrity"]) {
            if (typeof migration[key] !== "string" || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(migration[key])) errors.push(`migrations[${index}].${key} must be a sha256-... SRI hash`);
        }
        const key = `${migration.fromPackageId}:${migration.fromArtifactId}->${migration.toPackageId}:${migration.toArtifactId}`;
        if (migrationKeys.has(key)) errors.push(`migrations[${index}] is duplicated: ${key}`);
        migrationKeys.add(key);
    }
    return [...new Set(errors)];
}

function isSafePackageSurfaceUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) || url.protocol === "trilium:" || url.protocol === "trilium-next:";
    } catch {
        return false;
    }
}

function bundleProblems(value) {
    const errors: string[] = [];
    if (!value || typeof value !== "object") return ["bundle must be an object"];
    if (value.kind !== "bundle") errors.push("kind must be bundle");
    if (value.schemaVersion !== undefined && value.schemaVersion !== 1) errors.push("schemaVersion must be 1");
    if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(value.id)) errors.push("id must use the author/name format");
    if (typeof value.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)) errors.push("version must use semantic versioning");
    for (const key of ["name", "description", "repository"]) {
        if (typeof value[key] !== "string" || !value[key].trim()) errors.push(`${key} is required`);
    }
    if (typeof value.repository === "string") {
        const problem = downloadUrlProblem(value.repository, "");
        if (problem) errors.push(`repository: ${problem}`);
    }
    if (!Array.isArray(value.components) || !value.components.length) errors.push("at least one bundle component is required");
    const componentIds = new Set();
    for (const [index, component] of (value.components || []).entries()) {
        if (!component || typeof component !== "object") {
            errors.push(`components[${index}] must be an object`);
            continue;
        }
        if (typeof component.id !== "string" || !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(component.id)) errors.push(`components[${index}].id must use the author/name format`);
        if (componentIds.has(component.id)) errors.push(`components[${index}].id is duplicated: ${component.id}`);
        componentIds.add(component.id);
        if (component.required !== undefined && typeof component.required !== "boolean") errors.push(`components[${index}].required must be a boolean`);
        if (component.defaultEnabled !== undefined && typeof component.defaultEnabled !== "boolean") errors.push(`components[${index}].defaultEnabled must be a boolean`);
    }
    return [...new Set(errors)];
}

function errorMessage(cause) {
    return cause instanceof Error ? cause.message : String(cause);
}
