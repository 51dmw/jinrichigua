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
  // 左侧「内容类型」搜索框：代码用 form.Input.search（不是 LeftMenu.Search.label）。两个都补。
  'content-manager.form.Input.search': '搜索内容类型',
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
