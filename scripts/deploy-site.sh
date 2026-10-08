#!/usr/bin/env bash
# 部署网页版到 GitHub Pages（站点仓库 personal-workstation-site）
# 用法：bash scripts/deploy-site.sh
#
# 站点仓库是构建产物的镜像，这里只做「真实克隆 + 快进推送」：
# 旧写法用孤儿仓库 git init 再 push --force，会把远端部署历史整段重写，
# 已发布版本就没法回溯比对了。现在远端一旦分叉就停下报错，由人来决定怎么处理。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 站点仓库地址可用环境变量覆盖，便于在本地裸仓库演练推送/分叉逻辑
SITE_REPO="${DEPLOY_SITE_REPO:-https://github.com/ajie203b/personal-workstation-site.git}"
SITE_URL="${DEPLOY_SITE_URL:-https://ajie203b.github.io/personal-workstation-site/}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> 构建网页版..."
# 已有 dist/ 时复用（--fast），改动没进前端代码就别再花十秒重编
[ "${1:-}" = "--fast" ] && [ -d "$ROOT/dist" ] || (cd "$ROOT" && npm run build)

echo "==> 拉取站点仓库..."
# 资源名是内容哈希，换行符规范化会让线上与本地字节不一致；克隆时就关掉 autocrlf，
# 否则检出成 CRLF 的工作树与新产物比对全是换行噪声
if git ls-remote --heads "$SITE_REPO" main 2>/dev/null | grep -q 'refs/heads/main'; then
  git -c core.autocrlf=false -c core.eol=lf clone -q "$SITE_REPO" "$WORK/site"
  git -C "$WORK/site" config core.autocrlf false
  git -C "$WORK/site" config core.eol lf
  # 克隆后本地分支名跟着远端默认分支走（默认分支不叫 main 时会是 master），
  # 显式落到 main 上，否则后面的 push origin main 找不到本地分支
  git -C "$WORK/site" checkout -q -B main origin/main
else
  echo "    远端还没有 main 分支，按首次部署处理"
  mkdir -p "$WORK/site"
  git -C "$WORK/site" init -q -b main
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

echo "==> 推送 main（仅快进，不强推）..."
if ! PUSH_OUT="$(git push -u origin main 2>&1)"; then
  echo "$PUSH_OUT" >&2
  case "$PUSH_OUT" in
    *non-fast-forward* | *'[rejected]'* | *fetch*)
      echo "!! 推送被拒：远端 main 已分叉。请先核对远端历史再处理，本脚本不会覆盖它。" >&2 ;;
    *)
      echo "!! 推送失败（原因见上方 git 输出）。" >&2 ;;
  esac
  exit 1
fi

echo "==> 完成！站点地址：$SITE_URL"
if [ "$SITE_REPO" != "https://github.com/ajie203b/personal-workstation-site.git" ]; then
  echo "    （自定义仓库地址，跳过线上核对）"
else
  echo "    线上版本核对（Pages 重建约需几十秒）："
  curl -fsS "$SITE_URL/version.json?cb=$(date +%s)" 2>/dev/null || echo "    暂时取不到 version.json，稍后手动确认"
fi
