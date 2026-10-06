#!/usr/bin/env bash
# 部署网页版到 GitHub Pages（站点仓库 personal-workstation-site）
# 用法：bash scripts/deploy-site.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SITE_REPO="https://github.com/ajie203b/personal-workstation-site.git"
DEPLOY_DIR="$TEMP/site-deploy"

echo "==> 构建网页版..."
npm run build

echo "==> 同步到站点仓库..."
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"
git init -b main > /dev/null 2>&1
git remote add origin "$SITE_REPO"
git fetch origin main --depth 1 > /dev/null 2>&1 || true
touch .nojekyll
cp -r "$ROOT/dist/"* .
# 生成 version.json（版本号从 package.json 读取）
VERSION=$(grep '"version"' "$ROOT/package.json" | head -1 | sed 's/.*: "\([^"]*\)".*/\1/')
echo "{\"version\":\"$VERSION\"}" > version.json
git add -A
git commit -m "deploy: $(date '+%Y-%m-%d %H:%M') 个人工作站" > /dev/null
git push origin main --force > /dev/null 2>&1

echo "==> 完成！站点地址：https://ajie203b.github.io/personal-workstation-site/"
