// OpenNext × Cloudflare 适配（§7：MUST 用 @opennextjs/cloudflare，禁用 next-on-pages）。
// ISR 增量缓存 MUST 绑定 Workers KV（§7）→ 用 kv-incremental-cache。
import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import kvIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache';

export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  // 可选：把按需 revalidate（revalidateTag/Path）做成跨实例一致，
  // 需要再启用 queue / tag cache override（见 OpenNext 文档）。
});
