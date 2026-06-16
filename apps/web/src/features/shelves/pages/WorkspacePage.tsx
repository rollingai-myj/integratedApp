/**
 * 选品 · 场景工作台
 *
 * 已登记/未登记两种状态：
 *  - 未登记：自动跳登记货架向导（不再展示中间引导卡）
 *  - 已登记：拍照大按钮 + 数据三格 + 上次调改卡（如有）+ 调改追踪 + 经营提示
 *
 * 已登记但未"聊一聊"：点拍照前先去聊一聊（仅一次）。
 */
import { useEffect } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AppBar, Card, Chip, PrimaryBtn, ListRow, ScreenWrap } from '../ui/primitives';
import { TOKENS } from '../ui/tokens';
import { I } from '../ui/icons';
import { scenesApi, storeApi } from '../api';
import { emojiForScene, fmtDate } from '../data';

const fmtBigYuan = (n: number) =>
  n >= 10_000 ? `¥${(n / 10_000).toFixed(1)}万` : `¥${Math.round(n).toLocaleString('zh-CN')}`;
const fmtBigCount = (n: number) =>
  n >= 10_000 ? `${(n / 10_000).toFixed(1)}万` : `${Math.round(n).toLocaleString('zh-CN')}`;

export function WorkspacePage() {
  const { scene: sceneStr } = useParams({ from: '/shelves/scene/$scene/' });
  const scene = Number(sceneStr);
  const navigate = useNavigate();

  const scenesQ = useQuery({ queryKey: ['scenes', 'list'], queryFn: scenesApi.list });
  const ovQ = useQuery({ queryKey: ['scenes', 'overview'], queryFn: scenesApi.overview });
  const runtimeQ = useQuery({
    queryKey: ['scenes', scene, 'runtime'],
    queryFn: () => scenesApi.runtime(scene),
  });
  const skusQ = useQuery({
    queryKey: ['store', 'skus', 'scene', scene],
    queryFn: () => storeApi.skus(scene),
  });

  const def = scenesQ.data?.scenes.find((s) => s.scene === scene);
  const ov = ovQ.data?.scenes.find((s) => s.scene === scene);
  const rt = runtimeQ.data;

  const totals = (skusQ.data?.skus ?? []).reduce(
    (acc, s) => {
      acc.amount += s.salesAmount30d ?? 0;
      acc.qty += s.salesQty30d ?? 0;
      acc.margin += s.grossMargin30d ?? 0;
      return acc;
    },
    { amount: 0, qty: 0, margin: 0 },
  );

  // 未登记货架 → 直接进入登记向导，省掉中间引导卡
  useEffect(() => {
    if (ovQ.isSuccess && ov && !ov.shelfConfigured) {
      void navigate({ to: '/shelves/scene/$scene/setup', params: { scene: sceneStr }, replace: true });
    }
  }, [ovQ.isSuccess, ov, sceneStr, navigate]);

  const goBack = () => void navigate({ to: '/shelves' });
  const goInfo = () => void navigate({ to: '/shelves/scene/$scene/info', params: { scene: sceneStr } });
  const goRecords = () => void navigate({ to: '/shelves/scene/$scene/records', params: { scene: sceneStr } });
  const goLast = () => void navigate({ to: '/shelves/scene/$scene/last', params: { scene: sceneStr } });
  const goQA = () => void navigate({ to: '/shelves/scene/$scene/qa', params: { scene: sceneStr } });
  const goFlow = () =>
    void navigate({ to: '/shelves/scene/$scene/flow', params: { scene: sceneStr } });

  const startFlow = () => {
    if (!ov?.qaDone) goQA();
    else goFlow();
  };

  const lastSnap = rt?.lastSnapshot as null | {
    at: string; summary: string;
    items: Array<{ skuName: string; kind: 'add' | 'remove' }>;
  };
  const lastUp = lastSnap?.items.filter((i) => i.kind === 'add').length ?? 0;
  const lastDown = lastSnap?.items.filter((i) => i.kind === 'remove').length ?? 0;

  return (
    <ScreenWrap>
      <AppBar
        title={`${emojiForScene(scene)} ${def?.name ?? `场景 ${scene}`}`}
        onBack={goBack}
        right={ov?.shelfConfigured ? (
          <button onClick={goInfo} aria-label="基础信息" style={{
            appearance: 'none', border: 0, background: 'rgba(255,255,255,0.16)', cursor: 'pointer',
            width: 36, height: 36, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{I.Gear({ size: 19, color: '#fff' })}</button>
        ) : null}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ov?.shelfConfigured && (
          <Card pad={18} style={{ borderRadius: 20 }}>
            <div style={{
              fontSize: 11.5, fontWeight: 800, color: TOKENS.inkMuted,
              letterSpacing: 1, marginBottom: 14,
            }}>近 30 日{def?.name ? ` · ${def.name}` : ''} · 经营概览</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'end' }}>
              {[
                { label: '总月销额', value: fmtBigYuan(totals.amount), color: TOKENS.red },
                { label: '月销件数', value: fmtBigCount(totals.qty), color: TOKENS.ink },
                { label: '月毛利', value: fmtBigYuan(totals.margin), color: TOKENS.green },
              ].map((m, idx) => (
                <div key={m.label} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
                  borderLeft: idx > 0 ? `1px solid ${TOKENS.lineSoft}` : 'none',
                  padding: '4px 6px',
                }}>
                  <div style={{ fontSize: 11, color: TOKENS.inkMuted, fontWeight: 700, marginBottom: 6 }}>{m.label}</div>
                  <div style={{
                    fontSize: skusQ.isLoading ? 18 : (m.value.length > 6 ? 18 : 22),
                    fontWeight: 800, color: m.color, fontVariantNumeric: 'tabular-nums',
                  }}>
                    {skusQ.isLoading ? '—' : m.value}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {ov?.shelfConfigured && ov.hasDraft && (
          <Card pad={14} style={{ border: `2px solid ${TOKENS.orange}`, boxShadow: '0 4px 14px rgba(255,140,26,0.18)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, background: TOKENS.orangeSoft, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{I.Clock({ size: 20, color: '#cf7000' })}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: TOKENS.ink }}>有一次未完成的调改</div>
                <div style={{ fontSize: 12, color: TOKENS.inkSoft, marginTop: 2 }}>进度已自动保存</div>
              </div>
            </div>
            <PrimaryBtn onClick={goFlow} style={{ height: 48 }}>继续调改</PrimaryBtn>
          </Card>
        )}

        {ov?.shelfConfigured && !ov.hasDraft && (
          <button onClick={startFlow} style={{
            appearance: 'none', border: 0, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
            borderRadius: 20, padding: '22px 18px', position: 'relative', overflow: 'hidden',
            background: `linear-gradient(150deg, ${TOKENS.red}, ${TOKENS.redDark})`,
            color: '#fff', boxShadow: `0 10px 26px ${TOKENS.red}40`,
          }}>
            <div style={{ position: 'absolute', top: -50, right: -36, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.09)' }} />
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 58, height: 58, borderRadius: 18, flexShrink: 0,
                background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{I.Camera({ size: 30, color: '#fff' })}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: 0.5 }}>拍照开始调改</div>
                <div style={{ fontSize: 12, opacity: 0.92, marginTop: 4, lineHeight: 1.5 }}>
                  {ov.qaDone ? '拍照 → AI 诊断 → 确认方案' : '先聊几句货架情况，再拍照诊断'}
                </div>
              </div>
              <div style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
              }}>{I.ArrowR({ size: 18, color: TOKENS.red })}</div>
            </div>
            <div style={{
              position: 'relative', marginTop: 16, paddingTop: 12,
              borderTop: '1px solid rgba(255,255,255,0.18)',
              fontSize: 11.5, opacity: 0.88, display: 'flex', alignItems: 'center', gap: 5,
            }}>{I.Clock({ size: 13, color: '#fff' })} 全程约 3 分钟，进度自动保存，随时可退出</div>
          </button>
        )}

        {lastSnap && (
          <Card pad={14} onClick={goLast}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, background: TOKENS.greenSoft, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{I.Check({ size: 20, color: TOKENS.green })}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: TOKENS.ink }}>上一次调改</div>
                <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 2 }}>{lastSnap.at ? fmtDate(lastSnap.at) : ''}</div>
              </div>
              {I.ChevronR({ size: 16, color: TOKENS.inkMuted })}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 11 }}>
              {lastUp > 0 && <Chip tone="green" style={{ fontSize: 11.5, padding: '4px 9px' }}>上架 {lastUp} 个品</Chip>}
              {lastDown > 0 && <Chip tone="red" style={{ fontSize: 11.5, padding: '4px 9px' }}>停止进货 {lastDown} 个品</Chip>}
              {rt?.virtualStatus === 'completed' && <Chip tone="gray" style={{ fontSize: 11.5, padding: '4px 9px' }}>含陈列示意图</Chip>}
              {rt?.virtualStatus === 'processing' && <Chip tone="amber" style={{ fontSize: 11.5, padding: '4px 9px' }}>陈列图生成中…</Chip>}
            </div>
          </Card>
        )}

        {ov?.shelfConfigured && (
          <ListRow
            icon={I.History({ size: 20, color: TOKENS.red })}
            label="调改效果追踪"
            hint={ov.adjustmentCount > 0 ? `${ov.adjustmentCount} 次调改 · 看销量变化` : '完成调改后这里会显示效果'}
            badge={ov.lastSalesDeltaPercent != null
              ? <Chip tone={ov.lastSalesDeltaPercent >= 0 ? 'green' : 'red'}>{`上次 ${ov.lastSalesDeltaPercent >= 0 ? '+' : ''}${ov.lastSalesDeltaPercent}%`}</Chip>
              : undefined}
            onClick={goRecords}
          />
        )}

        {ov?.shelfConfigured && (
          <Card pad={13} style={{ background: TOKENS.bgWarm, boxShadow: 'none', marginTop: 2 }}>
            <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 16, lineHeight: 1.3 }}>💡</span>
              <div style={{ fontSize: 12, color: TOKENS.inkSoft, lineHeight: 1.65 }}>
                建议每 4–6 周做一次调改；新品上架两周后，记得回来看「调改效果追踪」里的销量变化。
              </div>
            </div>
          </Card>
        )}
      </div>
    </ScreenWrap>
  );
}
