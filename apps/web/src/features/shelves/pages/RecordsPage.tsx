/**
 * 选品 · 调改效果追踪
 *
 * 列出该场景的全部调改记录（来自 store_scene_adjustments），展示摘要 + 时间
 * + 销量变化角标（暂未在后端附加：留 stub，UI 显示"数据积累中"）。
 */
import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AppBar, Card, Chip, ScreenWrap } from '../ui/primitives';
import { TOKENS } from '../ui/tokens';
import { I } from '../ui/icons';
import { scenesApi } from '../api';
import { emojiForScene, fmtDate } from '../data';

export function RecordsPage() {
  const { scene: sceneStr } = useParams({ from: '/shelves/scene/$scene/records' });
  const scene = Number(sceneStr);
  const navigate = useNavigate();

  const listQ = useQuery({
    queryKey: ['scenes', scene, 'adjustments'],
    queryFn: () => scenesApi.listAdjustments(scene),
  });
  const scenesQ = useQuery({ queryKey: ['scenes', 'list'], queryFn: scenesApi.list });
  const def = scenesQ.data?.scenes.find((s) => s.scene === scene);

  const [openId, setOpenId] = useState<string | null>(null);
  const records = listQ.data?.adjustments ?? [];

  const goBack = () => void navigate({ to: '/shelves/scene/$scene', params: { scene: sceneStr } });

  return (
    <ScreenWrap>
      <AppBar title="调改效果追踪" subtitle={`${emojiForScene(scene)} ${def?.name ?? ''}`} onBack={goBack} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {records.length === 0 ? (
          <div style={{
            border: `1.5px dashed ${TOKENS.line}`, borderRadius: 14,
            padding: '40px 16px', textAlign: 'center', color: TOKENS.inkMuted, fontSize: 13, lineHeight: 1.7,
          }}>
            还没有调改记录。<br />完成第一次调改后，这里会显示每次调改和之后的销量变化。
          </div>
        ) : records.map((rec) => {
          const open = openId === rec.id;
          const up = rec.items.filter((i) => i.action === 'add');
          const down = rec.items.filter((i) => i.action === 'remove');
          return (
            <Card key={rec.id} pad={0} style={{ overflow: 'hidden' }}>
              <button onClick={() => setOpenId(open ? null : rec.id)} style={{
                appearance: 'none', border: 0, background: 'transparent', width: '100%', textAlign: 'left',
                padding: 14, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: TOKENS.ink }}>{rec.summaryText ?? '调改'}</div>
                  <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 3 }}>{fmtDate(rec.triggeredAt)}</div>
                </div>
                <Chip tone="gray">数据积累中</Chip>
                {I.ChevronD({ size: 16, color: TOKENS.inkMuted })}
              </button>
              {open && (
                <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${TOKENS.lineSoft}` }}>
                  {[
                    { title: '上架', list: up,   color: TOKENS.green },
                    { title: '停止进货', list: down, color: TOKENS.red },
                  ].map((g) => g.list.length > 0 && (
                    <div key={g.title} style={{ marginTop: 10 }}>
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
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </ScreenWrap>
  );
}
