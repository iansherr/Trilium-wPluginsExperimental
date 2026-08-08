export const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
export const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/;

export type PackagePermission =
    | "read-notes"
    | "write-notes"
    | "delete-notes"
    | "network"
    | "backend"
    | "custom-endpoint";

export type PackageSettingType = "boolean" | "number" | "string" | "secret" | "select";
export type PackageMaintenance = "active" | "slow" | "unmaintained";
export type PackageSecurityStatus = "unreviewed" | "reviewed" | "warning";
export type PackageSurfaceType = "page" | "settings" | "modal" | "deeplink";
export type ArtifactType =
    | "frontend"
    | "backend"
    | "widget"
    | "launcher"
    | "render"
    | "css"
    | "theme"
    | "endpoint"
    | "resource";
export type Activation = "manual" | "startup" | "launcher" | "event" | "schedule" | "request";

export interface PackageSettingDefinition {
    key: string;
    type: PackageSettingType;
    title: string;
    description?: string;
    default?: unknown;
    options?: string[];
}

/** A host-owned entry point exposed by an installed package in Settings → Plugins. */
export interface PackageSurface {
    id: string;
    type: PackageSurfaceType;
    title: string;
    description?: string;
    icon?: string;
    artifact?: string;
    settingKeys?: string[];
    command?: string;
    options?: Record<string, unknown>;
    url?: string;
}

export interface PackageArtifact {
    id: string;
    type: ArtifactType;
    source: string;
    integrity?: string;
    title?: string;
    activation?: Activation;
    mobile?: boolean;
    route?: string;
    schedule?: "hourly" | "daily";
    event?: string;
}

export interface PackageDependency {
    id: string;
    version: string;
    optional?: boolean;
}

export interface PackageMigration {
    fromPackageId: string;
    fromArtifactId: string;
    fromIntegrity: string;
    toPackageId: string;
    toArtifactId: string;
    toIntegrity: string;
}

export interface TriliumCompatibility {
    minTriliumVersion: string;
    maxTriliumVersion?: string;
    mobile?: boolean;
}

export interface PackageManifest {
    id: string;
    version: string;
    name: string;
    description: string;
    author?: string;
    maintainer?: string;
    repository: string;
    homepage?: string;
    license?: string;
    deprecated?: boolean;
    deprecationMessage?: string;
    maintenance?: PackageMaintenance;
    securityStatus?: PackageSecurityStatus;
    lastValidatedAt?: string;
    compatibility: TriliumCompatibility;
    dependencies?: PackageDependency[];
    migrations?: PackageMigration[];
    permissions?: PackagePermission[];
    settings?: PackageSettingDefinition[];
    surfaces?: PackageSurface[];
    artifacts: PackageArtifact[];
}

export interface BundleComponentReference {
    id: string;
    role?: string;
    required?: boolean;
    defaultEnabled?: boolean;
}

/** A bundle groups independently installable package manifests. */
export interface BundleManifest {
    kind: "bundle";
    schemaVersion?: 1;
    id: string;
    version: string;
    name: string;
    description: string;
    author?: string;
    maintainer?: string;
    repository: string;
    homepage?: string;
    license?: string;
    deprecated?: boolean;
    deprecationMessage?: string;
    maintenance?: PackageMaintenance;
    securityStatus?: PackageSecurityStatus;
    lastValidatedAt?: string;
    components: BundleComponentReference[];
    staged?: boolean;
    stagedReason?: string;
}

export type CatalogEntry = PackageManifest | BundleManifest;

export interface ManifestValidationResult {
    valid: boolean;
    errors: string[];
}

export interface ManifestValidationOptions {
    requireIntegrity?: boolean;
}

function validateBundleRepository(repository: unknown, errors: string[]) {
    if (typeof repository !== "string") return;
    try {
        const url = new URL(repository);
        const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
        if (!( ["https:", "http:"].includes(url.protocol) && (url.protocol === "https:" || isLocalHttp))) {
            errors.push("repository must use HTTPS (HTTP is only allowed for localhost development)");
        }
    } catch {
        errors.push("repository must be a valid URL");
    }
}

