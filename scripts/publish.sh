#!/usr/bin/env bash
# Run from an unrestricted terminal when the task sandbox cannot write .git.
set -euo pipefail
cd "$(dirname "$0")/.."

repo=pbelmans/mg-mirror
domain=mg.ncag.info
case "$(git remote get-url origin)" in
  "https://github.com/${repo}.git"|"git@github.com:${repo}.git") ;;
  *) echo "Unexpected origin; refusing to publish." >&2; exit 1 ;;
esac
test "$(git branch --show-current)" = main
gh auth status

git add .github .gitignore AGENTS.md Makefile README.md assets content hugo.toml layouts scripts static
git diff --cached --check
if ! git diff --cached --quiet; then
  git commit -m "feat: add static genealogy mirror"
fi

if ! gh api "repos/${repo}/pages" >/dev/null 2>&1; then
  gh api --method POST "repos/${repo}/pages" -f build_type=workflow >/dev/null
fi
gh api --method PUT "repos/${repo}/pages" -f build_type=workflow -f "cname=${domain}" >/dev/null
gh repo edit "$repo" --homepage "https://${domain}/"
git push --set-upstream origin main

revision=$(git rev-parse HEAD)
run_id=
for attempt in {1..12}; do
  if run_id=$(gh run list --repo "$repo" --workflow pages.yml --commit "$revision" --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null) && test -n "$run_id"; then
    break
  fi
  sleep 2
done
if test -z "$run_id"; then
  echo "No deployment run found: https://github.com/${repo}/actions" >&2
  exit 1
fi
gh run watch "$run_id" --repo "$repo" --interval 10 --exit-status
if ! gh api --method PUT "repos/${repo}/pages" -F https_enforced=true >/dev/null; then
  echo "Deployment succeeded; HTTPS enforcement is waiting for GitHub's certificate. Rerun this script when it is ready." >&2
  exit 1
fi
curl --fail --silent --show-error --location "https://${domain}/" --output /dev/null
echo "Published: https://${domain}/"
