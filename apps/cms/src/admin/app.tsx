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

  // ── 系统排查补漏：content-manager 官方简体包未翻译、但会出现在后台界面的词条 ──
  // 操作 / 对话框
  'content-manager.actions.clone.error': '复制文档时出错。',
  'content-manager.actions.delete.dialog.body': '确定要删除此文档吗？此操作不可撤销。',
  'content-manager.actions.delete.error': '删除文档时出错。',
  'content-manager.actions.discard.label': '放弃修改',
  'content-manager.actions.discard.dialog.body': '确定要放弃这些修改吗？此操作不可撤销。',
  'content-manager.actions.edit.error': '编辑文档时出错。',
  'content-manager.actions.unpublish.error': '取消发布文档时出错。',
  'content-manager.actions.unpublish.dialog.body': '确定要取消发布吗？',
  'content-manager.actions.unpublish.dialog.option.keep-draft': '取消发布并保留最新草稿',
  'content-manager.actions.unpublish.dialog.option.replace-draft': '取消发布并替换最新草稿',
  // 列表 / 关系
  'content-manager.ListViewTable.relation-loaded': '关联数据已加载',
  'content-manager.ListViewTable.relation-loading': '关联数据加载中',
  'content-manager.ListViewTable.relation-more': '此关联包含的条目多于所显示的数量',
  'content-manager.components.ListViewTable.row-line': '第 {number} 行',
  'content-manager.components.Filters.usersSelect.label': '搜索并选择用于筛选的用户',
  'content-manager.containers.list.table.row-actions': '行操作',
  'content-manager.popover.display-relations.label': '显示关联',
  'content-manager.relation.error-adding-relation': '添加关联时出错。',
  'content-manager.components.DynamicZone.extra-components':
    '存在 {number, plural, =0 {# 个多余组件} one {# 个多余组件} other {# 个多余组件}}',
  // 信息面板时间值（{time} … by {author}）
  'content-manager.containers.edit.information.last-published.value':
    '{time}{isAnonymous, select, true {} other { 由 {author}}}',
  'content-manager.containers.edit.information.last-draft.value':
    '{time}{isAnonymous, select, true {} other { 由 {author}}}',
  'content-manager.containers.edit.information.document.value':
    '{time}{isAnonymous, select, true {} other { 由 {author}}}',
  // 批量发布状态
  'content-manager.bulk-publish.already-published': '已发布',
  'content-manager.bulk-unpublish.already-unpublished': '已取消发布',
  'content-manager.bulk-publish.modified': '有改动待发布',
  'content-manager.bulk-publish.edit': '编辑',
  'content-manager.containers.list.selectedEntriesModal.title': '发布条目',
  'content-manager.containers.list.selectedEntriesModal.selectedCount.publish':
    '<b>{publishedCount}</b> {publishedCount, plural, other {个条目}}已发布。<b>{draftCount}</b> {draftCount, plural, other {个条目}}可发布。<b>{withErrorsCount}</b> {withErrorsCount, plural, other {个条目}}待处理。',
  'content-manager.containers.list.selectedEntriesModal.selectedCount.unpublish':
    '<b>{draftCount}</b> {draftCount, plural, other {个条目}}已取消发布。<b>{publishedCount}</b> {publishedCount, plural, other {个条目}}可取消发布。',
  // 复制（autoClone）弹窗
  'content-manager.containers.list.autoCloneModal.header': '复制',
  'content-manager.containers.list.autoCloneModal.title': '此条目无法直接复制。',
  'content-manager.containers.list.autoCloneModal.description':
    '将创建一个内容相同的新条目，但你需要修改以下字段才能保存。',
  'content-manager.containers.list.autoCloneModal.create': '创建',
  'content-manager.containers.list.autoCloneModal.error.unique': '唯一字段中不允许出现相同的值。',
  'content-manager.containers.list.autoCloneModal.error.relation': '复制该关联可能会将其从原条目中移除。',
  // 视图配置（Configure the view）弹窗
  'content-manager.containers.list-settings.modal-form.label': '编辑 {fieldName}',
  'content-manager.containers.list-settings.modal-form.error': '打开表单时出错。',
  'content-manager.containers.edit-settings.modal-form.error': '打开表单时出错。',
  'content-manager.containers.edit-settings.modal-form.label': '标签',
  'content-manager.containers.edit-settings.modal-form.description': '描述',
  'content-manager.containers.edit-settings.modal-form.placeholder': '占位提示',
  'content-manager.containers.edit-settings.modal-form.mainField': '条目标题',
  'content-manager.containers.edit-settings.modal-form.mainField.hint': '设置在编辑页与列表页显示的字段',
  'content-manager.containers.edit-settings.modal-form.editable': '可编辑字段',
  'content-manager.containers.edit-settings.modal-form.size': '尺寸',
  // 草稿关联告警
  'content-manager.error.records.fetch-draft-relatons': '获取该文档的草稿关联时出错。',
  'content-manager.popUpWarning.warning.has-draft-relations.message':
    '此条目关联了 {count, plural, one {# 个草稿条目} other {# 个草稿条目}}。发布它可能会在你的应用中留下失效链接。',
  'content-manager.popUpwarning.warning.bulk-has-draft-relations.message':
    '<b>{entities} 个条目中有 {count, plural, one {# 个关联} other {# 个关联}}</b>尚未发布，可能导致非预期行为。',
  // 预览
  'content-manager.preview.panel.title': '预览',
  'content-manager.preview.panel.button': '打开预览',
  'content-manager.preview.panel.button-disabled-tooltip': '请先保存再打开预览',
  'content-manager.preview.page-title': '{contentType} 预览',
  'content-manager.preview.header.close': '关闭预览',
  'content-manager.preview.copy.label': '复制预览链接',
  'content-manager.preview.copy.success': '已复制预览链接',
  'content-manager.preview.tabs.label': '预览状态',
  // 操作成功提示
  'content-manager.success.record.clone': '已复制文档',
  'content-manager.success.record.discard': '已放弃修改',
  'content-manager.success.record.publishing': '发布中……',
  'content-manager.success.records.delete': '删除成功。',
  'content-manager.success.records.unpublish': '取消发布成功。',
  'content-manager.success.records.publish': '发布成功。',
  'content-manager.validation.error': '文档中存在校验错误，请先修正再保存。',
  // 内容历史（Content History）
  'content-manager.history.document-action': '内容历史',
  'content-manager.history.page-title': '{contentType} 历史',
  'content-manager.history.sidebar.title': '版本',
  'content-manager.history.sidebar.version-card.aria-label': '版本卡片',
  'content-manager.history.sidebar.versionDescription':
    '{distanceToNow}{isAnonymous, select, true {} other { 由 {author}}}{isCurrent, select, true { <b>(当前)</b>} other {}}',
  'content-manager.history.sidebar.show-newer': '显示更新的版本',
  'content-manager.history.sidebar.show-older': '显示更早的版本',
  'content-manager.history.version.subtitle':
    '{hasLocale, select, true {{subtitle}，语言 {locale}} other {{subtitle}}}',
  'content-manager.history.content.new-field.title': '新字段',
  'content-manager.history.content.new-field.message':
    '保存此版本时该字段尚不存在。如果还原此版本，它将为空。',
  'content-manager.history.content.unknown-fields.title': '未知字段',
  'content-manager.history.content.unknown-fields.message':
    '这些字段已在内容类型构建器中被删除或重命名。<b>这些字段不会被还原。</b>',
  'content-manager.history.content.missing-assets.title':
    '{number, plural, =1 {缺失的素材} other {# 个缺失的素材}}',
  'content-manager.history.content.missing-assets.message':
    '{number, plural, =1 {它} other {它们}}已在媒体库中被删除，无法还原。',
  'content-manager.history.content.missing-relations.title':
    '{number, plural, =1 {缺失的关联} other {# 个缺失的关联}}',
  'content-manager.history.content.missing-relations.message':
    '{number, plural, =1 {它} other {它们}}已被删除，无法还原。',
  'content-manager.history.content.no-relations': '无关联。',
  'content-manager.history.content.localized':
    '此值为该语言特有。如果还原此版本，其它语言的内容不会被替换。',
  'content-manager.history.content.not-localized':
    '此值为所有语言共用。如果还原此版本，所有语言的内容都会被替换。',
  'content-manager.history.restore.confirm.button': '还原',
  'content-manager.history.restore.confirm.title': '确定要还原此版本吗？',
  'content-manager.history.restore.confirm.message':
    '{isDraft, select, true {还原的内容将覆盖你的草稿。} other {还原的内容不会被发布，它会覆盖草稿并保存为待发布修改，你可以随时发布这些修改。}}',
  'content-manager.history.restore.success.title': '版本已还原。',
  'content-manager.history.restore.success.message': '已还原内容的历史版本。',
  'content-manager.history.restore.error.message': '无法还原版本。',
  // 首页 dashboard 小组件
  'content-manager.widget.last-edited.title': '最近编辑的条目',
  'content-manager.widget.last-edited.single-type': '单一类型',
  'content-manager.widget.last-edited.no-data': '暂无编辑的条目',
  'content-manager.widget.last-published.title': '最近发布的条目',
  'content-manager.widget.last-published.no-data': '暂无发布的条目',

  // ── 系统排查补漏：@strapi/admin 核心包未翻译、会出现在后台界面的词条（key 不带插件前缀）──
  // 首页
  'HomePage.header.title': '你好，{name}',
  'HomePage.header.subtitle': '欢迎使用管理后台',
  'HomePage.widget.loading': '正在加载组件内容',
  'HomePage.widget.error': '无法加载组件内容。',
  'HomePage.widget.no-data': '未找到内容。',
  // 全局
  'global.home': '首页',
  'global.error': '出错了',
  'global.new': '新建',
  'global.learn-more': '了解更多',
  // 通用操作 / 状态
  'app.utils.refresh': '刷新',
  'app.utils.published': '已发布',
  'app.utils.ready-to-publish': '可发布',
  'app.utils.ready-to-publish-changes': '有改动待发布',
  'app.utils.ready-to-unpublish-changes': '可取消发布',
  'app.confirm.body': '确定吗？',
  'components.ViewSettings.tooltip': '视图设置',
  // 设置页
  'Settings.profile.form.section.experience.mode.option-system-label': '跟随系统设置',
  'Settings.content-history.title': '内容历史',
  'Settings.content-history.description': '更好地掌控内容生命周期的每一步。',
  'Settings.content-history.not-available': '内容历史仅在付费版中提供。升级后可全面掌控内容生命周期。',
  'Settings.permissions.auditLogs.not-available':
    '审计日志仅在付费版中提供。升级后可对所有操作进行可搜索、可筛选的展示。',
  'Settings.sso.not-available':
    '单点登录（SSO）仅在付费版中提供。升级后可为管理后台配置更多登录与注册方式。',
  // NPS 调研弹窗
  'app.components.NpsSurvey.banner-title': '你有多大可能向朋友或同事推荐 Strapi？',
  'app.components.NpsSurvey.feedback-response': '非常感谢你的反馈！',
  'app.components.NpsSurvey.feedback-question': '你有什么改进建议吗？',
  'app.components.NpsSurvey.submit-feedback': '提交反馈',
  'app.components.NpsSurvey.dismiss-survey-label': '关闭调查',
  'app.components.NpsSurvey.no-recommendation': '完全不会',
  'app.components.NpsSurvey.happy-to-recommend': '非常愿意',
  // 筛选器操作符（筛选下拉，界面可见）
  'components.FilterOptions.FILTER_TYPES.$containsi': '包含（不区分大小写）',
  'components.FilterOptions.FILTER_TYPES.$endsWithi': '以…结尾（不区分大小写）',
  'components.FilterOptions.FILTER_TYPES.$eqi': '等于（不区分大小写）',
  'components.FilterOptions.FILTER_TYPES.$nei': '不等于（不区分大小写）',
  'components.FilterOptions.FILTER_TYPES.$notContainsi': '不包含（不区分大小写）',
  'components.FilterOptions.FILTER_TYPES.$startsWithi': '以…开头（不区分大小写）',
  // 表单校验错误（{field} 占位保留）
  'components.Input.error.validation.string': '不是有效的字符串。',
  'components.Input.error.validation.email.withField': '{field} 不是有效的邮箱',
  'components.Input.error.validation.json.withField': '{field} 不符合 JSON 格式',
  'components.Input.error.validation.lowercase.withField': '{field} 必须是小写字符串',
  'components.Input.error.validation.max.withField': '{field} 数值过大。',
  'components.Input.error.validation.maxLength.withField': '{field} 过长。',
  'components.Input.error.validation.min.withField': '{field} 数值过小。',
  'components.Input.error.validation.minLength.withField': '{field} 过短。',
  'components.Input.error.validation.minSupMax.withField': '{field} 不能更大',
  'components.Input.error.validation.regex.withField': '{field} 不符合正则规则。',
  'components.Input.error.validation.required.withField': '{field} 为必填项。',
  'components.Input.error.validation.unique.withField': '{field} 已被使用。',
  // 富文本编辑器（Blocks）工具栏 / 菜单
  'components.Blocks.modifiers.bold': '加粗',
  'components.Blocks.modifiers.italic': '斜体',
  'components.Blocks.modifiers.underline': '下划线',
  'components.Blocks.modifiers.strikethrough': '删除线',
  'components.Blocks.modifiers.code': '行内代码',
  'components.Blocks.link': '链接',
  'components.Blocks.expand': '展开',
  'components.Blocks.collapse': '收起',
  'components.Blocks.popover.text': '文本',
  'components.Blocks.popover.text.placeholder': '输入链接文字',
  'components.Blocks.popover.link': '链接',
  'components.Blocks.popover.link.placeholder': '粘贴链接',
  'components.Blocks.popover.link.error': '请输入有效链接',
  'components.Blocks.popover.remove': '移除',
  'components.Blocks.popover.edit': '编辑',
  'components.Blocks.blocks.selectBlock': '选择一个块',
  'components.Blocks.blocks.text': '正文',
  'components.Blocks.blocks.heading1': '标题 1',
  'components.Blocks.blocks.heading2': '标题 2',
  'components.Blocks.blocks.heading3': '标题 3',
  'components.Blocks.blocks.heading4': '标题 4',
  'components.Blocks.blocks.heading5': '标题 5',
  'components.Blocks.blocks.heading6': '标题 6',
  'components.Blocks.blocks.code': '代码块',
  'components.Blocks.blocks.quote': '引用',
  'components.Blocks.blocks.image': '图片',
  'components.Blocks.blocks.unorderedList': '无序列表',
  'components.Blocks.blocks.orderedList': '有序列表',
  'components.Blocks.blocks.code.languageLabel': '选择语言',
  'components.Blocks.dnd.instruction':
    '要重新排序块，请按 Command 或 Control 加 Shift 以及上/下方向键',
  'components.Blocks.dnd.reorder': '{item} 已移动。在编辑器中的新位置：{position}。',

  // ── 浏览器实测补漏：代码实际用的 id 与 en 字典 key 不一致 / 走 defaultMessage，字典 diff 抓不到 ──
  // 列表 STATUS 列头：渲染代码用 .status（en 字典里只有 .publishedAt，故 defaultMessage="Status"）。
  'content-manager.containers.list.table-headers.status': '状态',
  // 左侧「内容类型」搜索框用的是 LeftMenu.Search.label。
  // （form.Input.search 是「视图设置」里那个「开启搜索」开关的标签，之前误标成了「搜索内容类型」。）
  'content-manager.form.Input.search': '开启搜索',
  'content-manager.components.LeftMenu.Search.label': '搜索内容类型',
  // 左侧菜单「Content-Type Builder」插件名（content-type-builder 插件，key 带该插件前缀）。
  'content-type-builder.plugin.name': '内容类型构建器',
  // 可重复组件「Add an entry」添加按钮(首页编排的首页区块等),en 字典有该 key 但官方 zh 漏译。
  'content-manager.containers.EditView.add.new-entry': '添加条目',

  // ── 第二轮浏览器扫描补漏:设置-用户「Active」状态 + 列表加载 aria 通知 ──
  'Settings.permissions.users.active': '已激活',
  'app.containers.Users.EditPage.form.active.label': '已激活',
  'Auth.form.active.label': '已激活',
  'content-manager.App.schemas.data-loaded': '内容类型已加载完成',

  // ── 第三轮：从运行中的后台导出 react-intl 实际合并后的 2640 条 messages，
  //    与打包产物里全部 814 组 {id, defaultMessage} 对照，把「查不到 id」和
  //    「查到了但值仍是英文」的两类全部补上。EE 专属页面（审核流/发布计划内部
  //    页、插件市场）不在本站可用范围，只补它们在导航里露出的名字。──

  // 列表页：批量勾选后的计数条（官方简体包把这个键写成了双前缀，等于没生效）
  'content-manager.components.TableDelete.label': '已选择 {number, plural, other {# 条}}',
  // 列表页：批量删除 / 批量取消发布的确认弹窗正文
  'popUpWarning.bodyMessage.contentType.delete.all': '确定要删除这些条目吗？',
  'popUpWarning.bodyMessage.contentType.unpublish.all': '确定要取消发布这些条目吗？',
  'content-manager.actions.unpublish.dialog.radio-label': '请选择取消发布的方式。',
  // 列表页「视图设置」页
  'containers.list.displayedFields': '展示的字段',
  'containers.SettingPage.editSettings.description': '拖动字段来调整布局',
  'list.table.header.sort': '按 {label} 排序',
  'list.table.content.empty-label': '此字段为空',
  'header.actions.no-permissions': '无权限查看',

  // 编辑页：URL 别名（uid 字段）右侧的可用性检测
  'content-manager.components.uid.available': '可用',
  'content-manager.components.uid.unavailable': '已被占用',
  'content-manager.components.uid.regenerate': '重新生成',

  // 通用控件 / 兜底文案
  'app.components.Select.placeholder': '请选择',
  'components.Select.placeholder': '请选择',
  'components.placeholder.select': '请选择',
  'global.localeToggle.label': '选择界面语言',
  'global.move': '移动',
  'app.utils.toggle': '切换',
  'app.error': '出错了',
  'app.error.copy': '复制到剪贴板',
  'app.error.message':
    '你的实例里似乎出现了一个缺陷。请通知技术同事排查来源，并通过 {link} 提交问题反馈。',
  'app.components.Onboarding.help.button-close': '关闭帮助菜单',
  'app.utils.show-bound-route': '查看 {route} 的绑定路由',
  'content-manager.pageNotFound': '页面不存在',
  'content-manager.pages.NoContentType.text': '你还没有任何内容，建议先创建第一个内容类型。',
  'noPreview': '无可预览内容',

  // 拖拽排序的读屏播报（视图设置页拖字段、动态区块排序都会用到）
  'dnd.grab-item':
    '{item} 已抓起。当前位置：第 {position} 位。按上下方向键调整位置，空格键放下，Esc 取消。',
  'dnd.drop-item': '{item} 已放下。最终位置：第 {position} 位。',
  'dnd.cancel-item': '{item} 已放下，重新排序已取消。',
  'dnd.reorder': '{item} 已移动。新位置：第 {position} 位。',

  // 预览 / 内容历史（这几个键代码里写的是不带插件前缀的 id）
  'preview.copy.label': '复制预览链接',
  'preview.tabs.label': '文档状态',
  'content-manager.restore.success.title': '版本已还原。',
  'content-manager.restore.success.message': '已还原该内容的历史版本。',
  'content-manager.history.sidebar.title.version-card.aria-label': '版本卡片',
  'history.content.localized':
    '此值为该语言特有。如果还原此版本，其它语言的内容不会被替换。',
  'history.content.not-localized':
    '此值为所有语言共用。如果还原此版本并保存，所有语言的内容都会被替换。',

  // 媒体库（选封面图时会弹出，属于日常路径）
  'list.assets.empty': '媒体库还是空的',
  'list.assets.empty-upload': '上传你的第一个素材……',
  'list.assets-empty.title-withSearch': '没有符合当前筛选条件的素材',
  'list.asset.at.finished': '素材加载完成。',
  'modal.remove.success-label': '已成功删除所选内容。',
  'modal.folder.move.submit': '移动',
  'window.confirm.close-modal.file': '确定要关闭吗？未保存的修改会丢失。',
  'window.confirm.close-modal.files': '确定要关闭吗？还有文件没有上传完成。',
  'view-switch.grid': '网格视图',
  'view-switch.list': '列表视图',

  // 设置页
  'Settings.application.header': '应用信息',
  'Settings.roles.form.input.url': 'URL 地址',
  'Settings.transferTokens.types.pull': '只读（拉取）',
  'Settings.transferTokens.types.push': '只写（推送）',
  'Settings.transferTokens.types.push-pull': '完全访问',
  'Settings.sso.subTitle': '配置单点登录（SSO）相关设置。',
  'Settings.permissions.auditLogs.filter.aria-label': '搜索并选择用于筛选的选项',
  'Settings.locales.modal.create.code.error': '请选择一个语言',
  'Settings.locales.modal.create.name.error.min': '语言显示名称不能超过 50 个字符。',
  'Settings.locales.modal.create.name.error.required': '请填写语言显示名称',
  'email.Settings.email.plugin.notification.test.error': '向 {to} 发送测试邮件失败',
  'email.Settings.email.plugin.notification.test.success': '测试邮件已发送，请查收 {to} 邮箱',
  'admin.pages.MarketPlacePage.production': '请在开发环境下管理插件',
  // EE 功能本站不可用，只汉化它们在左侧栏/设置栏里露出的名字
  'content-releases.plugin.name': '发布计划',
  'content-releases.pages.Settings.releases.title': '发布计划',
  'Settings.review-workflows.list.page.title': '审核流',

  // ── 第四轮：定位到系统性成因，一次补齐 ──
  // 官方 Strapi 5.7 的 content-manager / i18n 简体包，把自己 dict 里的键写成了
  // 「content-manager.xxx」；插件翻译在装载时还会再加一层插件名前缀，于是变成
  // 「content-manager.content-manager.xxx」，永远查不到 —— 这批键等于没翻译，
  // 界面直接掉回英文 defaultMessage。前几轮是逐条撞见逐条补，这里按 en 字典
  // 逐键比对运行时实际合并出的 messages，把剩下的 190 条一次补完。
  // （其中一部分是 Strapi 4 时代的遗留键，当前界面不一定走到，补上不影响。）

  // 视图设置页（列表页右上角齿轮）
  'content-manager.components.SettingsViewWrapper.pluginHeader.title': '配置视图 — {name}',
  'content-manager.components.SettingsViewWrapper.pluginHeader.description.list-settings':
    '设置列表页的展示方式。',
  'content-manager.components.SettingsViewWrapper.pluginHeader.description.edit-settings':
    '自定义编辑页的展示方式。',
  'content-manager.containers.SettingPage.settings': '设置',
  'content-manager.containers.SettingPage.view': '视图',
  'content-manager.containers.SettingPage.layout': '布局',
  'content-manager.containers.SettingPage.editSettings.description': '拖动字段来调整布局',
  'content-manager.containers.SettingPage.editSettings.title': '编辑页（设置）',
  'content-manager.containers.SettingPage.editSettings.entry.title': '条目标题',
  'content-manager.containers.SettingPage.editSettings.entry.title.description':
    '设置条目用哪个字段来显示',
  'content-manager.containers.SettingPage.editSettings.relation-field.description':
    '设置该关联在编辑页和列表页显示哪个字段',
  'content-manager.containers.SettingPage.listSettings.title': '列表页（设置）',
  'content-manager.containers.SettingPage.listSettings.description': '配置该集合类型的选项',
  'content-manager.containers.SettingPage.pluginHeaderDescription': '配置该集合类型的专属设置',
  'content-manager.containers.SettingPage.attributes': '字段',
  'content-manager.containers.SettingPage.attributes.description': '设定字段的排列顺序',
  'content-manager.containers.SettingPage.relations': '关联字段',
  'content-manager.containers.SettingPage.add.field': '再加一个字段',
  'content-manager.containers.SettingPage.add.relational-field': '再加一个关联字段',
  'content-manager.containers.list.displayedFields': '展示的字段',
  'content-manager.global.displayedFields': '展示的字段',
  'content-manager.components.FieldSelect.label': '添加字段',
  'content-manager.containers.EditSettingsView.modal-form.edit-field': '编辑字段',
  'content-manager.containers.SettingViewModel.pluginHeader.title': '内容管理 — {name}',
  'content-manager.containers.SettingsPage.Block.contentType.title': '集合类型',
  'content-manager.containers.SettingsPage.Block.contentType.description': '配置各自的专属设置',
  'content-manager.containers.SettingsPage.Block.generalSettings.title': '通用',
  'content-manager.containers.SettingsPage.Block.generalSettings.description':
    '配置所有集合类型的默认选项',
  'content-manager.containers.SettingsPage.pluginHeaderDescription': '配置全部集合类型与组件的设置',
  'content-manager.containers.SettingsView.list.title': '展示配置',
  'content-manager.containers.SettingsView.list.subtitle': '配置集合类型与组件的布局和展示方式',
  'content-manager.edit-settings-view.link-to-ctb.components': '编辑该组件',
  'content-manager.edit-settings-view.link-to-ctb.content-types': '编辑该内容类型',
  'content-manager.components.FieldItem.linkToComponentLayout': '设置该组件的布局',
  'content-manager.notification.error.displayedFields': '至少要保留一个展示字段',
  'content-manager.notification.info.minimumFields': '至少要保留一个展示字段',
  'content-manager.notification.info.SettingPage.disableSort': '至少要有一个字段允许排序',
  'content-manager.components.notification.info.maximum-requirement': '字段数量已达上限',
  'content-manager.components.notification.info.minimum-requirement': '已自动补一个字段以满足最少数量要求',
  'content-manager.popUpWarning.warning.updateAllSettings': '这会改动你的全部设置',

  // 视图设置页的字段表单
  'content-manager.form.Input.label': '标签',
  'content-manager.form.Input.label.inputDescription': '该值会覆盖表头显示的名称',
  'content-manager.form.Input.description': '描述',
  'content-manager.form.Input.description.placeholder': '在编辑页显示的说明',
  'content-manager.form.Input.placeholder': '占位提示',
  'content-manager.form.Input.placeholder.placeholder': '示例文字',
  'content-manager.form.Input.editable': '可编辑字段',
  'content-manager.form.Input.wysiwyg': '以富文本编辑器展示',
  'content-manager.form.Input.filters': '开启筛选',
  'content-manager.form.Input.bulkActions': '开启批量操作',
  'content-manager.form.Input.search.field': '该字段可被搜索',
  'content-manager.form.Input.sort.field': '该字段可用于排序',
  'content-manager.form.Input.defaultSort': '默认排序字段',
  'content-manager.form.Input.sort.order': '默认排序方向',
  'content-manager.form.Input.pageEntries': '每页条数',
  'content-manager.form.Input.pageEntries.inputDescription':
    '提示：该值可在各集合类型的设置页里单独覆盖。',

  // 筛选器
  'content-manager.components.AddFilterCTA.add': '筛选器',
  'content-manager.components.AddFilterCTA.hide': '筛选器',
  'content-manager.components.FilterOptions.button.apply': '应用',
  'content-manager.components.FiltersPickWrapper.PluginHeader.title.filter': '筛选器',
  'content-manager.components.FiltersPickWrapper.PluginHeader.description': '设置筛选条目的条件',
  'content-manager.components.FiltersPickWrapper.PluginHeader.actions.apply': '应用',
  'content-manager.components.FiltersPickWrapper.PluginHeader.actions.clearAll': '全部清除',
  'content-manager.components.FiltersPickWrapper.hide': '收起',

  // 列表页：空态 / 批量操作 / 分页
  'content-manager.components.TableEmpty.withoutFilter': '还没有{contentType}……',
  'content-manager.components.TableEmpty.withFilters': '没有符合当前筛选条件的{contentType}……',
  'content-manager.components.TableEmpty.withSearch': '没有匹配「{search}」的{contentType}……',
  'content-manager.components.TableDelete.delete': '全部删除',
  'content-manager.components.TableDelete.deleteSelected': '删除所选',
  'content-manager.components.LimitSelect.itemsPerPage': '每页条数',
  'content-manager.select.currently.selected': '当前已选 {count} 项',
  'content-manager.utils.data-loaded': '{number, plural, other {# 条内容}}已加载完成',
  'content-manager.listView.validation.errors.title': '需要先处理',
  'content-manager.listView.validation.errors.message':
    '发布前请确认所有字段都合规（必填项、最少/最多字数等）。',
  'content-manager.popUpWarning.bodyMessage.contentType.delete.all': '确定要删除这些条目吗？',
  'content-manager.popUpWarning.bodyMessage.contentType.publish.all': '确定要发布这些条目吗？',
  'content-manager.popUpWarning.bodyMessage.contentType.unpublish.all': '确定要取消发布这些条目吗？',
  'content-manager.popUpWarning.bodyMessage.contentType.delete': '确定要删除该内容类型吗？',
  'content-manager.popUpWarning.warning.has-draft-relations.title': '确认',
  'content-manager.popUpwarning.warning.has-draft-relations.button-confirm': '仍然发布',
  'content-manager.popUpWarning.warning.publish-question': '仍然要发布吗？',
  'content-manager.popUpWarning.warning.unpublish': '如果不发布，这条内容会自动变回草稿。',
  'content-manager.popUpWarning.warning.unpublish-question': '确定不发布吗？',

  // 编辑页：关联字段 / 动态区块 / 可重复组件
  'content-manager.EditRelations.title': '关联数据',
  'content-manager.relation.disconnect': '移除',
  'content-manager.relation.isLoading': '关联加载中',
  'content-manager.relation.loadMore': '加载更多',
  'content-manager.relation.notAvailable': '没有可选的关联',
  'content-manager.relation.publicationState.draft': '草稿',
  'content-manager.relation.publicationState.published': '已发布',
  'content-manager.components.RelationInput.icon-button-aria-label': '拖动',
  'content-manager.components.Select.draft-info-title': '草稿',
  'content-manager.components.Select.publish-info-title': '已发布',
  'content-manager.components.DynamicZone.ComponentPicker-label': '选择一个组件',
  'content-manager.components.DynamicZone.pick-compo': '选择一个组件',
  'content-manager.components.DynamicZone.add-component': '向 {componentName} 添加组件',
  'content-manager.components.DynamicZone.delete-label': '删除 {name}',
  'content-manager.components.DynamicZone.move-up-label': '上移组件',
  'content-manager.components.DynamicZone.move-down-label': '下移组件',
  'content-manager.components.DynamicZone.error-message': '组件内有错误',
  'content-manager.components.DynamicZone.required': '组件为必填项',
  'content-manager.components.DynamicZone.missing-components':
    '缺少 {number, plural, other {# 个组件}}',
  'content-manager.components.RepeatableComponent.error-message': '组件内有错误',
  'content-manager.components.repeatable.reorder.error': '组件字段排序失败，请重试',
  'content-manager.components.reset-entry': '重置条目',
  'content-manager.containers.EditView.notification.errors': '表单中存在错误',
  'content-manager.notification.upload.error': '上传文件时出错',
  'content-manager.notification.error.relationship.fetch': '拉取关联数据时出错。',

  // 编辑页：URL 别名（uid）辅助词
  'content-manager.components.uid.apply': '采用',
  'content-manager.components.uid.suggested': '建议值',

  // 拖拽排序读屏播报
  'content-manager.dnd.instructions': '按空格键抓起并重新排序',
  'content-manager.dnd.grab-item':
    '{item} 已抓起。当前位置：第 {position} 位。按上下方向键调整位置，空格键放下，Esc 取消。',
  'content-manager.dnd.drop-item': '{item} 已放下。最终位置：第 {position} 位。',
  'content-manager.dnd.cancel-item': '{item} 已放下，重新排序已取消。',
  'content-manager.dnd.reorder': '{item} 已移动。新位置：第 {position} 位。',
  'content-manager.components.DragHandle-label': '拖动',
  'content-manager.components.DraggableAttr.edit': '点击编辑',
  'content-manager.components.DraggableCard.move.field': '移动 {item}',
  'content-manager.components.DraggableCard.edit.field': '编辑 {item}',
  'content-manager.components.DraggableCard.delete.field': '删除 {item}',

  // 操作结果提示
  'content-manager.success.record.save': '已保存',
  'content-manager.success.record.publish': '已发布',
  'content-manager.success.record.unpublish': '已取消发布',
  'content-manager.success.record.delete': '已删除',
  'content-manager.permissions.not-allowed.create': '你没有创建该内容的权限',
  'content-manager.permissions.not-allowed.update': '你没有查看该内容的权限',

  // 校验与错误
  'content-manager.error.validation.required': '此项为必填。',
  'content-manager.error.validation.json': '不符合 JSON 格式',
  'content-manager.error.validation.regex': '不符合正则规则。',
  'content-manager.error.validation.min': '数值过小（最小 {min}）。',
  'content-manager.error.validation.max': '数值过大（最大 {max}）。',
  'content-manager.error.validation.minLength': '长度过短（最少 {min}）。',
  'content-manager.error.validation.maxLength': '长度过长（最多 {max}）。',
  'content-manager.error.validation.minSupMax': '不能更大',
  'content-manager.error.attribute.taken': '该字段名已存在',
  'content-manager.error.attribute.key.taken': '该值已存在',
  'content-manager.error.attribute.sameKeyAndName': '不能相同',
  'content-manager.error.contentTypeName.taken': '该名称已存在',
  'content-manager.error.model.fetch': '拉取模型配置时出错。',
  'content-manager.error.schema.generation': '生成 schema 时出错。',
  'content-manager.error.record.create': '创建记录时出错。',
  'content-manager.error.record.update': '更新记录时出错。',
  'content-manager.error.record.delete': '删除记录时出错。',
  'content-manager.error.record.fetch': '拉取记录时出错。',
  'content-manager.error.records.fetch': '拉取记录时出错。',
  'content-manager.error.records.count': '统计记录数时出错。',

  // 空内容类型引导 / 插件描述等边角
  'content-manager.emptyAttributes.title': '还没有任何字段',
  'content-manager.emptyAttributes.description': '给这个集合类型加上第一个字段吧',
  'content-manager.emptyAttributes.button': '前往内容类型构建器',
  'content-manager.components.EmptyAttributesBlock.description': '你可以修改这些设置',
  'content-manager.components.EmptyAttributesBlock.button': '前往设置页',
  'content-manager.pages.NoContentType.button': '创建第一个内容类型',
  'content-manager.containers.Home.pluginHeaderTitle': '内容管理',
  'content-manager.containers.Home.pluginHeaderDescription': '在这里管理你的全部内容。',
  'content-manager.containers.Home.introduction': '从左侧菜单进入具体的内容类型即可编辑数据。',
  'content-manager.plugin.description.short': '快速查看、编辑和删除数据库里的数据。',
  'content-manager.plugin.description.long': '快速查看、编辑和删除数据库里的数据。',
  'content-manager.models.numbered': '集合类型（{number}）',
  'content-manager.groups.numbered': '组件（{number}）',
  'content-manager.api.id': 'API ID',
  'content-manager.reviewWorkflows.stage.label': '审核阶段',

  // i18n 插件（本站只有单语言，但这些词会在编辑页/设置页露出）
  'i18n.actions.select-locale': '选择语言',
  'i18n.actions.delete.label': '删除条目（{locale}）',
  'i18n.actions.delete.dialog.title': '确认',
  'i18n.actions.delete.dialog.body': '确定要删除该语言版本吗？',
  'i18n.actions.delete.error': '删除该语言版本时出错。',
  'i18n.CMEditViewCopyLocale.cancel-text': '取消',
  'i18n.CMEditViewCopyLocale.dialog.title': '确认',
  'i18n.CMEditViewCopyLocale.dialog.body': '当前内容会被清空，并填入所选语言的内容：',
  'i18n.CMEditViewCopyLocale.dialog.field.label': '语言',
  'i18n.CMEditViewCopyLocale.dialog.field.placeholder': '选择一个语言……',
  'i18n.CMEditViewBulkLocale.publish-title': '发布多个语言版本',
  'i18n.CMEditViewBulkLocale.unpublish-title': '取消发布多个语言版本',
  'i18n.CMEditViewBulkLocale.status': '状态',
  'i18n.CMEditViewBulkLocale.publication-status': '发布状态',
  'i18n.CMEditViewBulkLocale.draft-relation-warning':
    '部分语言版本关联了草稿条目，发布后可能在站点上留下失效链接。',
  'i18n.CMEditViewBulkLocale.continue-confirmation': '确定要继续吗？',
  'i18n.CMEditViewLocalePicker.locale.create': '创建 <bold>{locale}</bold> 语言版本',
  'i18n.CMListView.popover.display-locales.label': '显示已翻译的语言',
  'i18n.Settings.list.actions.publishAdditionalInfos':
    '这会发布启用中的各语言版本 <em>（来自多语言插件）</em>',
  'i18n.Settings.list.actions.unpublishAdditionalInfos':
    '这会取消发布启用中的各语言版本 <em>（来自多语言插件）</em>',
  'i18n.Settings.locales.default': '默认',
  'i18n.Settings.locales.row.displayName': '显示名称',
  'i18n.Settings.locales.list.sort.id': '按 ID 排序',
  'i18n.Settings.locales.list.sort.displayName': '按显示名称排序',
  'i18n.Settings.locales.list.sort.default': '按默认语言排序',
  'i18n.Settings.locales.modal.create.code.error': '请选择一个语言',
  'i18n.Settings.locales.modal.create.name.description': '该语言在管理后台里会以这个名称显示',
  'i18n.Settings.locales.modal.create.name.error.min': '语言显示名称不能超过 50 个字符。',
  'i18n.Settings.locales.modal.create.name.error.required': '请填写语言显示名称',

  // ── 第五轮：把审计范围从 content-manager / i18n 扩到剩下全部语言包分片
  //    （admin 核心、content-type-builder、upload、users-permissions、email、cloud），
  //    同样用「en 字典逐键 × 运行时合并后的 messages」比对。剩余英文里，
  //    专有名词（URL / JSON / UID / GraphQL / Sentry / Webhooks）、纯占位插值
  //    （{firstname} {lastname}）、示例邮箱与 EE 专属键保持原样，其余补齐。──

  // 内容类型构建器：字段类型
  'content-type-builder.attribute.customField': '自定义字段',
  'content-type-builder.attribute.blocks': '富文本（区块）',
  'content-type-builder.attribute.blocks.description': '基于 JSON 的新版富文本编辑器',
  'content-type-builder.attribute.timestamp': '时间戳',
  'content-type-builder.modelPage.attribute.relation-polymorphic': '关联（多态）',

  // 内容类型构建器：左侧分组与列表页
  'content-type-builder.menu.section.models.name': '集合类型',
  'content-type-builder.menu.section.single-types.name': '单例类型',
  'content-type-builder.menu.section.components.name': '组件',
  'content-type-builder.listView.headerLayout.description': '搭建内容的数据结构',
  'content-type-builder.button.single-types.create': '创建单例类型',
  'content-type-builder.table.button.no-fields': '添加字段',
  'content-type-builder.table.content.create-first-content-type': '创建第一个集合类型',
  'content-type-builder.table.content.no-fields.collection-type': '给该集合类型添加第一个字段',
  'content-type-builder.table.content.no-fields.component': '给该组件添加第一个字段',

  // 内容类型构建器：新建/编辑弹窗
  'content-type-builder.form.button.collection-type.name': '集合类型',
  'content-type-builder.form.button.collection-type.description': '适合多条数据，如文章、商品、评论等。',
  'content-type-builder.form.button.single-type.name': '单例类型',
  'content-type-builder.form.button.single-type.description': '适合只有一条的数据，如「关于我们」、首页等。',
  'content-type-builder.form.button.add.field.to.collectionType': '给该集合类型再加一个字段',
  'content-type-builder.form.button.add.field.to.contentType': '给该内容类型再加一个字段',
  'content-type-builder.form.button.add.field.to.singleType': '给该单例类型再加一个字段',
  'content-type-builder.modalForm.singleType.header-create': '创建单例类型',
  'content-type-builder.modalForm.sub-header.chooseAttribute.singleType': '为该单例类型选择一个字段',
  'content-type-builder.modalForm.attribute.form.base.name.placeholder': '如 slug、seoUrl、canonicalUrl',
  'content-type-builder.modalForm.attribute.target-field': '来源字段',
  'content-type-builder.modalForm.tabs.default': '默认',
  'content-type-builder.modalForm.tabs.custom': '自定义',
  'content-type-builder.modalForm.tabs.label': '默认类型与自定义类型选项卡',
  'content-type-builder.modalForm.tabs.custom.howToLink': '如何添加自定义字段',
  'content-type-builder.modalForm.custom-fields.advanced.settings.extended': '扩展设置',
  'content-type-builder.modalForm.empty.heading': '这里还什么都没有。',
  'content-type-builder.modalForm.empty.sub-heading': '在丰富的扩展里找到你需要的。',
  'content-type-builder.modalForm.empty.button': '添加自定义字段',
  'content-type-builder.components.SelectComponents.displayed-value':
    '已选 {number, plural, other {# 个组件}}',
  'content-type-builder.form.attribute.item.date.type.date': 'date（如 01/01/{currentYear}）',
  'content-type-builder.form.attribute.item.date.type.datetime':
    'datetime（如 01/01/{currentYear} 00:00 AM）',
  'content-type-builder.form.attribute.item.date.type.time': 'time（如 00:00 AM）',
  'content-type-builder.form.attribute.item.text.regex': '正则表达式',
  'content-type-builder.form.attribute.item.text.regex.description': '填写正则表达式的内容',
  'content-type-builder.form.attribute.item.uniqueField.v5.disabled':
    '组件内的「唯一」字段目前无法正常工作，在修复前该选项已被禁用。',
  'content-type-builder.form.attribute.media.allowed-types': '选择允许的媒体类型',
  'content-type-builder.form.attribute.media.allowed-types.option-images': '图片',
  'content-type-builder.form.attribute.media.allowed-types.option-videos': '视频',
  'content-type-builder.form.attribute.media.allowed-types.option-files': '文件',

  // 内容类型构建器：图标选择器（组件分组用）
  'content-type-builder.IconPicker.search.placeholder.label': '搜索图标',
  'content-type-builder.IconPicker.search.button.label': '图标搜索按钮',
  'content-type-builder.IconPicker.search.clear.label': '清空图标搜索',
  'content-type-builder.IconPicker.remove.tooltip': '移除已选图标',
  'content-type-builder.IconPicker.remove.button': '移除已选图标按钮',
  'content-type-builder.IconPicker.emptyState.label': '没有找到图标',
  'content-type-builder.IconPicker.icon.label': '选择「{icon}」图标',

  // 内容类型构建器：校验与警告
  'content-type-builder.error.attributeName.reserved-name': '该名称是保留字，用作字段名可能导致其它功能异常',
  'content-type-builder.error.contentType.singularName-used': '不能与复数 API ID 相同',
  'content-type-builder.error.contentType.pluralName-used': '不能与单数 API ID 相同',
  'content-type-builder.error.contentType.singularName-equals-pluralName':
    '不能与其它内容类型的复数 API ID 相同。',
  'content-type-builder.error.contentType.pluralName-equals-singularName':
    '不能与其它内容类型的单数 API ID 相同。',
  'content-type-builder.error.contentType.pluralName-equals-collectionName':
    '该值已被其它内容类型占用。',
  'content-type-builder.error.validation.positive': '必须是正数',
  'content-type-builder.error.validation.regex': '正则表达式不合法',
  'content-type-builder.error.validation.enum-empty-string': '不允许空字符串',
  'content-type-builder.error.validation.enum-duplicate': '不允许重复值（只按字母和数字比较）。',
  'content-type-builder.error.validation.enum-regex':
    '至少有一个值不合法：每个值在第一个数字之前必须先出现一个字母。',
  'content-type-builder.error.validation.relation.targetAttribute-taken': '该名称在目标内容类型里已存在',
  'content-type-builder.notification.error.dynamiczone-min.validation':
    '动态区块里至少要有一个组件，才能保存内容类型',
  'content-type-builder.popUpWarning.draft-publish.message': '关闭「草稿与发布」后，现有草稿会被删除。',
  'content-type-builder.popUpWarning.draft-publish.second-message': '确定要关闭吗？',
  'content-type-builder.popUpWarning.draft-publish.button.confirm': '确定，关闭',

  // 邮件插件设置页
  'email.Settings.email.plugin.notification.config.error': '获取邮件配置失败',
  'email.Settings.email.plugin.notification.data.loaded': '邮件设置已加载',
  // 尖括号在 ICU 里会被当成富文本标签起始，用单引号转义（渲染出来仍是 < >）
  'email.Settings.email.plugin.placeholder.defaultFrom': "如：Strapi No-Reply '<'no-reply@strapi.io>",
  'email.Settings.email.plugin.placeholder.defaultReplyTo': "如：Strapi '<'example@strapi.io>",
  'email.Settings.email.plugin.placeholder.testAddress': '如：developer@example.com',
  'email.components.Input.error.validation.email': '邮箱格式不正确',

  // Strapi Cloud 插件（本站自建部署，用不到，但它在左侧菜单占一格）
  'cloud.Plugin.name': '云端部署',
  'cloud.Homepage.title': 'Strapi 官方全托管云端托管服务',
  'cloud.Homepage.subTitle': '两步即可获得在生产环境运行 Strapi 所需的一切。',
  'cloud.Homepage.githubBox.title.versioned': '项目已推送到 GitHub',
  'cloud.Homepage.githubBox.title.not-versioned': '把项目推送到 GitHub',
  'cloud.Homepage.githubBox.subTitle.versioned': '搞定！离项目上线只差一步了。',
  'cloud.Homepage.githubBox.subTitle.not-versioned':
    '部署到 Strapi Cloud 之前，项目需要先用 GitHub 做版本管理。',
  'cloud.Homepage.githubBox.buttonText': '上传到 GitHub',
  'cloud.Homepage.cloudBox.title': '部署到 Strapi Cloud',
  'cloud.Homepage.cloudBox.subTitle': '享用为 Strapi 优化过的整套环境，含数据库、邮件服务和 CDN。',
  'cloud.Homepage.cloudBox.buttonText': '部署到 Strapi Cloud',
  'cloud.Homepage.textBox.label.versioned': '免费试用 Strapi Cloud！',
  'cloud.Homepage.textBox.label.not-versioned': '为什么要把项目传到 GitHub？',
  'cloud.Homepage.textBox.text.versioned':
    'Strapi Cloud 提供 14 天免费试用，可在云端体验项目的全部功能。',
  'cloud.Homepage.textBox.text.not-versioned':
    'Strapi Cloud 会从你的 GitHub 仓库拉取并部署项目，这也是版本管理、维护和发布的最佳方式。按 GitHub 上的步骤把项目传上去即可。',

  // 后台设置页零星补漏
  'Settings.application.customization.carousel.title': '标志',
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
