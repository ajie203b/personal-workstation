#!/usr/bin/env bash
# 后台重试：推送源码 main + 校正 v0.6.0 标签 + 重新部署站点
cd "/d/AAA-resource/app/个人工作站" || exit 1

push_ok=0
for i in $(seq 1 40); do
  if git push origin main > /tmp/push-main.log 2>&1; then push_ok=1; echo "MAIN_PUSHED attempt $i"; break; fi
  sleep 30
done
if [ $push_ok -eq 0 ]; then echo "MAIN_PUSH_FAILED"; exit 1; fi

git tag -fa v0.6.0 -m "v0.6.0 手机端体验重构 + 打卡任务" > /dev/null 2>&1
tag_ok=0
for i in $(seq 1 20); do
  if git push -f origin v0.6.0 > /tmp/push-tag.log 2>&1; then tag_ok=1; echo "TAG_FIXED attempt $i"; break; fi
  sleep 30
done

site_ok=0
for i in $(seq 1 20); do
  if bash scripts/deploy-site.sh > /tmp/deploy-site.log 2>&1; then site_ok=1; echo "SITE_DEPLOYED attempt $i"; break; fi
  sleep 30
done

echo "=== RESULT: main=$push_ok tag=$tag_ok site=$site_ok ==="
