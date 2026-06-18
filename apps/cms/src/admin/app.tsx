/**
 * Strapi Admin 定制入口。
 * 启用简体中文为可选界面语言（默认仅英文，需在此声明并重建 admin）。
 */
export default {
  config: {
    // 在「接口语言」下拉里加入简体中文；英文为内置基准，无需列出
    locales: ['zh-Hans'],
  },
  bootstrap() {},
};
