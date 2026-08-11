import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const distDir = new URL("../dist/", import.meta.url).pathname;
const requiredPaths = [
    "node_modules/better-sqlite3/prebuilds/linux-x64.node",
    "node_modules/better-sqlite3/prebuilds/linux-arm64.node",
    "node_modules/better-sqlite3/prebuilds/linuxmusl-x64.node",
    "node_modules/better-sqlite3/prebuilds/linuxmusl-arm64.node"
];
const managerSourcePath = new URL("../../client/src/widgets/type_widgets/options/community_packages.tsx", import.meta.url);
const managerAssetPath = "assets/community-packages/community-packages.tsx";

for (const relativePath of requiredPaths) {
    try {
        await access(join(distDir, relativePath));
    } catch {
        throw new Error(`Missing Docker build artifact: ${relativePath}`);
    }
}

console.log(`Verified ${requiredPaths.length} Docker native artifacts in ${distDir}`);

const managerSource = await readFile(managerSourcePath, "utf-8");
const managerAsset = await readFile(join(distDir, managerAssetPath), "utf-8");
if (managerSource !== managerAsset) {
    throw new Error(`Stale Community Packages manager asset: ${managerAssetPath} does not match ${managerSourcePath.pathname}`);
}
if (/^import\s+.*from\s+["'](?!trilium:)/m.test(managerSource)) {
    throw new Error("Community Packages manager contains an import unavailable to Trilium render-note scripts");
}
console.log(`Verified Community Packages manager asset in ${managerAssetPath}`);
