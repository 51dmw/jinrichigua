#!/bin/bash
for i in $(seq 1 90); do
  find /private/tmp/claude-501 -name '*.output' -mmin +1 -delete 2>/dev/null
  if grep -qE "tagged [0-9]+ demo article|demo tags skipped" /Users/mac/newmoban/.tmpdisk/cms.log 2>/dev/null; then break; fi
  sleep 5
done
{
  grep -E "topped up|topUp skipped|linked [0-9]+ article|tagged [0-9]+ demo|demo tags skipped" /Users/mac/newmoban/.tmpdisk/cms.log | tail -6
  echo "published: $(psql -d newsportal -At -c 'SELECT count(*) FROM articles WHERE published_at IS NOT NULL;')"
  echo "tags-with-articles: $(psql -d newsportal -At -c "SELECT count(DISTINCT tag_id) FROM articles_tags_lnk;")"
  echo "per-channel published:"
  psql -d newsportal -At -F'|' -c "SELECT ch.slug, count(*) FROM articles a JOIN articles_channel_lnk l ON l.article_id=a.id JOIN channels ch ON ch.id=l.channel_id WHERE a.published_at IS NOT NULL AND ch.published_at IS NOT NULL GROUP BY ch.slug ORDER BY ch.slug;"
} > /Users/mac/newmoban/.tmpdisk/wait2-result.txt 2>&1
