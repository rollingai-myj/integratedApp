/**
 * 选品 · 拍照调改流（核心 7 阶段，接真实接口）
 *
 * 阶段：photo → diagnosing → diag → review → confirm → applied
 *
 * 真实链路（原版 PhotoPage 还原）：
 *  - photo：<input type="file" capture="environment"> 拍照/选图，多张 → 一次 multipart 上传
 *           POST /scenes/:scene/photos → OSS + runtime.photos
 *  - diagnosing：并行触发三件事：
 *      ① /detect 商品识别（红框）             — 失败显示琥珀色降级横幅，不阻塞
 *      ② /scenes/:scene/ai/diagnose (SSE)     — Dify align 工作流，extractDiagnosis 三段
 *      ③ /scenes/:scene/ai/strategy (SSE)     — Dify selection 工作流，extractStrategy 列表
 *  - review：用 strategy.items 逐条 ✓ / ✗
 *      跳过 → POST /scenes/:scene/corrections (scope=decision)
 *  - confirm：把 accepted 集分组展示
 *  - applied：POST /scenes/:scene/adjustments 落库 + 清 draft + bump remake_count
 *           → 自动触发 /scenes/:scene/ai/virtual-shelf (SSE) 生成陈列示意图
 *
 * 草稿：每个阶段状态变化都 PUT /scenes/:scene/runtime { draft, photos, detectionData, ... }
 *       跨设备登录同店同场景，能在 review 中第 N 条续作
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppBar, BottomBar, Card, Chip, FlowSteps, GhostBtn, ListRow,
  PrimaryBtn, ScreenWrap, Spin,
} from '../ui/primitives';
import { TOKENS } from '../ui/tokens';
import { I } from '../ui/icons';
import { scenesApi, detectApi, hqApi, type DetectBox } from '../api';
import { readWorkflowFinished, extractDiagnosis, extractStrategy, type DiagnosisResult, type StrategyItem as AiStrategyItem } from '../sse';
import { classifyStrategyKind, type StrategyKind } from '../lib/strategyAction';
import { SKIP_REASONS } from '../data';

type Stage = 'photo' | 'diagnosing' | 'diag' | 'review' | 'confirm' | 'applied';
type Decision = 'accept' | 'skip';

interface DraftShape {
  stage: Stage;
  reviewIndex?: number;
  decisions?: Decision[];
  skipReasons?: (string | null)[];
  diagnosis?: DiagnosisResult | null;
  strategy?: AiStrategyItem[] | null;
  detectBoxes?: DetectBox[] | null;
  detectError?: string | null;
}

const KIND_META: Record<StrategyKind, { label: string; color: string; bg: string; emoji: string }> = {
  remove:  { label: '建议：停止进货', color: TOKENS.red,   bg: TOKENS.redSoft,   emoji: '📦' },
  observe: { label: '建议：保留观察', color: TOKENS.amber, bg: TOKENS.amberSoft, emoji: '👀' },
  push:    { label: '建议：上架新品', color: TOKENS.green, bg: TOKENS.greenSoft, emoji: '✨' },
};

export function FlowPage() {
  const { scene: sceneStr } = useParams({ from: '/shelves/scene/$scene/flow' });
  const scene = Number(sceneStr);
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ---- runtime + 草稿 -----------------------------------------------------

  const runtimeQ = useQuery({
    queryKey: ['scenes', scene, 'runtime'],
    queryFn: () => scenesApi.runtime(scene),
  });
  const draft = (runtimeQ.data?.draft ?? null) as DraftShape | null;
  const photosFromServer = Array.isArray(runtimeQ.data?.photos)
    ? (runtimeQ.data!.photos as Array<{ url: string }>)
    : [];

  // ---- 状态 ---------------------------------------------------------------

  const [stage, setStage] = useState<Stage>('photo');
  const [photos, setPhotos] = useState<Array<{ url: string; localPreview?: string }>>([]);
  const [uploading, setUploading] = useState(false);

  const [detectBoxes, setDetectBoxes] = useState<DetectBox[] | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detectDone, setDetectDone] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [strategy, setStrategy] = useState<AiStrategyItem[] | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const [reviewIndex, setReviewIndex] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [skipReasons, setSkipReasons] = useState<(string | null)[]>([]);

  const [hydrated, setHydrated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- 草稿恢复（只跑一次） -----------------------------------------------

  useEffect(() => {
    if (hydrated || !runtimeQ.isSuccess) return;
    setHydrated(true);
    if (photosFromServer.length > 0) {
      setPhotos(photosFromServer.map((p) => ({ url: p.url })));
    }
    if (!draft) return;
    if (draft.diagnosis) setDiagnosis(draft.diagnosis);
    if (draft.strategy) setStrategy(draft.strategy);
    if (draft.detectBoxes) { setDetectBoxes(draft.detectBoxes); setDetectDone(true); }
    if (draft.detectError) setDetectError(draft.detectError);
    if (draft.decisions) setDecisions(draft.decisions);
    if (draft.skipReasons) setSkipReasons(draft.skipReasons);
    if (typeof draft.reviewIndex === 'number') setReviewIndex(draft.reviewIndex);
    if (draft.stage === 'diag' || draft.stage === 'review' || draft.stage === 'confirm') {
      setStage(draft.stage);
    }
  }, [hydrated, runtimeQ.isSuccess, draft, photosFromServer]);

  // ---- 草稿写入（增量 merge） --------------------------------------------

  const saveDraft = useMutation({
    mutationFn: (patch: Partial<DraftShape>) =>
      scenesApi.saveRuntime(scene, {
        draft: { ...(draft ?? {}), ...patch, stage: patch.stage ?? draft?.stage ?? stage } as any,
      } as any),
  });

  // ---- 阶段 1：拍照 + 上传 -----------------------------------------------

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    try {
      // 立即生成 localPreview 让 UI 先显示
      const previews = files.map((f) => ({ file: f, preview: URL.createObjectURL(f) }));
      setPhotos((ps) => [
        ...ps,
        ...previews.map((p) => ({ url: '', localPreview: p.preview })),
      ]);
      const { urls } = await scenesApi.uploadPhotos(scene, files);
      // 用 server 返回的 url 替换占位
      setPhotos((ps) => {
        const out = [...ps];
        let urlIdx = 0;
        for (let i = 0; i < out.length; i++) {
          if (out[i]!.url === '' && urlIdx < urls.length) {
            out[i] = { ...out[i]!, url: urls[urlIdx]! };
            urlIdx++;
          }
        }
        return out;
      });
      void qc.invalidateQueries({ queryKey: ['scenes', scene, 'runtime'] });
    } catch (err) {
      setAiError(`照片上传失败：${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  // ---- 阶段 2：诊断（并行 detect + diagnose SSE + strategy SSE） --------

  const startDiagnosis = async () => {
    if (photos.length === 0 || photos.every((p) => !p.url)) return;
    const rawUrl = photos.find((p) => p.url)?.url ?? '';
    if (!rawUrl) return;
    // 给 Dify 喂的必须是完整 http(s) URL。OSS 上传成功时已是 https；
    // dev 走本地 fallback 时是相对路径，前端补上 origin（Dify 在公网时拿不到，但端点不再因 schema 报 400）
    const firstPhotoUrl = rawUrl.startsWith('http')
      ? rawUrl
      : `${window.location.origin}${rawUrl}`;
    setStage('diagnosing');
    setAiError(null);
    setDetectBoxes(null);
    setDetectError(null);
    setDetectDone(false);
    setDiagnosis(null);
    setStrategy(null);

    saveDraft.mutate({ stage: 'diagnosing' });

    // detect：用第一张原图（fetch 拿回 blob → 调 detectApi）
    void (async () => {
      try {
        const r = await fetch(firstPhotoUrl);
        const blob = await r.blob();
        const detectRes = await detectApi.detect(scene, blob);
        if (detectRes.error) {
          setDetectError(detectRes.error.message);
          saveDraft.mutate({ detectError: detectRes.error.message });
        } else {
          setDetectBoxes(detectRes.boxes);
          saveDraft.mutate({ detectBoxes: detectRes.boxes });
        }
      } catch (e) {
        setDetectError((e as Error).message);
      } finally {
        setDetectDone(true);
      }
    })();

    // diagnose SSE
    void (async () => {
      try {
        const resp = await scenesApi.streamDiagnose(scene, firstPhotoUrl);
        const outputs = await readWorkflowFinished(resp);
        const diag = extractDiagnosis(outputs);
        setDiagnosis(diag);
        saveDraft.mutate({ diagnosis: diag });
      } catch (e) {
        setAiError(`诊断失败：${(e as Error).message}`);
      }
    })();

    // strategy SSE
    void (async () => {
      try {
        const resp = await scenesApi.streamStrategy(scene);
        const outputs = await readWorkflowFinished(resp);
        const strat = extractStrategy(outputs);
        const items = strat?.items ?? [];
        setStrategy(items);
        saveDraft.mutate({ strategy: items });
      } catch (e) {
        setAiError((prev) => prev ?? `方案生成失败：${(e as Error).message}`);
      }
    })();
  };

  // 诊断+方案都到位 → 自动进 diag 阶段
  useEffect(() => {
    if (stage === 'diagnosing' && diagnosis && strategy) {
      setStage('diag');
      saveDraft.mutate({ stage: 'diag' });
    }
  }, [stage, diagnosis, strategy]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 阶段 3：诊断结果展示 → 阶段 4：逐条确认 --------------------------

  const startReview = () => {
    setStage('review');
    setReviewIndex(0);
    saveDraft.mutate({ stage: 'review', reviewIndex: 0, decisions: [], skipReasons: [] });
  };

  const decide = (choice: Decision, reason: string | null = null) => {
    if (!strategy) return;
    const nextDec = [...decisions];
    nextDec[reviewIndex] = choice;
    const nextReasons = [...skipReasons];
    nextReasons[reviewIndex] = choice === 'skip' ? reason : null;
    setDecisions(nextDec);
    setSkipReasons(nextReasons);

    // 跳过 → 写勘误 store_sku_corrections
    if (choice === 'skip' && reason) {
      const item = strategy[reviewIndex]!;
      const kind = classifyStrategyKind(item.action);
      void scenesApi.submitCorrection(scene, {
        skuCode: item.skuCode,
        kind: kind === 'remove' ? 'remove' : kind === 'push' ? 'add' : 'observe',
        scope: 'decision',
        reasonCode: 'manual_keep',
        reasonText: reason,
      }).catch(() => {});
    }

    const isLast = reviewIndex + 1 >= strategy.length;
    if (isLast) {
      setStage('confirm');
      saveDraft.mutate({ stage: 'confirm', decisions: nextDec, skipReasons: nextReasons });
    } else {
      const ni = reviewIndex + 1;
      setReviewIndex(ni);
      saveDraft.mutate({ stage: 'review', reviewIndex: ni, decisions: nextDec, skipReasons: nextReasons });
    }
  };

  const undoLast = () => { if (reviewIndex > 0) setReviewIndex(reviewIndex - 1); };
  const restoreSku = (idx: number) => {
    const nx = [...decisions];
    nx[idx] = 'accept';
    setDecisions(nx);
    saveDraft.mutate({ decisions: nx });
  };

  const accepted = strategy
    ? strategy.filter((_, i) => decisions[i] === 'accept').map((s) => ({ ...s, kind: classifyStrategyKind(s.action) }))
    : [];
  const skippedIdx = strategy
    ? strategy.map((_, i) => i).filter((i) => decisions[i] === 'skip')
    : [];
  const counts = {
    remove: accepted.filter((s) => s.kind === 'remove').length,
    observe: accepted.filter((s) => s.kind === 'observe').length,
    push: accepted.filter((s) => s.kind === 'push').length,
  };

  // ---- 阶段 7：应用调改 ----------------------------------------------------

  const apply = useMutation({
    mutationFn: async () => {
      const items = accepted
        .filter((s) => s.kind !== 'observe') // observe 不入 adjustments
        .map((s) => ({
          action: s.kind === 'push' ? 'add' as const : 'remove' as const,
          skuCode: s.skuCode,
          productName: s.skuName,
          reasonCode: s.kind === 'push' ? 'ai_recommend_core' : 'low_sales',
          reasonText: s.reason,
        }));
      return scenesApi.apply(scene, {
        summaryText: `上架了${counts.push}个品，停止进货了${counts.remove}个品`,
        items,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scenes', 'overview'] });
      void qc.invalidateQueries({ queryKey: ['scenes', scene] });
      setStage('applied');
      // 顺手触发虚拟陈列生成（不等结果）
      void (async () => {
        try {
          const resp = await scenesApi.streamVirtualShelf(scene);
          await readWorkflowFinished(resp);
          void qc.invalidateQueries({ queryKey: ['scenes', scene, 'runtime'] });
        } catch { /* 失败由 runtime.virtualStatus 反映 */ }
      })();
    },
  });

  // ---- 渲染 -------------------------------------------------------------

  const stepIndex: number = { photo: 0, diagnosing: 1, diag: 2, review: 2, confirm: 2, applied: 2 }[stage];
  const heroPhoto = photos[0]?.url || photos[0]?.localPreview || '';

  const onBack = () => {
    void navigate({ to: '/shelves/scene/$scene', params: { scene: sceneStr } });
  };

  return (
    <ScreenWrap>
      <AppBar
        title="选品调改"
        subtitle={stage === 'applied' ? undefined : '进度会自动保存，可随时退出'}
        onBack={onBack}
      />
      {stage !== 'applied' && <FlowSteps current={stepIndex} steps={['拍照', 'AI 诊断', '确认方案']} />}

      {/* ===== 阶段 1：拍照 ===== */}
      {stage === 'photo' && (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 120px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13.5, color: TOKENS.inkSoft, lineHeight: 1.6 }}>
              请拍下货架现在的样子，拍清楚商品即可，可以拍多张。
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              style={{ display: 'none' }}
              onChange={onFileChange}
            />
            {photos.length === 0 ? (
              <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{
                appearance: 'none', fontFamily: 'inherit', cursor: 'pointer',
                border: `2px dashed ${TOKENS.red}55`, borderRadius: 18, background: '#fff',
                padding: '38px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
              }}>
                {uploading ? <Spin size={48} /> : (
                  <div style={{
                    width: 64, height: 64, borderRadius: 20,
                    background: `linear-gradient(135deg, ${TOKENS.red}, ${TOKENS.redDark})`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: `0 8px 20px ${TOKENS.red}40`,
                  }}>{I.Camera({ size: 32, color: '#fff' })}</div>
                )}
                <div style={{ fontSize: 16, fontWeight: 800, color: TOKENS.ink }}>{uploading ? '正在上传…' : '点这里拍货架'}</div>
                <div style={{ fontSize: 12, color: TOKENS.inkMuted }}>也可以从相册选择</div>
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {photos.map((p, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img
                      src={p.url || p.localPreview}
                      alt={`货架照片 ${i + 1}`}
                      style={{ width: '100%', height: i === 0 ? 220 : 130, objectFit: 'cover', borderRadius: 14, background: TOKENS.bg }}
                    />
                    <div style={{
                      position: 'absolute', top: 8, right: 8,
                      background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10.5, fontWeight: 700,
                      padding: '3px 8px', borderRadius: 8,
                    }}>{p.url ? '已上传' : '上传中…'}</div>
                  </div>
                ))}
                {photos.length < 3 && (
                  <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{
                    appearance: 'none', fontFamily: 'inherit', cursor: 'pointer',
                    border: `1.5px dashed ${TOKENS.line}`, borderRadius: 14, background: '#fff',
                    padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    fontSize: 14, fontWeight: 700, color: TOKENS.red,
                  }}>{I.Plus({ size: 18, color: TOKENS.red })} 再拍一张（{photos.length}/3）</button>
                )}
              </div>
            )}
            <Card pad={13} style={{ background: TOKENS.amberSoft, boxShadow: 'none' }}>
              <div style={{ display: 'flex', gap: 9 }}>
                {I.Alert({ size: 17, color: TOKENS.amber })}
                <div style={{ fontSize: 12, color: TOKENS.amber, lineHeight: 1.6 }}>
                  拍照小提示：正对货架、光线充足、商品标签朝外，AI 识别会更准。
                </div>
              </div>
            </Card>
            {aiError && (
              <Card pad={12} style={{ background: TOKENS.redSoft, boxShadow: 'none' }}>
                <div style={{ fontSize: 12.5, color: TOKENS.red, lineHeight: 1.55 }}>{aiError}</div>
              </Card>
            )}
          </div>
          <BottomBar>
            <PrimaryBtn
              disabled={photos.length === 0 || photos.some((p) => !p.url) || uploading}
              onClick={startDiagnosis}
              icon={photos.length > 0 ? I.Sparkles({ size: 20, color: '#fff' }) : undefined}
            >
              {photos.length === 0 ? '请先拍一张货架照片' : photos.some((p) => !p.url) ? '等待上传完成…' : '开始 AI 诊断'}
            </PrimaryBtn>
          </BottomBar>
        </>
      )}

      {/* ===== 阶段 2：诊断中 ===== */}
      {stage === 'diagnosing' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {heroPhoto && (
            <PhotoWithBoxes src={heroPhoto} boxes={detectBoxes ?? []} scanning={!detectDone} height={220} />
          )}
          {detectError && (
            <Card pad={12} style={{ background: TOKENS.amberSoft, boxShadow: 'none' }}>
              <div style={{ fontSize: 12.5, color: TOKENS.amber, lineHeight: 1.55 }}>
                商品识别服务暂不可用，无法标注问题单品；不影响后续诊断和方案，您可以继续完成本次调改。
                <div style={{ fontSize: 11, color: '#7a5f00', marginTop: 4 }}>原因：{detectError}</div>
              </div>
            </Card>
          )}
          <Card pad={16}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <ProgressStep label="识别货架上的商品" done={detectDone} running={!detectDone} />
              <ProgressStep label="结合你的回答与周边竞争生成诊断" done={!!diagnosis} running={!diagnosis} />
              <ProgressStep label="生成选品调改方案" done={!!strategy} running={!strategy} />
            </div>
          </Card>
          <div style={{ fontSize: 12, color: TOKENS.inkMuted, textAlign: 'center' }}>
            诊断与方案需要 30-60 秒，请耐心等待
          </div>
          {aiError && (
            <Card pad={12} style={{ background: TOKENS.redSoft, boxShadow: 'none' }}>
              <div style={{ fontSize: 12.5, color: TOKENS.red, lineHeight: 1.55 }}>{aiError}</div>
              <button onClick={startDiagnosis} style={{
                appearance: 'none', border: 0, marginTop: 8, padding: '6px 12px',
                background: '#fff', color: TOKENS.red, borderRadius: 14,
                fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              }}>重试</button>
            </Card>
          )}
        </div>
      )}

      {/* ===== 阶段 3：诊断结果 ===== */}
      {stage === 'diag' && diagnosis && strategy && (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 130px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {heroPhoto && (
              <PhotoWithBoxes src={heroPhoto} boxes={detectBoxes ?? []} scanning={false} height={210} />
            )}
            {(detectBoxes && detectBoxes.length > 0) && (
              <div style={{ fontSize: 12, color: TOKENS.inkSoft, textAlign: 'center', marginTop: -4 }}>
                <span style={{ color: TOKENS.red, fontWeight: 700 }}>红框</span>是 AI 找到的问题单品
              </div>
            )}
            {[
              { key: 'paragraphCustomer' as const, label: '客群分析', icon: '👥', color: '#1d63b8', bg: '#e8f1fb' },
              { key: 'paragraphCompetition' as const, label: '竞争分析', icon: '⚔️', color: '#9a6700', bg: '#fdf3df' },
              { key: 'paragraphStatus' as const, label: '货架现状', icon: '📊', color: TOKENS.green, bg: TOKENS.greenSoft },
            ].map((s) => (
              <Card key={s.key} pad={14}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 9, background: s.bg, fontSize: 14,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{s.icon}</div>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: s.color }}>{s.label}</span>
                </div>
                <div style={{ fontSize: 13, color: TOKENS.ink, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
                  {diagnosis[s.key] || <span style={{ color: TOKENS.inkMuted }}>（AI 未返回内容）</span>}
                </div>
              </Card>
            ))}
          </div>
          <BottomBar>
            <PrimaryBtn
              disabled={strategy.length === 0}
              onClick={startReview}
              icon={I.ArrowR({ size: 20, color: '#fff' })}
            >
              {strategy.length === 0 ? 'AI 未返回方案' : `开始过方案（共 ${strategy.length} 条）`}
            </PrimaryBtn>
          </BottomBar>
        </>
      )}

      {/* ===== 阶段 4：逐条确认 ===== */}
      {stage === 'review' && strategy && (
        <ReviewDeck
          skus={strategy}
          index={reviewIndex}
          onDecide={decide}
          onUndo={undoLast}
        />
      )}

      {/* ===== 阶段 5/6：清单确认 ===== */}
      {stage === 'confirm' && strategy && (
        <ConfirmList
          accepted={accepted}
          skippedIdx={skippedIdx}
          skipReasons={skipReasons}
          skus={strategy}
          counts={counts}
          onRestore={restoreSku}
          onRecheck={() => { setReviewIndex(0); setStage('review'); }}
          onApply={() => apply.mutate()}
          applying={apply.isPending}
          applyError={apply.isError}
        />
      )}

      {/* ===== 阶段 7：完成 ===== */}
      {stage === 'applied' && (
        <AppliedPanel counts={counts} sceneStr={sceneStr} />
      )}
    </ScreenWrap>
  );
}

