# Plugin work and PR tracking

This is the working checklist for the Trilium plugin ecosystem work. It records local commits and follow-up work; it does not mean that a commit has been pushed or that a PR has been updated.

## Fork strategy and current disposition

The `iansherr/Trilium-wPluginsExperimental` fork is a separate personal product
line. Its `main` branch may carry plugin ecosystem features that are useful in
the author's own build, and it should periodically incorporate `upstream/main`
without treating those features as accepted Trilium standards. Keep the fork's
integrated build usable for personal use while tracking each upstream candidate
in a separate topic branch and PR. Submit a candidate only when its scope and
interfaces fit a standard the Trilium maintainers are willing to adopt; until
then, retain it as fork-only work. Never use the personal integration branch as
the head of an upstream PR.

PR #10824 (`TriliumNext/Trilium`) was closed on 2026-10-17 without merging. The
fork's local `main` currently matches `origin/main`, but is 123 commits behind
`upstream/main` as of the planning review. The checkout also contains uncommitted
local-picker/autosave follow-up edits. Preserve those edits; do not sync or
create topic branches from this dirty, stale checkout. First finish or preserve
the local edits, then update the fork base from the verified current upstream
main, and only then create separate topic branches for future PR candidates.

### Security review follow-up

Fork issue [#7](https://github.com/iansherr/Trilium-wPluginsExperimental/issues/7) is open to track the audit and remediation work below. GitHub Issues was disabled on the fork; it was enabled to file this requested issue.

The closed PR's security review identified a real boundary mismatch. Manifest
permissions and the network setting are checked by catalog lifecycle code before
install, update, repair, and bundle installation. The source-host allowlist is
checked for artifact downloads. These checks do not sandbox plugin scripts or
restrict their runtime network, note, or script API capabilities after enable.
Treat enabled plugins as trusted arbitrary Trilium code until runtime capability
enforcement exists. Integrity hashes detect bytes that differ from a declared
digest; they do not prove a publisher or registry is trustworthy when that same
publisher supplies both the artifact and digest.

The existing lifecycle matrix test does not prove the gate is wired: it computes
`networkBlocked` directly from fixture values and never calls install/update or
asserts that no operation/download occurs. Replace it with tests through the
real action boundary, including the failure state and side effects.

Before presenting the plugin ecosystem as security-enforced or submitting
security claims upstream:

- [ ] Make labels and help text explicit: manifest permissions are publisher-declared disclosures; `allowNetworkPackages` is an install/update policy gate, not a runtime network sandbox; source-host allowlisting applies to artifact downloads only; review status is registry metadata, not independent verification.
- [ ] Decide how to handle `secret` settings. Current values are persisted as ordinary note labels and may sync in plaintext. Prefer rejecting the type until protected storage exists; if compatibility requires retaining it, clearly warn existing and new users and never describe it as securely stored.
- [ ] Inspect cache behavior when sources are removed or fail, and give users a clear way to inspect/forget cached publisher metadata or explain when it remains active.
- [ ] Design actual runtime capability enforcement at the script/API boundary, or explicitly keep plugins as trusted arbitrary code and remove any UI implying otherwise. An install confirmation is consent, not a sandbox.
- [ ] Add deterministic acceptance tests that call the real install/update paths and verify no operation or artifact request occurs when policy denies it; verify allowed behavior too. Add runtime tests for any capability boundary that is implemented.
- [ ] Review partial enable/disable failure and health checks for mixed activation labels; make inconsistency recoverable and visible.
- [ ] Document irreversibility of updates and the limits of repair before any upstream security resubmission.

Keep this security work on its own topic branch, separate from local-path install/autosave and visual polish. Reassess whether the concerns are resolved before drafting a new upstream PR.

## Historical upstream candidates

PR #10824 is closed and unmerged; do not update or reopen it. The following
local branches/commits are historical candidate slices, not current PR heads.
They must be compared with current upstream and selectively rebuilt on fresh
topic branches before any future submission:

- `integration/plugins` → `7b838d1830`: native Plugins settings plus hidden-package discovery. A future PR should include the installed-plugin **Settings** action and settings sub-card (`cf098e7e55`, carried into `711ef8fe2e`) and regression coverage for hidden-aware lookup.
- `fix/plugins-offline-metadata` → `8ef9eecece`: cached metadata, refresh-loop protection, and legacy-cache compatibility. Keep this independent from native settings/discovery. The compatibility fix for older cached manifests without `repository` is recorded at `c6605ea3ed`.
- `fix/plugins-package-id-display` → `193c0d7589`: focused HTML entity decoding fix.

- [ ] Reassess each candidate against the current upstream tree and maintainer-adopted package standards; do not assume these old branches are ready to submit.
- [ ] Keep settings/discovery, offline metadata, package-ID display, local-path/autosave, and security work in separate reviewable topic branches/PRs where their contracts are independent.
- [ ] Before a candidate PR, rerun focused acceptance tests, relevant client/server suites, typecheck, lint, and desktop build. Record exact results and verify against a clean current base.
- [ ] Do not push or open/update a PR until the candidate scope and draft language have been reviewed.

## Forensic findings from disposable-vault testing

The failure modes below were reproduced locally and matched against the application logs. These findings are recorded before any remote PR or branch update is considered.

- [x] The historical frontend failure was traced to the old `Create Note API` custom-request script, not the package manager. In `~/Library/Application Support/trilium-data/log/trilium-2026-07-30.log`, repeated `create-note` requests created and deleted notes in bursts, followed by note-cache misses, circular-JSON errors in the tree UI, and repeated 30-second frontend-update timeouts.
- [x] The August 2 production startup completed the database migration, backup, and consistency checks successfully. The early missing-manager-note/attachment messages were cleanup effects from the prior migration; subsequent package searches and operations were short-lived and did not reproduce the historical timeout loop.
- [x] A fresh legacy-vault install reproduced a Community Packages manager-source bug: the manager attempted `POST /api/branches` and received `404`, causing a partial install rollback.
- [x] After changing the manager to Trilium’s supported `PUT /api/branches/:branchId/move-to/:parentBranchId` endpoint, the same install exposed a second manager-source bug: normal package searches could not see the package notes after they were moved into `_hidden`, so verification incorrectly reported a missing manifest.
- [x] After switching package-owned searches to the hidden-aware `quick-search` endpoint, Wordcount installed successfully, the package container moved to `_hidden`, and the log contained only successful branch moves and package operations.
- [x] Enable/disable/restart verification passed in the same disposable legacy vault. The disabled launcher remained under Available Launchers, the old visible branch was marked deleted, the hidden package container persisted, `/api/health-check` returned 200, and startup ended with “All consistency checks passed.”
- [x] The endpoint mismatch escaped earlier checks because the old move helper returned early when a note was already in the target parent. Earlier checks covered normal installs and already-cleaned vaults, but not a legacy root/container migration or an enable/disable transition that required relocation.
- [x] Add source-contract regression tests for the supported branch-move endpoint and hidden-aware package lookups (`community-packages-contract.test.mjs`). The disposable-vault run remains the behavioral integration test.
- [x] Commit the two manager-source fixes locally (`4344a79`) and record the findings (`0dada87`). They are not part of the core offline-metadata PR.
- [x] Do not file a Trilium fix PR for the manager-source commits. Keep them as reviewed follow-up commits on the catalog/manager branch; publish them only when that branch is ready.

## Community Packages manager source changes

- [x] Keep disabled package launchers under Available Launchers and move them to Visible Launchers only when enabled (`4afda7e`).
- [x] Keep the Community Packages container in Trilium’s hidden system area, including migration of a legacy root branch (`06fd49c`).
- [x] Deploy and byte-verify the tested manager script in the local vault’s Community Packages code note.
- [x] Add source-contract coverage for launcher branch relocation and hidden-container migration paths; retain the disposable-vault lifecycle run as integration coverage.
- [ ] Recalculate artifact integrity values and update catalog entries whenever a published plugin artifact changes.

## Migration and recovery test matrix

- [x] Create and integrity-check a pre-cleanup backup: `~/Backups/trilium/trilium-pre-clean-migration-20260802-1427`.
- [x] Move existing manager/settings/catalog notes out of the normal root tree without deleting them.
- [x] Move disabled package launchers out of the visible launchbar without deleting them.
- [x] Build and install the local TriliumDEV bundle while preserving the previous TriliumDEV bundle; the stable Trilium Notes app is untouched.
- [x] Migration rehearsal from the pre-cleanup backup: root manager notes and visible disabled launchers were relocated in a disposable vault and remained correct after restart.
- [x] Fresh install from a legacy vault where the package container is under root; after the endpoint/search fixes, `ensureRootNote()` relocated the managed package container to `_hidden` and the install completed.
- [x] Install disabled, enable, disable, restart; launcher placement and activation labels were correct, the previous branch was marked deleted rather than duplicated, and the restarted vault passed consistency checks.
- [x] Simulate an unavailable registry in the disposable vault; all five installed manifests retained their cached metadata while the registry was unreachable.
- [x] Open the native Plugins settings page while offline; it reports “Plugin catalog unavailable — using saved plugin information,” shows all five packages as healthy, and keeps the installed-plugin Settings controls available.
- [x] Rebuild the local app with the hidden-package discovery commit; the rebuilt Plugins page discovers all five hidden installed packages and renders the Settings controls offline. The first rehearsal correctly exposed the missing discovery path.
- [ ] Interrupt install/update/repair; verify transaction cleanup or recovery and preservation of the previous package.
- [x] Archive and restore a package; native Plugins rehearsed this in a disposable clone, preserving package-owned notes and settings, clearing the recovery entry on restore, and returning the package disabled with activation labels/launcher placement intact.
- [x] Restart the cleaned vault and inspect the new log window; no recurring Community Packages search/set-label loop appeared during startup.
- [x] Reopen Plugins settings repeatedly in the disposable offline test; no recurring search/set-label loop or `Invalid time value` error appeared in the new log window.

## Bug triage rule

An issue belongs in Trilium core when the native settings surface, event lifecycle, entity cache, or server API is wrong. An issue belongs in the Community Packages manager source when package installation, manifest validation, artifact placement, launcher lifecycle, or catalog behavior is wrong. The individual plugin packages remain separately versioned. Migration-only cleanup of persisted notes is tracked here as a vault operation, not as a core bug unless a reproducible core migration path is added.

Last reviewed locally: 2026-08-05. No remote pushes performed.
