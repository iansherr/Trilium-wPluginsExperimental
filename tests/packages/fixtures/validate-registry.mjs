import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadPackageServices } from "../load-package-services.mjs";

const { validateRegistryIndex } = loadPackageServices();

const filename = process.argv[2] === "--" ? process.argv[3] || "tests/packages/fixtures/registry.json" : process.argv[2] || "tests/packages/fixtures/registry.json";
const path = resolve(filename);
let value;

try {
    value = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
    console.error(`Could not read registry ${path}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
}

if (value !== undefined) {
    const result = validateRegistryIndex(value);
    if (!result.valid) {
        console.error(`Registry validation failed for ${path}:`);
        for (const error of result.errors) console.error(`- ${error}`);
        process.exitCode = 1;
    } else {
        console.log(`Registry valid: ${path} (${value.packages.length} package${value.packages.length === 1 ? "" : "s"})`);
    }
}
