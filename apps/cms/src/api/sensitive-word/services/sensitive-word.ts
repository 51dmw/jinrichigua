import { factories } from '@strapi/strapi';

// 内置兜底词表（库为空时也能拦截）。后台可在 SensitiveWord 中增删覆盖。
const BUILTIN_WORDS = ['敏感词测试', 'badword', '违禁示例'];

export default factories.createCoreService('api::sensitive-word.sensitive-word', ({ strapi }) => ({
  /** 取当前生效的敏感词集合（DB 启用词 + 内置兜底）。 */
  async list(): Promise<string[]> {
    let dbWords: string[] = [];
    try {
      const rows = await strapi.documents('api::sensitive-word.sensitive-word').findMany({
        filters: { enabled: true },
        fields: ['word'],
        pagination: { pageSize: 1000 },
      });
      dbWords = (rows ?? [])
        .map((r: { word?: string }) => r.word)
        .filter((w: string | undefined): w is string => Boolean(w));
    } catch {
      dbWords = [];
    }
    return Array.from(new Set([...BUILTIN_WORDS, ...dbWords]));
  },

  /** 扫描文本，返回命中的敏感词（去重）。 */
  async scan(text: string): Promise<string[]> {
    if (!text) return [];
    const words = await this.list();
    const lower = text.toLowerCase();
    const hits = words.filter((w) => w && lower.includes(w.toLowerCase()));
    return Array.from(new Set(hits));
  },
}));
