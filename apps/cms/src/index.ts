/**
 * Strapi 5 应用入口。
 *
 * bootstrap 在「首次启动」时：
 *   1) 给 public 角色开放各内容类型的只读权限（find/findOne），
 *      这样前台无需手工在后台点权限就能取「已发布」数据（数据单向只读，§2）。
 *   2) 灌入最小示例数据（频道/文章/Global），让前台三个路由立刻有内容可渲染（DoD §10.3）。
 *
 * 通过 plugin store 的 `initHasRun` 标志保证只跑一次、可重复启动不重复灌数。
 * 全程 try/catch，失败只告警，绝不阻断启动。
 */

import { errors } from '@strapi/utils';

type StrapiApp = any;

const ARTICLE_UID = 'api::article.article';

// ── 发布守卫（§6：审核通过才发布）──
// document service 中间件：拦截 article 的 publish 动作，
// 若该文档 reviewState !== 'approved' 则抛错阻止发布（admin UI / API / cron 一律生效）。
function registerPublishGuard(strapi: StrapiApp) {
  strapi.documents.use(async (context: any, next: any) => {
    if (context.uid === ARTICLE_UID && context.action === 'publish') {
      const documentId = context.params?.documentId;
      if (documentId) {
        const current = await strapi
          .documents(ARTICLE_UID)
          .findOne({ documentId, status: 'draft', fields: ['reviewState'] })
          .catch(() => null);
        // 仅在确实查到且未通过审核时拦截；查不到则放行（避免误伤创建流程）
        if (current && current.reviewState !== 'approved') {
          throw new errors.ApplicationError(
            `文章未通过审核（reviewState=${current.reviewState}），禁止发布`,
          );
        }
      }
    }
    return next();
  });
}

// ── RBAC 三角色（§6：管理员 / 编辑 / 审核）──
// 管理员 = 内置 Super Admin；这里创建「编辑」「审核」两个后台角色并赋权。
const ARTICLE_FIELDS = [
  'title', 'slug', 'summary', 'content', 'cover', 'channel', 'tags',
  'author', 'source', 'publishAt', 'reviewState', 'reviewNote', 'viewCount', 'seo',
];

function cmPerms(actions: string[], subject: string, fields: string[]) {
  return actions.map((action) => ({
    action: `plugin::content-manager.explorer.${action}`,
    subject,
    properties: { fields },
    conditions: [],
  }));
}

async function ensureAdminRoles(strapi: StrapiApp) {
  const roleService = strapi.service('admin::role');
  if (!roleService) return;

  const defs = [
    {
      name: '编辑',
      code: 'strapi-editor-custom',
      description: '可创建/编辑文章并提交待审，但无发布权（§6）',
      // 编辑：文章 增改读；频道/标签 读改；无 publish
      permissions: [
        ...cmPerms(['create', 'read', 'update'], ARTICLE_UID, ARTICLE_FIELDS),
        ...cmPerms(['read'], 'api::channel.channel', ['name', 'slug', 'order', 'isNav']),
        ...cmPerms(['read'], 'api::tag.tag', ['name', 'slug']),
      ],
    },
    {
      name: '审核',
      code: 'strapi-reviewer-custom',
      description: '可读改并发布文章（审核通过才发布，§6）',
      // 审核：文章 读改 + publish
      permissions: [
        ...cmPerms(['read', 'update', 'publish'], ARTICLE_UID, ARTICLE_FIELDS),
      ],
    },
  ];

  for (const def of defs) {
    try {
      let role = await strapi.db
        .query('admin::role')
        .findOne({ where: { code: def.code } });
      if (!role) {
        role = await roleService.create({
          name: def.name,
          code: def.code,
          description: def.description,
        });
      }
      await roleService.assignPermissions(role.id, def.permissions);
    } catch (e) {
      strapi.log.warn(`[bootstrap] role "${def.name}" setup skipped: ${(e as Error).message}`);
    }
  }
  strapi.log.info('[bootstrap] admin roles (编辑/审核) ensured');
}

// ── 开发用全访问 API Token（仅 SEED_DEV_TOKEN=true 时）──
async function ensureDevToken(strapi: StrapiApp) {
  if (process.env.SEED_DEV_TOKEN !== 'true') return;
  try {
    const exists = await strapi.db
      .query('admin::api-token')
      .findOne({ where: { name: 'dev-e2e' } });
    if (exists) return;
    const t = await strapi.service('admin::api-token').create({
      name: 'dev-e2e',
      description: 'M2 e2e 测试用（生产请删除）',
      type: 'full-access',
      lifespan: null,
    });
    strapi.log.info(`[dev] FULL-ACCESS API token (dev-e2e): ${t.accessKey}`);
  } catch (e) {
    strapi.log.warn(`[dev] api token create skipped: ${(e as Error).message}`);
  }
}

const PUBLIC_READ: Record<string, string[]> = {
  'api::article.article': ['find', 'findOne', 'view', 'stats'],
  'api::channel.channel': ['find', 'findOne'],
  'api::tag.tag': ['find', 'findOne'],
  'api::ad-slot.ad-slot': ['find', 'findOne'],
  'api::global.global': ['find'],
  'api::home-page.home-page': ['find'],
  'api::page.page': ['find', 'findOne'],
  'api::author.author': ['find', 'findOne'],
  // 评论：公众可读（仅已审核，前台过滤）+ 可提交（lifecycle 强制待审 + 敏感词）
  'api::comment.comment': ['find', 'create'],
};

async function grantPublicReadPermissions(strapi: StrapiApp) {
  const publicRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });
  if (!publicRole) return;

  for (const [uid, actions] of Object.entries(PUBLIC_READ)) {
    for (const action of actions) {
      const actionId = `${uid}.${action}`;
      const existing = await strapi
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action: actionId, role: publicRole.id } });
      if (!existing) {
        await strapi.query('plugin::users-permissions.permission').create({
          data: { action: actionId, role: publicRole.id },
        });
      }
    }
  }
  strapi.log.info('[bootstrap] public read permissions ensured');
}

