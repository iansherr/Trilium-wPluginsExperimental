import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const managerSource = readFileSync(
    new URL("./assets/community-packages/community-packages.tsx", import.meta.url),
    "utf8"
);

describe("bundled Community Packages manager", () => {
    it("uses the supported branch move endpoint", () => {
        expect(managerSource).toMatch(
            /packageRequest\("PUT", \`branches\/\$\{sourceBranch\.branchId\}\/move-to\/\$\{targetParentBranch\.branchId\}\`\)/
        );
        expect(managerSource).not.toMatch(/packageRequest\("POST", "branches"/);
    });

    it("uses hidden-aware quick search for package-owned notes", () => {
        expect(managerSource).toMatch(/async function searchPackageNotes\(searchString\)/);
        expect(managerSource).toMatch(/quick-search\/\$\{encodeURIComponent\(searchString\)\}/);
        expect(managerSource).toMatch(/result\.searchResultNoteIds/);
        expect(managerSource).not.toMatch(/api\.searchForNote\(?s?\(/);

        for (const functionName of [
            "readSettings",
            "readInstalledPackages",
            "ensureRootNote",
            "packageNotes",
            "transactionNotes",
            "readInterruptedTransactions"
        ]) {
            const functionStart = managerSource.indexOf("async function " + functionName);
            expect(functionStart, functionName + " should exist").not.toBe(-1);
            const functionEnd = managerSource.indexOf("\\n}\\n", functionStart);
            const functionSource = managerSource.slice(functionStart, functionEnd === -1 ? undefined : functionEnd);
            expect(functionSource, functionName + " should use hidden-aware lookup").toMatch(/searchPackageNotes\(/);
        }
    });
});
