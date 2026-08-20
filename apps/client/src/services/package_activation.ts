import type FNote from "../entities/fnote";
import { removeOwnedAttributesByNameOrType, setLabel } from "./attributes";
import froca from "./froca";
import search from "./search";
import server from "./server";

/** Labels whose names control whether Trilium executes or exposes package artifacts. */
export const PACKAGE_ACTIVATION_LABELS = ["widget", "appCss", "appTheme", "run", "customRequestHandler", "launcherType"] as const;

export interface PackageActivationRepair {
    packageId: string;
    repairedNoteIds: string[];
}

let reconciliationInProgress = false;

/**
 * Repairs only an enabled package whose activation labels were accidentally left
 * under the inert `disabled:` prefix. A package explicitly marked disabled is
 * never changed here.
 */
export async function reconcileEnabledPackageActivations(): Promise<PackageActivationRepair[]> {
    if (reconciliationInProgress) return [];
    reconciliationInProgress = true;

    try {
        await froca.initializedPromise;
        const notes = await search.searchForNotesIncludingHidden("#packageOwner");
        const packageIds = [...new Set(notes.map((note) => note.getOwnedLabelValue("packageOwner")).filter((packageId): packageId is string => !!packageId))];
        const repairs: PackageActivationRepair[] = [];

        for (const packageId of packageIds) {
            const packageNotes = notes.filter((note) => note.getOwnedLabelValue("packageOwner") === packageId);
            if (packageNotes.some((note) => note.getOwnedLabelValue("packageTransaction"))) continue;

            const manifest = packageNotes.find((note) => note.getOwnedLabelValue("packageArtifact") === "manifest");
            if (!manifest || manifest.getOwnedLabelValue("packageEnabled") !== "true") continue;
            const cachedManifest = parseCachedManifest(manifest.getOwnedLabelValue("packageManifest"));

            const repairedNoteIds: string[] = [];
            for (const note of packageNotes) {
                let repaired = false;
                for (const labelName of PACKAGE_ACTIVATION_LABELS) {
                    const disabledName = `disabled:${labelName}`;
                    const disabledValues = note.getOwnedLabels(disabledName).map((attribute) => attribute.value);
                    const activeValues = note.getOwnedLabels(labelName).map((attribute) => attribute.value);
                    const expectedValues = expectedValuesForNote(note, cachedManifest);
                    const expected = expectedValues.get(labelName) || [];
                    const valuesToRestore = disabledValues.length ? disabledValues : expected.filter((value) => !activeValues.includes(value));
                    if (!valuesToRestore.length) continue;

                    if (disabledValues.length) await removeOwnedAttributesByNameOrType(note, "label", disabledName);
                    for (const value of valuesToRestore) await setLabel(note.noteId, labelName, value);
                    repaired = true;
                }
                if (note.type === "launcher") repaired = await setLauncherVisibility(note, true) || repaired;
                if (repaired) repairedNoteIds.push(note.noteId);
            }

            if (repairedNoteIds.length) {
                await froca.reloadNotes(repairedNoteIds);
                repairs.push({ packageId, repairedNoteIds });
            }
        }

        return repairs;
    } finally {
        reconciliationInProgress = false;
    }
}

function parseCachedManifest(value: string | null | undefined) {
    if (!value) return null;
    try {
        const manifest = JSON.parse(value);
        return manifest && Array.isArray(manifest.artifacts) ? manifest : null;
    } catch {
        return null;
    }
}

function expectedValuesForNote(note: FNote, manifest: { artifacts: Array<Record<string, unknown>> } | null) {
    const result = new Map<string, string[]>();
    const artifactId = note.getOwnedLabelValue("packageArtifact");
    const artifact = manifest?.artifacts.find((candidate) => candidate.id === artifactId);
    if (!artifact) return result;
    const add = (name: string, value: string) => result.set(name, [...(result.get(name) || []), value]);
    if (artifact.type === "widget") add("widget", "");
    if (artifact.type === "launcher") add("launcherType", "customWidget");
    if (artifact.type === "css") add("appCss", "");
    if (artifact.type === "theme") add("appTheme", typeof artifact.title === "string" ? artifact.title : "community");
    if (artifact.activation === "startup") add("run", artifact.type === "backend" ? "backendStartup" : "frontendStartup");
    if (artifact.activation === "schedule" && typeof artifact.schedule === "string") add("run", artifact.schedule);
    if (artifact.activation === "request" && typeof artifact.route === "string") add("customRequestHandler", artifact.route);
    return result;
}

async function setLauncherVisibility(note: FNote, enabled: boolean) {
    const targetParentNoteId = enabled ? "_lbVisibleLaunchers" : "_lbAvailableLaunchers";
    const sourceBranch = note.getParentBranches().find((branch) =>
        branch.parentNoteId === "_lbVisibleLaunchers" || branch.parentNoteId === "_lbAvailableLaunchers"
    );
    if (!sourceBranch || sourceBranch.parentNoteId === targetParentNoteId) return false;

    const targetParent = await froca.getNote(targetParentNoteId, true);
    const targetBranch = targetParent?.getParentBranches()[0];
    if (!targetBranch) throw new Error(`Could not find the parent branch for ${targetParentNoteId}`);
    await server.put(`branches/${sourceBranch.branchId}/move-to/${targetBranch.branchId}`);
    return true;
}
