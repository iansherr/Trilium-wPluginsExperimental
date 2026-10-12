import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "community_packages.tsx"), "utf8");

const LAUNCHER_MOVERS = [
    "community_packages.tsx",
    "plugins.tsx",
    "../../../services/package_activation.ts"
];

describe("package launcher moves", () => {
    it.each(LAUNCHER_MOVERS)("%s moves branches through the batch move-to route", (file) => {
        // The server only registers PUT /api/branches/move-to/:parentBranchId with { branchIds }.
        // The old /branches/:branchId/move-to/:parentBranchId route is gone, so disabling or
        // archiving a package silently failed to take its launchers off the launch bar.
        const text = readFileSync(resolve(__dirname, file), "utf8");
        expect(text).not.toMatch(/branches\/\$\{[^}]+\}\/move-to\//);
        expect(text).toMatch(/branches\/move-to\/\$\{[^}]+\}`, \{ branchIds: \[/);
    });
});

describe("community packages manager", () => {
    it("searches through the query-string quick-search route, not the removed path-parameter one", () => {
        // The server only registers GET /api/quick-search (search?searchString=...); the old
        // /api/quick-search/:searchString route 404s, which left the manager's spinner up forever.
        expect(source).not.toMatch(/quick-search\/\$\{/);
        expect(source).toContain("`quick-search?searchString=${encodeURIComponent(searchString)}&includeHidden=true`");
    });

    it("clears the loading state when initialization fails", () => {
        expect(source).toMatch(/initialize\(\)\.catch\(\(cause\) => \{\s*setError\(errorMessage\(cause\)\);\s*setLoading\(false\);/);
    });
});
