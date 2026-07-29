import { factories } from '@strapi/strapi';

// 核心 CRUD 路由（find/findOne 经 PUBLIC_READ 对前台只读开放；写操作仅 admin / API Token）。
export default factories.createCoreRouter('api::friend-link.friend-link');
