#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/release.sh {patch|minor|major} [notes-file|-]

Run local checks, then trigger the Release GitHub Actions workflow on master.

Examples:
  scripts/release.sh patch "Fix currency validation and sync upstream menu"
  scripts/release.sh minor release-notes.md
  git log --format='- %s' v1.0.0..HEAD | scripts/release.sh patch -
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

bump="${1:-}"
notes_source="${2:--}"

if [[ ! "$bump" =~ ^(patch|minor|major)$ ]]; then
  echo "error: bump must be patch, minor, or major" >&2
  usage >&2
  exit 1
fi

if [[ "$notes_source" == "-" ]]; then
  notes="$(cat)"
else
  if [[ ! -f "$notes_source" ]]; then
    echo "error: notes file not found: $notes_source" >&2
    exit 1
  fi
  notes="$(cat "$notes_source")"
fi

if [[ -z "${notes//[[:space:]]/}" ]]; then
  echo "error: release notes must not be empty" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "Running local tests..."
node --test tests/*.js

if command -v shellcheck >/dev/null 2>&1; then
  echo "Running shellcheck..."
  shellcheck scripts/*.sh
else
  echo "shellcheck not installed locally; CI will still lint shell scripts."
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required to trigger the release workflow" >&2
  exit 1
fi

echo "Triggering Release workflow on master (${bump})..."
notes_file="$(mktemp)"
trap 'rm -f "$notes_file"' EXIT
printf '%s\n' "$notes" > "$notes_file"

gh workflow run release.yml \
  --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner)" \
  --ref master \
  -f "bump=${bump}" \
  -F "notes@${notes_file}"

echo
echo "Release workflow started."
echo "Watch progress with:"
echo "  gh run list --workflow release.yml --limit 1"
echo "  gh run watch --workflow release.yml"
echo
echo "When it finishes, open the run summary for marketplace verification details."
