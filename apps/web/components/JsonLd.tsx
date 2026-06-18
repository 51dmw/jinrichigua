/**
 * 注入 JSON-LD（§4）。服务端渲染为 <script type="application/ld+json">。
 */
export function JsonLd({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return null;
  return (
    <script
      type="application/ld+json"
      // 内容来自后台/可控数据，序列化时转义 < 防止脚本截断
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}
