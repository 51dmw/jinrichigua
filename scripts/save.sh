#!/usr/bin/env bash
# 一键提交 + 推送：pnpm save "这次改了啥"
# 没写说明则用时间戳；没有改动则跳过；机密文件由 .gitignore 自动排除。
cd "$(dirname "$0")/.." || exit 1

msg="$*"
[ -z "$msg" ] && msg="update $(date '+%Y-%m-%d %H:%M')"

if [ -z "$(git status --porcelain)" ]; then
  echo "✓ 没有改动，无需提交。"
  exit 0
fi

git add -A
if ! git commit -m "$msg"; then
  echo "✗ 提交失败。"
  exit 1
fi

echo "→ 推送到 GitHub…"
if git push; then
  echo "✅ 已提交并推送：$msg"
else
  echo "✗ 推送失败（可能网络问题或 token 过期）。代码已在本地存档，联网后重试 'git push' 即可。"
  exit 1
fi
