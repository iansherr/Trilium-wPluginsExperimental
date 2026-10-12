import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "community_packages.tsx"), "utf8");

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
