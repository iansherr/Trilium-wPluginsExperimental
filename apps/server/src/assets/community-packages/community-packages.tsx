/**
 * @trilium-script
 *
 * id: community-packages-manager
 * type: render
 * title: Community Packages
 */

import { showMessage, triggerCommand } from "trilium:api";
import { Admonition, Button, FormGroup, FormTextBox, FormToggle, LoadingSpinner, useEffect, useState } from "trilium:preact";

const DEFAULT_REGISTRY_URL = "";
const REGISTRY_URL_LABEL = "packageRegistryUrl";
const REGISTRY_URLS_LABEL = "packageRegistryUrls";
const DIRECT_MANIFEST_URLS_LABEL = "packageDirectManifestUrls";
const ROOT_LABEL = "communityPackagesRoot";
const SETTINGS_LABEL = "packageManagerSettings";
const MANAGED_LABEL = "packageManaged";
const OWNER_LABEL = "packageOwner";
const VERSION_LABEL = "packageVersion";
const ARTIFACT_LABEL = "packageArtifact";
const ENABLED_LABEL = "packageEnabled";
const PINNED_LABEL = "packagePinned";
const TRANSACTION_LABEL = "packageTransaction";
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
    const [registryUrls, setRegistryUrls] = useState([]);
    const [directManifestUrls, setDirectManifestUrls] = useState([]);
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
    const [configuredPackage, setConfiguredPackage] = useState("");
    const [detailsPackage, setDetailsPackage] = useState("");
    const [packageValues, setPackageValues] = useState({});
    const [searchQuery, setSearchQuery] = useState("");
    const [interruptedTransactions, setInterruptedTransactions] = useState([]);

    useEffect(() => {
        void initialize();
    }, []);

    useEffect(() => {
        if (!checkForUpdates || (!registryUrls.length && !directManifestUrls.length)) return;
        const intervalHours = Math.max(1, Number(updateCheckIntervalHours) || 24);
        const timer = window.setInterval(() => void refresh(registryUrls, directManifestUrls), intervalHours * 60 * 60 * 1000);
        return () => window.clearInterval(timer);
    }, [checkForUpdates, updateCheckIntervalHours, registryUrls, directManifestUrls]);

    async function initialize() {
        const settings = await readSettings();
        setRegistryUrls(settings.registryUrls);
        setDirectManifestUrls(settings.directManifestUrls);
        setAllowNetworkPackages(settings.allowNetworkPackages);
        setAllowedSourceHosts(normalizeSourceHosts(settings.allowedSourceHosts));
        setCheckForUpdates(settings.checkForUpdates);
        setUpdateCheckIntervalHours(settings.updateCheckIntervalHours);
        setIncludeDeprecatedPackages(settings.includeDeprecatedPackages);
        await refresh(settings.registryUrls, settings.directManifestUrls);
    }

    async function refresh(urls = registryUrls, directUrls = directManifestUrls) {
        setLoading(true);
        setError("");
        try {
            const installedPackages = await readInstalledPackages();
            setInstalled(installedPackages);
            setInterruptedTransactions(await readInterruptedTransactions());
            const registrySources = urls.filter(Boolean);
            const directSources = directUrls.filter(Boolean);
            if (!registrySources.length && !directSources.length) {
                setPackages([]);
                return;
            }

            const registryResults = registrySources.map(async (url) => {
                const index = await fetchJsonSource(url);
                if (!Array.isArray(index.packages)) throw new Error(`${url} does not contain a packages array`);
                return index.packages.filter(isManifest);
            });
            const directResults = directSources.map(async (url) => {
                const manifest = await fetchJsonSource(url);
                if (!isManifest(manifest)) throw new Error(`${url} is not a valid plugin manifest`);
                return [manifest];
            });
            const results = await Promise.allSettled([...registryResults, ...directResults]);
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
            await installPackageSafely([...dependencyResolution.packages, manifest], allowedSourceHosts);
            showMessage(`${manifest.name} installed disabled. Enable it here when ready.`);
            await refresh(registryUrls, directManifestUrls);
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
            await replacePackage(manifest, false, allowedSourceHosts, dependencyResolution.packages);
            showMessage(`${manifest.name} updated disabled. Enable it here when ready.`);
            await refresh(registryUrls, directManifestUrls);
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
            await replacePackage(manifest, true, allowedSourceHosts, dependencyResolution.packages);
            showMessage(`${manifest.name} repaired.`);
            await refresh(registryUrls, directManifestUrls);
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            await endPackageOperation();
            setBusyPackage("");
        }
    }

    async function setEnabled(packageId, enabled) {
        let owned;
        try {
            owned = await packageNotes(packageId);
        } catch (cause) {
            setError(errorMessage(cause));
            return;
        }
        if (!enabled && !window.confirm([
            `Disable ${packageId}?`,
            "This will turn off the package's scripts, styles, widgets, and launchers. Its package files and settings will remain installed so it can be enabled again.",
            packageImpactSummary(owned),
            "No user-authored notes will be changed."
        ].join("\n\n"))) return;
        if (!(await beginPackageOperation(setError))) return;
        setBusyPackage(packageId);
        try {
            await applyEnabledState(owned, enabled);
            showMessage(`${packageId} ${enabled ? "enabled" : "disabled"}.`);
            await refresh(registryUrls, directManifestUrls);
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
            await refresh(registryUrls, directManifestUrls);
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            await endPackageOperation();
            setBusyPackage("");
        }
    }

    async function setPinned(packageId, pinned) {
        if (!(await beginPackageOperation(setError))) return;
        setBusyPackage(packageId);
        try {
            const note = await api.getNote(installed[packageId].noteId);
            if (!note) throw new Error(`Installed package note not found: ${packageId}`);
            await replaceAttribute(note, "label", PINNED_LABEL, pinned ? "true" : "false");
            showMessage(`${packageId} updates ${pinned ? "pinned" : "unpinned"}.`);
            await refresh(registryUrls, directManifestUrls);
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            await endPackageOperation();
            setBusyPackage("");
        }
    }

    async function configurePackage(entry, manifest) {
        try {
            setConfiguredPackage(entry.id);
            setPackageValues(await readPackageSettings(entry.noteId, manifest));
        } catch (cause) {
            setError(errorMessage(cause));
        }
    }

    async function savePackageSettings(packageId, manifest) {
        if (!(await beginPackageOperation(setError))) return;
        setBusyPackage(packageId);
        try {
            const note = await api.getNote(installed[packageId].noteId);
            if (!note) throw new Error(`Installed package note not found: ${packageId}`);
            for (const setting of manifest.settings || []) {
                const labelName = settingLabelName(setting.key);
                await replaceAttribute(note, "label", labelName, serializeSetting(packageValues[setting.key]));
            }
            await api.reloadNotes([note.noteId]);
            showMessage(`${manifest.name} settings saved.`);
            setConfiguredPackage("");
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            await endPackageOperation();
            setBusyPackage("");
        }
    }

    async function archivePackage(packageId) {
        let owned;
        try {
            owned = await packageNotes(packageId);
        } catch (cause) {
            setError(errorMessage(cause));
            return;
        }
        if (!window.confirm([
            `Uninstall ${packageId}?`,
            "This will disable the package and remove its managed files, settings, and launchers from the active plugin list.",
            packageImpactSummary(owned),
            "The package-managed notes will remain recoverable under Archived notes. No user-authored notes will be changed.",
            "Permanent deletion is not part of this uninstall action."
        ].join("\n\n"))) return;
        if (!(await beginPackageOperation(setError))) return;
        setBusyPackage(packageId);
        try {
            await archiveNotes(owned);
            showMessage(`${packageId} uninstalled. Its package notes remain recoverable under Archived notes.`);
            setConfiguredPackage("");
            await refresh(registryUrls, directManifestUrls);
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
    const hasConfiguredSources = registryUrls.length > 0 || directManifestUrls.length > 0;

    function openPluginSettings() {
        triggerCommand("showOptions", { section: "_optionsPlugins" });
    }

    return (
        <div className="options" style={{ maxWidth: "900px", padding: "1.5em" }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "0.75em" }}>
                <h1 style={{ margin: 0 }}>Plugin catalog</h1>
                <Button text="Back to plugin settings" icon="bx-arrow-back" onClick={openPluginSettings} />
            </div>
            <p>Search and install community extensions. Installed plugins can be enabled or configured here.</p>

            {error && <Admonition type="warning">{error}</Admonition>}
            {interruptedTransactions.length > 0 && (
                <Admonition type="warning">
                    <div>
                        <strong>Interrupted package operation detected.</strong>
                        <p>{interruptedTransactions.length} staged operation{interruptedTransactions.length === 1 ? "" : "s"} remain from an interrupted install or update. Recovery keeps only complete stages and discards incomplete ones; recovered packages stay disabled.</p>
                        <Button text={busyPackage === "recovery" ? "Recovering…" : "Recover package operations"} kind="primary" size="small" onClick={recoverInterruptedTransactions} disabled={Boolean(busyPackage)} />
                    </div>
                </Admonition>
            )}

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
                <p className="options-section-description">Install a plugin, or manage an installed plugin’s enabled state and package settings.</p>
                <div className="options-section-card">
                    {loading && <LoadingSpinner />}
                    {!loading && !hasConfiguredSources && <p>Configure a plugin source in Settings → Plugins.</p>}
                    {!loading && hasConfiguredSources && !catalog.length && <p>{search ? `No packages match “${searchQuery}”.` : "No packages found in the configured sources."}</p>}
                    {catalog.map((manifest) => {
                        const entry = installed[manifest.id];
                        const updateAvailable = entry && isNewerVersion(manifest.version, entry.version);
                        const status = !entry ? "Available" : entry.health === "broken" ? "Broken" : updateAvailable ? "Update available" : entry.enabled ? "Enabled" : "Installed";
                        return <div key={manifest.id}>
                            <PackageRow
                                title={manifest.name}
                                status={status}
                                description={entry
                                    ? `${isNewerVersion(manifest.version, entry.version) ? `${entry.version} → ${manifest.version}` : `v${entry.version}`} · ${entry.enabled ? "enabled" : "disabled"} · ${entry.health}${entry.healthMessage ? ` (${entry.healthMessage})` : ""}`
                                    : `${manifest.description} · ${manifest.version}${manifestStatus(manifest) ? ` · ${manifestStatus(manifest)}` : ""}`}
                                action={
                                    <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "0.4em" }}>
                                        <Button
                                            text={detailsPackage === manifest.id ? "Hide details" : "Details"}
                                            size="small"
                                            onClick={() => setDetailsPackage((current) => current === manifest.id ? "" : manifest.id)}
                                            disabled={Boolean(busyPackage)}
                                        />
                                        {entry ? <>
                                            {entry.health === "broken" && (
                                                <Button
                                                    text={busyPackage === manifest.id ? "Repairing…" : "Repair"}
                                                    size="small"
                                                    kind="primary"
                                                    onClick={() => repair(entry)}
                                                    disabled={Boolean(busyPackage)}
                                                />
                                            )}
                                            {entry.health !== "broken" && isNewerVersion(manifest.version, entry.version) && (
                                                <Button
                                                    text={busyPackage === manifest.id ? "Updating…" : "Update"}
                                                    size="small"
                                                    kind="primary"
                                                    onClick={() => update(manifest)}
                                                    disabled={Boolean(busyPackage)}
                                                />
                                            )}
                                            <Button
                                                text={entry.enabled ? "Disable" : "Enable"}
                                                size="small"
                                                onClick={() => setEnabled(entry.id, !entry.enabled)}
                                                disabled={Boolean(busyPackage)}
                                            />
                                            {manifest.settings?.length > 0 && (
                                                <Button
                                                    text="Settings"
                                                    size="small"
                                                    onClick={() => configurePackage(entry, manifest)}
                                                    disabled={Boolean(busyPackage)}
                                                />
                                            )}
                                            <Button
                                                text="Uninstall"
                                                size="small"
                                                kind="lowProfile"
                                                onClick={() => archivePackage(entry.id)}
                                                disabled={Boolean(busyPackage)}
                                            />
                                        </> : (
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
                            {configuredPackage === manifest.id && entry && manifest.settings?.length > 0 && (
                                <PackageSettings
                                    manifest={manifest}
                                    values={packageValues}
                                    onChange={(key, value) => setPackageValues({ ...packageValues, [key]: value })}
                                    onSave={() => savePackageSettings(entry.id, manifest)}
                                    disabled={busyPackage === manifest.id}
                                />
                            )}
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
        ["Permissions", manifest.permissions.length ? manifest.permissions.join(", ") : "None declared"],
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
    const legacyUrl = note?.getOwnedLabelValue(REGISTRY_URL_LABEL) || DEFAULT_REGISTRY_URL;
    return {
        registryUrls: parseRegistryUrls(note?.getOwnedLabelValue(REGISTRY_URLS_LABEL) || legacyUrl),
        directManifestUrls: parseRegistryUrls(note?.getOwnedLabelValue(DIRECT_MANIFEST_URLS_LABEL) || ""),
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
    return createNote("_hidden", {
        title: "Community Packages",
        type: "book",
        content: "Packages installed by the Community Packages manager.",
        attributes: [{ type: "label", name: ROOT_LABEL }]
    });
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

async function moveNoteToParent(note, targetParentNoteId, branchFilter = () => true) {
    const sourceBranch = note.getParentBranches().find(branchFilter);
    if (!sourceBranch || sourceBranch.parentNoteId === targetParentNoteId) return;

    const targetParentNote = await api.getNote(targetParentNoteId);
    const targetParentBranch = targetParentNote?.getParentBranches()[0];
    if (!targetParentBranch) throw new Error(`Could not find the parent branch for ${targetParentNoteId}`);

    const response = await packageRequest("PUT", `branches/${sourceBranch.branchId}/move-to/${targetParentBranch.branchId}`);
    if (!response.ok) throw new Error(`Could not move ${note.title} (${response.status})`);
    await api.reloadNotes([note.noteId]);
}

async function replacePackage(manifest, preserveEnabled, allowedSourceHosts, dependencies = []) {
    const transactionId = createTransactionId();
    let previousNotes = [];
    let previousEnabled = false;
    let previousPinned = false;
    let previousSettings = {};
    try {
        previousNotes = await packageNotes(manifest.id);
        const previousManifest = previousNotes.find((note) => note.getOwnedLabelValue(ARTIFACT_LABEL) === "manifest");
        previousEnabled = previousManifest?.getOwnedLabelValue(ENABLED_LABEL) === "true";
        previousPinned = previousManifest?.getOwnedLabelValue(PINNED_LABEL) === "true";
        previousSettings = previousManifest ? packageSettingsFromNote(previousManifest, manifest) : {};

        const manifests = [...dependencies, manifest];
        await stagePackages(manifests, transactionId, allowedSourceHosts);
        const stagedNotes = await transactionNotes(transactionId);
        for (const stagedManifest of manifests) verifyStagedPackage(stagedNotes, stagedManifest);
        const stagedPackageNotes = stagedNotes.filter((note) => note.getOwnedLabelValue(OWNER_LABEL) === manifest.id);
        await restorePackageSettings(stagedPackageNotes, manifest, previousSettings);
        await restorePackagePinned(stagedPackageNotes, previousPinned);
        await archiveNotes(previousNotes);
        if (preserveEnabled && previousEnabled) await applyEnabledState(stagedPackageNotes, true);
        await clearTransaction(transactionId, stagedNotes);
    } catch (cause) {
        const rollbackErrors = [];
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

async function installPackageSafely(manifests, allowedSourceHosts) {
    const transactionId = createTransactionId();
    try {
        await stagePackages(manifests, transactionId, allowedSourceHosts);
        const stagedNotes = await transactionNotes(transactionId);
        for (const manifest of manifests) verifyStagedPackage(stagedNotes, manifest);
        await clearTransaction(transactionId, stagedNotes);
    } catch (cause) {
        const rollbackErrors = [];
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
    const digest = await crypto.subtle.digest("SHA-256", payload);
    const actual = `sha256-${arrayBufferToBase64(digest)}`;
    if (actual !== artifact.integrity) {
        throw new Error(`${manifest.name} artifact ${artifact.id} failed integrity verification (expected ${artifact.integrity}, received ${actual})`);
    }
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

function arrayBufferToBase64(buffer) {
    let binary = "";
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    return btoa(binary);
}

async function packageNotes(packageId) {
    const notes = await searchPackageNotes(`#${OWNER_LABEL}`);
    return notes.filter((note) => note.getOwnedLabelValue(OWNER_LABEL) === packageId && !note.isArchived && !isTransactionNote(note));
}

function packageImpactSummary(notes) {
    const titles = [...new Set(notes.map((note) => note.title).filter(Boolean))];
    const preview = titles.slice(0, 8).join(", ");
    const remainder = titles.length > 8 ? `, and ${titles.length - 8} more` : "";
    return `${notes.length} package-managed note${notes.length === 1 ? "" : "s"} will be affected${preview ? `: ${preview}${remainder}` : "."}`;
}

function isTransactionNote(note) {
    return Boolean(note.getOwnedLabelValue(TRANSACTION_LABEL));
}

async function archivePackageNotes(packageId) {
    const owned = await packageNotes(packageId);
    await archiveNotes(owned);
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
    const notes = await searchPackageNotes(`#${TRANSACTION_LABEL}`);
    return [...new Set(notes
        .filter((note) => !note.isArchived)
        .map((note) => note.getOwnedLabelValue(TRANSACTION_LABEL))
        .filter(Boolean))];
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
            await replaceAttribute(manifestNote, "label", settingLabelName(setting.key), serializeSetting(values[setting.key]));
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
            const activeName = labelName;
            const disabledName = `disabled:${labelName}`;
            const active = note.getOwnedLabels(activeName);
            const disabled = note.getOwnedLabels(disabledName);
            const desired = enabled ? [...active, ...disabled] : [...disabled, ...active];
            const values = [...new Set(desired.map((attribute) => attribute.value))];
            if (!values.length) continue;

            // Normalize both forms first. This makes retries safe and repairs
            // packages left with both active and disabled copies of a label.
            for (const attribute of [...active, ...disabled]) await removeAttribute(note, attribute);
            const targetName = enabled ? activeName : disabledName;
            for (const value of values) await addAttribute(note, "label", targetName, value);
        }
        if (note.getOwnedLabelValue(ARTIFACT_LABEL) === "manifest") {
            await replaceAttribute(note, "label", ENABLED_LABEL, enabled ? "true" : "false");
        }
        await setLauncherVisibility(note, enabled);
    }
    await api.reloadNotes(notes.map((note) => note.noteId));
}

async function readPackageSettings(noteId, manifest) {
    const note = await api.getNote(noteId);
    if (!note) throw new Error(`Installed package note not found: ${manifest.id}`);
    return packageSettingsFromNote(note, manifest);
}

function packageSettingsFromNote(note, manifest) {
    return Object.fromEntries((manifest.settings || []).map((setting) => {
        const stored = note.getOwnedLabelValue(settingLabelName(setting.key));
        return [setting.key, stored === null ? setting.default : parseSettingValue(stored, setting)];
    }));
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
    return [
        { type: "label", name: MANAGED_LABEL },
        { type: "label", name: OWNER_LABEL, value: manifest.id },
        { type: "label", name: VERSION_LABEL, value: manifest.version },
        { type: "label", name: ARTIFACT_LABEL, value: artifactId },
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

function PackageSettings({ manifest, values, onChange, onSave, disabled }) {
    return (
        <div style={{ padding: "0.8em 1em", marginBottom: "0.8em", background: "var(--main-background-color)", border: "1px solid var(--main-border-color)" }}>
            <h3>{manifest.name} settings</h3>
            {(manifest.settings || []).map((setting) => (
                <FormGroup key={setting.key} name={`${manifest.id}-${setting.key}`} label={setting.title} description={setting.description}>
                    <SettingEditor setting={setting} value={values[setting.key]} onChange={(value) => onChange(setting.key, value)} disabled={disabled} />
                </FormGroup>
            ))}
            <Button text="Save package settings" kind="primary" size="small" onClick={onSave} disabled={disabled} />
        </div>
    );
}

function SettingEditor({ setting, value, onChange, disabled }) {
    if (setting.type === "boolean") {
        return <FormToggle currentValue={Boolean(value)} onChange={onChange} disabled={disabled} switchOnName="Enabled" switchOffName="Disabled" />;
    }
    if (setting.type === "select") {
        return (
            <select value={value ?? ""} onChange={(event) => onChange(event.currentTarget.value)} disabled={disabled}>
                {(setting.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
        );
    }
    return (
        <FormTextBox
            type={setting.type === "secret" ? "password" : setting.type === "number" ? "number" : "text"}
            currentValue={value === undefined || value === null ? "" : String(value)}
            onChange={(newValue) => onChange(setting.type === "number" ? Number(newValue) : newValue)}
            disabled={disabled}
        />
    );
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

function isManifest(value) {
    return manifestProblems(value).length === 0;
}

function manifestProblems(value) {
    const errors = [];
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
    return [...new Set(errors)];
}

function errorMessage(cause) {
    return cause instanceof Error ? cause.message : String(cause);
}
