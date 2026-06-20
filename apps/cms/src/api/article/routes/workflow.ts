// 审核流自定义路由（§6）。与核心 router 合并加载。
export default {
  routes: [
    {
      method: 'POST',
      path: '/articles/:id/submit',
      handler: 'article.submit',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/articles/:id/approve',
      handler: 'article.approve',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/articles/:id/reject',
      handler: 'article.reject',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/articles/:id/view',
      handler: 'article.view',
      config: { policies: [] },
    },
    {
      // 自动匹配标签（需 RBAC 权限 / API Token，非公开写）。
      method: 'POST',
      path: '/articles/:documentId/auto-tag',
      handler: 'article.autoTag',
      config: { policies: [] },
    },
    {
      method: 'GET',
      path: '/articles-stats',
      handler: 'article.stats',
      config: { policies: [] },
    },
  ],
};
