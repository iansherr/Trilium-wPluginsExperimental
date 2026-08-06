import { validateCatalogEntry, type BundleManifest, type CatalogEntry, type PackageManifest } from "./package_manifest.js";
import { resolveDependencies } from "./dependencies.js";

export interface RegistryIndex {
    schemaVersion: 1;
    generatedAt: string;
    packages: CatalogEntry[];
}

export interface RegistrySource {
    id: string;
    title: string;
    url: string;
    trusted: boolean;
}

export interface RegistryValidationResult {
    valid: boolean;
    errors: string[];
}

export type PackageCatalogEntry = (PackageManifest | BundleManifest) & {
    registryId: string;
    featured?: boolean;
    beta?: boolean;
    deprecated?: boolean;
    incompatible?: boolean;
    lastValidatedAt?: string;
}

export function indexPackages(index: RegistryIndex, registryId: string): PackageCatalogEntry[] {
    return index.packages.map((manifest) => ({ ...manifest, registryId }));
}

export function validateRegistryIndex(index: unknown): RegistryValidationResult {
    const errors: string[] = [];
    if (!index || typeof index !== "object") return { valid: false, errors: ["registry must be an object"] };

    const value = index as Partial<RegistryIndex>;
    if (value.schemaVersion !== 1) errors.push("schemaVersion must be 1");
    if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) {
        errors.push("generatedAt must be an ISO date-time");
    }
    if (!Array.isArray(value.packages)) return { valid: false, errors: [...errors, "packages must be an array"] };

    const packages = value.packages;
    const packageMap = new Map<string, PackageManifest>();
    const entryMap = new Map<string, CatalogEntry>();
    for (const [index, manifest] of packages.entries()) {
        const validation = validateCatalogEntry(manifest, { requireIntegrity: true });
        errors.push(...validation.errors.map((error) => `packages[${index}]: ${error}`));
        if (!manifest || typeof manifest !== "object" || typeof manifest.id !== "string") continue;
        if (entryMap.has(manifest.id)) errors.push(`packages[${index}]: duplicate package ID ${manifest.id}`);
        else if (validation.valid) {
            entryMap.set(manifest.id, manifest as CatalogEntry);
            if (!("kind" in manifest) || manifest.kind !== "bundle") packageMap.set(manifest.id, manifest as PackageManifest);
        }
    }

    for (const bundle of entryMap.values()) {
        if (!("kind" in bundle) || bundle.kind !== "bundle") continue;
        for (const component of bundle.components) {
            if (!packageMap.has(component.id)) errors.push(`${bundle.id}: bundle component ${component.id} is missing from the registry`);
        }
    }

    for (const manifest of packageMap.values()) {
        const resolution = resolveDependencies(manifest, packageMap);
        for (const dependency of resolution.missing) {
            errors.push(`${manifest.id}: required dependency ${dependency.id} is missing from the registry`);
        }
        for (const incompatible of resolution.incompatible) {
            errors.push(`${manifest.id}: dependency ${incompatible.dependency.id} requires ${incompatible.dependency.version}, registry provides ${incompatible.installedVersion}`);
        }
        for (const cycle of resolution.cycles) {
            errors.push(`${manifest.id}: dependency cycle ${cycle.join(" → ")}`);
        }
    }

    return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
