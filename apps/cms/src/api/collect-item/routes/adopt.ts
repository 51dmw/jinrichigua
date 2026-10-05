// 采集草稿的自定义动作，与核心 router 合并加载。权限通过 API Token / RBAC 控制，非公开。
export default {
  routes: [
    {
      method: 'POST',
      path: '/collect-items/:documentId/adopt',
      handler: 'collect-item.adopt',
      config: { policies: [] },
    },
  ],
};