// ---- 子组件：进度阶段步骤 ------------------------------------------------

function ProgressStep({ label, done, running }: { label: string; done: boolean; running: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, opacity: done || running ? 1 : 0.4 }}>
      {done ? (
        <div style={{
          width: 22, height: 22, borderRadius: '50%', background: TOKENS.green, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{I.Check({ size: 13, color: '#fff' })}</div>
      ) : running ? <Spin size={22} /> : (
        <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${TOKENS.line}`, flexShrink: 0 }} />
      )}
      <div style={{ fontSize: 14, fontWeight: running ? 800 : 600, color: running ? TOKENS.ink : TOKENS.inkSoft }}>
        {label}{running && !done && '…'}
      </div>
    </div>
  );
}

// ---- 子组件：带红框的照片 ------------------------------------------------

function PhotoWithBoxes({
  src, boxes, scanning, height,
}: { src: string; boxes: DetectBox[]; scanning: boolean; height: number }) {
  return (
    <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden' }}>
      <img src={src} alt="货架" style={{
        width: '100%', height, objectFit: 'cover', display: 'block', background: TOKENS.bg,
      }} />
      {boxes.map((b, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${b.x * 100}%`,
          top: `${b.y * 100}%`,
          width: `${b.w * 100}%`,
          height: `${b.h * 100}%`,
          border: `2px solid ${TOKENS.red}`,
          borderRadius: 4,
          boxShadow: '0 0 0 1px rgba(255,255,255,0.6) inset',
          animation: 'shv-fadein 0.4s ease',
        }} />
      ))}
      {scanning && (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute', left: 0, right: 0, height: '34%',
            background: `linear-gradient(180deg, transparent, ${TOKENS.red}33, transparent)`,
            animation: 'shv-scan 2s linear infinite',
          }} />
        </div>
      )}
    </div>
  );
}

