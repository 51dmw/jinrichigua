// Prompt matching (no LLM call). Mirrors the enable guard in
// apps/cms/src/api/collect-source/content-types/collect-source/lifecycles.ts, but at runtime the
// conditions must actually hold for this item:
//   - identify: must list this source
//   - write / review: every condition the prompt sets must hold (source if listed, category if listed),
//     and it must set at least one of them
//   - matchMode is "any" or equals the source's mode; provider must exist in collect-config
// Most specific wins (source > category > mode), then priority. No match → null, never a fallback.

const hasId = (list, documentId) => Array.isArray(list) && list.some((x) => x?.documentId === documentId);

export function matchPrompt(prompts, stage, { source, category, providerNames }) {
  const scored = [];
  for (const p of prompts) {
    if (p.stage !== stage || p.enabled === false) continue;
    if (p.matchMode !== 'any' && p.matchMode !== source.mode) continue;
    if (providerNames && !providerNames.has(p.provider)) continue;
    const sources = p.matchSources || [];
    const categories = p.matchCategories || [];
    const sourceHit = hasId(sources, source.documentId);
    if (stage === 'identify') {
      if (!sourceHit) continue;
    } else {
      if (!sources.length && !categories.length) continue;
      if (sources.length && !sourceHit) continue;
      if (categories.length && !(category && hasId(categories, category.documentId))) continue;
    }
    const score = (sourceHit ? 4 : 0) + (categories.length ? 2 : 0) + (p.matchMode !== 'any' ? 1 : 0);
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.p.priority || 0) - (a.p.priority || 0));
  return scored[0]?.p || null;
}

export function promptRef(p) {
  return p ? { documentId: p.documentId, name: p.name, version: p.version, provider: p.provider, model: p.model } : null;
}
