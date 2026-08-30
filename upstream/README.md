# Upstream menu snapshot

This directory holds pristine copies of the stock `omarchy.menu` plugin files from [basecamp/omarchy](https://github.com/basecamp/omarchy) at the commit recorded in [`.upstream-menu.json`](../.upstream-menu.json).

They are the **base** side of the three-way merge used when rebasing this fork onto upstream changes. The workflow is:

1. Compare tracked upstream files (`Menu.qml`, `MenuModel.js`, `BarWidget.qml`) against the copies here.
2. If any differ, run `scripts/rebase-on-upstream-menu.sh` to merge upstream into the fork.
3. Replace these snapshots with the new upstream versions after a successful rebase.

Do not edit files in `upstream/menu/` by hand — they should always reflect the last upstream commit this fork was rebased onto. To rebase locally:

```bash
./scripts/rebase-on-upstream-menu.sh
```

The weekly GitHub Action (`.github/workflows/upstream-rebase.yml`) runs the same script and opens a PR when tracked upstream files change.
