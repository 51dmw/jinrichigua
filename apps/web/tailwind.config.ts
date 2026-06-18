import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  // 广告位响应式可见性（来自 lib/adFormats）——确保动态拼接的类一定被生成。
  safelist: ['hidden', 'lg:block', 'lg:hidden'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#c1272d', // 资讯门户常见的红色主色（移动版版式参考）
          dark: '#a01f24',
        },
      },
      // 简体中文系统字体栈：覆盖 iOS/macOS/Windows/Android/Linux，
      // 全部用系统自带字体 → 零 Web 字体下载（性能最佳，无 FOUT/FOIT）。
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"PingFang SC"', // iOS / macOS
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"', // Windows 微软雅黑
          '"Noto Sans CJK SC"', // Android / Linux
          '"Source Han Sans SC"',
          '"WenQuanYi Micro Hei"',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      maxWidth: {
        screen: '640px', // 移动优先：内容主列宽
      },
    },
  },
  plugins: [],
};

export default config;
