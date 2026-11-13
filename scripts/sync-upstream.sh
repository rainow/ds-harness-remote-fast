#!/usr/bin/env bash
# Rebuild the `lite` branch on top of the latest upstream `main` by replaying
# patches/*.patch, then rebuild the committed bundles and verify.
#
# Why patches instead of a long-lived rebase: upstream moves fast (100+ commits
# per week) and our fork is a handful of concerns (identity rename, fast mode,
# docs/CI). A patch series gives one conflict per concern per upstream sync, and
# the resolution lives in the patch file instead of a merge commit.
#
# Usage:
#   bash scripts/sync-upstream.sh            # sync to upstream/main
#   bash scripts/sync-upstream.sh --no-test  # skip the slow test run
#
# On conflict: fix the files, `git add -A && git am --continue`, then re-run
# with --no-test; the script regenerates patches/ from the result at the end.
set -euo pipefail
cd "$(dirname "$0")/.."

UPSTREAM="${UPSTREAM_REMOTE:-upstream}"
BRANCH="${FORK_BRANCH:-lite}"
RUN_TESTS=1
[ "${1:-}" = "--no-test" ] && RUN_TESTS=0

if [ -n "$(git status --porcelain)" ]; then
  echo "工作区不干净，先提交或 stash" >&2
  exit 1
fi
[ -d patches ] || { echo "缺少 patches/ 目录" >&2; exit 1; }

git fetch "$UPSTREAM" main --depth=120
BASE=$(git rev-parse "$UPSTREAM/main")
echo "上游基线：$BASE $(git log -1 --format=%s "$BASE")"

# Keep the previous state addressable; the sync rewrites `lite` history.
git branch -f "backup/$BRANCH-$(date +%Y%m%d-%H%M%S)" "$BRANCH" 2>/dev/null || true

# `patches/` is tracked on this branch but not in the upstream tree we are
# about to check out, so stage a copy before switching.
PATCH_DIR=$(mktemp -d)
cp patches/*.patch "$PATCH_DIR"/
trap 'rm -rf "$PATCH_DIR"' EXIT

git checkout -B "$BRANCH" "$BASE"

if ! git am -3 "$PATCH_DIR"/*.patch; then
  cat >&2 <<'MSG'
停止在补丁冲突处。规则：改的是 patch，不是工作区。
  1) 手工解冲突，让源码回到「上游新代码 + 我们的 fork 改动」的正确形态
  2) git add -A && git am --continue
  3) bash scripts/sync-upstream.sh --no-test     # 从下一步继续并刷新 patches/
MSG
  exit 1
fi

pnpm install --frozen-lockfile
pnpm --filter './packages/**' -r build
git add packages/plugin/dist
git commit -q -m "chore: rebuild bundles for upstream $(git rev-parse --short "$BASE")"

npx tsc -p packages/plugin/tsconfig.test.json
node scripts/verify-dsh-plugin.mjs
if [ "$RUN_TESTS" = 1 ]; then
  pnpm -C packages/plugin test
fi

# Keep the series in sync with what actually applied (HEAD~1 = last patch commit).
rm -rf patches
git format-patch -q "$BASE"..HEAD~1 -o patches
git add patches
git add patches
git commit -q --amend --no-edit

echo
echo "完成：$BRANCH 现在基于 $(git rev-parse --short "$BASE")"
echo "记得把版本改成 \`<upstream-version>-fast.N\`：packages/plugin/package.json、src/version.ts、dsh-plugin.json ×2、package.json"
