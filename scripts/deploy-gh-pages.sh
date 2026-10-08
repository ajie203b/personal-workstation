#!/usr/bin/env bash
# 把构建产物发到 GitHub Pages —— 目标是本仓库自身的 gh-pages 分支（站点仓库已停用删除）
# 用法：bash scripts/deploy-gh-pages.sh [--fast]
#   --fast  复用已有 dist/，不重新构建（只改文档/脚本时用）
#
# 只做「真实克隆 + 快进推送」：远端一旦分叉就停下报错，不强推覆盖历史。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE_REPO="$(git -C "$ROOT" remote get-url origin)"
# 站点仓库停用后的兜底：Pages 地址由 origin 推导成 https://<user>.github.io/<repo>/
# 不解析远端 Pages 配置（没开启时 API 会返回 HTML 错误页，别拿它当 URL 印出来）
derive_site_url() {
  local origin owner slug
  origin="$(git -C "$ROOT" remote get-url origin)"
  slug="${origin##*/}"
  slug="${slug%.git}"
  if [[ "$origin" == *"@"*":"* ]]; then
    owner="${origin#*:}"
  else
    owner="${origin#*://}"
  fi
  owner="${owner%%/*}"
  echo "https://${owner}.github.io/${slug}/"
}
SITE_URL="${DEPLOY_SITE_URL:-$(derive_site_url)}"
BRANCH=gh-pages
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> 构建网页版..."
# 已有 dist/ 时复用（--fast），改动没进前端代码就别再花十秒重编
[ "${1:-}" = "--fast" ] && [ -d "$ROOT/dist" ] || (cd "$ROOT" && npm run build)

echo "==> 准备 $BRANCH 分支（仓库：$SITE_REPO）..."
if git -C "$ROOT" ls-remote --heads "$SITE_REPO" "$BRANCH" 2>/dev/null | grep -q "refs/heads/$BRANCH"; then
  # 只取那一支分支，历史浅一点即可：产物分支没有源码可翻
  git -c core.autocrlf=false -c core.eol=lf clone -q --depth 5 --branch "$BRANCH" "$SITE_REPO" "$WORK/site"
  git -C "$WORK/site" config core.autocrlf false
  git -C "$WORK/site" config core.eol lf
else
  echo "    远端还没有 $BRANCH，按首次发布处理"
  mkdir -p "$WORK/site/.git"
  git -C "$WORK/site" init -q -b "$BRANCH"
  git -C "$WORK/site" remote add origin "$SITE_REPO"
fi

cd "$WORK/site"
case "$PWD" in
  "$WORK"/*) ;;
  *) echo "!! 工作目录异常（$PWD），中止以免误删文件" >&2; exit 1 ;;
esac

# 用新构建替换旧的静态产物，只保留 .git
find . -maxdepth 1 -mindepth 1 ! -name .git -exec rm -rf {} +
cp -r "$ROOT/dist/"* .
touch .nojekyll
VERSION="$(grep '"version"' "$ROOT/package.json" | head -1 | sed 's/.*: "\([^"]*\)".*/\1/')"
printf '{"version":"%s"}\n' "$VERSION" > version.json

git add -A
# 以暂存内容判断是否有变更：工作树与 HEAD 的换行差异会在 add 时被规范化掉，
# 只看 git status 会把「无实质变更」误判成有变更，进而撞上空的 commit
if git diff --cached --quiet; then
  echo "==> 产物与线上一致，无需发布"
  exit 0
fi

git commit -q -m "deploy: v$VERSION $(date '+%Y-%m-%d %H:%M')"

echo "==> 推送 $BRANCH（仅快进，不强推）..."
if ! PUSH_OUT="$(git push -u origin "$BRANCH" 2>&1)"; then
  echo "$PUSH_OUT" >&2
  case "$PUSH_OUT" in
    *non-fast-forward* | *'[rejected]'* | *fetch*)
      echo "!! 推送被拒：远端 $BRANCH 已分叉。请先核对远端历史再处理，本脚本不会覆盖它。" >&2 ;;
    *)
      echo "!! 推送失败（原因见上方 git 输出）。" >&2 ;;
  esac
  exit 1
fi

echo "==> 完成！已推送 $BRANCH"
echo "    站点地址：$SITE_URL"
echo "    线上版本核对（Pages 重建约需几十秒）："
curl -fsS "$SITE_URL/version.json?cb=$(date +%s)" 2>/dev/null || echo "    暂时取不到 version.json，稍后手动确认"
echo "    发布历史：$SITE_REPO/releases（版本号与网页版产物都在那里）"
