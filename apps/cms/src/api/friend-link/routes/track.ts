// 埋点写入路由（第1期：来路/去路）。
// auth:false → 公网可达；安全由 controller 内的共享密钥（FRIEND_TRACK_SECRET）把关，
// 而非依赖 users-permissions（前台中间件/route 以服务端身份带密钥头调用）。
export default {
  routes: [
    {
      method: 'POST',
      path: '/friend-link/track',
      handler: 'friend-link.track',
      config: { auth: false, policies: [] },
    },
  ],
};
