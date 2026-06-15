/**
 * 选品 · 基础信息
 *
 * 已登记货架（可重新登记）+ 周边环境（主要客群 / 周边竞争两段文字，落入
 * store_scene_state.env_*）
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppBar, Card, PrimaryBtn, ScreenWrap } from '../ui/primitives';
import { TOKENS } from '../ui/tokens';
import { I } from '../ui/icons';
import { scenesApi } from '../api';
import { emojiForScene } from '../data';

export function InfoPage() {
  const { scene: sceneStr } = useParams({ from: '/shelves/scene/$scene/info' });
  const scene = Number(sceneStr);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const scenesQ = useQuery({ queryKey: ['scenes', 'list'], queryFn: scenesApi.list });
  const def = scenesQ.data?.scenes.find((s) => s.scene === scene);
  const shelvesQ = useQuery({ queryKey: ['scenes', scene, 'shelves'], queryFn: () => scenesApi.listShelves(scene) });
  const runtimeQ = useQuery({ queryKey: ['scenes', scene, 'runtime'], queryFn: () => scenesApi.runtime(scene) });

  const [crowd, setCrowd] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    if (!synced && runtimeQ.isSuccess) {
      setCrowd(runtimeQ.data?.envCrowd ?? '');
      setCompetitor(runtimeQ.data?.envCompetitor ?? '');
      setSynced(true);
    }
  }, [runtimeQ.isSuccess, runtimeQ.data, synced]);

  const save = useMutation({
    mutationFn: () => scenesApi.saveRuntime(scene, { envCrowd: crowd || null, envCompetitor: competitor || null } as any),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scenes', scene, 'runtime'] });
    },
  });

  const groups = shelvesQ.data?.groups ?? [];

  const taStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', minHeight: 74, resize: 'vertical',
    border: `1.5px solid ${TOKENS.line}`, borderRadius: 12, padding: '10px 12px',
    fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.6, color: TOKENS.ink,
    background: '#fff', outline: 'none',
  };

  return (
    <ScreenWrap>
      <AppBar title="基础信息" subtitle={`${emojiForScene(scene)} ${def?.name ?? ''}`}
        onBack={() => navigate({ to: '/shelves/scene/$scene', params: { scene: sceneStr } })} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card pad={14}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: TOKENS.ink }}>已登记的货架</span>
            <button onClick={() => navigate({ to: '/shelves/scene/$scene/setup', params: { scene: sceneStr } })} style={{
              appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer',
              fontSize: 12.5, color: TOKENS.red, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 2,
            }}>重新登记 {I.ChevronR({ size: 13, color: TOKENS.red })}</button>
          </div>
          {groups.length === 0 ? (
            <div style={{ fontSize: 12, color: TOKENS.inkMuted, padding: '8px 0' }}>尚未登记</div>
          ) : groups.map((g, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
              borderTop: i > 0 ? `1px solid ${TOKENS.lineSoft}` : 'none',
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10, background: TOKENS.redSoft, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{I.Shelf({ size: 17, color: TOKENS.red })}</div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: TOKENS.ink }}>{g.shelfType ?? '标准货架'}</div>
                <div style={{ fontSize: 11.5, color: TOKENS.inkMuted }}>{g.widthCm ?? '—'}cm · {g.layerCount ?? '—'}层</div>
              </div>
            </div>
          ))}
        </Card>

        <Card pad={14}>
          <div style={{ fontSize: 14, fontWeight: 800, color: TOKENS.ink, marginBottom: 4 }}>周边环境</div>
          <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginBottom: 12, lineHeight: 1.5 }}>
            写一写门店周边的客人和竞争对手，AI 诊断会参考这些信息（选填）
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: TOKENS.inkSoft, marginBottom: 6 }}>主要客群</div>
          <textarea value={crowd} onChange={(e) => setCrowd(e.target.value)} style={taStyle}
            placeholder="例如：写字楼上班族为主，下午和晚上人多" />
          <div style={{ fontSize: 12.5, fontWeight: 700, color: TOKENS.inkSoft, margin: '12px 0 6px' }}>周边竞争</div>
          <textarea value={competitor} onChange={(e) => setCompetitor(e.target.value)} style={taStyle}
            placeholder="例如：隔壁有一家零食量贩店，散糖卖得便宜" />
          <div style={{ marginTop: 14 }}>
            <PrimaryBtn onClick={() => save.mutate()} disabled={save.isPending}
              style={{ height: 46, fontSize: 15 }}>
              {save.isPending ? '保存中…' : save.isSuccess ? '已保存 ✓' : '保存'}
            </PrimaryBtn>
          </div>
        </Card>
      </div>
    </ScreenWrap>
  );
}
