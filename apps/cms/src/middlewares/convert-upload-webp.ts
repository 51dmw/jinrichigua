/**
 * 上传图片自动转 WebP（落盘前）。
 *
 * 在 strapi::body 解析 multipart 之后、upload 控制器之前拦截：
 * 把 JPEG/PNG/TIFF/BMP 用 sharp 转成 WebP（质量 80）+ 限制最大宽度 1920，
 * 直接覆写临时文件并改写元信息（名/类型/大小）。
 *
 * 收益：存进媒体库的原文件即为小体积 WebP——省服务器磁盘、省 Cloudflare Images
 * 转换费、并在前端图片优化未接通时也能直出 WebP。
 *
 * 跳过：SVG（矢量勿栅格化）、GIF（保留动图）、已是 WebP/AVIF。
 * 转换失败只告警、保留原图，绝不阻断上传。
 */
import sharp from 'sharp';
import { promises as fs } from 'fs';

const MAX_WIDTH = 1920; // 网页展示足够；更大无意义
const QUALITY = 80; // WebP 质量（体积/画质平衡点）
const CONVERT_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/tiff',
  'image/bmp',
]);

const stripExt = (name: string) => name.replace(/\.[^./\\]+$/, '');

async function toWebp(file: any, strapi: any): Promise<void> {
  const src = file.filepath ?? file.path; // 兼容 formidable v3 / 旧字段
  if (!src) return;
  try {
    const buf = await sharp(src)
      .rotate() // 按 EXIF 自动转正
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();
    await fs.writeFile(src, buf); // 覆写同一临时文件（复用 body 中间件的清理）

    const base = stripExt(file.originalFilename ?? file.name ?? 'image');
    file.originalFilename = `${base}.webp`;
    if (file.name) file.name = `${base}.webp`;
    file.mimetype = 'image/webp';
    if (file.type) file.type = 'image/webp';
    file.size = buf.length;
    if (file.newFilename) file.newFilename = `${stripExt(file.newFilename)}.webp`;
  } catch (e) {
    strapi.log.warn(`[webp-upload] 转换失败，保留原图：${(e as Error).message}`);
  }
}

export default (_config: unknown, { strapi }: { strapi: any }) => {
  return async (ctx: any, next: any) => {
    const isUpload =
      ctx.request?.method === 'POST' && /\/upload\/?$/.test(ctx.request?.path ?? '');
    const filesField = ctx.request?.files?.files;
    if (isUpload && filesField) {
      const files = Array.isArray(filesField) ? filesField : [filesField];
      for (const f of files) {
        const mime = (f?.mimetype ?? f?.type ?? '').toLowerCase();
        if (CONVERT_MIME.has(mime)) {
          await toWebp(f, strapi);
        }
      }
    }
    await next();
  };
};
