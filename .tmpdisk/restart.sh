#!/bin/bash
pkill -9 -f "strapi develop" 2>/dev/null
lsof -ti tcp:1337 2>/dev/null | xargs kill -9 2>/dev/null
sleep 4
cd /Users/mac/newmoban/apps/cms
export TMPDIR=/Users/mac/newmoban/.tmpdisk
export PATH="/usr/local/opt/node@20/bin:$PATH"
nohup pnpm develop > /Users/mac/newmoban/.tmpdisk/cms.log 2>&1 &
echo "launched pid $!" > /Users/mac/newmoban/.tmpdisk/restart-result.txt