// ── 一次性改版：替换频道结构为「今日吃瓜」+ 改站名 + 重建演示内容（store flag 守卫，仅一次）──
const REBRAND_CHANNELS = [
  { name: '明星娱乐', slug: 'star' },
  { name: '网红达人', slug: 'influencer' },
  { name: '吃瓜视频', slug: 'video' },
  { name: '社会大瓜', slug: 'society' },
  { name: '爆料内幕', slug: 'inside' },
  { name: '黑料档案', slug: 'dirt' },
  { name: '情感婚恋', slug: 'love' },
  { name: '体育吃瓜', slug: 'sports' },
  { name: '校园热议', slug: 'campus' },
  { name: '海外吃瓜', slug: 'oversea' },
  { name: '历史旧瓜', slug: 'history' },
];

// 频道 SEO 描述（slug → description）：写入 channel.description，
// 既是频道页 meta description（§4 TDK），也作为频道页可见简介。仅填空缺、不覆盖后台手改。
const CHANNEL_DESCRIPTIONS: Record<string, string> = {
  star: '明星娱乐第一线：实时追踪明星绯闻、恋情、塌房、综艺与红毯八卦，带你吃透娱乐圈每日热搜。',
  influencer: '网红达人动态全收录：主播、博主、带货红人的翻车、撕番、爆料与涨粉内幕，一站吃瓜。',
  video: '热点吃瓜视频聚合：现场实拍、监控曝光、采访片段与名场面回放，边看边吃瓜。',
  society: '社会大瓜聚焦：民生事件、维权现场、奇葩新闻与全网热议话题的深度梳理与持续跟进。',
  inside: '独家爆料与内幕揭秘：行业黑幕、隐秘交易、知情人爆料，带你看清事件来龙去脉。',
  dirt: '黑料档案馆：人物黑历史、争议事件与实锤证据的系统归档，持续更新不漏一条。',
  love: '情感婚恋八卦：明星恋情、离婚出轨、豪门恩怨与网友情感大瓜，全程围观不掉队。',
  sports: '体育圈吃瓜：球星场内外动态、转会绯闻、更衣室风波与赛场争议热点速递。',
  campus: '校园热议话题：高校趣闻、师生热点、考试升学与年轻人热搜的第一现场。',
  oversea: '海外吃瓜前线：欧美日韩明星动态、国际名人八卦与全球热点事件实时跟进。',
  history: '历史旧瓜重温：经典事件回顾、名人往事扒皮与那些年的热搜旧闻深度盘点。',
};

// 全站默认 SEO 描述：首页 / 搜索等无专属描述的页面的兜底 meta description（§4 TDK）。
const DEFAULT_SEO_DESCRIPTION =
  '今日吃瓜——全网热点吃瓜第一站，实时聚合明星娱乐、网红达人、社会大瓜、爆料内幕等多频道热搜，带你第一时间吃瓜、看清事件来龙去脉。';

// 演示用吃瓜标签：每篇文章挂 3 个，让全新部署的「热门标签」开箱即有内容（避免空标签云）。
const REBRAND_TAGS = [
  { name: '热搜', slug: 'resou' },
  { name: '出圈', slug: 'chuquan' },
  { name: '围观', slug: 'weiguan' },
  { name: '吃瓜', slug: 'chigua' },
  { name: '大瓜', slug: 'dagua' },
  { name: '爆料', slug: 'baoliao' },
  { name: '实锤', slug: 'shichui' },
  { name: '反转', slug: 'fanzhuan' },
  { name: '黑料', slug: 'heiliao' },
  { name: '塌房', slug: 'tafang' },
  { name: '明星', slug: 'mingxing' },
  { name: '顶流', slug: 'dingliu' },
  { name: '恋情', slug: 'lianqing' },
  { name: '网红', slug: 'wanghong' },
];

