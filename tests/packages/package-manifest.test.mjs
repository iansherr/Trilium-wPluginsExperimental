import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadPackageServices } from "./load-package-services.mjs";

const { validateBundleManifest, validateManifest, validateRegistryIndex } = loadPackageServices();

const fixtureRegistry = JSON.parse(await readFile(new URL("./fixtures/registry.json", import.meta.url), "utf8"));
const fixtureManifest = fixtureRegistry.packages[0];

test("accepts a manifest with HTTPS/local development sources and SRI", () => {
    const result = validateManifest(fixtureManifest, { requireIntegrity: true });
    assert.deepEqual(result, { valid: true, errors: [] });
});

test("accepts safe plugin settings entry points", () => {
    const manifest = structuredClone(fixtureManifest);
    manifest.surfaces = [
        { id: "dashboard", type: "page", title: "Dashboard", artifact: "widget" },
        { id: "preferences", type: "settings", title: "Preferences", settingKeys: ["greeting"] },
        { id: "about", type: "modal", title: "About", command: "showInfoDialog", options: { title: "Hello" } },
        { id: "docs", type: "deeplink", title: "Documentation", url: "https://example.com/docs" }
    ];
    assert.deepEqual(validateManifest(manifest, { requireIntegrity: true }), { valid: true, errors: [] });
});

test("rejects unsafe or unmapped plugin settings entry points", () => {
    const manifest = structuredClone(fixtureManifest);
    manifest.surfaces = [
        { id: "bad-page", type: "page", title: "Missing", artifact: "unknown" },
        { id: "bad-modal", type: "modal", title: "Unsafe", command: "runArbitraryCode" },
        { id: "bad-link", type: "deeplink", title: "Unsafe", url: "javascript:alert(1)" }
    ];
    const result = validateManifest(manifest, { requireIntegrity: true });
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /declared artifact|allowed modal command|permitted/);
});

test("rejects an artifact without integrity when integrity is required", () => {
    const manifest = structuredClone(fixtureManifest);
    delete manifest.artifacts[0].integrity;
    const result = validateManifest(manifest, { requireIntegrity: true });
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /integrity is required/);
});

test("rejects insecure non-local repositories", () => {
    const manifest = structuredClone(fixtureManifest);
    manifest.repository = "http://packages.example.test";
    const result = validateManifest(manifest, { requireIntegrity: true });
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /HTTPS/);
});

test("rejects duplicate artifact IDs", () => {
    const manifest = structuredClone(fixtureManifest);
    manifest.artifacts.push(structuredClone(manifest.artifacts[0]));
    const result = validateManifest(manifest, { requireIntegrity: true });
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /duplicated/);
});

test("accepts an ownership migration with explicit source and destination integrity", () => {
    const manifest = structuredClone(fixtureManifest);
    manifest.migrations = [{
        fromPackageId: "fixture/old",
        fromArtifactId: "old-widget",
        fromIntegrity: manifest.artifacts[0].integrity,
        toPackageId: "fixture/new",
        toArtifactId: "new-widget",
        toIntegrity: manifest.artifacts[0].integrity
    }];
    assert.deepEqual(validateManifest(manifest, { requireIntegrity: true }), { valid: true, errors: [] });
});

test("registry validation requires integrity for every package artifact", () => {
    const registry = structuredClone(fixtureRegistry);
    delete registry.packages[0].artifacts[0].integrity;
    const result = validateRegistryIndex(registry);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /integrity is required/);
});

test("accepts a selectable bundle with package component references", () => {
    const bundle = {
        kind: "bundle",
        schemaVersion: 1,
        id: "fixture/bundle",
        version: "1.0.0",
        name: "Fixture Bundle",
        description: "A selectable fixture bundle.",
        repository: "https://example.com/fixture-bundle",
        components: [
            { id: fixtureManifest.id, role: "core", required: true },
            { id: "fixture/optional", role: "optional", defaultEnabled: true }
        ]
    };
    assert.deepEqual(validateBundleManifest(bundle), { valid: true, errors: [] });

    const registry = structuredClone(fixtureRegistry);
    registry.packages.push(bundle);
    registry.packages.push({
        ...structuredClone(fixtureManifest),
        id: "fixture/optional",
        name: "Optional Fixture",
        description: "An optional fixture component."
    });
    assert.deepEqual(validateRegistryIndex(registry), { valid: true, errors: [] });
});

test("rejects a bundle that points at an unpublished component", () => {
    const registry = structuredClone(fixtureRegistry);
    registry.packages.push({
        kind: "bundle",
        id: "fixture/bundle",
        version: "1.0.0",
        name: "Fixture Bundle",
        description: "A selectable fixture bundle.",
        repository: "https://example.com/fixture-bundle",
        components: [{ id: "fixture/missing", required: true }]
    });
    const result = validateRegistryIndex(registry);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("; "), /bundle component fixture\/missing is missing/);
});
