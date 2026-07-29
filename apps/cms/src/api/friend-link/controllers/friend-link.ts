import { factories } from '@strapi/strapi';
import { createHash } from 'crypto';

const UID = 'api::friend-link.friend-link';

// IP 单向散列用的固定盐——只为「不存明文 IP」（隐私），非加密用途。
// 第1期不做聚合/UV，盐固定即可；若日后换盐，新旧 hash 不可比，但不影响本期。
const IP_SALT = 'jinrichigua::friend-link::ip-salt::v1';

// 已知爬虫 UA 关键词。命中即视为 bot：默认「跳过不入库」，保持原始日志表干净
// （任务允许二选一；选跳过）。
const BOT_UA =
  /(googlebot|bingbot|yandex(bot|metrika)|bytespider|baiduspider|duckduckbot|applebot|slurp|sogou\sweb|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|spider|crawler|\bbot\b)/i;

function hashIp(ip: string): string {
  if (!ip) return '';
  return createHash('sha256').update(ip + IP_SALT).digest('hex').slice(0, 16);
}

export default factories.createCoreController(UID, ({ strapi }) => ({
  /**
   * POST /api/friend-link/track —— 写入一条来路/去路原始日志。
   * 入参：{ code, type:'in'|'out', ip, ua }；请求头 x-friend-track-secret 须与 env 一致。
   * 只写日志、不做去重（PV/UV 去重留第2期聚合）。任何异常都返回 ok，绝不影响前台跳转。
   */
  async track(ctx) {
    // 1) 共享密钥校验（防公网刷日志）。未配置密钥时一律拒绝（fail-closed）。
    const secret = process.env.FRIEND_TRACK_SECRET;
    const provided = ctx.request.headers['x-friend-track-secret'];
    if (!secret || provided !== secret) {
      return ctx.unauthorized('invalid track secret');
    }

    const body = (ctx.request.body ?? {}) as {
      code?: string;
      type?: string;
      ip?: string;
      ua?: string;
    };
    const code = (body.code ?? '').trim();
    const type = body.type === 'in' ? 'in' : body.type === 'out' ? 'out' : '';
    // 入参不合法：静默返回 ok（不暴露内部细节，也不记脏数据）。
    if (!code || !type) {
      ctx.body = { ok: true };
      return;
    }

    try {
      const knex = strapi.db.connection;

      // 2) 按 code 查「已启用」友链；查不到 → 忽略不记、返回 ok。
      const link = await knex('friend_links').where({ code, enabled: true }).first('id');
      if (!link) {
        ctx.body = { ok: true };
        return;
      }

      // 3) 爬虫 UA → 默认跳过不入库（保持表干净）。
      if (BOT_UA.test(body.ua ?? '')) {
        ctx.body = { ok: true, skipped: 'bot' };
        return;
      }

      // 4) ip_hash = sha256(ip + 盐) 前 16 位（不存明文 IP）。
      const ipHash = hashIp((body.ip ?? '').trim());

      // 5) 插一条原始日志（不去重）。
      await knex('friend_link_logs').insert({
        link_id: link.id,
        type,
        ip_hash: ipHash,
        is_bot: false,
        created_at: knex.fn.now(),
      });

      ctx.body = { ok: true };
    } catch (e) {
      strapi.log.warn(`[friend-link.track] ${(e as Error).message}`);
      ctx.body = { ok: true };
    }
  },
}));
