import Script from 'next/script';

/**
 * 站点分析：
 * - GA4（gtag.js）：ID 由 NEXT_PUBLIC_GA_ID 驱动；未配置则不注入。
 * - Yandex.Metrica（§4 SHOULD：对 Yandex 收录/排名有正反馈）：
 *   计数器 ID 由 Global.yandexMetricaId 驱动；未配置则不注入。
 * 注意：新增第三方脚本域名需同步 nginx CSP（script-src/connect-src）。
 */
export function Analytics({ metricaId, gaId }: { metricaId?: string | null; gaId?: string | null }) {
  if (!metricaId && !gaId) return null;
  return (
    <>
      {gaId ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaId}');`}
          </Script>
        </>
      ) : null}
      {/* Metrica：afterInteractive 让代码进 HTML 源码，Metrica 安装检测才能通过（lazyOnload 检测不到） */}
      {metricaId ? (
      <Script id="yandex-metrica" strategy="afterInteractive">
        {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
(window,document,"script","https://mc.yandex.ru/metrika/tag.js?id=${metricaId}","ym");
ym(${metricaId},"init",{ssr:true,webvisor:true,clickmap:true,referrer:document.referrer,url:location.href,accurateTrackBounce:true,trackLinks:true});`}
      </Script>
      ) : null}
      {metricaId ? (
      <noscript>
        <div>
          <img
            src={`https://mc.yandex.ru/watch/${metricaId}`}
            style={{ position: 'absolute', left: '-9999px' }}
            alt=""
          />
        </div>
      </noscript>
      ) : null}
    </>
  );
}
