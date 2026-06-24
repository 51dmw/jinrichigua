'use strict';

/**
 * 友链原始日志表 friend_link_logs（第1期：来路/去路埋点）。
 *
 * 刻意用「普通 PG 表」而非 Strapi 集合：
 *   - 只追加写、不需要后台 CRUD / 草稿发布 / RBAC；
 *   - 写入走 strapi.db.connection(knex)，避开 document service 开销；
 *   - 后续第2期聚合直接 SQL group by，无需经 Strapi ORM。
 *
 * link_id 关联 friend_links.id，但「不建外键约束」——避免迁移时序（本表可能先于
 * friend_links 表建好）与删除友链时的级联顾虑；用 (link_id, type, created_at) 索引即可。
 *
 * 幂等：建表前 hasTable 判断；索引用 CREATE INDEX IF NOT EXISTS（PG）。
 */
module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable('friend_link_logs');
    if (!exists) {
      await knex.schema.createTable('friend_link_logs', (t) => {
        t.increments('id').primary();
        t.integer('link_id').notNullable();
        t.string('type', 8).notNullable(); // 'in' | 'out'
        t.string('ip_hash', 64); // sha256 前 16 位（不存明文 IP）
        t.boolean('is_bot').notNullable().defaultTo(false);
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      });
    }
    // 索引（幂等）：按时间扫 + 按(友链,类型,时间)聚合。
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_fll_created_at ON friend_link_logs (created_at)',
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_fll_link_type_created ON friend_link_logs (link_id, type, created_at)',
    );
  },

  async down(knex) {
    await knex.schema.dropTableIfExists('friend_link_logs');
  },
};
