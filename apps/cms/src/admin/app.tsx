/**
 * Strapi Admin 定制入口。
 * 1) 启用简体中文为界面语言；
 * 2) 翻译覆盖：补齐 Strapi 5.7 官方简体中文包**漏翻**的 content-manager 界面词
 *    （键取自 @strapi/content-manager 的 en 字典，前缀 `content-manager.`）。
 *    仅覆盖显示文案，不影响字段名/接口/数据。
 * 3) 文章编辑页加「自动匹配标签」Document Action 按钮；
 * 4) 左侧菜单加「批量添加标签」自定义页面。
 */
import * as React from 'react';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';

const ARTICLE_UID = 'api::article.article';

// 内联标签图标（不引 @strapi/icons —— 非本包直接依赖，Rollup 解析不到）。
const TagIcon = () =>
  React.createElement(
    'svg',
    { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
    React.createElement('path', {
      d: 'M20.59 13.41 11 3.83V8a3 3 0 0 1-3 3H3.83l9.58 9.59a2 2 0 0 0 2.83 0l4.35-4.35a2 2 0 0 0 0-2.83Z',
      strokeLinejoin: 'round',
    }),
  );

// 内联「+」图标。
const PlusIcon = () =>
  React.createElement(
    'svg',
    { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
    React.createElement('path', { d: 'M12 5v14M5 12h14', strokeLinecap: 'round' }),
  );

/**
 * 「自动匹配标签」Document Action（仅文章 edit 视图显示）。
 * 点击 → 确认 → 调 admin 路由 /article-auto-tag/:documentId（走 admin 会话鉴权）→
 * 成功提示并刷新文档（让 tags 字段显示新挂标签）。作用于「已保存的正文」。
 */
const AutoTagAction = ({ model, documentId }: { model?: string; documentId?: string }) => {
  const { post } = useFetchClient();
  const { toggleNotification } = useNotification();

  if (model !== ARTICLE_UID || !documentId) return null;

  return {
    label: '自动匹配标签',
    icon: React.createElement(TagIcon),
    // 放编辑页顶部标题栏（与 保存/发布 同区），比 panel 的「⋯ 更多操作」下拉更显眼。
    position: ['header'] as const,
    onClick: async () => {
      // 确认弹窗里说明一句：作用于已保存的正文。
      if (
        !window.confirm(
          '将扫描【本文已保存的正文】，从标签库匹配出现的标签并挂到文章（只增不覆盖，最多 12 个）。\n请先保存草稿再继续。',
        )
      ) {
        return;
      }
      try {
        const { data } = await post(`/article-auto-tag/${documentId}`);
        const n = Array.isArray(data?.applied) ? data.applied.length : 0;
        toggleNotification({
          type: 'success',
          message: n > 0 ? `已匹配 ${n} 个新标签，刷新后显示` : '未匹配到新标签',
        });
        if (n > 0) window.location.reload();
      } catch (e) {
        toggleNotification({ type: 'danger', message: '自动匹配标签失败' });
      }
    },
  };
};

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
    // 禁止浏览器自动翻译后台：界面改为简体中文后，Chrome/Edge 会把页面再翻译一遍，
    // 用 <font> 包裹并替换文本节点 —— 这绕过了 React 的 DOM 记账。当 React 之后卸载
    // 这些子树时，调 removeChild 的节点已被浏览器移走，抛
    // 「NotFoundError: removeChild … not a child」并白屏。下面三行声明本页不可翻译。
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('translate', 'no');
      document.documentElement.classList.add('notranslate');
      if (!document.querySelector('meta[name="google"][content="notranslate"]')) {
        const meta = document.createElement('meta');
        meta.name = 'google';
        meta.content = 'notranslate';
        document.head.appendChild(meta);
      }
    }

    // 左侧菜单加「批量添加标签」入口 → 自定义页面（调 admin 路由 /tags-bulk-create）。
    app.addMenuLink({
      to: '/bulk-tags',
      icon: PlusIcon,
      intlLabel: { id: 'bulk-tags.menu', defaultMessage: '批量添加标签' },
      Component: () => import('./pages/BulkTags'),
      position: 6,
    });
  },
  bootstrap(app: any) {
    // 文章编辑页注入「自动匹配标签」按钮（content-manager Document Action）。
    app.getPlugin('content-manager').apis.addDocumentAction((actions: any[]) => [
      ...actions,
      AutoTagAction,
    ]);
  },
};
