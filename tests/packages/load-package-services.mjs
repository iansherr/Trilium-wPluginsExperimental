import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSync } from "esbuild";

let services;

export function loadPackageServices() {
    if (services) return services;

    const testsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const entryPoints = [
        path.join(testsRoot, "apps/server/src/services/packages/package_manifest.ts"),
        path.join(testsRoot, "apps/server/src/services/packages/registry.ts")
    ];
    services = entryPoints.map((entryPoint) => buildSync({
        entryPoints: [entryPoint],
        bundle: true,
        format: "cjs",
        platform: "node",
        write: false,
        logLevel: "silent"
    }).outputFiles[0].text).map((bundle) => {
        const module = { exports: {} };
        new Function("module", "exports", bundle)(module, module.exports);
        return module.exports;
    }).reduce((all, current) => ({ ...all, ...current }), {});
    return services;
}
