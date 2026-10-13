#!/usr/bin/env bash
# sync-qingxiao-assets.sh — 从清霄模型仓库拷贝模型与语音到 pets/qingxiao/assets/（素材不进 git）
# 用法：tools/sync-qingxiao-assets.sh [清霄仓库的 assets 目录]
set -euo pipefail
SRC="${1:-$HOME/projects/tmp/qingxiao-pet/assets}"
DST="$(cd "$(dirname "$0")/.." && pwd)/pets/qingxiao/assets"
mkdir -p "$DST/voices"
cp "$SRC/qingxiao/model.glb" "$DST/model.glb"
rsync -a --delete "$SRC/voices/qingxiao/" "$DST/voices/"
echo "synced $SRC -> $DST"
