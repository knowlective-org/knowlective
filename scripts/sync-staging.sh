#!/usr/bin/env bash
# After a pull request from staging is merged into master: bring staging up to
# master (the merge commit), on this machine and on GitHub.
#
#   pnpm sync:staging
#
# Only moves staging forward (--ff-only): if staging has commits master
# doesn't, it stops instead of merging. Pushing staging runs CI once more.
set -euo pipefail

cd "$(dirname "$0")/.."
die() { echo "sync-staging: $*" >&2; exit 1; }

[ -z "$(git status --porcelain)" ] || die "the working tree has changes; commit or stash them first"

git checkout staging
git fetch origin
behind=$(git rev-list --count staging..origin/master)
ahead=$(git rev-list --count origin/master..staging)

if [ "$behind" -eq 0 ]; then
  echo "sync-staging: staging is already up to date with master"
  exit 0
fi
[ "$ahead" -eq 0 ] || die "staging has $ahead commit(s) master doesn't; merge them into master first"

git pull --ff-only origin master
git push
echo "sync-staging: staging is now at master ($(git rev-parse --short HEAD))"
