// PM2 进程配置（§7：进程用 PM2 或 Docker，开机自启）。
// 用法：
//   cd apps/cms && pnpm build
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup     # 开机自启
module.exports = {
  apps: [
    {
      name: 'newsportal-cms',
      cwd: __dirname,
      script: 'node_modules/@strapi/strapi/bin/strapi.js',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        // 实际机密放 apps/cms/.env（dotenv 自动加载），勿写在此
      },
      max_memory_restart: '1G',
      autorestart: true,
      watch: false,
      out_file: '/var/log/newsportal/cms-out.log',
      error_file: '/var/log/newsportal/cms-err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