// 候选标签词库（批量生产：仅名称，slug 由 tag lifecycle 自动生成拼音+去重）。
// 未被任何文章使用的标签对外完全隐身：前端标签云/页脚不展示、sitemap 不收录、/tag 页 404。
// 文章编辑时可从中搜索勾选；选中并发布后该标签才"成真"（出页面）。
const CANDIDATE_TAGS = [
  '热搜', '热榜', '头条', '热点', '热门', '热议', '刷屏', '爆火', '出圈', '围观',
  '关注', '疯传', '霸榜', '冲榜', '上榜', '爆款', '趋势', '焦点', '全网', '热传',
  '吃瓜', '大瓜', '新瓜', '旧瓜', '爆瓜', '猛料', '爆料', '实锤', '石锤', '扒皮',
  '深扒', '揭秘', '曝光', '追踪', '盘点', '回顾', '合集', '汇总', '反转', '黑料',
  '翻车', '塌房', '崩盘', '打脸', '双标', '洗白', '删帖', '控评', '公关', '违规',
  '封号', '造假', '抄袭', '骗粉', '争议', '爆雷', '翻盘', '黑史', '实录', '明星',
  '演员', '歌手', '爱豆', '偶像', '顶流', '影帝', '影后', '小花', '小生', '艺人',
  '男团', '女团', '导演', '编剧', '制片', '主持', '导师', '嘉宾', '剧组', '恋情',
  '绯闻', '官宣', '隐婚', '结婚', '离婚', '分手', '复合', '出轨', '劈腿', '婚变',
  '婚讯', '订婚', '求婚', '同居', '闪婚', '再婚', '热恋', '冷战', '和好', '网红',
  '主播', '达人', '博主', '带货', '探店', '测评', '直播', '连麦', '停播', '封禁',
  '涨粉', '掉粉', '炫富', '摆拍', '剧本', '账号', '矩阵', '短剧', 'MCN', '视频',
  '短视频', '长视频', '现场', '录音', '录屏', '录像', '回放', '监控', '截图', '原图',
  '原片', '录音件', '视频曝', '录音曝', '截图曝', '现场曝', '完整版', '未删减', '聊天', '群聊',
  '证据', '文件', '合同', '邮件', '短信', '账单', '流水', '公告', '声明', '通知',
  '举报', '实名', '匿名', '投稿', '爆料人', '知情人', '圈内人', '内部人', '员工曝', '社会',
  '事件', '冲突', '纠纷', '维权', '调查', '通报', '回应', '处罚', '拘留', '开除',
  '处分', '辟谣', '造谣', '澄清', '立案', '报警', '实名锤', '网络曝', '后续曝', '诈骗',
  '跑路', '欠薪', '欠债', '骗局', '传销', '洗钱', '涉赌', '涉黄', '违法', '犯罪',
  '盗窃', '侵权', '售假', '假货', '勒索', '骗保', '黑产', '灰产', '套路', '内幕',
  '猛料曝', '内部信', '内部群', '合同曝', '聊天曝', '邮件曝', '举报信', '证据链', '实名曝', '匿名曝',
  '同行曝', '高管曝', '公司曝', '企业曝', '行业曝', '资本局', '内幕瓜', '黑历史', '旧闻', '旧照',
  '翻车史', '塌房史', '人设崩', '人设塌', '学历假', '履历假', '论文假', '成绩假', '数据假', '销量假',
  '流水假', '学历门', '抄袭门', '作弊门', '造假门', '黑料曝', '情感', '恋爱', '感情', '情侣',
  '夫妻', '原配', '小三', '情敌', '婚姻', '家暴', '冷暴力', '分居', '私生活', '感情史',
  '恋爱脑', '婚外情', '地下恋', '三角恋', '相亲', '脱单', '校园', '学校', '学生', '老师',
  '同学', '宿舍', '食堂', '军训', '社团', '霸凌', '考试', '作弊', '论文', '答辩',
  '考研', '高考', '留学', '毕业', '实习', '体育', '球星', '球队', '转会', '禁赛',
  '退役', '复出', '红牌', '黑哨', '假球', '赛后', '采访', '冠军', '亚军', '电竞',
  '选手', '战队', '教练', '裁判', '赛事', '海外', '欧美', '日韩', '韩国', '日本',
  '美国', '英国', '法国', '德国', '泰国', '越南', '国际瓜', '海外瓜', '海外曝', '海外黑',
  '全球热', '国际热', '国外曝', '国外黑', '历史', '经典瓜', '年度瓜', '传奇瓜', '名场面', '大事件',
  '经典翻', '陈年瓜', '老新闻', '老八卦', '旧事件', '旧爆料', '旧黑料', '旧热搜', '怀旧瓜', '往事录',
  '旧档案', '回忆杀', '历史曝', '经典曝', '粉丝', '饭圈', '脱粉', '回踩', '应援', '后援会',
  '站姐', '超话', '互撕', '骂战', '开团', '数据组', '控评组', '粉圈瓜', '饭圈瓜', '粉丝曝',
  '站姐曝', '粉丝战', '应援战', '流量战', '热搜榜', '话题榜', '排行榜', '关键词', '流量王', '营销号',
  '自媒体', '爆文', '刷量', '买热搜', '降热搜', '热搜词', '热搜瓜', '热搜曝', '热门榜', '热点榜',
  '热议榜', '推荐榜', '事件榜', '舆论场', '职场瓜', '裁员瓜', '离职瓜', '跳槽瓜', '潜规则', '办公室',
  '职场黑', '同事曝', '老板曝', '企业瓜', '公司瓜', '融资瓜', '资本瓜', '商业瓜', '豪门瓜', '富豪瓜',
  '争产瓜', '股权瓜', '投资瓜', '路透', '街拍', '偶遇', '机场照', '后台照', '花絮', '片场',
  '彩排', '后台', '路透图', '探班', '拍摄中', '录制中', '节目组', '综艺瓜', '选秀瓜', '剧组瓜',
  '拍戏瓜', '红毯瓜',
];

// 演示作者（吃瓜系 29 位）：每篇演示文章轮播分配一位，全新部署即多作者署名（E-E-A-T）。
const REBRAND_AUTHORS = [
  { name: '吃瓜君', slug: 'chiguajun', role: '吃瓜博主' },
  { name: '爆料君', slug: 'baoliaojun', role: '爆料人' },
  { name: '黑料君', slug: 'heiliaojun', role: '黑料追踪' },
  { name: '深扒君', slug: 'shenbajun', role: '深扒记者' },
  { name: '实锤君', slug: 'shichuijun', role: '真相核查' },
  { name: '瓜探长', slug: 'guatanzhang', role: '深扒侦探' },
  { name: '圈内君', slug: 'quanneijun', role: '圈内爆料' },
  { name: '内幕君', slug: 'neimujun', role: '圈内爆料' },
  { name: '猛料君', slug: 'mengliaojun', role: '爆料人' },
  { name: '扒皮君', slug: 'bapijun', role: '深扒记者' },
  { name: '翻车君', slug: 'fanchejun', role: '热点观察' },
  { name: '真相君', slug: 'zhenxiangjun', role: '真相核查' },
  { name: '瓜闻社', slug: 'guawenshe', role: '爆料机构' },
  { name: '爆料社', slug: 'baoliaoshe', role: '爆料机构' },
  { name: '黑料社', slug: 'heiliaoshe', role: '爆料机构' },
  { name: '吃瓜哥', slug: 'chiguage', role: '吃瓜博主' },
  { name: '爆料哥', slug: 'baoliaoge', role: '爆料人' },
  { name: '知情君', slug: 'zhiqingjun', role: '圈内爆料' },
  { name: '石锤君', slug: 'shichuijun-2', role: '真相核查' },
  { name: '塌房君', slug: 'tafangjun', role: '热点观察' },
  { name: '深扒社', slug: 'shenbashe', role: '爆料机构' },
  { name: '爆料局', slug: 'baoliaoju', role: '爆料机构' },
  { name: '真相局', slug: 'zhenxiangju', role: '爆料机构' },
  { name: '黑料库', slug: 'heiliaoku', role: '爆料机构' },
  { name: '内幕社', slug: 'neimushe', role: '爆料机构' },
  { name: '吃瓜研究所', slug: 'chiguayanjiusuo', role: '爆料机构' },
  { name: '全网爆料站', slug: 'quanwangbaoliaozhan', role: '爆料机构' },
  { name: '吃瓜档案馆', slug: 'chiguadanganguan', role: '爆料机构' },
  { name: '热点观察员', slug: 'redianguanchayuan', role: '热点观察员' },
];

