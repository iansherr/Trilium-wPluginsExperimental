import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const managerSource = await readFile(new URL("../../apps/client/src/widgets/type_widgets/options/community_packages.tsx", import.meta.url), "utf8");
const pluginsSource = await readFile(new URL("../../apps/client/src/widgets/type_widgets/options/plugins.tsx", import.meta.url), "utf8");

test("package branch moves use Trilium's move-to endpoint", () => {
    assert.match(
        managerSource,
        /packageRequest\("PUT", `branches\/\$\{sourceBranch\.branchId\}\/move-to\/\$\{targetParentBranch\.branchId\}`\)/
    );
    assert.doesNotMatch(managerSource, /packageRequest\("POST", "branches"/);
});

test("package-owned note lookups use hidden-aware quick search", () => {
    assert.match(managerSource, /async function searchPackageNotes\(searchString\)/);
    assert.match(managerSource, /quick-search\/\$\{encodeURIComponent\(searchString\)\}/);
    assert.match(managerSource, /result\.searchResultNoteIds/);
    assert.doesNotMatch(managerSource, /api\.searchForNote\(?s?\(/);

    for (const functionName of ["readSettings", "readInstalledPackages", "ensureRootNote", "packageNotes", "transactionNotes", "readInterruptedTransactions"]) {
        const functionStart = managerSource.indexOf(`async function ${functionName}`);
        assert.notEqual(functionStart, -1, `${functionName} should exist`);
        const functionEnd = managerSource.indexOf("\n}\n", functionStart);
        const functionSource = managerSource.slice(functionStart, functionEnd === -1 ? undefined : functionEnd);
        assert.match(functionSource, /searchPackageNotes\(/, `${functionName} should use hidden-aware lookup`);
    }
});

test("catalog bundles keep component selection separate from package lifecycle", () => {
    assert.match(managerSource, /function isBundleEntry\(entry\)/);
    assert.match(managerSource, /Install selected \(\$\{selectedAvailableCount\}\)/);
    assert.match(managerSource, /each selected app keeps its own settings and lifecycle/);
    assert.match(managerSource, /installPackageSafely\(manifests, allowedSourceHosts, packages\)/);
    assert.match(managerSource, /function bundleComponents\(bundle, catalog\)/);
});

test("catalog keeps installed packages as discovery entries", () => {
    assert.match(managerSource, /const updateAvailable = entry && isNewerVersion\(manifest\.version, entry\.version\)/);
    assert.match(managerSource, /text="Manage in Plugins"/);
    assert.match(managerSource, /text=\{busyPackage === manifest\.id \? "Updating…" : "Update"\}/);
    assert.match(managerSource, /onClick=\{\(\) => update\(manifest\)\}/);
});

test("catalog surfaces legacy source labels instead of hiding them", () => {
    assert.match(managerSource, /const LEGACY_DIRECT_MANIFEST_URLS_LABEL = "packageDirectManifestUrls"/);
    assert.match(managerSource, /sources: parseConfiguredSources\(note\)/);
    assert.match(managerSource, /function parseConfiguredSources\(note\)/);
    assert.match(managerSource, /note\?\.getOwnedLabelValue\(LEGACY_DIRECT_MANIFEST_URLS_LABEL\)/);
});

test("plugin settings canonicalize and mirror legacy source labels on save", () => {
    assert.match(pluginsSource, /const PACKAGE_DIRECT_MANIFEST_URLS_LABEL = "packageDirectManifestUrls"/);
    assert.match(pluginsSource, /parseConfiguredPluginSources\(\(labelName\) => settings\?\.getOwnedLabelValue\(labelName\)\)/);
    assert.match(pluginsSource, /setLabel\(state\.settings\.noteId, PACKAGE_SOURCES_LABEL, JSON\.stringify\(sources\)\)/);
    assert.match(pluginsSource, /buildLegacyPluginSourceLabels\(sources\)/);
    assert.match(pluginsSource, /setLabel\(state\.settings\.noteId, PACKAGE_REGISTRY_URL_LABEL, legacySources\.packageRegistryUrl\)/);
    assert.match(pluginsSource, /setLabel\(state\.settings\.noteId, PACKAGE_DIRECT_MANIFEST_URLS_LABEL, legacySources\.packageDirectManifestUrls\)/);
});

test("plugin settings enable and disable every managed artifact activation", () => {
    assert.match(pluginsSource, /setPackageArtifactActivation\(pkg\.id, enabled\)/);
    assert.match(pluginsSource, /search\.searchForNotesIncludingHidden\(`#packageOwner="\$\{packageId\}"`\)/);
    assert.match(pluginsSource, /PACKAGE_ACTIVATION_LABELS = \["widget", "appCss", "appTheme", "run", "customRequestHandler", "launcherType"\]/);
    assert.match(pluginsSource, /removeOwnedAttributesByNameOrType\(note, "label", disabledName\)/);
    assert.match(pluginsSource, /removeOwnedAttributesByNameOrType\(note, "label", labelName\)/);
    assert.match(pluginsSource, /setLauncherVisibility\(note, enabled\)/);
});

test("plugin settings owns installed lifecycle and manifest entry points", () => {
    assert.match(pluginsSource, /async function setPackageArchived\(pkg: PackageSummary, archived: boolean\)/);
    assert.match(pluginsSource, /async function deletePackage\(pkg: PackageSummary\)/);
    assert.match(pluginsSource, /archivedPackages/);
    assert.match(pluginsSource, /onArchive=\{\(\) => void setPackageArchived\(pkg, true\)\}/);
    assert.match(pluginsSource, /onClick=\{\(\) => void deletePackage\(pkg\)\}/);
    assert.match(pluginsSource, /type PackageSurfaceType = "page" \| "settings" \| "modal" \| "deeplink"/);
    assert.match(pluginsSource, /PACKAGE_MODAL_COMMANDS/);
    assert.match(pluginsSource, /openPackageSurface\(pkg, surface\)/);
});

test("plugin settings puts updates first and hides an empty archive section", () => {
    const updatesIndex = pluginsSource.indexOf('title={t("plugins.updates_title")}');
    const availableIndex = pluginsSource.indexOf('title={t("plugins.available_title")}');
    assert.notEqual(updatesIndex, -1);
    assert.notEqual(availableIndex, -1);
    assert.ok(updatesIndex < availableIndex, "updates should be the first plugin section");
    assert.match(pluginsSource, /state\.archivedPackages\.length > 0 && <OptionsSection/);
    assert.doesNotMatch(pluginsSource, /!state\.loading && !state\.archivedPackages\.length && <NoItems icon="bx bx-archive"/);
});

test("archived plugins are collapsed by default and support bulk cleanup", () => {
    assert.match(pluginsSource, /const \[archivedExpanded, setArchivedExpanded\] = useState\(false\)/);
    assert.match(pluginsSource, /async function deleteArchivedPackages\(\)/);
    assert.match(pluginsSource, /delete_archived_confirm/);
    assert.match(pluginsSource, /cleanup_archived_label/);
    assert.match(pluginsSource, /aria-expanded=\{archivedExpanded\}/);
    assert.match(pluginsSource, /disabled=\{Boolean\(savingPackage\)\}/);
});

test("JSX launcher and render artifacts use the JSX MIME", () => {
    assert.match(managerSource, /if \(type === "launcher" \|\| type === "render"\) return "text\/jsx"/);
});

test("catalog reports broken installations without owning repair", () => {
    assert.match(managerSource, /entry\.health === "broken"/);
    assert.match(managerSource, /const status = !entry[\s\S]*?"Repair needed"/);
    assert.match(managerSource, /text="Manage in Plugins"/);
    assert.doesNotMatch(managerSource, /onClick=\{\(\) => repair\(entry\)\}/);
});

test("interrupted stages retain recoverable manager internals", () => {
    assert.match(managerSource, /const \[interruptedTransactions, setInterruptedTransactions\]/);
    assert.match(managerSource, /async function recoverInterruptedTransactions\(\)/);
    assert.match(managerSource, /await archiveTransactionNotes\(transactionId\)/);
    assert.match(managerSource, /await clearTransaction\(transactionId, notes\)/);
    assert.doesNotMatch(managerSource, /Interrupted package operation detected\./);
});

test("ownership migrations require a staged source replacement and rollback markers", () => {
    assert.match(managerSource, /function applyPackageMigrations\(manifests, stagedNotes, catalog, transactionId\)/);
    assert.match(managerSource, /migration requires an updated/);
    assert.match(managerSource, /migration cannot transfer/);
    assert.match(managerSource, /function rollbackPackageMigrations\(transactionId\)/);
    assert.match(managerSource, /await rollbackPackageMigrations\(transactionId\)/);
    assert.match(managerSource, /packageMigrationFromIntegrity/);
});

test("unfinished migration notes are excluded from ordinary package state", () => {
    assert.match(managerSource, /!isTransactionNote\(note\) && !isMigrationNote\(note\)/);
    assert.match(managerSource, /function isMigrationNote\(note\)/);
    assert.match(managerSource, /searchPackageNotes\(`#\$\{MIGRATION_TRANSACTION_LABEL\}`\)/);
});

test("package updates persist versioned configuration backups and inherit them on reinstall", () => {
    assert.match(managerSource, /const CONFIG_BACKUP_LABEL = "packageConfigBackup"/);
    assert.match(managerSource, /schemaVersion: CONFIG_BACKUP_SCHEMA_VERSION/);
    assert.match(managerSource, /async function backupPackageConfiguration\(manifest, previousManifest, settings, enabled, pinned\)/);
    assert.match(managerSource, /type: "code",\s*mime: "application\/json"/);
    assert.match(managerSource, /async function readLatestConfigBackup\(packageId\)/);
    assert.match(managerSource, /await restorePackageSettings\(stagedPackageNotes, manifest, backup\.settings \|\| \{\}\)/);
    assert.match(managerSource, /function packageSettingsSnapshot\(note, manifest\)/);
    assert.match(managerSource, /candidate\.name\.startsWith\("packageSetting:"\)/);
});

test("package storage reports archived generations and bounds active configuration backups", () => {
    assert.match(managerSource, /async function readPackageStorageSummary\(\)/);
    assert.match(managerSource, /archivedGenerations:/);
    assert.match(managerSource, /archivedManagedNotes:/);
    assert.match(managerSource, /const CONFIG_BACKUP_RETENTION = 5/);
    assert.match(managerSource, /const stale = notes\.slice\(CONFIG_BACKUP_RETENTION\)/);
    assert.match(managerSource, /for \(const note of stale\) await addAttribute\(note, "label", "archived"\)/);
});

test("ownership migrations move managed child artifacts with their transferred parent", () => {
    assert.match(managerSource, /const sourceNoteTargets = new Map\(\)/);
    assert.match(managerSource, /sourceNoteTargets\.set\(sourceArtifact\.noteId, targetArtifactNote\.noteId\)/);
    assert.match(managerSource, /sourceNoteTargets\.has\(branch\.parentNoteId\)/);
    assert.match(managerSource, /moveNoteToParent\(note, toParent, \(branch\) => branch\.parentNoteId === fromParent\)/);
    assert.match(managerSource, /const targetArtifactNotes = targetNotes\.filter/);
    assert.match(managerSource, /const stagedReplacements = \[\.\.\.new Set\(migrationContexts\.flatMap\(\(context\) => context\.targetArtifactNotes\)\)\]/);
    assert.match(managerSource, /await archiveNotes\(stagedReplacements\)/);
    assert.match(managerSource, /await applyEnabledState\(sourceArtifacts, sourceEnabled\)/);
});
