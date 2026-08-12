import type { PackageDependency, PackageManifest } from "./package_manifest.js";
import { compareSemver } from "./semver.js";

export interface DependencyResolution {
    order: string[];
    missing: PackageDependency[];
    incompatible: Array<{ dependency: PackageDependency; installedVersion: string }>;
    cycles: string[][];
}

export function resolveDependencies(
    root: PackageManifest,
    packages: Map<string, PackageManifest>
): DependencyResolution {
    const order: string[] = [];
    const missing: PackageDependency[] = [];
    const incompatible: Array<{ dependency: PackageDependency; installedVersion: string }> = [];
    const cycles: string[][] = [];
    const visiting: string[] = [];
    const visited = new Set<string>();

    function visit(manifest: PackageManifest) {
        if (visited.has(manifest.id)) return;
        const cycleStart = visiting.indexOf(manifest.id);
        if (cycleStart >= 0) {
            cycles.push([ ...visiting.slice(cycleStart), manifest.id ]);
            return;
        }

        visiting.push(manifest.id);
        for (const dependency of manifest.dependencies ?? []) {
            const target = packages.get(dependency.id);
            if (!target) {
                if (!dependency.optional) missing.push(dependency);
                continue;
            }
            if (!versionSatisfies(dependency.version, target.version)) {
                incompatible.push({ dependency, installedVersion: target.version });
                continue;
            }
            visit(target);
        }
        visiting.pop();
        visited.add(manifest.id);
        order.push(manifest.id);
    }

    visit(root);
    return { order, missing, incompatible, cycles };
}

/** Supports exact versions and the common ^major.minor.patch form for the first resolver. */
export function versionSatisfies(range: string, version: string): boolean {
    const normalized = range.trim();
    if (normalized === "*" || normalized === "latest") return true;
    const caret = normalized.startsWith("^");
    const wanted = caret ? normalized.slice(1) : normalized;
    try {
        const comparison = compareSemver(version, wanted);
        if (!caret) return comparison === 0;
        const [major] = wanted.split(".").map(Number);
        return comparison >= 0 && Number(version.split(".")[0]) === major;
    } catch {
        return false;
    }
}
