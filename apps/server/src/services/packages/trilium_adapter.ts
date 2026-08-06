import type { ArtifactType, PackageArtifact, PackageManifest } from "./package_manifest.js";

export const PACKAGE_ROOT_NOTE_ID = "_community_packages";
export const PACKAGE_MANAGED_LABEL = "packageManaged";
export const PACKAGE_OWNER_LABEL = "packageOwner";
export const PACKAGE_VERSION_LABEL = "packageVersion";
export const PACKAGE_ARTIFACT_LABEL = "packageArtifact";

export interface NoteAttributePlan {
    type: "label" | "relation";
    name: string;
    value?: string;
}

export interface ManagedNotePlan {
    noteId: string;
    parentNoteId: string;
    title: string;
    type: "doc" | "code" | "render" | "launcher";
    mime?: string;
    content: string;
    attributes: NoteAttributePlan[];
}

export interface ArtifactSource {
    artifactId: string;
    content: string;
    mime?: string;
}

export interface InstallPlan {
    container: ManagedNotePlan;
    packageRoot: ManagedNotePlan;
    notes: ManagedNotePlan[];
}

export function packageRootNoteId(packageId: string): string {
    return `${PACKAGE_ROOT_NOTE_ID}_${slug(packageId)}`;
}

export function artifactNoteId(packageId: string, artifactId: string): string {
    return `${packageRootNoteId(packageId)}_${slug(artifactId)}`;
}

export function buildInstallPlan(
    manifest: PackageManifest,
    sources: ArtifactSource[],
    enabled: boolean,
    parentNoteId = PACKAGE_ROOT_NOTE_ID
): InstallPlan {
    const sourceById = new Map(sources.map((source) => [source.artifactId, source]));
    const rootId = packageRootNoteId(manifest.id);
    const container: ManagedNotePlan = {
        noteId: PACKAGE_ROOT_NOTE_ID,
        parentNoteId,
        title: "Community Packages",
        type: "doc",
        content: "Managed packages installed by the Trilium Community Packages manager.",
        attributes: [ { type: "label", name: PACKAGE_MANAGED_LABEL } ]
    };
    const packageAttributes = managedAttributes(manifest, "manifest");
    const packageRoot: ManagedNotePlan = {
        noteId: rootId,
        parentNoteId: PACKAGE_ROOT_NOTE_ID,
        title: manifest.name,
        type: "doc",
        content: manifest.description,
        attributes: packageAttributes
    };
    const notes: ManagedNotePlan[] = [];

    for (const artifact of manifest.artifacts) {
        const source = sourceById.get(artifact.id);
        if (!source) throw new Error(`missing source for artifact ${artifact.id}`);
        notes.push(...buildArtifactNotes(manifest, artifact, source, enabled, rootId));
    }

    return { container, packageRoot, notes };
}

function buildArtifactNotes(
    manifest: PackageManifest,
    artifact: PackageArtifact,
    source: ArtifactSource,
    enabled: boolean,
    rootId: string
): ManagedNotePlan[] {
    const codeId = artifactNoteId(manifest.id, artifact.id);
    const title = artifact.title ?? `${manifest.name}: ${artifact.id}`;
    const attributes = [ ...managedAttributes(manifest, artifact.id), ...activationAttributes(artifact, enabled) ];
    const mime = source.mime ?? mimeForArtifact(artifact.type);

    if (artifact.type !== "render") {
        const codeNote: ManagedNotePlan = {
            noteId: codeId,
            parentNoteId: rootId,
            title,
            type: "code",
            mime,
            content: source.content,
            attributes
        };

        // Launch-bar configuration is a separate note pointing at the widget code note.
        // Keeping the two notes separate matches Trilium's existing `~widget` convention.
        if (artifact.type === "launcher") {
            return [
                codeNote,
                {
                    noteId: `${codeId}_launcher`,
                    parentNoteId: rootId,
                    title: `${title} launcher`,
                    type: "launcher",
                    content: "",
                    attributes: [
                        ...managedAttributes(manifest, artifact.id),
                        { type: "label", name: enabled ? "launcherType" : "disabled:launcherType", value: "customWidget" },
                        { type: "relation", name: "widget", value: codeId }
                    ]
                }
            ];
        }
        return [ codeNote ];
    }

    const renderId = `${codeId}_render`;
    return [
        {
            noteId: renderId,
            parentNoteId: rootId,
            title,
            type: "render",
            content: "",
            attributes: [ ...managedAttributes(manifest, artifact.id), { type: "relation", name: "renderNote", value: codeId } ]
        },
        {
            noteId: codeId,
            parentNoteId: renderId,
            title,
            type: "code",
            mime,
            content: source.content,
            attributes
        }
    ];
}

function managedAttributes(manifest: PackageManifest, artifactId: string): NoteAttributePlan[] {
    return [
        { type: "label", name: PACKAGE_MANAGED_LABEL },
        { type: "label", name: PACKAGE_OWNER_LABEL, value: manifest.id },
        { type: "label", name: PACKAGE_VERSION_LABEL, value: manifest.version },
        { type: "label", name: PACKAGE_ARTIFACT_LABEL, value: artifactId },
        { type: "label", name: "readOnly" }
    ];
}

function activationAttributes(artifact: PackageArtifact, enabled: boolean): NoteAttributePlan[] {
    const activeName = enabled ? "" : "disabled:";
    const attributes: NoteAttributePlan[] = [];
    if (artifact.type === "widget") attributes.push({ type: "label", name: `${activeName}widget` });
    if (artifact.type === "launcher") attributes.push({ type: "label", name: `${activeName}launcherType`, value: "customWidget" });
    if (artifact.type === "css") attributes.push({ type: "label", name: `${activeName}appCss` });
    if (artifact.type === "theme") attributes.push({ type: "label", name: `${activeName}appTheme`, value: artifact.title ?? "community" });
    if (artifact.activation === "startup") {
        const environment = artifact.type === "backend" ? "backendStartup" : "frontendStartup";
        attributes.push({ type: "label", name: `${activeName}run`, value: environment });
    }
    if (artifact.activation === "schedule" && artifact.schedule) {
        attributes.push({ type: "label", name: `${activeName}run`, value: artifact.schedule });
    }
    if (artifact.activation === "request" && artifact.route) {
        attributes.push({ type: "label", name: `${activeName}customRequestHandler`, value: artifact.route });
    }
    // Event handlers require a target-note binding. That binding is deliberately not guessed from
    // the package artifact; the Trilium adapter will add it once the manifest declares an explicit
    // target selector.
    return attributes;
}

function mimeForArtifact(type: ArtifactType): string {
    if (type === "css" || type === "theme") return "text/css";
    if (type === "launcher" || type === "render") return "text/jsx";
    if (["backend", "endpoint", "resource"].includes(type)) return "application/javascript;env=backend";
    if (type === "widget" || type === "frontend") return "application/javascript;env=frontend";
    return "text/plain";
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