async function rebrandGuaToday(strapi: StrapiApp) {
  const store = strapi.store({ type: 'type', name: 'setup' });
  if (await store.get({ key: 'rebrandGuaTodayHasRun' })) return;
  try {
    // 1) 删除旧文章、旧频道
    const oldArticles = await strapi
      .documents('api::article.article')
      .findMany({ fields: ['documentId'], pagination: { pageSize: 1000 } });
    for (const a of oldArticles ?? [])
      await strapi.documents('api::article.article').delete({ documentId: a.documentId });
    const oldChannels = await strapi
      .documents('api::channel.channel')
      .findMany({ fields: ['documentId'], pagination: { pageSize: 1000 } });
    for (const c of oldChannels ?? [])
      await strapi.documents('api::channel.channel').delete({ documentId: c.documentId });

    // 2) 清空首页区块 → 交给 ensureHomeLayout 按新频道重建
    const home = await strapi.documents('api::home-page.home-page').findFirst();
    if (home?.documentId)
      await strapi
        .documents('api::home-page.home-page')
        .update({ documentId: home.documentId, data: { blocks: [] } });

    // 3) 新频道 + 每频道 30 篇演示文章（草稿，reviewState=approved；发布与挂标签由 ensureAuthors/ensureDemoArticleTags 处理）
    const nowTs = Date.now();
    let order = 1;
    let artIdx = 0;
    for (const c of REBRAND_CHANNELS) {
      const ch = await strapi.documents('api::channel.channel').create({
        data: { name: c.name, slug: c.slug, isNav: true, order },
        status: 'published',
      });
      for (let i = 1; i <= 30; i++) {
        const title = `${c.name}示例 ${i}`;
        await strapi.documents('api::article.article').create({
          data: {
            title,
            slug: `${c.slug}-${i}`,
            summary: `「${c.name}」频道第 ${i} 篇示例内容，用于演示版式。`,
            content: `# ${title}\n\n这是「${c.name}」频道的示例正文段落一。\n\n示例正文段落二，用于演示文章页排版。`,
            channel: ch.documentId,
            author: '编辑部',
            source: '本站',
            publishAt: new Date(nowTs - ((order - 1) * 6 + (6 - i)) * 1_800_000).toISOString(),
            viewCount: ((order * 7 + i * 13) % 30) * 100_000 + i * 777,
            reviewState: 'approved',
          },
        });
        artIdx += 1;
      }
      order += 1;
    }

    // 4) 站名 + 首页简介 + 免责声明改版（升级或新建 Global）
    const homeIntro =
      '今日吃瓜聚合每日最新热点与全网热搜，覆盖明星娱乐、网红达人、吃瓜视频、社会大瓜、爆料内幕、黑料档案、情感婚恋、体育吃瓜、校园热议、海外吃瓜与历史旧瓜等话题，第一时间带你围观今日热议、深扒事件来龙去脉。';
    const disclaimer =
      '免责声明：本站内容多来源于网络公开渠道及用户投稿，仅代表作者个人观点，不代表本站立场；相关信息仅供娱乐与参考，不构成任何投资、决策或法律建议。如内容涉及侵权、不实或个人隐私，请通过「联络我们」与我们联系，我们将及时核实并处理。';
    const g = await strapi.documents('api::global.global').findFirst();
    if (g?.documentId)
      await strapi.documents('api::global.global').update({
        documentId: g.documentId,
        data: { siteName: '今日吃瓜', titleTemplate: '%s | 今日吃瓜', homeIntro, disclaimer },
      });
    else
      await strapi.documents('api::global.global').create({
        data: {
          siteName: '今日吃瓜',
          titleTemplate: '%s | 今日吃瓜',
          homeIntro,
          disclaimer,
          defaultRobots: { index: true, follow: true },
        },
        status: 'published',
      });

    await store.set({ key: 'rebrandGuaTodayHasRun', value: true });
    strapi.log.info(`[bootstrap] rebrand → 今日吃瓜（${REBRAND_CHANNELS.length} 频道）`);
  } catch (e) {
    strapi.log.warn(`[bootstrap] rebrand skipped: ${(e as Error).message}`);
  }
}

// ── 把每个频道的演示文章补足到 TARGET 篇（幂等：缺哪篇补哪篇），每篇挂 3 个标签 ──
// 用于已播种过的库（rebrand 早期只建了 6 篇/频道）；全新库 rebrand 已建满则全部 skip。
async function topUpDemoArticles(strapi: StrapiApp, target = 30) {
  const store = strapi.store({ type: 'type', name: 'setup' });
  if (await store.get({ key: 'topUpDemo30HasRun' })) return;
  try {
    const channels = await strapi
      .documents('api::channel.channel')
      .findMany({ fields: ['documentId', 'name', 'slug'], pagination: { pageSize: 50 } });
    if (!channels?.length) return;

    const nowTs = Date.now();
    let artIdx = 0;
    let created = 0;
    for (const ch of channels) {
      for (let i = 1; i <= target; i++) {
        const slug = `${ch.slug}-${i}`;
        const exists = await strapi
          .documents('api::article.article')
          .findFirst({ filters: { slug } });
        if (!exists) {
          const title = `${ch.name}示例 ${i}`;
          // 标签由 ensureDemoArticleTags（knex）统一挂，避免 document service 关联报错
          await strapi.documents('api::article.article').create({
            data: {
              title,
              slug,
              summary: `「${ch.name}」频道第 ${i} 篇示例内容，用于演示版式。`,
              content: `# ${title}\n\n这是「${ch.name}」频道的示例正文段落一。\n\n示例正文段落二，用于演示文章页排版。`,
              channel: ch.documentId,
              author: '编辑部',
              source: '本站',
              publishAt: new Date(nowTs - artIdx * 600_000).toISOString(),
              viewCount: ((artIdx * 7 + i * 13) % 30) * 100_000 + i * 777,
              reviewState: 'approved',
            },
          });
          created += 1;
        }
        artIdx += 1;
      }
    }
    await store.set({ key: 'topUpDemo30HasRun', value: true });
    strapi.log.info(`[bootstrap] demo articles topped up to ${target}/频道（新增 ${created}）`);
  } catch (e) {
    strapi.log.warn(`[bootstrap] topUp skipped: ${(e as Error).message}`);
  }
}

