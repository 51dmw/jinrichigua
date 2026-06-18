export default ({ env }) => ({
  // 官方 SEO 插件（§3 MUST）——为 Article/Channel/Global 的 seo 组件提供建议面板。
  seo: {
    enabled: true,
  },

  // 媒体存储 → Cloudflare R2（SHOULD，§7）。M5 启用：
  // upload: {
  //   config: {
  //     provider: 'aws-s3',
  //     providerOptions: {
  //       s3Options: {
  //         credentials: {
  //           accessKeyId: env('R2_ACCESS_KEY_ID'),
  //           secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  //         },
  //         endpoint: env('R2_ENDPOINT'),
  //         region: 'auto',
  //         params: { Bucket: env('R2_BUCKET') },
  //       },
  //     },
  //   },
  // },
});
