export default ({ env }) => ({
  // 官方 SEO 插件（§3 MUST）——为 Article/Channel/Global 的 seo 组件提供建议面板。
  seo: {
    enabled: true,
  },

  // 媒体存储 → Cloudflare R2（SHOULD，§7）。M5 启用；未配 R2_ACCESS_KEY_ID 时回退本地存储。
  ...(env('R2_ACCESS_KEY_ID', '')
    ? {
        upload: {
          config: {
            provider: 'aws-s3',
            providerOptions: {
              baseUrl: env('R2_PUBLIC_URL'), // 公网展示域（img.sibian.xyz，走 CF 代理 + 防盗链）
              s3Options: {
                credentials: {
                  accessKeyId: env('R2_ACCESS_KEY_ID'),
                  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
                },
                endpoint: env('R2_ENDPOINT'),
                region: 'auto',
                // R2 不支持 public-read ACL，必须显式 private（公网访问走自定义域）
                params: { Bucket: env('R2_BUCKET'), ACL: 'private' },
              },
            },
            actionOptions: { upload: {}, uploadStream: {}, delete: {} },
          },
        },
      }
    : {}),
});
