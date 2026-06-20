// 批量创建标签自定义路由（content-api）。需 RBAC 权限 / API Token，非公开写。
export default {
  routes: [
    {
      method: 'POST',
      path: '/tags/bulk-create',
      handler: 'tag.bulkCreate',
      config: { policies: [] },
    },
  ],
};
