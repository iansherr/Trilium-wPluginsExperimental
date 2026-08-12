# Ikmal package-boundary migration

Ikmal currently publishes one compatibility package,
`iansherr/ikmal_tools_trilium`, whose manifest contains the workspace surfaces,
editor, and standalone micro-tools as artifacts. That is convenient for the
first install, but it makes every component share the core package's enable,
update, and uninstall lifecycle.

The target App Store-style boundary is:

- `iansherr/ikmal_tools`: a selectable bundle that groups independently managed
  Ikmal apps and offers install-all or per-component selection.
- `iansherr/ikmal_tools_trilium`: Today, workspace dashboard, project
  dashboard, launcher, shared workspace styles, and workspace bootstrap.
- `iansherr/ikmal_editor_trilium`: Ikmal Editor's frontend startup script and
  editor-only stylesheet, with its own enable, update, and uninstall lifecycle.
- One independently managed package per standalone micro-tool, each with its
  own manifest, version, settings, enable state, update pin, and recovery
  record.
- Shared source and built artifacts remain in this repository. Splitting the
  lifecycle must not copy the source tree or create duplicate package trees.
- Each micro-tool package may require the core package as a dependency when it
  needs the shared stylesheet or workspace setup. The package manager must
  enable dependencies before dependents and must refuse to disable or uninstall
  a required dependency while a dependent remains installed.

## Safe rollout

The current bundled manifest remains the compatibility path until the host can
perform an ownership handoff. A future core-package update that removes a
micro-tool artifact must, in one transaction:

1. verify the old artifact note belongs to the exact known package artifact;
2. create or validate the destination micro-tool manifest and artifact notes;
3. preserve the artifact note's enabled state, settings, and user branches;
4. transfer ownership labels from the old package ID to the new package ID;
5. archive the old package manifest only after every handoff succeeds; and
6. roll back all labels and notes if any destination package fails validation.

The handoff must never delete a render note or silently recreate a second note
when an existing managed note can be transferred. User-authored notes and
branches are outside the transfer set. If a handoff cannot prove ownership or
integrity, it should leave the old bundled package intact and report a repair
action instead.

The host-side transaction now implements explicitly declared `migrations`: it
requires the source package replacement and destination package in the same
transaction, checks both declared SRI values, transfers only exact managed
artifact notes, preserves user branches, records rollback labels, and restores
ownership on interruption. Existing manifests without `migrations` use the
unchanged update path. The staged split manifests remain unpublished until the
cloned-vault rehearsal validates this behavior against the current compatibility
install.

Until that transaction exists, new micro-tool manifests should not be added to
the public registry alongside the bundled package: doing so would offer two
owners for the same artifact and could create duplicate render notes.

## Follow-up implementation order

1. Generate per-tool manifests that reference the existing shared build
   outputs, without copying source or `dist` trees. Ikmal Editor is the first
   staged component; its generated manifest is under
   `packages/ikmal_tools_trilium/manifests/ikmal-editor.json`.
2. Generate the staged bundle index under
   `packages/ikmal_tools_trilium/manifests/ikmal-tools-bundle.json`.
3. Publish a compatibility core release and per-tool manifests together.
4. Validate an upgrade from the current bundled install in a cloned vault,
   including enabled/disabled tools, user clones, update pins, and recovery.
5. Only then register the split packages and update the user-facing install
   instructions.
