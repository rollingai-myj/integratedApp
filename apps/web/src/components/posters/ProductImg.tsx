import * as React from 'react';

export function productImageUrl(sku: string, displaySize?: number) {
  // 走后端 302 重定向：后端按 SKU_IMAGE_BASE/{paddedSkuCode}.png 拼接到 OSS。
  // 走后端的好处：图片基址改动不需要前端发版；nginx 层有缓存，间歇性 OSS 抖动也能被吸收。
  const base = `/api/v1/hq/products/${encodeURIComponent(sku)}/official-image`;
  if (!displaySize) return base;
  const w = Math.round(displaySize * 2);
  // OSS 图片处理参数透传给后端 → 重定向时会拼接到目标 URL 上
  return `${base}?w=${w}`;
}

export function ProductImg({
  sku,
  size,
  radius = 10,
  fallbackSkus,
}: {
  sku: string;
  size: number;
  radius?: number;
  fallbackSkus?: string[];
}) {
  const candidates = React.useMemo(
    () => [sku, ...(fallbackSkus ?? [])].filter(Boolean),
    [sku, fallbackSkus],
  );
  const key = candidates.join('|');
  const [idx, setIdx] = React.useState(0);
  const [status, setStatus] = React.useState<'loading' | 'ok' | 'error'>('loading');

  React.useEffect(() => {
    setIdx(0);
    setStatus('loading');
  }, [key]);

  if (status === 'error') {
    return (
      <div style={{
        width: size, height: size, borderRadius: radius, background: '#f0f0f3',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#bbb', fontSize: 10, flexShrink: 0,
      }}>无图</div>
    );
  }

  const current = candidates[idx] ?? sku;
  return (
    <div style={{
      position: 'relative', width: size, height: size, borderRadius: radius,
      overflow: 'hidden', flexShrink: 0, background: '#f0f0f3',
    }}>
      {status === 'loading' && (
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(90deg, #ececf0 0%, #f6f6f8 50%, #ececf0 100%)',
            backgroundSize: '200% 100%',
            animation: 'productImgShimmer 1.2s ease-in-out infinite',
          }}
        />
      )}
      <img
        key={current}
        src={productImageUrl(current, size)}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setStatus('ok')}
        onError={() => {
          if (idx + 1 < candidates.length) {
            setIdx(idx + 1);
            setStatus('loading');
          } else {
            console.warn('[product-img] missing', current);
            setStatus('error');
          }
        }}
        style={{
          display: 'block',
          width: '100%', height: '100%',
          objectFit: 'contain', background: '#fafafa',
          opacity: status === 'ok' ? 1 : 0,
          transition: 'opacity 0.25s ease-out',
        }}
      />
      <style>{`@keyframes productImgShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </div>
  );
}
