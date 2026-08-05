import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const managerSource = await readFile(new URL("../scripts/community-packages.tsx", import.meta.url), "utf8");

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

test("catalog exposes an explicit update action for installed newer versions", () => {
    assert.match(managerSource, /const updateAvailable = entry && isNewerVersion\(manifest\.version, entry\.version\)/);
    assert.match(managerSource, /text=\{busyPackage === manifest\.id \? "Updating…" : "Update"\}/);
    assert.match(managerSource, /onClick=\{\(\) => update\(manifest\)\}/);
    assert.match(managerSource, /text="Manage in Plugins"/);
});

test("catalog exposes repair for broken installed packages", () => {
    assert.match(managerSource, /entry\.health === "broken"/);
    assert.match(managerSource, /status = !entry \? "Available"[\s\S]*?"Repair needed"/);
    assert.match(managerSource, /text=\{busyPackage === manifest\.id \? "Repairing…" : "Repair"\}/);
    assert.match(managerSource, /onClick=\{\(\) => repair\(entry\)\}/);
});

test("interrupted stages surface recovery and keep incomplete notes recoverable", () => {
    assert.match(managerSource, /const \[interruptedTransactions, setInterruptedTransactions\]/);
    assert.match(managerSource, /Interrupted package operation detected\./);
    assert.match(managerSource, /Recovery keeps only complete stages and discards incomplete ones/);
    assert.match(managerSource, /async function recoverInterruptedTransactions\(\)/);
    assert.match(managerSource, /await archiveTransactionNotes\(transactionId\)/);
    assert.match(managerSource, /await clearTransaction\(transactionId, notes\)/);
    assert.match(managerSource, /recovered packages stay disabled/);
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
