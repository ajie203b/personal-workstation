#!/usr/bin/env bash
# 带“代理/直连”交替重试的 git push：网络间歇时自动换路重试
# 用法：bash scripts/push-retry.sh <remote> <refspec...>
set -u
REMOTE="$1"; shift
REFSPECS=("$@")
PROXY="http://127.0.0.1:7897"

for i in $(seq 1 30); do
  # 偶数轮直连，奇数轮走代理
  if [ $((i % 2)) -eq 0 ]; then
    echo "[$(date '+%H:%M:%S')] 第 $i 次尝试：直连 push"
    if git -c http.proxy= -c https.proxy= push "$REMOTE" "${REFSPECS[@]}" 2>&1; then
      echo "OK 直连成功"; exit 0
    fi
  else
    echo "[$(date '+%H:%M:%S')] 第 $i 次尝试：代理 push"
    if git -c http.proxy="$PROXY" -c https.proxy="$PROXY" push "$REMOTE" "${REFSPECS[@]}" 2>&1; then
      echo "OK 代理成功"; exit 0
    fi
  fi
  sleep 20
done
echo "FAILED 30 次重试均失败"; exit 1