// ---- 子组件：逐条确认（沿用原 UI） ---------------------------------------

function ReviewDeck({
  skus, index, onDecide, onUndo,
}: {
  skus: AiStrategyItem[];
  index: number;
  onDecide: (c: Decision, reason?: string | null) => void;
  onUndo: () => void;
}) {
  const s = skus[index]!;
  const kind = classifyStrategyKind(s.action);
  const meta = KIND_META[kind];
  const [skipAsk, setSkipAsk] = useState(false);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '8px 16px 0' }}>
      <div style={{ flexShrink: 0, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <button onClick={onUndo} disabled={index === 0} style={{
            appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit',
            fontSize: 12.5, fontWeight: 700, color: index === 0 ? '#d0c9bf' : TOKENS.inkSoft,
            cursor: index === 0 ? 'default' : 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', gap: 3,
          }}>{I.Back({ size: 13, color: index === 0 ? '#d0c9bf' : TOKENS.inkSoft })} 上一条</button>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkSoft, fontVariantNumeric: 'tabular-nums' }}>
            第 <span style={{ color: TOKENS.red, fontSize: 15 }}>{index + 1}</span> / {skus.length} 条
          </div>
        </div>
        <div style={{ height: 5, borderRadius: 3, background: '#eee9e1', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 3, background: TOKENS.red,
            width: `${(index / skus.length) * 100}%`, transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      <div key={s.skuCode} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', animation: 'shv-card-in 0.28s ease' }}>
        <Card pad={0} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ background: meta.bg, padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 19 }}>{meta.emoji}</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: meta.color }}>{meta.label}</span>
            {s.tags.length > 0 && (
              <span style={{ marginLeft: 'auto' }}>
                <Chip tone={kind === 'remove' ? 'red' : kind === 'push' ? 'green' : 'amber'}>{s.tags[0]}</Chip>
              </span>
            )}
          </div>

          <div style={{ padding: '16px 16px 14px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <div style={{ display: 'flex', gap: 13, alignItems: 'center' }}>
              <SkuThumb skuCode={s.skuCode} size={76} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 21, fontWeight: 800, color: TOKENS.ink, lineHeight: 1.3 }}>{s.skuName}</div>
                {s.spec && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: TOKENS.inkMuted, marginTop: 4 }}>{s.spec}</div>
                )}
              </div>
            </div>

            <div style={{
              flex: 1, marginTop: 14, background: TOKENS.bg, borderRadius: 14, padding: '13px 14px',
              display: 'flex', flexDirection: 'column', gap: 6, minHeight: 86,
            }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: meta.color, letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                {I.Sparkles({ size: 14, color: meta.color })} AI 为什么这么建议
              </div>
              <div style={{ fontSize: 14.5, color: TOKENS.ink, lineHeight: 1.8 }}>{s.reason || '（AI 未提供原因）'}</div>
            </div>
          </div>
        </Card>
      </div>

      <div style={{
        flexShrink: 0, display: 'flex', gap: 10,
        padding: '12px 0 calc(env(safe-area-inset-bottom, 0px) + 16px)',
      }}>
        <button onClick={() => setSkipAsk(true)} style={{
          appearance: 'none', fontFamily: 'inherit', cursor: 'pointer',
          flex: 1, height: 54, borderRadius: 27, background: '#fff',
          border: `1.5px solid ${TOKENS.line}`, color: TOKENS.inkSoft,
          fontSize: 16, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>{I.Close({ size: 18, color: TOKENS.inkSoft })} 这条跳过</button>
        <button onClick={() => onDecide('accept')} style={{
          appearance: 'none', border: 0, fontFamily: 'inherit', cursor: 'pointer',
          flex: 1.4, height: 54, borderRadius: 27,
          background: TOKENS.red, color: '#fff',
          fontSize: 17, fontWeight: 700, letterSpacing: 1,
          boxShadow: `0 8px 24px ${TOKENS.red}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        }}>{I.Check({ size: 20, color: '#fff' })} 应用</button>
      </div>

      {skipAsk && (
        <SkipReasonSheet
          kind={kind}
          skuName={s.skuName}
          onCancel={() => setSkipAsk(false)}
          onConfirm={(reason) => { setSkipAsk(false); onDecide('skip', reason); }}
        />
      )}
    </div>
  );
}

function SkipReasonSheet({
  kind, skuName, onCancel, onConfirm,
}: { kind: StrategyKind; skuName: string; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const presets = SKIP_REASONS[kind];
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState('');
  const reason = text.trim() || picked;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 300 }}>
      <div onClick={onCancel} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', animation: 'shv-fadein 0.2s ease' }} />
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: TOKENS.bg, borderRadius: '20px 20px 0 0',
        padding: '18px 16px calc(env(safe-area-inset-bottom, 0px) + 16px)',
        animation: 'shv-sheet-up 0.28s ease',
        display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '82%', overflowY: 'auto',
      }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: TOKENS.ink }}>为什么跳过这条？</div>
          <div style={{ fontSize: 12.5, color: TOKENS.inkSoft, marginTop: 4, lineHeight: 1.55 }}>
            告诉我原因，下次给「{skuName}」这类商品的建议会更准。
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
          {presets.map((r) => {
            const sel = picked === r && !text.trim();
            return (
              <button key={r} onClick={() => { setPicked(sel ? null : r); setText(''); }} style={{
                appearance: 'none', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
                padding: '13px 15px', borderRadius: 14, fontSize: 14.5, fontWeight: 700,
                border: sel ? `2px solid ${TOKENS.red}` : '2px solid transparent',
                background: sel ? TOKENS.redSoft : '#fff',
                color: sel ? TOKENS.red : TOKENS.ink,
                boxShadow: sel ? 'none' : TOKENS.shadow1,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              }}>
                {r}
                {sel && I.Check({ size: 17, color: TOKENS.red })}
              </button>
            );
          })}
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); if (e.target.value.trim()) setPicked(null); }}
            placeholder="或者自己写原因…"
            rows={2}
            style={{
              boxSizing: 'border-box', width: '100%', resize: 'none',
              border: text.trim() ? `2px solid ${TOKENS.red}` : `1.5px solid ${TOKENS.line}`,
              borderRadius: 14, padding: '12px 14px',
              fontFamily: 'inherit', fontSize: 14, lineHeight: 1.55, color: TOKENS.ink,
              background: '#fff', outline: 'none',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={onCancel} style={{
            appearance: 'none', fontFamily: 'inherit', cursor: 'pointer',
            flex: 1, height: 50, borderRadius: 25, background: '#fff',
            border: `1.5px solid ${TOKENS.line}`, color: TOKENS.inkSoft, fontSize: 15.5, fontWeight: 700,
          }}>不跳了</button>
          <button onClick={() => reason && onConfirm(reason)} disabled={!reason} style={{
            appearance: 'none', border: 0, fontFamily: 'inherit',
            flex: 1.4, height: 50, borderRadius: 25,
            background: reason ? TOKENS.red : '#ddd6cc', color: '#fff',
            fontSize: 16, fontWeight: 700, letterSpacing: 1,
            cursor: reason ? 'pointer' : 'not-allowed',
            boxShadow: reason ? `0 8px 24px ${TOKENS.red}40` : 'none',
          }}>{reason ? '确认跳过' : '请先选个原因'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- 子组件：清单确认 ---------------------------------------------------

type AcceptedItem = AiStrategyItem & { kind: StrategyKind };

function ConfirmList({
  accepted, skippedIdx, skipReasons, skus, counts, onRestore, onRecheck, onApply, applying, applyError,
}: {
  accepted: AcceptedItem[];
  skippedIdx: number[];
  skipReasons: (string | null)[];
  skus: AiStrategyItem[];
  counts: { remove: number; observe: number; push: number };
  onRestore: (idx: number) => void;
  onRecheck: () => void;
  onApply: () => void;
  applying: boolean;
  applyError: boolean;
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  const groups = [
    { kind: 'remove'  as const, label: '停止进货', color: TOKENS.red,   bg: TOKENS.redSoft },
    { kind: 'observe' as const, label: '保留观察', color: TOKENS.amber, bg: TOKENS.amberSoft },
    { kind: 'push'    as const, label: '上架新品', color: TOKENS.green, bg: TOKENS.greenSoft },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 130px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ textAlign: 'center', padding: '4px 0 2px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: TOKENS.ink }}>都过完了，确认一下清单</div>
          <div style={{ fontSize: 12.5, color: TOKENS.inkSoft, marginTop: 4 }}>确认没问题就点最下面的红色按钮应用</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {groups.map((g) => (
            <div key={g.kind} style={{ background: g.bg, borderRadius: 12, padding: '10px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: g.color }}>{counts[g.kind]}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: g.color, marginTop: 1 }}>{g.label}</div>
            </div>
          ))}
        </div>

        {groups.map((g) => {
          const items = accepted.filter((s) => s.kind === g.kind);
          if (items.length === 0) return null;
          return (
            <Card key={g.kind} pad={14}>
              <div style={{ fontSize: 13, fontWeight: 800, color: g.color, marginBottom: 8 }}>{g.label}（{items.length}）</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {items.map((s) => (
                  <ProductRow key={s.skuCode} sku={s} right={s.tags[0] ? <Chip tone={g.kind === 'remove' ? 'red' : g.kind === 'push' ? 'green' : 'amber'} style={{ flexShrink: 0 }}>{s.tags[0]}</Chip> : undefined} />
                ))}
              </div>
            </Card>
          );
        })}

        {skippedIdx.length > 0 && (
          <Card pad={14} style={{ background: '#f4f1ea', boxShadow: 'none' }}>
            <button onClick={() => setShowSkipped(!showSkipped)} style={{
              appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer',
              width: '100%', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 13, fontWeight: 700, color: TOKENS.inkSoft,
            }}>
              <span>跳过了 {skippedIdx.length} 条（不会处理）</span>
              {I.ChevronD({ size: 15, color: TOKENS.inkMuted })}
            </button>
            {showSkipped && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                {skippedIdx.map((i) => (
                  <div key={skus[i]!.skuCode} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ProductRow sku={skus[i]!} dim />
                      {skipReasons[i] && (
                        <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 3, paddingLeft: 43 }}>原因：{skipReasons[i]}</div>
                      )}
                    </div>
                    <button onClick={() => onRestore(i)} style={{
                      appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer',
                      fontSize: 12.5, fontWeight: 700, color: TOKENS.red, padding: '7px 4px', flexShrink: 0,
                    }}>恢复</button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        <button onClick={onRecheck} style={{
          appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer',
          fontSize: 12.5, color: TOKENS.inkMuted, fontWeight: 600, textDecoration: 'underline', padding: '2px 0',
        }}>重新逐条看一遍</button>

        {applyError && (
          <div style={{ background: TOKENS.redSoft, color: TOKENS.red, padding: 12, borderRadius: 12, fontSize: 13 }}>
            应用失败，请稍后重试
          </div>
        )}
      </div>

      <BottomBar>
        <PrimaryBtn
          disabled={accepted.length === 0 || applying}
          onClick={onApply}
          icon={accepted.length > 0 ? I.Check({ size: 20, color: '#fff' }) : undefined}
        >
          {applying ? '正在应用…' : accepted.length === 0 ? '清单是空的，恢复几条再应用' : `应用调改（共 ${accepted.length} 条）`}
        </PrimaryBtn>
      </BottomBar>
    </div>
  );
}

function ProductRow({ sku, right, dim }: { sku: AiStrategyItem; right?: React.ReactNode; dim?: boolean }) {
  return (
    <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9 }}>
      <SkuThumb skuCode={sku.skuCode} size={34} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600,
        color: dim ? TOKENS.inkMuted : TOKENS.ink,
        textDecoration: dim ? 'line-through' : 'none',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {sku.skuName} {sku.spec && <span style={{ fontSize: 11.5, color: TOKENS.inkMuted, fontWeight: 500 }}>{sku.spec}</span>}
      </span>
      {right}
    </div>
  );
}

function SkuThumb({ skuCode, size }: { skuCode: string; size: number }) {
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
        // contain：商品官方图大多是 1:1 + 大边距设计，cover 会把瓶身两端裁掉
        // 用户看不见商品本体。参考 posters/ProductImg.tsx。
        objectFit: 'contain', background: '#fafafa', flexShrink: 0,
        border: `1px solid ${TOKENS.line}`,
        padding: Math.round(size / 24),
      }}
    />
  );
}

function AppliedPanel({ counts, sceneStr }: { counts: { push: number; remove: number }; sceneStr: string }) {
  const navigate = useNavigate();
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 20px 40px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ textAlign: 'center', padding: '10px 0 6px' }}>
        <div style={{
          width: 74, height: 74, borderRadius: '50%', background: TOKENS.greenSoft, margin: '0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'shv-pop 0.45s cubic-bezier(0.2, 1.4, 0.5, 1)',
        }}>{I.Check({ size: 38, color: TOKENS.green })}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: TOKENS.ink, marginTop: 14 }}>调改已完成</div>
        <div style={{ fontSize: 13.5, color: TOKENS.inkSoft, marginTop: 6 }}>
          上架了 {counts.push} 个品，停止进货了 {counts.remove} 个品
        </div>
      </div>

      <Card pad={14} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Spin size={26} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: TOKENS.ink }}>正在帮你生成陈列示意图…</div>
          <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginTop: 2, lineHeight: 1.5 }}>
            不用等在这里，过一会回来看就行
          </div>
        </div>
      </Card>

      <ListRow
        icon={I.Doc({ size: 20, color: TOKENS.red })}
        label="查看调改清单和陈列示意图"
        hint="刚应用的清单 + 货架怎么摆"
        onClick={() => navigate({ to: '/shelves/scene/$scene/last', params: { scene: sceneStr } })}
      />

      <Card pad={13} style={{ background: TOKENS.amberSoft, boxShadow: 'none' }}>
        <div style={{ fontSize: 12.5, color: TOKENS.amber, lineHeight: 1.65 }}>
          接下来记得：按清单调整货架，下架的商品停止订货，新品到货后摆上货架。
          <span style={{ fontWeight: 800 }}>过两周再回来</span>，工作台的「调改效果追踪」里就能看到销量变化了。
        </div>
      </Card>

      <GhostBtn onClick={() => navigate({ to: '/shelves/scene/$scene', params: { scene: sceneStr } })} style={{ marginTop: 8 }}>
        返回工作台
      </GhostBtn>
    </div>
  );
}
