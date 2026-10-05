/**
 * 采集提示词 lifecycle —— 修改即存档。
 * 正文、服务商或模型有变动时，把改动前的版本推进 history（最多保留 20 份），version +1。
 * 采集草稿上记录的 promptUsed 带 version，因此统计和回查都能对上当时用的是哪一版。
 */
const UID = 'api::collect-prompt.collect-prompt';
const KEEP = 20;
const TRACKED = ['content', 'provider', 'model', 'fallbackModels', 'outputSchema'] as const;

export default {
  async beforeUpdate(event: any) {
    const data = event.params?.data;
    const id = event.params?.where?.id;
    if (!data || !id) return;
    const current = await strapi.db.query(UID).findOne({
      where: { id },
      select: ['id', 'version', 'history', ...TRACKED],
    });
    if (!current) return;
    const changed = TRACKED.some(
      (k) => k in data && JSON.stringify(data[k] ?? null) !== JSON.stringify(current[k] ?? null),
    );
    if (!changed) return;
    const snapshot = {
      version: current.version ?? 1,
      savedAt: new Date().toISOString(),
      ...Object.fromEntries(TRACKED.map((k) => [k, current[k] ?? null])),
    };
    const history = Array.isArray(current.history) ? current.history : [];
    data.history = [...history, snapshot].slice(-KEEP);
    data.version = (current.version ?? 1) + 1;
  },
};
