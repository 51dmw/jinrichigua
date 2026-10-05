/**
 * 采集源 lifecycle —— 启用前检查（不设兜底）。
 *
 * 规则（2026-10-05 与用户确认）：只有明确匹配到提示词与模型的源才允许采集。
 * 启用时必须满足：
 *   - identify：至少一份启用中的识别提示词，matchSources 里明确包含本源（识别前还不知道类型，只能按源绑定）
 *   - write / review：至少一份启用中的提示词，要么 matchSources 包含本源，要么绑定了内容类型
 *   - 以上提示词的 matchMode 为 any 或等于本源的 mode
 *   - 提示词写的 provider 必须在「采集配置」的 providers 里存在
 * 新建时不能直接启用：提示词要绑定已存在的源，先建源、配好提示词，再回来启用。
 */
import { errors } from '@strapi/utils';

const PROMPT_UID = 'api::collect-prompt.collect-prompt';
const CONFIG_UID = 'api::collect-config.collect-config';
const STAGES = ['identify', 'write', 'review'] as const;
const STAGE_LABEL: Record<string, string> = { identify: '识别', write: '成文', review: '审核' };

async function missingStages(sourceId: number, mode: string): Promise<string[]> {
  const prompts = await strapi.db.query(PROMPT_UID).findMany({
    where: { stage: { $in: STAGES as unknown as string[] }, enabled: true },
    select: ['id', 'stage', 'matchMode', 'provider'],
    populate: { matchSources: { select: ['id'] }, matchCategories: { select: ['id'] } },
  });
  const config = await strapi.db.query(CONFIG_UID).findOne({ select: ['providers'] });
  const providerNames = new Set(
    (Array.isArray(config?.providers) ? config.providers : [])
      .map((p: { name?: string }) => p?.name)
      .filter(Boolean),
  );

  const problems: string[] = [];
  for (const stage of STAGES) {
    const candidates = prompts.filter((p: any) => {
      if (p.stage !== stage) return false;
      if (p.matchMode !== 'any' && p.matchMode !== mode) return false;
      const boundToSource = (p.matchSources ?? []).some((s: { id: number }) => s.id === sourceId);
      const boundToCategory = (p.matchCategories ?? []).length > 0;
      return stage === 'identify' ? boundToSource : boundToSource || boundToCategory;
    });
    if (!candidates.length) {
      problems.push(`缺少「${STAGE_LABEL[stage]}」提示词`);
      continue;
    }
    if (!candidates.some((p: any) => providerNames.has(p.provider))) {
      problems.push(`「${STAGE_LABEL[stage]}」提示词的服务商不在「采集配置」里`);
    }
  }
  return problems;
}

export default {
  async beforeCreate(event: any) {
    if (event.params?.data?.enabled === true) {
      throw new errors.ApplicationError('新建的采集源不能直接启用：请先保存，再为它配置识别、成文、审核提示词，然后回来启用');
    }
  },

  async beforeUpdate(event: any) {
    const data = event.params?.data ?? {};
    if (data.enabled !== true) return;
    const id = event.params?.where?.id;
    if (!id) return;
    const current = await strapi.db.query('api::collect-source.collect-source').findOne({
      where: { id },
      select: ['id', 'mode'],
    });
    if (!current) return;
    const problems = await missingStages(current.id, data.mode ?? current.mode);
    if (problems.length) {
      throw new errors.ApplicationError(`不能启用：${problems.join('；')}`, { problems });
    }
  },
};
