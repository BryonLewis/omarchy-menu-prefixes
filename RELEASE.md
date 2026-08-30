# Releasing

This repo ships through three related layers:

| Layer | What it is | Updated by |
|-------|------------|------------|
| `manifest.json` → `version` | Version shown by Omarchy and the plugin marketplace | Release workflow |
| Git tag + GitHub Release | Human-readable changelog anchor | Release workflow |
| Marketplace `listingValidatedCommit` | Verified marketplace snapshot (exact SHA) | Manual verification issue |

The release workflow handles the first two. Marketplace verification stays manual.

## When to bump what

| Change | Bump | Examples |
|--------|------|----------|
| Patch `1.0.x` | Upstream menu sync, bug fixes, CI-only changes | Weekly upstream rebase merges |
| Minor `1.x.0` | New prefix behavior, config options, user-visible features | New prefix kind, new config keys |
| Major `x.0.0` | Breaking config or behavior changes | Removing or renaming config keys users rely on |

Upstream rebase PRs do not need their own release. Cut a patch release when you want users and the catalog to see a new version.

## Option 1: GitHub Actions UI

1. Open **Actions → Release → Run workflow** on `master`.
2. Choose `patch`, `minor`, or `major`.
3. Paste markdown release notes.
4. Run the workflow.

The workflow will:

1. Run the same checks as CI (tests, shellcheck, QML brace check, `omarchy plugin validate`)
2. Bump `manifest.json`
3. Commit `Release vX.Y.Z` to `master`
4. Create tag `vX.Y.Z` and a GitHub Release
5. Write a job summary with marketplace verification details

## Option 2: Local helper script

From the repo root:

```bash
chmod +x scripts/release.sh   # once

scripts/release.sh patch "Fix currency validation and sync upstream menu"
scripts/release.sh minor release-notes.md
git log --format='- %s' v1.0.0..HEAD | scripts/release.sh patch -
```

The script runs local tests first, then triggers the same Release workflow through the GitHub CLI.

Requirements:

- [`gh`](https://cli.github.com/) authenticated for this repository
- Optional local `shellcheck` (CI still runs it if missing locally)

Watch the workflow:

```bash
gh run list --workflow release.yml --limit 1
gh run watch --workflow release.yml
```

## Marketplace verification (manual)

After a release finishes, open the workflow run summary. It contains the exact commit SHA and fields for a marketplace verification issue.

1. Open the [plugin verification issue form](https://github.com/HANCORE-linux/omarchy-plugin-marketplace/issues/new?template=verify-plugin.yml).
2. Choose **Verify and publish a newer upstream commit**.
3. Fill in:
   - **Plugin ID:** `com.bryon.omarchy-menu-prefixes`
   - **Repository URL:** `https://github.com/BryonLewis/omarchy-menu-prefixes`
   - **Target commit:** the full 40-character SHA from the release summary
4. Check the acknowledgment box and submit.
5. Wait for the bot reports, then a marketplace maintainer applies `approved-and-verified`.

You do not need to verify every patch release if you are fine with the catalog showing **Update unverified** between promotions. Users can still install from `master`; Omarchy clones mutable HEAD, not the verified SHA.

## First release for this repo

The marketplace listing is still pinned to an older verified commit while `master` has moved ahead. A sensible first automated release is:

- **Bump:** `patch` → `1.0.1`
- **Notes:** upstream rebase workflow, Frankfurter validation, upstream menu sync

Then file the marketplace verification issue if you want verified status restored.

## Troubleshooting

- **Tag already exists:** the workflow refuses to reuse a tag. Bump again or delete the unused tag first.
- **Workflow not on master:** Release only runs from `refs/heads/master`.
- **Validation failed:** fix the failure on `master` first; the release workflow will not push a broken commit.