// ── 给「已发布但无标签」的演示文章挂 3 个标签（knex 直插 link 表，幂等）──
// 用 knex 而非 document service 关联：导入的标签按 documentId 关联会报 Invalid relations。
async function ensureDemoArticleTags(strapi: StrapiApp) {
  try {
    // 确保 14 个演示标签存在
    for (const t of REBRAND_TAGS) {
      const ex = await strapi.documents('api::tag.tag').findFirst({ filters: { slug: t.slug } });
      if (!ex) await strapi.documents('api::tag.tag').create({ data: { name: t.name, slug: t.slug } });
    }
    const knex = strapi.db.connection;
    const tagRows = await knex('tags')
      .whereIn(
        'slug',
        REBRAND_TAGS.map((t) => t.slug),
      )
      .select('id');
    const tagIds = tagRows.map((r: { id: number }) => r.id);
    if (!tagIds.length) return;

    // 已发布、且当前无任何标签的文章行
    const arts = await knex('articles')
      .whereNotNull('published_at')
      .whereNotExists(function (this: any) {
        this.select('*')
          .from('articles_tags_lnk')
          .whereRaw('articles_tags_lnk.article_id = articles.id');
      })
      .select('id');

    let idx = 0;
    let n = 0;
    for (const a of arts) {
      const set = [0, 1, 2].map((k) => tagIds[(idx * 3 + k) % tagIds.length]);
      for (let k = 0; k < set.length; k++) {
        await knex('articles_tags_lnk')
          .insert({ article_id: a.id, tag_id: set[k], tag_ord: k + 1, article_ord: idx + 1 })
          .onConflict(['article_id', 'tag_id'])
          .ignore();
      }
      idx += 1;
      n += 1;
    }
    if (n > 0) strapi.log.info(`[bootstrap] tagged ${n} demo article(s) with 3 tags each`);
  } catch (e) {
    strapi.log.warn(`[bootstrap] demo tags skipped: ${(e as Error).message}`);
  }
}

async function seedContent(strapi: StrapiApp) {
  const existing = await strapi.documents('api::channel.channel').count();
  if (existing > 0) return;

  // ── Channels（顺序与是否上导航由数据驱动，§5）──
  const channelSeed = [
    { name: '要闻', slug: 'news', order: 1 },
    { name: '科技', slug: 'tech', order: 2 },
    { name: '财经', slug: 'finance', order: 3 },
    { name: '体育', slug: 'sports', order: 4 },
  ];

  const channels: Record<string, string> = {};
  for (const c of channelSeed) {
    const created = await strapi.documents('api::channel.channel').create({
      data: { ...c, isNav: true },
      status: 'published',
    });
    channels[c.slug] = created.documentId;
  }

  // ── Articles（每频道几条，供首页模块化区块 + 频道页 + 文章页渲染）──
  const now = Date.now();
  const articleSeed = [
    { channel: 'news', n: 6 },
    { channel: 'tech', n: 6 },
    { channel: 'finance', n: 6 },
    { channel: 'sports', n: 6 },
  ];

  for (const group of articleSeed) {
    for (let i = 1; i <= group.n; i++) {
      const title = `示例文章 ${group.channel}-${i}`;
      await strapi.documents('api::article.article').create({
        data: {
          title,
          slug: `${group.channel}-sample-${i}`,
          summary: `这是 ${group.channel} 频道的第 ${i} 篇示例文章，用于验证 M1 脚手架的列表与详情渲染。`,
          content: `# ${title}\n\n这是示例正文。前台文章页应服务端完整输出此内容（§4 MUST：正文不得依赖客户端 JS）。\n\n段落二：用于占位的中文示例文本。`,
          channel: channels[group.channel],
          author: '编辑部',
          source: '本站',
          publishAt: new Date(now - (group.n - i) * 3600_000).toISOString(),
          viewCount: 0,
          reviewState: 'approved', // 已发布 ⟹ 审核通过（满足发布守卫）
        },
        status: 'published',
      });
    }
  }

  // ── Global 单类型（首次创建）──
  const globalExists = await strapi.documents('api::global.global').findFirst();
  if (!globalExists) {
    await strapi.documents('api::global.global').create({
      data: {
        siteName: '今日吃瓜',
        titleTemplate: '%s | 今日吃瓜',
        defaultRobots: { index: true, follow: true },
        icpRecord: '京ICP备XXXXXXXX号-1',
      },
      status: 'published',
    });
  }

  strapi.log.info('[bootstrap] seed content created');
}

// ── 首页编排（§5）：若 HomePage 未配置区块，按现有频道生成默认编排（幂等，每次启动检查）──
async function ensureHomeLayout(strapi: StrapiApp) {
  try {
    const current = await strapi
      .documents('api::home-page.home-page')
      .findFirst({ populate: { blocks: true } });
    if (current?.blocks?.length) return;

    const channels = await strapi.documents('api::channel.channel').findMany({
      filters: { isNav: true },
      sort: 'order:asc',
      fields: ['documentId', 'name', 'slug'],
      pagination: { pageSize: 50 },
    });
    if (!channels?.length) return;

    // 区块版式：首块「上图下标题」，其余轮换；每块取 6 条（版式由后台数据驱动）
    const variants = ['image-top', 'left-text-right-image', 'three-image', 'text-only'];
    const blocks = channels.map((ch: any, i: number) => ({
      title: ch.name,
      channel: ch.documentId,
      variant: variants[i % variants.length],
      limit: 6,
    }));

    if (current?.documentId) {
      await strapi
        .documents('api::home-page.home-page')
        .update({ documentId: current.documentId, data: { blocks } });
    } else {
      await strapi.documents('api::home-page.home-page').create({ data: { blocks } });
    }
    strapi.log.info(`[bootstrap] home layout seeded (${blocks.length} blocks)`);
  } catch (e) {
    strapi.log.warn(`[bootstrap] home layout skipped: ${(e as Error).message}`);
  }
}

