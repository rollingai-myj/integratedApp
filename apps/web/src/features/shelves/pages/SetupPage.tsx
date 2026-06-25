/**
 * 选品 · 登记货架向导（每场景一次性）
 *
 * 3 步：选类型 → 宽 + 层 → 确认（可多组）
 * 完成后：首次 → 自动进入"聊一聊"；非首次 → 返回工作台
 * 不询问"主要摆什么品类"——服务端自动取场景的 level1 品类。
 */
import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppBar, BottomBar, Card, GhostBtn, NumStepper, PrimaryBtn, BigOption, ScreenWrap } from '../ui/primitives';
import { TOKENS } from '../ui/tokens';
import { I } from '../ui/icons';
import { scenesApi } from '../api';
import { SHELF_TYPES, WIDTH_PRESETS, emojiForScene } from '../data';

interface Group {
  shelfType: string;
  widthCm: number;
  layerCount: number;
}

export function SetupPage() {
  const { scene: sceneStr } = useParams({ from: '/shelves/scene/$scene/setup' });
  const scene = Number(sceneStr);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const scenesQ = useQuery({ queryKey: ['scenes', 'list'], queryFn: scenesApi.list });
  const ovQ = useQuery({ queryKey: ['scenes', 'overview'], queryFn: scenesApi.overview });
  const def = scenesQ.data?.scenes.find((s) => s.scene === scene);
  const ov = ovQ.data?.scenes.find((s) => s.scene === scene);
  const firstTime = !ov?.shelfConfigured;

  const shelvesQ = useQuery({
    queryKey: ['scenes', scene, 'shelves'],
    queryFn: () => scenesApi.listShelves(scene),
  });
  const initialGroups: Group[] = (shelvesQ.data?.groups ?? []).map((g) => ({
    shelfType: g.shelfType ?? '标准货架',
    widthCm: g.widthCm ?? 75,
    layerCount: g.layerCount ?? 5,
  }));

  const [groups, setGroups] = useState<Group[]>(initialGroups);
  const [step, setStep] = useState<0 | 1 | 2>(initialGroups.length > 0 ? 2 : 0);
  const [cur, setCur] = useState<Group>({ shelfType: '', widthCm: 75, layerCount: 5 });
  const [synced, setSynced] = useState(false);

  // 仅在第一次加载完后同步一次（避免重设步骤）
  if (!synced && shelvesQ.isSuccess && initialGroups.length > 0 && groups.length === 0) {
    setGroups(initialGroups);
    setStep(2);
    setSynced(true);
  }

  const save = useMutation({
    mutationFn: () => scenesApi.replaceShelves(scene, groups.map((g) => ({
      shelfType: g.shelfType, widthCm: g.widthCm, layerCount: g.layerCount,
    }))),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scenes', 'overview'] });
      void qc.invalidateQueries({ queryKey: ['scenes', scene] });
      if (firstTime && !ov?.qaDone) {
        void navigate({ to: '/shelves/scene/$scene/qa', params: { scene: sceneStr } });
      } else {
        void navigate({ to: '/shelves/scene/$scene', params: { scene: sceneStr } });
      }
    },
  });

  const exitSetup = () => {
    const target = firstTime
      ? { to: '/shelves' as const }
      : { to: '/shelves/scene/$scene' as const, params: { scene: sceneStr } };
    void navigate(target);
  };

  const back = () => {
    // step=2 是汇总页（顶层）→ 直接退出，避免被 step=0 分支绕回造成循环
    if (step === 2) { exitSetup(); return; }
    // step=0 选类型页：有已登记的组 → 是"再添加一组"流程，取消回汇总；
    //                  无任何组 → 还没开始登记，退出回上级
    if (step === 0) {
      if (groups.length > 0) { setStep(2); return; }
      exitSetup();
      return;
    }
    // step=1 宽高页 → 退回 step=0 选类型
    setStep(0);
  };

  const finishGroup = () => {
    setGroups([...groups, { ...cur }]);
    setStep(2);
  };
  const addAnother = () => {
    setCur({ shelfType: '', widthCm: 75, layerCount: 5 });
    setStep(0);
  };

  const stepTitle = ['这组货架是什么类型？', '货架有多宽、几层？', '确认货架信息'][step]!;

  return (
    <ScreenWrap>
      <AppBar title="登记货架" subtitle={`${emojiForScene(scene)} ${def?.name ?? ''}`} onBack={back} />

      {step < 2 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, paddingTop: 16, flexShrink: 0 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{
              width: i === step ? 22 : 8, height: 8, borderRadius: 4,
              background: i <= step ? TOKENS.red : '#e5dfd6', transition: 'all 0.25s',
            }} />
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 120px' }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: TOKENS.ink, marginBottom: 4 }}>{stepTitle}</div>
        {step < 2 && groups.length > 0 && (
          <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginBottom: 14 }}>正在登记第 {groups.length + 1} 组货架</div>
        )}
        {step < 2 && groups.length === 0 && (
          <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginBottom: 14 }}>不确定的话按默认选就行，之后随时能改</div>
        )}

        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {SHELF_TYPES.map((t) => (
              <BigOption key={t.type} title={t.type} hint={t.hint}
                selected={cur.shelfType === t.type}
                onClick={() => { setCur({ ...cur, shelfType: t.type }); setTimeout(() => setStep(1), 220); }} />
            ))}
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card pad={16}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: TOKENS.inkSoft, marginBottom: 12 }}>货架宽度</div>
              <div style={{ display: 'flex', gap: 10 }}>
                {WIDTH_PRESETS.map((w) => {
                  const sel = cur.widthCm === w;
                  return (
                    <button key={w} onClick={() => setCur({ ...cur, widthCm: w })} style={{
                      appearance: 'none', flex: 1, height: 58, borderRadius: 14, fontFamily: 'inherit',
                      border: sel ? `2px solid ${TOKENS.red}` : `1.5px solid ${TOKENS.line}`,
                      background: sel ? TOKENS.redSoft : '#fff',
                      color: sel ? TOKENS.red : TOKENS.inkSoft,
                      fontSize: 17, fontWeight: 800, cursor: 'pointer',
                    }}>{w}<span style={{ fontSize: 11, fontWeight: 600 }}>cm</span></button>
                  );
                })}
              </div>
            </Card>
            <Card pad={16}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: TOKENS.inkSoft, marginBottom: 12 }}>货架层数</div>
              <NumStepper value={cur.layerCount} onChange={(v) => setCur({ ...cur, layerCount: v })} min={2} max={8} unit="层" />
            </Card>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {groups.map((g, i) => (
              <Card key={i} pad={14} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12, background: TOKENS.redSoft, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{I.Shelf({ size: 20, color: TOKENS.red })}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: TOKENS.ink }}>第 {i + 1} 组 · {g.shelfType}</div>
                  <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginTop: 2 }}>{g.widthCm}cm · {g.layerCount}层</div>
                </div>
                <button onClick={() => setGroups(groups.filter((_, idx) => idx !== i))} aria-label="删除该组" style={{
                  appearance: 'none', border: 0, background: 'transparent', cursor: 'pointer', padding: 6,
                }}>{I.Trash({ size: 18, color: TOKENS.inkMuted })}</button>
              </Card>
            ))}
            <GhostBtn onClick={addAnother} icon={I.Plus({ size: 18, color: TOKENS.red })} style={{ marginTop: 4 }}>
              再添加一组货架
            </GhostBtn>
            {firstTime && (
              <div style={{ fontSize: 12, color: TOKENS.inkMuted, textAlign: 'center', lineHeight: 1.6 }}>
                保存后再花 1 分钟聊聊这个货架的情况，就全部准备好了
              </div>
            )}
          </div>
        )}
      </div>

      {(step === 1 || step === 2) && (
        <BottomBar>
          {step === 1 && <PrimaryBtn onClick={finishGroup}>完成这组货架</PrimaryBtn>}
          {step === 2 && (
            <PrimaryBtn
              disabled={groups.length === 0 || save.isPending}
              onClick={() => save.mutate()}
              icon={I.Check({ size: 20, color: '#fff' })}
            >
              {firstTime ? `保存，开始调改（共 ${groups.length} 组）` : `保存（共 ${groups.length} 组货架）`}
            </PrimaryBtn>
          )}
        </BottomBar>
      )}
    </ScreenWrap>
  );
}
