#!/usr/bin/env bash
# Rebase forked menu files onto the latest upstream omarchy.menu source.
#
# Only reacts when tracked files (see .upstream-menu.json "files") actually
# change upstream — commits that touch other files under shell/plugins/menu/
# (e.g. manifest.json) are ignored.
#
# MenuModel.js and BarWidget.qml are taken verbatim from upstream. Menu.qml is
# three-way merged: upstream/menu/Menu.qml (base), Menu.qml (ours), latest
# upstream Menu.qml (theirs). Conflicts are left in place for manual resolution.
#
# Usage:
#   scripts/rebase-on-upstream-menu.sh          # rebase if tracked files moved
#   scripts/rebase-on-upstream-menu.sh --check  # exit 1 when an update exists
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/.upstream-menu.json"
UPSTREAM_DIR="$ROOT/upstream/menu"

check_only=false
if [[ "${1:-}" == "--check" ]]; then
  check_only=true
fi

if [[ ! -f "$CONFIG" ]]; then
  echo "error: missing $CONFIG" >&2
  exit 1
fi

read_config() {
  python3 - "$CONFIG" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
for key in ("repository", "branch", "path", "commit"):
    if key not in cfg:
        raise SystemExit(f"error: .upstream-menu.json missing {key!r}")
files = cfg.get("files")
if not files:
    raise SystemExit('error: .upstream-menu.json missing non-empty "files" list')
print(cfg["repository"])
print(cfg["branch"])
print(cfg["path"])
print(cfg["commit"])
print("\n".join(files))
PY
}

mapfile -t cfg < <(read_config)
repo="${cfg[0]}"
branch="${cfg[1]}"
menu_path="${cfg[2]}"
stored_commit="${cfg[3]}"
tracked_files=("${cfg[@]:4}")

upstream_state() {
  python3 - "$repo" "$branch" "$menu_path" "$UPSTREAM_DIR" "${tracked_files[@]}" <<'PY'
import hashlib
import json
import sys
import urllib.error
import urllib.request

repo, branch, menu_path, upstream_dir, *tracked_files = sys.argv[1:]

def fetch_text(url):
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()

def fetch_branch_head():
    url = f"https://api.github.com/repos/{repo}/commits/{branch}"
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    return data["sha"], data["commit"]["message"].splitlines()[0]

def file_at_ref(ref, filename):
    url = f"https://raw.githubusercontent.com/{repo}/{ref}/{menu_path}/{filename}"
    return fetch_text(url)

def sha256(data):
    return hashlib.sha256(data).hexdigest()

head_sha, head_title = fetch_branch_head()
changed = []
latest_by_file = {}

for filename in tracked_files:
    local_path = f"{upstream_dir}/{filename}"
    try:
        with open(local_path, "rb") as f:
            local = f.read()
    except FileNotFoundError:
        raise SystemExit(f"error: missing base file {local_path}")

    remote = file_at_ref(head_sha, filename)
    latest_by_file[filename] = sha256(remote)
    if sha256(local) != latest_by_file[filename]:
        changed.append(filename)

if not changed:
    print("unchanged")
    print(head_sha)
    print(head_title)
    sys.exit(0)

print("changed")
print(head_sha)
print(head_title)
print(",".join(changed))
PY
}

mapfile -t state < <(upstream_state)
status="${state[0]}"
head_commit="${state[1]}"
head_title="${state[2]}"
changed_files="${state[3]:-}"

if [[ "$status" == "unchanged" ]]; then
  echo "tracked upstream files unchanged (branch head ${head_commit:0:12})"
  echo "rebase-result: unchanged"
  if ! $check_only && [[ "$head_commit" != "$stored_commit" ]]; then
    python3 - "$CONFIG" "$head_commit" "$head_title" <<'PY'
import json, sys
path, commit, title = sys.argv[1:4]
cfg = json.load(open(path))
cfg["commit"] = commit
cfg["commitTitle"] = title
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
PY
  fi
  exit 0
fi

echo "tracked upstream files changed: ${changed_files}"
echo "  branch head ${head_commit:0:12}: ${head_title}"
echo "rebase-changed-files: ${changed_files}"

if $check_only; then
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

fetch_upstream_file() {
  local name="$1"
  curl -fsSL \
    "https://raw.githubusercontent.com/${repo}/${head_commit}/${menu_path}/${name}" \
    -o "$tmpdir/${name}"
}

for file in "${tracked_files[@]}"; do
  fetch_upstream_file "$file"
done

if [[ ! -f "$UPSTREAM_DIR/Menu.qml" ]]; then
  echo "error: missing base file $UPSTREAM_DIR/Menu.qml" >&2
  exit 1
fi

cp "$ROOT/Menu.qml" "$tmpdir/Menu.ours.qml"
cp "$UPSTREAM_DIR/Menu.qml" "$tmpdir/Menu.base.qml"
cp "$tmpdir/Menu.qml" "$tmpdir/Menu.theirs.qml"

set +e
git merge-file -p \
  "$tmpdir/Menu.ours.qml" \
  "$tmpdir/Menu.base.qml" \
  "$tmpdir/Menu.theirs.qml" \
  > "$tmpdir/Menu.merged.qml"
merge_status=$?
set -e

cp "$tmpdir/Menu.merged.qml" "$ROOT/Menu.qml"
cp "$tmpdir/MenuModel.js" "$ROOT/MenuModel.js"
cp "$tmpdir/BarWidget.qml" "$ROOT/BarWidget.qml"

mkdir -p "$UPSTREAM_DIR"
cp "$tmpdir/Menu.theirs.qml" "$UPSTREAM_DIR/Menu.qml"
cp "$tmpdir/MenuModel.js" "$UPSTREAM_DIR/MenuModel.js"
cp "$tmpdir/BarWidget.qml" "$UPSTREAM_DIR/BarWidget.qml"

python3 - "$CONFIG" "$head_commit" "$head_title" <<'PY'
import json, sys
path, commit, title = sys.argv[1:4]
cfg = json.load(open(path))
cfg["commit"] = commit
cfg["commitTitle"] = title
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
PY

if [[ $merge_status -ne 0 ]]; then
  echo ""
  echo "Menu.qml merged with conflicts — search for conflict markers and resolve."
  echo "MenuModel.js and BarWidget.qml were updated from upstream without conflicts."
  echo "rebase-result: conflicts"
  exit 2
fi

echo "rebase complete with no Menu.qml conflicts"
echo "rebase-result: rebased"
exit 0
