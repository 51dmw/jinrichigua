/**
 * 评论 lifecycle（§6 + 防刷/反垃圾）。
 * - 先审后发：approved=false。
 * - 文本规范化后再匹配（抗全角/零宽/空格绕过）。
 * - 内容 + 昵称 同时过滤：链接 / 混淆链接 / 联系方式 / 广告词 / 敏感词。
 * - 低质拦截：纯符号表情 / 重复字符刷屏。
 */
import { errors } from '@strapi/utils';

const ZERO_WIDTH = /[​-‍﻿⁠᠎]/g;

/** 全角→半角 + 去零宽 + 小写（仅用于匹配，不改存储内容）。 */
function normalize(s: string): string {
  return s
    .replace(ZERO_WIDTH, '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .toLowerCase();
}

// 链接 / 联系方式
const LINK_RE =
  /(https?:\/\/|www\.[\w-]+|[\w-]+\.(?:com|cn|net|org|cc|top|xyz|vip|shop|club|me|tv|app|co|info|biz|wang|site)(?:\/|\b)|\b1[3-9]\d{9}\b|(?:微信|薇信|威信|vx|wx|qq|扣扣)\s*[:：]?\s*[\w-]{4,})/i;

// 混淆链接：域名用 点/。/dot/[.]/空格 分隔 + 常见 TLD
const OBFUSC_LINK_RE =
  /[\w一-龥-]+\s*(?:点|。|\.|\(?dot\)?|\[\.?\]|（点）)\s*(?:com|cn|net|org|top|xyz|vip|shop|cc|me)/i;

const AD_WORDS = [
  '加微信', '加我微信', '私聊', '代理', '加盟', '招商', '兼职', '刷单', '日赚', '月入',
  '一手货源', '微商', '返利', '优惠券', '现金贷', '博彩', '彩票', '免费领', '点击领取',
  '扫码', '联系电话', '招代理', '诚招', '收徒', '带单', '稳赚', '包回本',
];

function assertClean(raw: string, field: string) {
  if (!raw) return;
  const text = normalize(raw);
  const compact = text.replace(/\s+/g, ''); // 去空格抗「加 微 信」
  if (LINK_RE.test(text) || OBFUSC_LINK_RE.test(text)) {
    throw new errors.ApplicationError(`${field}不允许包含链接、网址或联系方式`);
  }
  const ad = AD_WORDS.find((w) => compact.includes(normalize(w).replace(/\s+/g, '')));
  if (ad) {
    throw new errors.ApplicationError(`${field}包含疑似广告内容`);
  }
}

function assertQuality(content: string) {
  // 去空白/标点/符号/控制字符后，应还剩可读文字
  const meaningful = content.replace(/[\s\p{P}\p{S}\p{C}]/gu, '');
  if (meaningful.length === 0) {
    throw new errors.ApplicationError('评论内容无效，请输入文字');
  }
  // 同一字符连续 ≥10 次（刷屏，如「啊啊啊…」「。。。…」）
  if (/(.)\1{9,}/u.test(content)) {
    throw new errors.ApplicationError('评论包含大量重复字符');
  }
}

export default {
  async beforeCreate(event: any) {
    const data = event.params?.data ?? {};
    data.approved = false; // 先审后发

    const content = (data.content ?? '').toString();
    const name = (data.authorName ?? '').toString();

    assertClean(content, '评论');
    assertClean(name, '昵称');
    assertQuality(content);

    // 敏感词（内容 + 昵称）
    const hits: string[] = await strapi
      .service('api::sensitive-word.sensitive-word')
      .scan(`${content} ${name}`);
    if (hits.length > 0) {
      throw new errors.ApplicationError(`评论含敏感词，已拦截：${hits.join('、')}`);
    }
  },
};
