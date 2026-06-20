/**
 * Strapi Admin 定制入口。
 * 1) 启用简体中文为界面语言；
 * 2) 翻译覆盖：补齐 Strapi 5.7 官方简体中文包**漏翻**的 content-manager 界面词
 *    （键取自 @strapi/content-manager 的 en 字典，前缀 `content-manager.`）。
 *    仅覆盖显示文案，不影响字段名/接口/数据。
 * 3) 左侧菜单加「批量添加标签」自定义页面。
 */
import * as React from 'react';

// 内联「+」图标（不引 @strapi/icons —— 它非本包直接依赖，Rollup 解析不到）。
const PlusIcon = () =>
  React.createElement(
    'svg',
    { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
    React.createElement('path', { d: 'M12 5v14M5 12h14', strokeLinecap: 'round' }),
  );

const zhOverrides: Record<string, string> = {
  // 左侧导航 / 插件名
  'content-manager.plugin.name': '内容管理',
  'content-manager.header.name': '内容管理',
  'content-manager.components.LeftMenu.collection-types': '集合类型',
  'content-manager.components.LeftMenu.single-types': '单一类型',

  // 列表页
  'content-manager.HeaderLayout.button.label-add-entry': '新建条目',
  'content-manager.pages.ListView.header-subtitle': '{number, plural, =0 {无内容} other {共 # 条}}',
  'content-manager.containers.list.items': '{number} 项',
  'content-manager.containers.list.table-headers.actions': '操作',

  // 行操作菜单
  'content-manager.actions.edit.label': '编辑',
  'content-manager.actions.clone.label': '复制',
  'content-manager.actions.delete.label': '删除条目{isLocalized, select, true { (所有语言)} other {}}',
  'content-manager.containers.Edit.delete': '删除',

  // 编辑页：状态标签 / 右侧信息面板
  'content-manager.containers.edit.tabs.label': '文档状态',
  'content-manager.containers.edit.tabs.draft': '草稿',
  'content-manager.containers.edit.tabs.published': '已发布',
  'content-manager.containers.edit.title.new': '新建条目',
  'content-manager.containers.edit.header.more-actions': '更多操作',
  'content-manager.containers.edit.panels.default.title': '条目',
  'content-manager.containers.edit.panels.default.more-actions': '更多文档操作',
  'content-manager.containers.edit.information.document.label': '创建于',
  'content-manager.containers.edit.information.last-draft.label': '更新于',
  'content-manager.containers.edit.information.last-published.label': '发布于',
};

export default {
  config: {
    // 在「界面语言」下拉里加入简体中文；英文为内置基准，无需列出
    locales: ['zh-Hans'],
    // 覆盖/补全简体中文翻译
    translations: {
      'zh-Hans': zhOverrides,
    },
  },
  register(app: any) {
    // 左侧菜单加「批量添加标签」入口 → 自定义页面（调 admin 路由 /tags-bulk-create）。
    app.addMenuLink({
      to: '/bulk-tags',
      icon: PlusIcon,
      intlLabel: { id: 'bulk-tags.menu', defaultMessage: '批量添加标签' },
      Component: () => import('./pages/BulkTags'),
      position: 6,
    });
  },
  bootstrap() {},
};
