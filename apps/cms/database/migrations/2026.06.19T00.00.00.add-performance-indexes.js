'use strict';

/**
 * 性能索引（为数据增长提前铺路）。
 *
 * Strapi 默认只给主键 / uid 唯一字段 / 关系链接表建索引；
 * 而这些「排序 / 过滤」标量列被高频查询却无索引，量大后会全表扫描：
 *   - articles.slug        ：文章页按 slug 精确查找（/频道/文章slug）
 *   - articles.publish_at  ：全站列表 sort=publishAt:desc
 *   - articles.view_count  ：吃瓜热榜 / 精选标签 sort=viewCount:desc
 *   - articles.review_state：后台审核流过滤
 *   - comments.approved    ：前台仅取「已审核」评论
 *   - comments.created_at  ：评论按时间倒序
 *
 * 全部 CREATE INDEX IF NOT EXISTS（PostgreSQL）→ 幂等，重复运行 / 索引已存在均安全。
 * 仅针对生产用的 PostgreSQL（项目禁用 SQLite）。
 */

const INDEXES = [
  { name: 'idx_articles_slug', sql: 'CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles (slug)' },
  { name: 'idx_articles_publish_at', sql: 'CREATE INDEX IF NOT EXISTS idx_articles_publish_at ON articles (publish_at DESC)' },
  { name: 'idx_articles_view_count', sql: 'CREATE INDEX IF NOT EXISTS idx_articles_view_count ON articles (view_count DESC)' },
  { name: 'idx_articles_review_state', sql: 'CREATE INDEX IF NOT EXISTS idx_articles_review_state ON articles (review_state)' },
  { name: 'idx_comments_approved', sql: 'CREATE INDEX IF NOT EXISTS idx_comments_approved ON comments (approved)' },
  { name: 'idx_comments_created_at', sql: 'CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments (created_at DESC)' },
];

module.exports = {
  async up(knex) {
    // 项目仅用 PostgreSQL（禁用 SQLite）；CREATE INDEX IF NOT EXISTS 为 PG 语法。
    for (const { sql } of INDEXES) {
      await knex.raw(sql);
    }
  },
  async down(knex) {
    for (const { name } of INDEXES) {
      await knex.raw(`DROP INDEX IF EXISTS ${name}`);
    }
  },
};
