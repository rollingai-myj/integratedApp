/**
 * 选品 · 场景列表
 *
 * 进入选品模块的首屏：13 场景双列卡片 + "继续调改"高亮卡 + 状态角标。
 */
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMe } from '@/lib/auth';
import { AppBar, Card, Chip, ScreenWrap } from '../ui/primitives';
import { TOKENS } from '../ui/tokens';
import { I } from '../ui/icons';
import { scenesApi } from '../api';
import { emojiForScene } from '../data';

/**
 * 当前阶段仅"面包架【烘焙】"(scene=2) 与 "冷藏"(scene=12) 有完整商品主数据；
 * 其余 11 个场景待总部主数据补齐后再逐个开放。
 */
const ENABLED_SCENES = new Set<number>([2, 12]);

export function HomePage() {
  const navigate = useNavigate();
  const me = useMe();
  const scenesQ = useQuery({ queryKey: ['scenes', 'list'], queryFn: scenesApi.list });
  const ovQ = useQuery({ queryKey: ['scenes', 'overview'], queryFn: scenesApi.overview });

  const scenes = scenesQ.data?.scenes ?? [];
  const ovMap = new Map(ovQ.data?.scenes.map((o) => [o.scene, o]) ?? []);
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

  const goBackHome = () => void navigate({ to: '/' });

  return (
    <ScreenWrap>
      <AppBar
        title="货盘选品"
        subtitle={`${me.data?.currentStore?.code ?? ''} · ${me.data?.currentStore?.name ?? ''}`}
        onBack={goBackHome}
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
            <Chip tone="orange">继续</Chip>
          </Card>
        )}

        <div style={{ fontSize: 17, fontWeight: 800, color: TOKENS.ink }}>选择场景</div>
        <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 2, marginBottom: 12 }}>
          每个场景对应一组货架，点进去即可查看与调改
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {scenes.map((s) => {
            const ov = ovMap.get(s.scene);
            const enabled = ENABLED_SCENES.has(s.scene);
            const status = enabled ? computeStatus(ov) : { tone: 'gray' as const, label: '数据准备中' };
            return (
              <Card
                key={s.scene}
                onClick={enabled ? () => goWorkspace(s.scene) : undefined}
                pad={13}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 8, minHeight: 108,
                  border: enabled && ov?.hasDraft ? `2px solid ${TOKENS.orange}` : '2px solid transparent',
                  opacity: enabled ? 1 : 0.45,
                  cursor: enabled ? 'pointer' : 'not-allowed',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 28, lineHeight: 1 }}>{emojiForScene(s.scene)}</div>
                  <Chip tone={status.tone}>{status.label}</Chip>
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: TOKENS.ink }}>{s.name}</div>
                  <div style={{
                    fontSize: 11, color: TOKENS.inkMuted, marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{s.categories.map((c) => c.name).join('、')}</div>
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

function computeStatus(ov?: { hasDraft: boolean; shelfConfigured: boolean; adjustmentCount: number }): {
  tone: 'orange' | 'gray' | 'green';
  label: string;
} {
  if (!ov) return { tone: 'gray', label: '加载中' };
  if (ov.hasDraft) return { tone: 'orange', label: '调改进行中' };
  if (!ov.shelfConfigured) return { tone: 'gray', label: '未登记货架' };
  if (ov.adjustmentCount > 0) return { tone: 'green', label: `已调改 ${ov.adjustmentCount} 次` };
  return { tone: 'gray', label: '未调改' };
}
