import Script from 'next/script';

/**
 * Yandex.Metrica（§4 SHOULD：对 Yandex 收录/排名有正反馈）。
 * 计数器 ID 由 Global.yandexMetricaId 驱动；未配置则不注入。
 */
export function Analytics({ metricaId }: { metricaId?: string | null }) {
  if (!metricaId) return null;
  return (
    <>
      <Script id="yandex-metrica" strategy="lazyOnload">
        {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");
ym(${metricaId},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true});`}
      </Script>
      <noscript>
        <div>
          <img
            src={`https://mc.yandex.ru/watch/${metricaId}`}
            style={{ position: 'absolute', left: '-9999px' }}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}
