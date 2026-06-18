#!/bin/bash
for i in $(seq 1 80); do
  if grep -qE "topped up to 30|topUp skipped" /Users/mac/newmoban/.tmpdisk/cms.log 2>/dev/null; then break; fi
  sleep 5
done
{
  echo "=== topUp/authors log ==="
  grep -E "rebrand|topped up|topUp skipped|linked [0-9]+ article|authors ensured|home layout seeded|setup skipped" /Users/mac/newmoban/.tmpdisk/cms.log | tail -8
  echo "total_rows: $(psql -d newsportal -At -c 'SELECT count(*) FROM articles;')"
  echo "published: $(psql -d newsportal -At -c 'SELECT count(*) FROM articles WHERE published_at IS NOT NULL;')"
} > /Users/mac/newmoban/.tmpdisk/wait-result.txt 2>&1
