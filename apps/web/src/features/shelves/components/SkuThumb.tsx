/**
 * 商品官方图缩略图（取自后端 /hq/products/:skuCode/official-image 302 → OSS）。
 * 加载失败时退化为带 SKU 末 4 位的占位块。
 */
import { useState } from 'react';
import { TOKENS } from '../ui/tokens';
import { hqApi } from '../api';

export function SkuThumb({ skuCode, size }: { skuCode: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div style={{
        width: size, height: size, borderRadius: Math.round(size / 4), flexShrink: 0,
        background: 'repeating-linear-gradient(135deg, #efe9df 0 8px, #f6f2ec 8px 16px)',
        border: `1px solid ${TOKENS.line}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: Math.max(8, size / 8), color: TOKENS.inkMuted, letterSpacing: 0.5,
        }}>{skuCode.slice(-4)}</span>
      </div>
    );
  }
  return (
    <img
      src={hqApi.productImageUrl(skuCode)}
      alt={skuCode}
      onError={() => setFailed(true)}
      style={{
        width: size, height: size, borderRadius: Math.round(size / 4),
        // 商品官方图大多 1:1 大边距设计，cover 会裁掉瓶身两端
        objectFit: 'contain', background: '#fafafa', flexShrink: 0,
        border: `1px solid ${TOKENS.line}`,
        padding: Math.round(size / 24),
      }}
    />
  );
}
