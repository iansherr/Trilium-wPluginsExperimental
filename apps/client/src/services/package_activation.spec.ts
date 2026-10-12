import { beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.fn(async () => undefined);
const reloadNotes = vi.fn(async () => undefined);
let ownerNotes: unknown[] = [];

vi.mock("./server", () => ({ default: { put: (...args: unknown[]) => put(...(args as [])) } }));
vi.mock("./search", () => ({ default: { searchForNotesIncludingHidden: async () => ownerNotes } }));
vi.mock("./attributes", () => ({ setLabel: vi.fn(async () => undefined), removeOwnedAttributesByNameOrType: vi.fn(async () => undefined) }));
vi.mock("./froca", () => ({
    default: {
        initializedPromise: Promise.resolve(),
        reloadNotes: (...args: unknown[]) => reloadNotes(...(args as [])),
        getNote: async (noteId: string) => ({ noteId, getParentBranches: () => [{ branchId: `${noteId}_branch` }] })
    }
}));

import { reconcileEnabledPackageActivations } from "./package_activation";

function fakeNote(noteId: string, type: string, labels: Record<string, string>, parent?: string) {
    return {
        noteId,
        type,
        getOwnedLabelValue: (name: string) => labels[name] ?? null,
        getOwnedLabels: (name: string) => (name in labels ? [{ value: labels[name] }] : []),
        getParentBranches: () => (parent ? [{ branchId: `${noteId}_b`, parentNoteId: parent }] : [])
    };
}

const manifest = fakeNote("manifest", "text", { packageOwner: "pkg", packageArtifact: "manifest", packageEnabled: "true" });

describe("reconcileEnabledPackageActivations launchers", () => {
    beforeEach(() => {
        put.mockClear();
        reloadNotes.mockClear();
    });

    it("leaves a launcher the user hid alone when it is only stamped with #packageOwner", async () => {
        ownerNotes = [manifest, fakeNote("al_newTask", "launcher", { packageOwner: "pkg" }, "_lbAvailableLaunchers")];

        const repairs = await reconcileEnabledPackageActivations();

        expect(put).not.toHaveBeenCalled();
        expect(repairs).toEqual([]);
    });

    it("still restores a launcher that is a package artifact", async () => {
        ownerNotes = [manifest, fakeNote("art", "launcher", { packageOwner: "pkg", packageArtifact: "launcher-1" }, "_lbAvailableLaunchers")];

        const repairs = await reconcileEnabledPackageActivations();

        expect(put).toHaveBeenCalledWith("branches/art_b/move-to/_lbVisibleLaunchers_branch");
        expect(repairs).toEqual([{ packageId: "pkg", repairedNoteIds: ["art"] }]);
    });
});