// ── 广告位投放（§M6）：幂等播种全站广告位，每个位带标准 format（占位尺寸）──
// enabled 默认 false：尺寸已配置好，但无创意不渲染（避免空位/伤 SEO），运营投放时再开。
async function ensureAdSlots(strapi: StrapiApp) {
  try {
    const seeds: Array<{ key: string; title: string; format: string }> = [
      // 首页
      { key: 'home-top', title: '首页顶部横幅', format: 'leaderboard' },
      { key: 'home-feed-1', title: '首页信息流位 1', format: 'in-feed' },
      { key: 'home-feed-2', title: '首页信息流位 2', format: 'in-feed' },
      { key: 'home-anchor', title: '首页移动悬浮', format: 'anchor' },
      // 频道页
      { key: 'channel-top', title: '频道页顶部横幅', format: 'leaderboard' },
      { key: 'channel-mid', title: '频道页信息流位', format: 'in-feed' },
      { key: 'channel-aside', title: '频道页侧栏矩形', format: 'rectangle' },
      { key: 'channel-anchor', title: '频道页移动悬浮', format: 'anchor' },
      // 文章页
      { key: 'article-inline', title: '文章正文内原生', format: 'in-feed' },
      { key: 'article-bottom', title: '文章页底部横幅', format: 'leaderboard' },
      { key: 'article-aside', title: '文章页侧栏矩形', format: 'rectangle' },
      { key: 'article-aside-2', title: '文章页侧栏半屏', format: 'half-page' },
      { key: 'article-anchor', title: '文章页移动悬浮', format: 'anchor' },
      // 热门 / 作者 / 标签
      { key: 'hot-top', title: '热门页顶部横幅', format: 'leaderboard' },
      { key: 'hot-aside', title: '热门页侧栏矩形', format: 'rectangle' },
      { key: 'author-aside', title: '作者页侧栏矩形', format: 'rectangle' },
      { key: 'tag-aside', title: '标签页侧栏矩形', format: 'rectangle' },
      // 搜索页
      { key: 'search-top', title: '搜索页顶部横幅', format: 'leaderboard' },
      { key: 'search-feed', title: '搜索页信息流位', format: 'in-feed' },
    ];
    for (const s of seeds) {
      const exists = await strapi
        .documents('api::ad-slot.ad-slot')
        .findFirst({ filters: { key: s.key } });
      if (!exists) {
        await strapi.documents('api::ad-slot.ad-slot').create({
          data: { key: s.key, title: s.title, format: s.format, enabled: false },
        });
      } else if (!(exists as { format?: string }).format) {
        // 历史数据回填 format（仅当缺失，不覆盖运营改动）
        await strapi
          .documents('api::ad-slot.ad-slot')
          .update({ documentId: exists.documentId, data: { format: s.format } });
      }
    }
    strapi.log.info('[bootstrap] ad slots ensured');
  } catch (e) {
    strapi.log.warn(`[bootstrap] ad slots skipped: ${(e as Error).message}`);
  }
}

// ── 信息/法律页（§8）：幂等播种，已存在的不覆盖（保留后台编辑）──
const PAGE_SEED: Array<{ title: string; slug: string; body: string }> = [
  {
    title: '关于我们',
    slug: 'about',
    body: '今日吃瓜是一个聚合每日热点与全网热搜的吃瓜资讯站，覆盖明星娱乐、网红达人、吃瓜视频、社会大瓜、爆料内幕、黑料档案、情感婚恋、体育吃瓜、校园热议、海外吃瓜与历史旧瓜等话题。\n\n我们第一时间汇总全网热议事件，带你快速围观、深扒来龙去脉。本站坚持内容审核与合规过滤，所有内容均经「草稿 → 待审 → 已发布」流程；信息多来源于网络公开渠道与用户投稿，仅供娱乐参考。如涉及侵权或不实，请通过「联络我们」与我们联系处理。',
  },
  {
    title: '联络我们',
    slug: 'contact',
    body: '如需联系编辑部、商务合作或内容反馈，请通过以下方式与我们取得联系。\n\n邮箱：contact@example.com　商务合作：bd@example.com',
  },
  {
    title: '常见问题',
    slug: 'faq',
    body: '问：如何投稿或反馈内容问题？答：请发送邮件至 contact@example.com。\n\n问：内容多久更新一次？答：热点内容实时更新，列表按最新发布与热度排序。\n\n问：如何参与评论？答：任何人可在文章页发表评论，经后台审核通过后展示。\n\n问：发现不实或侵权内容怎么办？答：请通过「联络我们」提交说明，我们会尽快核实并处理。',
  },
  {
    title: '内容政策',
    slug: 'policy',
    body: '本站对所有发布内容执行「草稿 → 待审 → 已发布」的审核流程，并接入敏感词过滤，确保内容合规。\n\n我们尊重知识产权，未经授权不转载、不抓取第三方文本、图片或数据。',
  },
  {
    title: '隐私政策',
    slug: 'privacy',
    body: '我们重视并保护用户隐私。本政策说明我们如何收集、使用与保护您的个人信息。\n\n我们可能使用 Cookie 及统计分析工具（如 Yandex.Metrica）以改善服务体验；您可随时在浏览器中管理 Cookie。\n\n未经您的同意，我们不会向第三方出售或泄露您的个人信息。',
  },
  {
    title: '使用协议',
    slug: 'terms',
    body: '使用本站即表示您同意遵守本使用协议。本站内容仅供参考，不构成任何投资、医疗或法律建议。\n\n未经书面许可，不得复制、转载或商用本站内容。我们保留随时修改本协议的权利。',
  },
  {
    title: 'DMCA 版权声明',
    slug: 'dmca',
    body: '本站尊重知识产权。若您认为本站内容侵犯了您的版权，请提交包含以下信息的书面通知：版权作品说明、侵权链接、您的联系方式及权属声明。\n\n版权通知请发送至：dmca@example.com。我们将依法及时处理。',
  },
  {
    title: '18 U.S.C. 2257 合规声明',
    slug: '2257',
    body: '本站为热点资讯聚合平台，不制作、不托管任何受 18 U.S.C. § 2257 记录保存要求约束的内容。\n\n如有相关合规疑问，请通过「联络我们」与我们联系。',
  },
  {
    title: '热门搜索',
    slug: 'hot-search',
    body: '以下为站内热门话题与关键词，点击可进入对应专题页面。',
  },
  {
    title: '其他',
    slug: 'other',
    body: '更多站点信息、合作与服务入口将陆续补充。',
  },
];

async function ensurePages(strapi: StrapiApp) {
  try {
    for (const p of PAGE_SEED) {
      const exists = await strapi
        .documents('api::page.page')
        .findFirst({ filters: { slug: p.slug }, status: 'draft' });
      if (!exists) {
        await strapi.documents('api::page.page').create({
          data: { title: p.title, slug: p.slug, body: p.body },
          status: 'published',
        });
      }
    }
    strapi.log.info('[bootstrap] info pages ensured');
  } catch (e) {
    strapi.log.warn(`[bootstrap] info pages skipped: ${(e as Error).message}`);
  }
}

