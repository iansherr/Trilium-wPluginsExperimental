import { SEMVER } from "./package_manifest.js";

export interface Semver {
    major: number;
    minor: number;
    patch: number;
    prerelease: string[];
}

export function parseSemver(value: string): Semver | null {
    if (!SEMVER.test(value)) return null;
    const [core, prerelease = ""] = value.split("-", 2);
    const [major, minor, patch] = core.split(".").map(Number);
    return { major, minor, patch, prerelease: prerelease ? prerelease.split(".") : [] };
}

export function compareSemver(left: string, right: string): number {
    const a = parseSemver(left);
    const b = parseSemver(right);
    if (!a || !b) throw new Error("cannot compare invalid semantic versions");

    for (const key of ["major", "minor", "patch"] as const) {
        if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
    }
    if (!a.prerelease.length && !b.prerelease.length) return 0;
    if (!a.prerelease.length) return 1;
    if (!b.prerelease.length) return -1;

    for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
        const leftPart = a.prerelease[i];
        const rightPart = b.prerelease[i];
        if (leftPart === undefined) return -1;
        if (rightPart === undefined) return 1;
        if (leftPart === rightPart) continue;
        const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
        const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
        if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1;
        if (leftNumber !== null) return -1;
        if (rightNumber !== null) return 1;
        return leftPart > rightPart ? 1 : -1;
    }
    return 0;
}

export function isNewerSemver(candidate: string, current: string): boolean {
    return compareSemver(candidate, current) > 0;
}
