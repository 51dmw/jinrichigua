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
import { useFetchClient, useNotification, useField } from '@strapi/strapi/admin';
import { Button, Field, SingleSelect, SingleSelectOption } from '@strapi/design-system';

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
 * 「自动匹配标签」按钮——渲染在编辑页右侧操作面板（发布/保存 那一区）下方的独立面板里。
 * 点击 → 确认 → 调 admin 路由 /article-auto-tag/:documentId（走 admin 会话鉴权）→
 * 成功提示并刷新文档（让 tags 字段显示新挂标签）。作用于「已保存的正文」。
 */
const AutoTagButton = ({ documentId }: { documentId: string }) => {
  const { post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [loading, setLoading] = React.useState(false);

  const onClick = async () => {
    // 确认弹窗里说明一句：作用于已保存的正文。
    if (
      !window.confirm(
        '将扫描【本文已保存的正文】，从标签库匹配出现的标签并挂到文章（只增不覆盖，最多 12 个）。\n请先保存草稿再继续。',
      )
    ) {
      return;
    }
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  };

  return React.createElement(
    Button,
    {
      onClick,
      loading,
      disabled: loading,
      variant: 'secondary',
      fullWidth: true,
      startIcon: React.createElement(TagIcon),
    },
    '自动匹配标签',
  );
};

/**
 * 注册为编辑视图右侧自定义面板（addEditViewSidePanel）。
 * 仅在文章（api::article.article）且文档已保存（有 documentId）时显示。
 * 返回 { title, content }；返回 null 则该面板不渲染。
 */
const AutoTagPanel = ({ model, documentId }: { model?: string; documentId?: string }) => {
  if (model !== ARTICLE_UID || !documentId) return null;
  return {
    title: '标签',
    content: React.createElement(AutoTagButton, { documentId }),
  };
};

// 后台 5 个 enumeration 字段的「英文值 → 中文显示 label」总表。底层 value 全部保持英文，
// 这些值被代码引用（reviewState→发布守卫/RBAC，variant→前端，format→adFormats，
// twitterCard/structuredDataType→SEO），绝不改动；这里只做显示映射。
// 注：19 个 value 全局唯一，故按 value 直接查表即可同时覆盖顶层字段与 component 嵌套字段
//（variant/twitterCard/structuredDataType 在 component 里，name 带路径，按 value 查更稳）。
const ENUM_LABELS: Record<string, string> = {
  // 文章 reviewState（api::article.article）
  draft: '草稿',
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  // 首页区块 variant（component layout.home-block）
  hero: '大图',
  'image-top': '上图下标题',
  'left-text-right-image': '左文右图',
  'three-image': '三图并列',
  'text-only': '纯文字',
  // 广告位 format（api::ad-slot.ad-slot）
  leaderboard: '横幅 728×90',
  'in-feed': '信息流 1200×628',
  rectangle: '矩形 300×250',
  'half-page': '半屏 300×600',
  anchor: '移动悬浮 320×50',
  // SEO twitterCard（component seo.meta-data）
  summary: '摘要卡',
  summary_large_image: '大图摘要卡',
  // SEO structuredDataType（component seo.meta-data）
  NewsArticle: '新闻文章',
  Article: '普通文章',
  none: '不输出',
};

/**
 * 自定义 enumeration 输入控件，按 type 注册（app.addFields）。
 * Strapi 5.7 的自定义 input 只能按字段 type 注册、没有按字段名的入口，所以这里会接管后台
 * 所有 enum 字段：
 *   - 值在 ENUM_LABELS 里（上述 5 个字段的 19 个值）→ 显示中文 label；
 *     onChange 写回 / 回显的仍是英文 value，存储值不变。
 *   - 不在表中的 enum 值 → label = value（保持英文），行为与内置一致。
 * 复刻内置 EnumerationInput 的结构（useField + Field.Root + SingleSelect），避免破坏表单。
 */
const EnumerationInput = React.forwardRef<HTMLButtonElement, any>((props, ref) => {
  const { name, attribute, required, label, hint, labelAction, disabled } = props;
  const field = useField(name);
  const values: string[] = Array.isArray(attribute?.enum) ? attribute.enum : [];
  const toLabel = (v: string) => ENUM_LABELS[v] ?? v;

  return React.createElement(
    Field.Root,
    { error: field.error, name, hint, required },
    React.createElement(Field.Label, { action: labelAction }, label),
    React.createElement(
      SingleSelect,
      {
        ref,
        onChange: (value: string) => field.onChange(name, value),
        value: field.value ?? '',
        disabled,
      },
      // 非必填时保留一个空占位项（必填则隐藏），与内置行为一致。
      React.createElement(
        SingleSelectOption,
        { key: '__empty', value: '', disabled: required, hidden: required },
        '请选择',
      ),
      ...values.map((v) => React.createElement(SingleSelectOption, { key: v, value: v }, toLabel(v))),
    ),
    React.createElement(Field.Hint),
    React.createElement(Field.Error),
  );
});
EnumerationInput.displayName = 'EnumerationInput';

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

  // B：补 Strapi content-manager 自带英文词的中文覆盖（键取自 @strapi/content-manager en 字典）。
  'content-manager.relation.add': '添加关联',
  'content-manager.components.empty-repeatable': '暂无内容，点击添加',
  'content-manager.link-to-ctb': '编辑模型',
  // 文本字段「max. {…} characters」字数提示由两条拼成：text 模板（min./max.）+ 单位（character/characters）。
  // 保持 ICU 占位结构不变，只把英文词换成中文。
  'content-manager.form.Input.hint.text':
    '{min, select, undefined {} other {最小 {min}}}{divider}{max, select, undefined {} other {最多 {max}}}{unit}{br}{description}',
  'content-manager.form.Input.hint.character.unit': '{maxValue, plural, one { 字符} other { 字符}}',

  // 发布状态：列表 STATUS 列头（基于 publishedAt 字段）+ 状态徽章（DocumentStatus，列表与编辑页共用）。
  'content-manager.containers.list.table-headers.publishedAt': '状态',
  'content-manager.containers.List.published': '已发布',
  'content-manager.containers.List.draft': '草稿',
  'content-manager.containers.List.modified': '已修改',
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

    // 注册自定义 enumeration 输入控件：文章「审核状态」下拉显示中文，存储值仍为英文枚举。
    // 注意：addFields 按 type 注册，会接管后台所有 enum 字段（详见 EnumerationInput 注释）。
    app.addFields({ type: 'enumeration', Component: EnumerationInput });

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
    // 文章编辑页右侧加「自动匹配标签」面板按钮（content-manager 编辑视图侧栏面板）。
    // 用 side panel 而非 document action：后者在面板区只有「主/次」两个可见位（被 发布/保存 占），
    // 多出来的会被收进「⋯ 更多操作」；side panel 则是独立可见按钮，不挤占发布/保存。
    app.getPlugin('content-manager').apis.addEditViewSidePanel((panels: any[]) => [
      ...panels,
      AutoTagPanel,
    ]);
  },
};