// ── 作者实体（E-E-A-T）：建「编辑部」+ 迁移未关联作者的文章 ──
async function ensureAuthors(strapi: StrapiApp) {
  try {
    // 1) 确保 29 位吃瓜系作者存在
    const ids: string[] = [];
    const names: string[] = [];
    for (const a of REBRAND_AUTHORS) {
      let au = await strapi
        .documents('api::author.author')
        .findFirst({ filters: { slug: a.slug } });
      if (!au) {
        au = await strapi.documents('api::author.author').create({
          data: {
            name: a.name,
            slug: a.slug,
            role: a.role,
            bio: `${a.name}，${a.role}，专注全网热点的爆料、深扒与求证，带你第一时间吃瓜、看清事件来龙去脉。`,
          },
        });
      }
      ids.push(au.documentId);
      names.push(a.name);
    }

    // 2) 未关联作者实体的文章 → 轮播分配给 29 位作者并发布（同步署名字段）
    const orphans = await strapi.documents('api::article.article').findMany({
      status: 'draft',
      filters: { authorRef: { $null: true } } as any,
      fields: ['documentId'],
      pagination: { pageSize: 1000 },
    });
    let n = 0;
    for (const a of orphans ?? []) {
      try {
        const k = n % ids.length;
        await strapi
          .documents('api::article.article')
          .update({ documentId: a.documentId, data: { authorRef: ids[k], author: names[k] } as any });
        await strapi.documents('api::article.article').publish({ documentId: a.documentId });
        n += 1;
      } catch {
        /* 跳过单篇失败 */
      }
    }
    if (n > 0) strapi.log.info(`[bootstrap] assigned ${n} article(s) to ${ids.length} authors`);
    strapi.log.info('[bootstrap] authors ensured');
  } catch (e) {
    strapi.log.warn(`[bootstrap] authors skipped: ${(e as Error).message}`);
  }
}

// ── 后台字段中文标签（仅改「显示标签」，不改字段名 / 不影响 API 与前台）──
// 写入 content-manager 配置（core-store）里 metadatas[字段].edit/list.label。
// 仅作用于本项目 api::* 内容类型与自定义组件；admin::/plugin::（用户、文件、角色等系统类型）不动。
const FIELD_LABELS_BASE: Record<string, string> = {
  // 通用
  title: '标题', slug: 'URL 别名', summary: '摘要', content: '正文', body: '正文内容',
  cover: '封面图', image: '图片', name: '名称', description: '描述', note: '备注',
  order: '排序', enabled: '是否启用',
  // 系统字段
  id: 'ID', createdAt: '创建时间', updatedAt: '更新时间',
  createdBy: '创建人', updatedBy: '更新人', publishedAt: '发布时间',
  // 文章
  channel: '所属频道', tags: '标签', author: '作者署名', authorRef: '关联作者',
  source: '来源', publishAt: '定时发布时间', reviewState: '审核状态',
  reviewNote: '审核备注', viewCount: '浏览量', seo: 'SEO 设置',
  // 频道
  isNav: '显示在导航', parent: '上级频道', children: '下级频道', articles: '关联文章',
  // 作者
  role: '角色／头衔', bio: '简介', avatar: '头像',
  // 广告位
  key: '位置标识', format: '广告格式', link: '跳转链接', startAt: '开始时间', endAt: '结束时间',
  // 评论
  authorName: '昵称', approved: '已审核', article: '所属文章',
  // 敏感词
  word: '敏感词',
  // 首页编排
  blocks: '首页区块',
  // 站点设置
  siteName: '站点名称', titleTemplate: '标题模板', homeIntro: '首页简介',
  disclaimer: '免责声明', defaultOgImage: '默认分享图', defaultRobots: '默认抓取设置',
  googleSiteVerification: 'Google 站点验证', yandexSiteVerification: 'Yandex 站点验证',
  bingSiteVerification: 'Bing 站点验证', yandexMetricaId: 'Yandex 统计 ID',
  icpRecord: 'ICP 备案号', defaultSeo: '默认 SEO',
  // SEO 组件
  metaTitle: 'SEO 标题', metaDescription: 'SEO 描述', keywords: '关键词',
  canonicalURL: '规范链接 (canonical)', robots: '抓取指令', ogTitle: '分享标题',
  ogDescription: '分享描述', ogImage: '分享图', twitterCard: 'Twitter 卡片',
  structuredDataType: '结构化数据类型', structuredDataJSON: '结构化数据 (JSON)',
  index: '允许索引', follow: '允许跟踪',
  // 首页区块组件
  variant: '版式', limit: '取数量',
};
// 同名字段在特定组件下的语义覆盖（避免歧义）
const FIELD_LABELS_OVERRIDE: Record<string, Record<string, string>> = {
  'components::layout.home-block': { title: '区块标题', channel: '频道' },
};

async function ensureChineseFieldLabels(strapi: StrapiApp) {
  const store = strapi.store({ type: 'type', name: 'setup' });
  if (await store.get({ key: 'cnFieldLabelsV2HasRun' })) return;

  const PREFIXES = [
    'plugin_content_manager_configuration_content_types::api::', // 仅本项目内容类型
    'plugin_content_manager_configuration_components::', // 自定义组件
  ];
  const q = strapi.db.query('strapi::core-store');
  let touched = 0;
  for (const prefix of PREFIXES) {
    const rows = await q.findMany({ where: { key: { $startsWith: prefix } } });
    for (const row of rows) {
      let cfg: any;
      try {
        cfg = JSON.parse(row.value);
      } catch {
        continue;
      }
      const uid = row.key
        .replace('plugin_content_manager_configuration_content_types::', '')
        .replace('plugin_content_manager_configuration_components::', 'components::');
      const override = FIELD_LABELS_OVERRIDE[uid] ?? {};
      const metas = cfg.metadatas ?? {};
      let changed = false;
      for (const field of Object.keys(metas)) {
        const label = override[field] ?? FIELD_LABELS_BASE[field];
        if (!label) continue;
        const m = metas[field];
        if (m?.edit && m.edit.label !== label) {
          m.edit.label = label;
          changed = true;
        }
        if (m?.list && m.list.label !== label) {
          m.list.label = label;
          changed = true;
        }
      }
      if (changed) {
        await q.update({ where: { id: row.id }, data: { value: JSON.stringify(cfg) } });
        touched += 1;
      }
    }
  }
  await store.set({ key: 'cnFieldLabelsV2HasRun', value: true });
  strapi.log.info(`[bootstrap] 已应用后台字段中文标签（更新 ${touched} 个配置）`);
}

