/**
 * 选品 · 上一次调改详情（含陈列示意图）
 *
 * 数据源：store_scene_state.last_snapshot（应用调改时由前端写入）+
 * 调改批次最新一条（详情）+ 虚拟陈列历史（最新一张）
 */
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AppBar, Card, GhostBtn, PhotoPlaceholder, ScreenWrap, Spin } from '../ui/primitives';
import { TOKENS } from '../ui/tokens';
import { I } from '../ui/icons';
import { scenesApi } from '../api';
import { emojiForScene, fmtDate, DEMO_DIAGNOSIS } from '../data';

export function LastPage() {
  const { scene: sceneStr } = useParams({ from: '/shelves/scene/$scene/last' });
  const scene = Number(sceneStr);
  const navigate = useNavigate();

  const rtQ = useQuery({ queryKey: ['scenes', scene, 'runtime'], queryFn: () => scenesApi.runtime(scene) });
  const adjQ = useQuery({ queryKey: ['scenes', scene, 'adjustments'], queryFn: () => scenesApi.listAdjustments(scene, 1) });
  const scenesQ = useQuery({ queryKey: ['scenes', 'list'], queryFn: scenesApi.list });
  const def = scenesQ.data?.scenes.find((s) => s.scene === scene);

  const adj = adjQ.data?.adjustments[0];
  const rt = rtQ.data;
  const virtualReady = rt?.virtualStatus === 'completed';

  if (!adj) {
    return (
      <ScreenWrap>
        <AppBar title="上一次调改" subtitle={`${emojiForScene(scene)} ${def?.name ?? ''}`} onBack={() => navigate({ to: '/shelves/scene/$scene', params: { scene: sceneStr } })} />
        <div style={{ padding: 32, textAlign: 'center', color: TOKENS.inkMuted }}>
          还没有调改记录
        </div>
      </ScreenWrap>
    );
  }

  const up = adj.items.filter((i) => i.action === 'add');
  const down = adj.items.filter((i) => i.action === 'remove');

  return (
    <ScreenWrap>
      <AppBar
        title="上一次调改"
        subtitle={`${def?.name ?? ''} · ${fmtDate(adj.triggeredAt)}`}
        onBack={() => navigate({ to: '/shelves/scene/$scene', params: { scene: sceneStr } })}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card pad={14} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, background: TOKENS.greenSoft, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{I.Check({ size: 20, color: TOKENS.green })}</div>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: TOKENS.ink }}>{adj.summaryText ?? '调改'}</div>
            <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 2 }}>{fmtDate(adj.triggeredAt)} 应用</div>
          </div>
        </Card>

        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, letterSpacing: 1, margin: '2px 2px 8px' }}>当时的货架照片</div>
          <PhotoPlaceholder seed={0} label="货架照片 1" h={140} />
        </div>

        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, letterSpacing: 1, margin: '2px 2px 8px' }}>当时的诊断结论</div>
          <Card pad={0} style={{ overflow: 'hidden' }}>
            {[
              { key: 'paragraph_customer', label: '客群分析' },
              { key: 'paragraph_competition', label: '竞争分析' },
              { key: 'paragraph_status', label: '货架现状' },
            ].map((s, i) => (
              <div key={s.key} style={{ padding: '12px 14px', borderTop: i > 0 ? `1px solid ${TOKENS.lineSoft}` : 'none' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: TOKENS.red, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 12.5, color: TOKENS.ink, lineHeight: 1.7 }}>{(DEMO_DIAGNOSIS as any)[s.key]}</div>
              </div>
            ))}
          </Card>
        </div>

        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, letterSpacing: 1, margin: '2px 2px 8px' }}>应用的调改清单</div>
          <Card pad={14}>
            {[
              { title: '上架', list: up,   color: TOKENS.green },
              { title: '停止进货', list: down, color: TOKENS.red },
            ].map((g, gi) => g.list.length > 0 && (
              <div key={g.title} style={{ marginTop: gi > 0 ? 12 : 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: g.color, marginBottom: 7 }}>{g.title}（{g.list.length}）</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {g.list.map((it, i) => (
                    <div key={i} style={{ fontSize: 13, color: TOKENS.ink }}>
                      {it.productName ?? it.skuCode}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        </div>

        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, letterSpacing: 1, margin: '2px 2px 8px' }}>调改后的陈列示意图</div>
          {!virtualReady ? (
            <Card pad={18} style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}><Spin size={30} /></div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: TOKENS.ink, marginTop: 12 }}>正在生成陈列示意图…</div>
              <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginTop: 5 }}>通常不到 1 分钟，生成好会直接显示在这里</div>
              <div style={{ marginTop: 14, height: 6, borderRadius: 3, background: TOKENS.bgWarm, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '40%', borderRadius: 3, background: TOKENS.red, animation: 'shv-progress 1.6s ease-in-out infinite' }} />
              </div>
            </Card>
          ) : (
            <Card pad={14}>
              <div style={{ fontSize: 13, color: TOKENS.inkSoft }}>陈列示意图已生成</div>
              <div style={{ marginTop: 10, color: TOKENS.inkMuted, fontSize: 11 }}>
                （详细可视化将在后续接 Dify 真实输出后展示）
              </div>
            </Card>
          )}
        </div>

        <GhostBtn onClick={() => navigate({ to: '/shelves/scene/$scene', params: { scene: sceneStr } })} style={{ marginTop: 8 }}>
          返回工作台
        </GhostBtn>
      </div>
    </ScreenWrap>
  );
}
