#!/usr/bin/env bash
# 后台重试：推送 v0.7.4 源码与标签
cd "/d/AAA-resource/app/个人工作站" || exit 1
for i in $(seq 1 40); do
  if git push origin main > /tmp/push-074.log 2>&1 && git tag -fa v0.7.4 -m "v0.7.4" > /dev/null 2>&1 && git push -f origin v0.7.4 >> /tmp/push-074.log 2>&1; then
    echo "ALL_PUSHED attempt $i"
    exit 0
  fi
  echo "--- attempt $i: $(tail -1 /tmp/push-074.log | head -c 60)"
  sleep 30
done
echo "PUSH_FAILED"