// 候选标签词库入库（仅名称，slug 由 lifecycle 自动生成）。
// find-or-create by name：已存在的（含 REBRAND_TAGS 14 个）跳过，幂等。
// 未被文章使用的标签对外隐身，不生成路径——换库/重部署后词库自动复现。
async function ensureCandidateTags(strapi: StrapiApp) {
  const store = strapi.store({ type: 'type', name: 'setup' });
  if (await store.get({ key: 'candidateTagsV1HasRun' })) return;
  let created = 0;
  for (const name of CANDIDATE_TAGS) {
    const exists = await strapi.db
      .query('api::tag.tag')
      .findOne({ where: { name }, select: ['id'] });
    if (exists) continue;
    try {
      await strapi.documents('api::tag.tag').create({ data: { name } }); // 触发 lifecycle → 自动拼音 slug + 去重
      created += 1;
    } catch (e) {
      strapi.log.warn(`[bootstrap] candidate tag "${name}" skipped: ${(e as Error).message}`);
    }
  }
  await store.set({ key: 'candidateTagsV1HasRun', value: true });
  strapi.log.info(`[bootstrap] 候选标签词库已就绪（新建 ${created} 个）`);
}

// ── 频道 description（§4 TDK）：补全缺失的频道 meta description ──
// 幂等：仅当 description 为空时填入（不覆盖后台手改）；channel 为 draft&publish，填后发布。
async function ensureChannelDescriptions(strapi: StrapiApp) {
  try {
    const channels = await strapi
      .documents('api::channel.channel')
      .findMany({ fields: ['documentId', 'slug', 'description'], pagination: { pageSize: 100 } });
    let n = 0;
    for (const ch of channels ?? []) {
      const desc = CHANNEL_DESCRIPTIONS[ch.slug as keyof typeof CHANNEL_DESCRIPTIONS];
      if (desc && !(ch.description && String(ch.description).trim())) {
        await strapi
          .documents('api::channel.channel')
          .update({ documentId: ch.documentId, data: { description: desc } });
        await strapi
          .documents('api::channel.channel')
          .publish({ documentId: ch.documentId })
          .catch(() => null);
        n += 1;
      }
    }
    if (n > 0) strapi.log.info(`[bootstrap] channel descriptions filled (${n})`);
  } catch (e) {
    strapi.log.warn(`[bootstrap] channel descriptions skipped: ${(e as Error).message}`);
  }
}

// ── 全局 defaultSeo.metaDescription（§4 TDK）：首页/搜索等的兜底描述 ──
// 幂等：仅当为空时填入（global 非 draft&publish，update 即生效）。
async function ensureGlobalDefaultSeo(strapi: StrapiApp) {
  try {
    const g = await strapi
      .documents('api::global.global')
      .findFirst({ populate: { defaultSeo: true } });
    if (!g?.documentId) return;
    const cur = (g as any).defaultSeo?.metaDescription;
    if (cur && String(cur).trim()) return; // 已有则不覆盖
    await strapi.documents('api::global.global').update({
      documentId: g.documentId,
      data: {
        defaultSeo: { ...((g as any).defaultSeo ?? {}), metaDescription: DEFAULT_SEO_DESCRIPTION },
      },
    });
    strapi.log.info('[bootstrap] global defaultSeo.metaDescription filled');
  } catch (e) {
    strapi.log.warn(`[bootstrap] global defaultSeo skipped: ${(e as Error).message}`);
  }
}

export default {
  register({ strapi }: { strapi: StrapiApp }) {
    // 发布守卫需在内容操作前注册（§6）
    registerPublishGuard(strapi);

    // 「批量添加标签」后台页面用的 admin 类型路由（走 admin 会话鉴权）。
    // 注：src/api/*/routes 会被强制为 content-api，admin-JWT 无法调；故在此手动注册 admin 路由。
    // content-api 路由 /api/tags/bulk-create 仍保留（供 API Token / curl 调用）。
    strapi.server.routes({
      type: 'admin',
      routes: [
        {
          method: 'POST',
          path: '/tags-bulk-create',
          handler: 'api::tag.tag.bulkCreate',
          config: { policies: [] },
        },
      ],
    });
  },

  async bootstrap({ strapi }: { strapi: StrapiApp }) {
    const store = strapi.store({ type: 'type', name: 'setup' });
    const initHasRun = await store.get({ key: 'initHasRun' });

    try {
      await rebrandGuaToday(strapi); // 一次性改版：今日吃瓜频道结构 + 站名（须在 ensureHomeLayout 前）
      await topUpDemoArticles(strapi); // 把演示文章补足到 30 篇/频道（须在 ensureAuthors 前以便发布）
      await grantPublicReadPermissions(strapi);
      await ensureAdminRoles(strapi); // RBAC 三角色（§6）
      await ensureHomeLayout(strapi); // 首页编排（§5）
      await ensureChannelDescriptions(strapi); // 频道 description（§4 TDK，须在频道已建之后）
      await ensureGlobalDefaultSeo(strapi); // 全局兜底 SEO 描述（§4 TDK）
      await ensureAdSlots(strapi); // 广告位（§M6）
      await ensurePages(strapi); // 信息/法律页（§8）
      await ensureAuthors(strapi); // 作者实体（E-E-A-T）
      await ensureDemoArticleTags(strapi); // 给演示文章挂 3 个标签（须在 ensureAuthors 后，文章已发布）
      await ensureCandidateTags(strapi); // 候选标签词库（仅名称，slug 自动；未用即隐身）
      await ensureDevToken(strapi); // 仅开发测试
      await ensureChineseFieldLabels(strapi); // 后台字段中文显示标签（A：不改字段名/不动 API）
      if (!initHasRun) {
        await seedContent(strapi);
        await store.set({ key: 'initHasRun', value: true });
      }
    } catch (err) {
      strapi.log.warn(`[bootstrap] setup skipped: ${(err as Error).message}`);
    }
  },
};
