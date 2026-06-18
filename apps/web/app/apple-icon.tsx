import { ImageResponse } from 'next/og';

// iOS 添加到主屏的图标（180×180 PNG，运行时由 Next 生成，免外部工具）。
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  const seed = {
    position: 'absolute' as const,
    width: 11,
    height: 15,
    borderRadius: 8,
    background: '#c1272d',
  };
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#c1272d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* 西瓜切片：白色半圆（平顶圆底）+ 红色瓜子 */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            width: 120,
            height: 60,
            background: '#ffffff',
            borderTopLeftRadius: 0,
            borderTopRightRadius: 0,
            borderBottomLeftRadius: 60,
            borderBottomRightRadius: 60,
          }}
        >
          <div style={{ ...seed, left: 27, top: 14 }} />
          <div style={{ ...seed, left: 54, top: 23 }} />
          <div style={{ ...seed, left: 81, top: 14 }} />
        </div>
      </div>
    ),
    { ...size },
  );
}
