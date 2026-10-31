const PREFERRED_MANIFEST_NAMES = [ "trilium-package.json", "manifest.json" ];
const MAX_LOCAL_PACKAGE_FILES = 5000;
const MAX_LOCAL_MANIFEST_BYTES = 2 * 1024 * 1024;

export interface LocalPackageFiles {
    manifestPath: string;
    manifest: Record<string, unknown>;
    files: Map<string, File>;
}

export async function readLocalPackageDirectory(
    files: ArrayLike<File>
): Promise<LocalPackageFiles> {
    if (files.length > MAX_LOCAL_PACKAGE_FILES) {
        throw new Error(`The selected folder contains more than ${MAX_LOCAL_PACKAGE_FILES} files.`);
    }
    const localFiles = new Map<string, File>();
    for (const file of Array.from(files)) {
        const selectedPath = file.webkitRelativePath || file.name;
        const pathParts = selectedPath.replaceAll("\\", "/").split("/");
        const relativePath = pathParts.length > 1 ? pathParts.slice(1).join("/") : pathParts[0];
        const safePath = normalizeLocalPackagePath(relativePath);
        if (localFiles.has(safePath)) {
            throw new Error(`The selected folder contains duplicate file paths: ${safePath}`);
        }
        localFiles.set(safePath, file);
    }

    const preferredManifests = PREFERRED_MANIFEST_NAMES.filter((name) => localFiles.has(name));
    if (preferredManifests.length > 1) {
        throw new Error("The selected folder contains multiple package manifests.");
    }
    const preferredManifest = preferredManifests[0];
    const manifestCandidates = preferredManifest
        ? [ preferredManifest ]
        : [ ...localFiles.keys() ].filter((path) => path.toLowerCase().endsWith(".json"));
    const validCandidates: Array<{
        path: string;
        manifest: Record<string, unknown>;
    }> = [];
    for (const path of manifestCandidates) {
        const file = localFiles.get(path);
        if (!file) continue;
        if (file.size > MAX_LOCAL_MANIFEST_BYTES) {
            if (path === preferredManifest) {
                throw new Error(
                    `${path} exceeds the ${MAX_LOCAL_MANIFEST_BYTES} byte manifest limit.`
                );
            }
            continue;
        }
        try {
            const parsed: unknown = JSON.parse(await file.text());
            if (parsed && typeof parsed === "object" && "artifacts" in parsed) {
                validCandidates.push({
                    path,
                    manifest: parsed as Record<string, unknown>
                });
            }
        } catch {
            if (path === preferredManifest) {
                throw new Error(`${path} is not valid JSON.`);
            }
        }
    }

    if (validCandidates.length === 0) {
        throw new Error(
            "The selected folder must contain a trilium-package.json or manifest.json file."
        );
    }
    if (validCandidates.length > 1) {
        throw new Error("Multiple package manifests found; select a folder with only one.");
    }
    return {
        manifestPath: validCandidates[0].path,
        manifest: validCandidates[0].manifest,
        files: localFiles
    };
}

export function resolveLocalPackageArtifact(source: string, files: Map<string, File>): File {
    const path = normalizeLocalPackagePath(source);
    const file = files.get(path);
    if (!file) {
        throw new Error(`The selected folder does not contain artifact file ${path}.`);
    }
    return file;
}

export function normalizeLocalPackagePath(value: string): string {
    const path = value.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");
    if (!path || path.startsWith("/") || /^[a-zA-Z]:/.test(path)
        || path.includes(":") || path.includes("?") || path.includes("#")) {
        throw new Error(
            "Package artifact paths must be relative files inside the selected folder."
        );
    }
    const parts = path.split("/");
    if (parts.some((part) => !part || part === "..")) {
        throw new Error(
            "Package artifact paths cannot contain empty or parent directory segments."
        );
    }
    return parts.filter((part) => part !== ".").join("/");
}
