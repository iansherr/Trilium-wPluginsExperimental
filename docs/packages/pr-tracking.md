# Plugin work and PR tracking

This is the working checklist for the Trilium plugin ecosystem work. It records local commits and follow-up work; it does not mean that a commit has been pushed or that a PR has been updated.

## Existing Trilium PR work

Local review branches are assembled but not pushed:

- `integration/plugins` → `7b838d1830` for the Settings UI plus hidden-package discovery work (candidate for PR #10824).
- `fix/plugins-offline-metadata` → `8ef9eecece` for cached metadata, refresh-loop protection, and legacy-cache compatibility.
- `fix/plugins-package-id-display` → `193c0d7589` for the independent package-ID display fix.

- [ ] PR #10824: update the description so it accurately explains the proposed plugin ecosystem manager and the new Plugins settings surface. Avoid describing the pre-existing Community Packages note or an existing Trilium add-on system as though either was already present.
- [ ] PR #10824: include the explicit installed-plugin **Settings** action and the settings sub-card UI (`cf098e7e55`, locally carried into `711ef8fe2e`).
- [ ] PR #10824: include the hidden-package discovery fix in the same feature PR (`searchForNotesIncludingHidden` plus regression coverage). This is required because the package tree is intentionally hidden from the normal note tree.
- [ ] Offline package metadata PR: include the cached-manifest behavior, the user-facing “offline, using local plugin data” wording, and the refresh-loop guard (`61787a814e`, `5304d0f485`).
- [x] Offline package metadata PR: add the cached-manifest compatibility fix found during the disposable offline UI test; older cached manifests omit `repository`, so the parser must still recognize their saved metadata (`c6605ea3ed`, local only).
- [ ] Keep the hidden-package discovery fix out of the offline PR; it is a settings/package-location integration issue, not an offline-cache change.
- [ ] Package ID display PR: keep the HTML entity decoding fix separate and focused (`193c0d7589`).
- [x] Before updating any PR, rerun the relevant focused tests, client suite, typecheck, lint, and desktop build; locally verified: focused plugin/search tests 17 passed, full client suite 2,951 passed across 242 files, typecheck clean, targeted ESLint clean, and desktop packaging exit 0. Record these results in the PR description when remote updates are eventually approved.
- [ ] Do not push or open/update a PR until the draft language and commit grouping have been reviewed.

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
