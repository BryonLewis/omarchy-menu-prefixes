# Upstream tracking

This fork rebases onto the stock `omarchy.menu` plugin from [basecamp/omarchy](https://github.com/basecamp/omarchy). No local copies of upstream files are kept — the last-synced commit is recorded in [`.upstream-menu.json`](../.upstream-menu.json).

That commit is the **base** for three-way merging `Menu.qml` when upstream moves:

| Role | Source |
|------|--------|
| Base | Tracked files at the pinned commit in `.upstream-menu.json` |
| Ours | This repo's `Menu.qml` (with prefix dispatch) |
| Theirs | Tracked files at upstream `quattro` branch head |

`MenuModel.js` and `BarWidget.qml` are copied verbatim from upstream; only `Menu.qml` is merged.

## How it works

1. Compare tracked files (`Menu.qml`, `MenuModel.js`, `BarWidget.qml`) at the pinned commit vs. upstream branch head.
2. If any differ, `scripts/rebase-on-upstream-menu.sh` fetches both versions and rebases.
3. Update the pinned commit in `.upstream-menu.json` after a successful rebase.

To rebase locally:

```bash
./scripts/rebase-on-upstream-menu.sh
```

The weekly GitHub Action (`.github/workflows/upstream-rebase.yml`) runs the same script and opens a PR when tracked upstream files change.
