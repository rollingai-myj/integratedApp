/**
 * 商品详情弹窗 —— 展示商品图、规格、商品代码 + 条码图。
 * 用于诊断中/确认清单/上一次调改/历史调改记录里任何 SKU 列表行的点击。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { TOKENS } from '../ui/tokens';
import { I } from '../ui/icons';
import { hqApi } from '../api';

export interface SkuDetailLike {
  skuCode: string;
  productName?: string | null;
  spec?: string | null;
  brand?: string | null;
}

export function SkuDetailDialog({
  sku, onClose,
}: { sku: SkuDetailLike | null; onClose: () => void }) {
  const [imgErr, setImgErr] = useState(false);
  const [codeErr, setCodeErr] = useState(false);
  useEffect(() => { setImgErr(false); setCodeErr(false); }, [sku?.skuCode]);
  if (!sku) return null;

  const title = sku.productName || sku.skuCode;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 400 }}>
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', animation: 'shv-fadein 0.2s ease' }}
      />
      <div style={{
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(86%, 340px)', maxHeight: '86%', overflowY: 'auto',
        background: '#fff', borderRadius: 18, padding: 16,
        display: 'flex', flexDirection: 'column', gap: 12,
        boxShadow: '0 12px 36px rgba(0,0,0,0.28)',
        animation: 'shv-card-in 0.22s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: TOKENS.ink, lineHeight: 1.4, wordBreak: 'break-all' }}>{title}</div>
            {sku.spec && (
              <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 2 }}>{sku.spec}</div>
            )}
          </div>
          <button onClick={onClose} aria-label="关闭" style={{
            appearance: 'none', border: 0, background: 'transparent', cursor: 'pointer',
            padding: 4, marginTop: -2, flexShrink: 0,
          }}>{I.Close({ size: 20, color: TOKENS.inkMuted })}</button>
        </div>

        <div style={{
          borderRadius: 12, background: TOKENS.bg, height: 180, padding: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {imgErr ? (
            <div style={{ fontSize: 12, color: TOKENS.inkMuted }}>暂无商品图</div>
          ) : (
            <img
              src={hqApi.productImageUrl(sku.skuCode)}
              alt={title}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              onError={() => setImgErr(true)}
            />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
          <Row label="商品代码">{sku.skuCode}</Row>
          {sku.brand && <Row label="品牌">{sku.brand}</Row>}
          {sku.spec && <Row label="规格">{sku.spec}</Row>}
        </div>

        <div>
          <div style={{ fontSize: 11, color: TOKENS.inkMuted, fontWeight: 700, marginBottom: 6, letterSpacing: 1 }}>条码</div>
          <div style={{
            borderRadius: 10, background: '#fff', border: `1px solid ${TOKENS.line}`,
            padding: 10, minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {codeErr ? (
              <div style={{ fontSize: 12, color: TOKENS.inkMuted }}>暂无条码图</div>
            ) : (
              <img
                src={hqApi.productBarcodeUrl(sku.skuCode)}
                alt={`${sku.skuCode} 条码`}
                style={{ maxWidth: '100%', maxHeight: 90 }}
                onError={() => setCodeErr(true)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: TOKENS.inkMuted }}>{label}</span>
      <span style={{ color: TOKENS.ink, textAlign: 'right', wordBreak: 'break-all' }}>{children}</span>
    </div>
  );
}
