/**
 * 选品 · 场景列表
 *
 * 视觉对齐 prices/index：双列、emoji + 场景名 + "X 个商品"小字、未启用灰显「敬请期待」。
 * 上方"继续调改"高亮卡保留作为快速入口。
 */
import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMe } from '@/lib/auth';
import { AppBar, Card, ScreenWrap } from '../ui/primitives';
import { TOKENS } from '../ui/tokens';
import { I } from '../ui/icons';
import { scenesApi, storeApi } from '../api';
import { emojiForScene } from '../data';

/**
 * 当前阶段仅"面包架【烘焙】"(scene=2) 与 "冷藏"(scene=12) 有完整商品主数据；
 * 其余 11 个场景待总部主数据补齐后再逐个开放。
 * 与后端 ai-shelves.service.ts 的 ENABLED_SCENES 保持一致。
 */
const ENABLED_SCENES = new Set<number>([2, 12]);

export function HomePage() {
  const navigate = useNavigate();
  const me = useMe();
  const scenesQ = useQuery({ queryKey: ['scenes', 'list'], queryFn: scenesApi.list });
  const ovQ = useQuery({ queryKey: ['scenes', 'overview'], queryFn: scenesApi.overview });
  // 全店 SKU 一次性拉，前端按 scene 分组算"X 个商品"
  const skusQ = useQuery({ queryKey: ['store', 'skus', 'all'], queryFn: () => storeApi.skus() });

  const scenes = scenesQ.data?.scenes ?? [];
  const ovMap = new Map(ovQ.data?.scenes.map((o) => [o.scene, o]) ?? []);
  const sceneSkuCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of skusQ.data?.skus ?? []) {
      if (s.scene != null) m.set(s.scene, (m.get(s.scene) ?? 0) + 1);
    }
    return m;
  }, [skusQ.data]);

  // 选 draft 最新的那一条；没 draftUpdatedAt 的兜底排到最后
  const draft = (ovQ.data?.scenes ?? [])
    .filter((o) => o.hasDraft)
    .slice()
    .sort((a, b) => {
      const ta = a.draftUpdatedAt ? Date.parse(a.draftUpdatedAt) : 0;
      const tb = b.draftUpdatedAt ? Date.parse(b.draftUpdatedAt) : 0;
      return tb - ta;
    })[0];
  const draftSceneName = scenes.find((s) => s.scene === draft?.scene)?.name;

  const goWorkspace = (scene: number) => {
    void navigate({ to: '/shelves/scene/$scene', params: { scene: String(scene) } });
  };

  return (
    <ScreenWrap>
      <AppBar
        title="货盘选品"
        subtitle={`${me.data?.currentStore?.code ?? ''} · ${me.data?.currentStore?.name ?? ''}`}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 28px' }}>
        {draft && draftSceneName && (
          <Card
            onClick={() => goWorkspace(draft.scene)}
            pad={14}
            style={{
              marginBottom: 16, border: `2px solid ${TOKENS.orange}`,
              display: 'flex', alignItems: 'center', gap: 12,
              boxShadow: '0 4px 14px rgba(255,140,26,0.18)',
            }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 13, background: TOKENS.orangeSoft, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            }}>{emojiForScene(draft.scene)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: TOKENS.ink }}>
                继续「{draftSceneName}」的调改
              </div>
              <div style={{ fontSize: 12, color: TOKENS.inkSoft, marginTop: 2 }}>
                进度已自动保存，点击继续
              </div>
            </div>
            {I.ChevronR({ size: 16, color: TOKENS.orange })}
          </Card>
        )}

        <div style={{ fontSize: 17, fontWeight: 800, color: TOKENS.ink, marginBottom: 14 }}>请选择场景</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {scenes.map((s) => {
            const enabled = ENABLED_SCENES.has(s.scene);
            const ov = enabled ? ovMap.get(s.scene) : undefined;
            const skuN = sceneSkuCount.get(s.scene) ?? 0;
            return (
              <Card
                key={s.scene}
                onClick={enabled ? () => goWorkspace(s.scene) : undefined}
                pad={14}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 0, minHeight: 108,
                  border: enabled && ov?.hasDraft ? `2px solid ${TOKENS.orange}` : '2px solid transparent',
                  opacity: enabled ? 1 : 0.4,
                  cursor: enabled ? 'pointer' : 'not-allowed',
                }}
              >
                <div style={{ fontSize: 30, lineHeight: 1 }}>{emojiForScene(s.scene)}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: TOKENS.ink, marginTop: 12 }}>
                  {s.name}
                </div>
                <div style={{
                  fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {enabled
                    ? <><span style={{ color: TOKENS.red, fontWeight: 700 }}>{skuN}</span> 个商品</>
                    : '敬请期待'}
                </div>
              </Card>
            );
          })}
        </div>

        {!scenesQ.isLoading && scenes.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: TOKENS.inkMuted }}>
            {I.Alert({ size: 32, color: TOKENS.inkMuted })}
            <div style={{ marginTop: 8 }}>暂无场景数据</div>
          </div>
        )}
      </div>
    </ScreenWrap>
  );
}