export function validateManifest(manifest: unknown, options: ManifestValidationOptions = {}): ManifestValidationResult {
    const errors: string[] = [];
    if (!manifest || typeof manifest !== "object") return { valid: false, errors: ["manifest must be an object"] };

    const value = manifest as Partial<PackageManifest>;
    if (typeof value.id !== "string" || !PACKAGE_ID.test(value.id)) errors.push("id must use the author/name format");
    if (typeof value.version !== "string" || !SEMVER.test(value.version)) errors.push("version must be semantic versioning");
    for (const key of ["name", "description", "repository"] as const) {
        if (typeof value[key] !== "string" || !value[key]?.trim()) errors.push(`${key} is required`);
    }
    if (typeof value.repository === "string") {
        try {
            const url = new URL(value.repository);
            const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
            if (!(["https:", "http:"].includes(url.protocol) && (url.protocol === "https:" || isLocalHttp))) {
                errors.push("repository must use HTTPS (HTTP is only allowed for localhost development)");
            }
        } catch {
            errors.push("repository must be a valid URL");
        }
    }
    if (value.deprecated !== undefined && typeof value.deprecated !== "boolean") errors.push("deprecated must be a boolean");
    if (value.deprecationMessage !== undefined && typeof value.deprecationMessage !== "string") errors.push("deprecationMessage must be a string");
    if (value.maintenance !== undefined && !["active", "slow", "unmaintained"].includes(value.maintenance)) errors.push("maintenance must be active, slow, or unmaintained");
    if (value.securityStatus !== undefined && !["unreviewed", "reviewed", "warning"].includes(value.securityStatus)) errors.push("securityStatus must be unreviewed, reviewed, or warning");
    if (value.lastValidatedAt !== undefined && (typeof value.lastValidatedAt !== "string" || Number.isNaN(Date.parse(value.lastValidatedAt)))) errors.push("lastValidatedAt must be an ISO date-time");
    if (!value.compatibility || typeof value.compatibility.minTriliumVersion !== "string") {
        errors.push("compatibility.minTriliumVersion is required");
    } else {
        if (!SEMVER.test(value.compatibility.minTriliumVersion)) errors.push("compatibility.minTriliumVersion must be semantic versioning");
        if (value.compatibility.maxTriliumVersion !== undefined && !SEMVER.test(value.compatibility.maxTriliumVersion)) {
            errors.push("compatibility.maxTriliumVersion must be semantic versioning");
        }
    }
    if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) errors.push("at least one artifact is required");

    const artifactIds = new Set<string>();
    for (const [index, artifact] of (value.artifacts ?? []).entries()) {
        if (!artifact || typeof artifact !== "object") {
            errors.push(`artifacts[${index}] must be an object`);
            continue;
        }
        if (!artifact.id?.trim()) errors.push(`artifacts[${index}].id is required`);
        if (artifact.id && artifactIds.has(artifact.id)) errors.push(`artifacts[${index}].id is duplicated: ${artifact.id}`);
        if (artifact.id) artifactIds.add(artifact.id);
        if (!artifact.source?.trim()) errors.push(`artifacts[${index}].source is required`);
        if (options.requireIntegrity && !artifact.integrity) errors.push(`artifacts[${index}].integrity is required`);
        if (artifact.integrity !== undefined && (typeof artifact.integrity !== "string" || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(artifact.integrity))) {
            errors.push(`artifacts[${index}].integrity must be a sha256-... SRI hash`);
        }
        if (artifact.source && /^https?:\/\//i.test(artifact.source)) {
            try {
                const url = new URL(artifact.source);
                const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
                if (!(["https:", "http:"].includes(url.protocol) && (url.protocol === "https:" || isLocalHttp))) {
                    errors.push(`artifacts[${index}].source must use HTTPS (HTTP is only allowed for localhost development)`);
                }
            } catch {
                errors.push(`artifacts[${index}].source must be a valid URL`);
            }
        }
    }

    for (const [index, dependency] of (value.dependencies ?? []).entries()) {
        if (!dependency.id || !PACKAGE_ID.test(dependency.id)) errors.push(`dependencies[${index}].id is invalid`);
        if (!dependency.version?.trim()) errors.push(`dependencies[${index}].version is required`);
    }

    const artifactIdSet = new Set((value.artifacts ?? []).map((artifact) => artifact?.id).filter((id): id is string => typeof id === "string"));
    const settingKeySet = new Set((value.settings ?? []).map((setting) => setting?.key).filter((key): key is string => typeof key === "string"));
    const surfaceIds = new Set<string>();
    const safeModalCommands = new Set(["showInfoDialog", "showConfirmDialog", "showPromptDialog", "showImportDialog", "showExportDialog"]);
    for (const [index, surface] of (value.surfaces ?? []).entries()) {
        if (!surface || typeof surface !== "object") {
            errors.push(`surfaces[${index}] must be an object`);
            continue;
        }
        if (typeof surface.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(surface.id)) errors.push(`surfaces[${index}].id is invalid`);
        if (surface.id && surfaceIds.has(surface.id)) errors.push(`surfaces[${index}].id is duplicated: ${surface.id}`);
        if (surface.id) surfaceIds.add(surface.id);
        if (! ["page", "settings", "modal", "deeplink"].includes(surface.type as string)) errors.push(`surfaces[${index}].type is invalid`);
        if (typeof surface.title !== "string" || !surface.title.trim()) errors.push(`surfaces[${index}].title is required`);
        if (surface.icon !== undefined && typeof surface.icon !== "string") errors.push(`surfaces[${index}].icon must be a string`);
        if (surface.type === "page") {
            if (typeof surface.artifact !== "string" || !artifactIdSet.has(surface.artifact)) errors.push(`surfaces[${index}].artifact must reference a declared artifact`);
        } else if (surface.type === "settings") {
            if (!Array.isArray(surface.settingKeys) || surface.settingKeys.length === 0) errors.push(`surfaces[${index}].settingKeys must contain at least one setting key`);
            for (const key of surface.settingKeys ?? []) {
                if (typeof key !== "string" || !settingKeySet.has(key)) errors.push(`surfaces[${index}].settingKeys references an undeclared setting`);
            }
        } else if (surface.type === "modal") {
            if (typeof surface.command !== "string" || !safeModalCommands.has(surface.command)) errors.push(`surfaces[${index}].command is not an allowed modal command`);
            if (surface.options !== undefined && (!surface.options || typeof surface.options !== "object" || Array.isArray(surface.options))) errors.push(`surfaces[${index}].options must be an object`);
        } else if (surface.type === "deeplink") {
            if (typeof surface.url !== "string" || !isSafeSurfaceUrl(surface.url)) errors.push(`surfaces[${index}].url must be an HTTPS, localhost HTTP, or Trilium deep link`);
        }
    }

    const migrationKeys = new Set<string>();
    for (const [index, migration] of (value.migrations ?? []).entries()) {
        if (!migration || typeof migration !== "object") {
            errors.push(`migrations[${index}] must be an object`);
            continue;
        }
        for (const key of ["fromPackageId", "fromArtifactId", "toPackageId", "toArtifactId"] as const) {
            if (typeof migration[key] !== "string" || !migration[key].trim()) errors.push(`migrations[${index}].${key} is required`);
        }
        for (const key of ["fromPackageId", "toPackageId"] as const) {
            if (typeof migration[key] === "string" && !PACKAGE_ID.test(migration[key])) errors.push(`migrations[${index}].${key} is invalid`);
        }
        if (migration.fromPackageId === migration.toPackageId) errors.push(`migrations[${index}] cannot keep the same package owner`);
        for (const key of ["fromIntegrity", "toIntegrity"] as const) {
            if (typeof migration[key] !== "string" || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(migration[key])) errors.push(`migrations[${index}].${key} must be a sha256-... SRI hash`);
        }
        const key = `${migration.fromPackageId}:${migration.fromArtifactId}->${migration.toPackageId}:${migration.toArtifactId}`;
        if (migrationKeys.has(key)) errors.push(`migrations[${index}] is duplicated: ${key}`);
        migrationKeys.add(key);
    }

    return { valid: errors.length === 0, errors };
}

