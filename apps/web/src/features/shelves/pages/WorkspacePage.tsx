/**
 * 选品 · 场景工作台
 *
 * 已登记/未登记两种状态：
 *  - 未登记：引导卡 → 跳登记货架向导
 *  - 已登记：拍照大按钮 + 数据三格 + 上次调改卡（如有）+ 调改追踪 + 经营提示
 *
 * 已登记但未"聊一聊"：点拍照前先去聊一聊（仅一次）。
 */
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AppBar, Card, Chip, PrimaryBtn, ListRow, ScreenWrap } from '../ui/primitives';
import { TOKENS } from '../ui/tokens';
import { I } from '../ui/icons';
import { scenesApi } from '../api';
import { emojiForScene, fmtDate } from '../data';

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

  const def = scenesQ.data?.scenes.find((s) => s.scene === scene);
  const ov = ovQ.data?.scenes.find((s) => s.scene === scene);
  const rt = runtimeQ.data;

  const goBack = () => void navigate({ to: '/shelves' });
  const goSetup = () => void navigate({ to: '/shelves/scene/$scene/setup', params: { scene: sceneStr } });
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
        {!ov?.shelfConfigured && (
          <>
            <Card pad={18} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 10 }}>{emojiForScene(scene)}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: TOKENS.ink }}>先花 1 分钟登记货架</div>
              <div style={{ fontSize: 13, color: TOKENS.inkSoft, marginTop: 6, lineHeight: 1.6 }}>
                告诉我们这个场景有几组什么样的货架，<br />AI 才能给出准确的选品调改建议。<br />只需登记一次。
              </div>
              <div style={{ marginTop: 16 }}>
                <PrimaryBtn onClick={goSetup} icon={I.Shelf({ size: 20, color: '#fff' })}>登记货架</PrimaryBtn>
              </div>
            </Card>

            <Card pad={14}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, marginBottom: 10, letterSpacing: 1 }}>之后的流程</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { n: '1', t: '登记货架', d: '选类型和大小，只做一次' },
                  { n: '2', t: '聊一聊', d: '回答几个问题，也只做一次' },
                  { n: '3', t: '拍照调改', d: 'AI 诊断给方案，以后每次只需这步' },
                ].map((s) => (
                  <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', background: TOKENS.redSoft, color: TOKENS.red,
                      fontSize: 12.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>{s.n}</div>
                    <div>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: TOKENS.ink }}>{s.t}</span>
                      <span style={{ fontSize: 12, color: TOKENS.inkMuted, marginLeft: 8 }}>{s.d}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
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

        {ov?.shelfConfigured && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { label: '已调改', value: String(ov.adjustmentCount), unit: '次' },
              {
                label: '上次效果',
                value: ov.lastSalesDeltaPercent != null ? `${ov.lastSalesDeltaPercent >= 0 ? '+' : ''}${ov.lastSalesDeltaPercent}%` : '—',
                unit: ov.lastSalesDeltaPercent != null ? '销售额' : '',
                color: ov.lastSalesDeltaPercent != null
                  ? (ov.lastSalesDeltaPercent >= 0 ? TOKENS.green : TOKENS.red)
                  : TOKENS.inkMuted,
              },
              { label: '场景状态', value: ov.qaDone ? '已就绪' : '待聊一聊', unit: '' },
            ].map((t) => (
              <div key={t.label} style={{
                background: '#fff', borderRadius: 14, padding: '12px 6px 11px', textAlign: 'center',
                boxShadow: TOKENS.shadow1,
              }}>
                <div style={{ fontSize: 10.5, color: TOKENS.inkMuted, fontWeight: 700 }}>{t.label}</div>
                <div style={{ fontSize: t.value.length > 4 ? 14 : 20, fontWeight: 800, color: t.color || TOKENS.ink, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                  {t.value}
                  {t.unit && <span style={{ fontSize: 10.5, fontWeight: 600, color: TOKENS.inkMuted, marginLeft: 2 }}>{t.unit}</span>}
                </div>
              </div>
            ))}
          </div>
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