function isSafeSurfaceUrl(value: string): boolean {
    try {
        const url = new URL(value);
        const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
        return url.protocol === "https:" || localHttp || url.protocol === "trilium:" || url.protocol === "trilium-next:";
    } catch {
        return false;
    }
}

export function validateBundleManifest(bundle: unknown): ManifestValidationResult {
    const errors: string[] = [];
    if (!bundle || typeof bundle !== "object") return { valid: false, errors: ["bundle must be an object"] };

    const value = bundle as Partial<BundleManifest>;
    if (value.kind !== "bundle") errors.push("kind must be bundle");
    if (value.schemaVersion !== undefined && value.schemaVersion !== 1) errors.push("schemaVersion must be 1");
    if (typeof value.id !== "string" || !PACKAGE_ID.test(value.id)) errors.push("id must use the author/name format");
    if (typeof value.version !== "string" || !SEMVER.test(value.version)) errors.push("version must be semantic versioning");
    for (const key of ["name", "description", "repository"] as const) {
        if (typeof value[key] !== "string" || !value[key]?.trim()) errors.push(`${key} is required`);
    }
    validateBundleRepository(value.repository, errors);
    if (value.deprecated !== undefined && typeof value.deprecated !== "boolean") errors.push("deprecated must be a boolean");
    if (value.deprecationMessage !== undefined && typeof value.deprecationMessage !== "string") errors.push("deprecationMessage must be a string");
    if (value.maintenance !== undefined && !["active", "slow", "unmaintained"].includes(value.maintenance)) errors.push("maintenance must be active, slow, or unmaintained");
    if (value.securityStatus !== undefined && !["unreviewed", "reviewed", "warning"].includes(value.securityStatus)) errors.push("securityStatus must be unreviewed, reviewed, or warning");
    if (value.lastValidatedAt !== undefined && (typeof value.lastValidatedAt !== "string" || Number.isNaN(Date.parse(value.lastValidatedAt)))) errors.push("lastValidatedAt must be an ISO date-time");
    if (!Array.isArray(value.components) || value.components.length === 0) errors.push("at least one bundle component is required");

    const componentIds = new Set<string>();
    for (const [index, component] of (value.components ?? []).entries()) {
        if (!component || typeof component !== "object") {
            errors.push(`components[${index}] must be an object`);
            continue;
        }
        if (typeof component.id !== "string" || !PACKAGE_ID.test(component.id)) errors.push(`components[${index}].id must use the author/name format`);
        if (component.id && componentIds.has(component.id)) errors.push(`components[${index}].id is duplicated: ${component.id}`);
        if (component.id) componentIds.add(component.id);
        if (component.role !== undefined && (typeof component.role !== "string" || !component.role.trim())) errors.push(`components[${index}].role must be a non-empty string`);
        if (component.required !== undefined && typeof component.required !== "boolean") errors.push(`components[${index}].required must be a boolean`);
        if (component.defaultEnabled !== undefined && typeof component.defaultEnabled !== "boolean") errors.push(`components[${index}].defaultEnabled must be a boolean`);
    }

    return { valid: errors.length === 0, errors };
}

export function validateCatalogEntry(entry: unknown, options: ManifestValidationOptions = {}): ManifestValidationResult {
    if (entry && typeof entry === "object" && (entry as { kind?: unknown }).kind === "bundle") {
        return validateBundleManifest(entry);
    }
    return validateManifest(entry, options);
}
