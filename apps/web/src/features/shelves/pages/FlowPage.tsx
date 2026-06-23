/**
 * 选品 · 拍照调改流（核心 7 阶段，接真实接口）
 *
 * 阶段：photo → diagnosing → diag → review → confirm → applied
 *
 * 真实链路（原版 PhotoPage 还原）：
 *  - photo：<input type="file" accept="image/*"> 走系统原生选择器（拍照 / 相册 / 文件），多张 → 一次 multipart 上传
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppBar, BottomBar, Card, Chip, FlowSteps, GhostBtn, ListRow,
  PrimaryBtn, ScreenWrap, Spin,
} from '../ui/primitives';
import { TOKENS } from '../ui/tokens';
import { I } from '../ui/icons';
import { scenesApi, detectApi, storeApi, type DetectBox, type StoreSku, type SceneRuntime, type BenchmarkSku } from '../api';
import type { DiagnosisResult, DiagnosisStatusItem, StrategyItem as AiStrategyItem } from '../sse';
import { classifyStrategyKind, type StrategyKind } from '../lib/strategyAction';
import { SKIP_REASONS } from '../data';
import { SkuDetailDialog, type SkuDetailLike } from '../components/SkuDetailDialog';
import { SkuThumb } from '../components/SkuThumb';
import { VirtualShelfRenderer } from '../virtual-shelf/VirtualShelfRenderer';
import { unwrapSkuLct } from '../virtual-shelf/parseDifyOutput';

/**
 * 多张照片时,每张套一组"识别框"做视觉区分(检测只在第 1 张上跑真实结果,
 * 其余张用下面这几组预设位置画框,避免每张照片画得一模一样)。
 * 数值是相对坐标 [0,1],只关心 x/y/w/h —— 跟 DetectBox 的 x/y/w/h 子集兼容,
 * 不需要 skuCode/confidence。PhotoWithBoxes 也只读这四个字段。
 */
type FrameBox = Pick<DetectBox, 'x' | 'y' | 'w' | 'h'>;
const PRESET_BOX_SETS: FrameBox[][] = [
  // preset A:上层 3 排 / 下层 2 排
  [
    { x: 0.06, y: 0.10, w: 0.22, h: 0.30 },
    { x: 0.34, y: 0.12, w: 0.30, h: 0.28 },
    { x: 0.70, y: 0.10, w: 0.24, h: 0.32 },
    { x: 0.10, y: 0.55, w: 0.36, h: 0.34 },
    { x: 0.54, y: 0.55, w: 0.36, h: 0.34 },
  ],
  // preset B:网格 2x3
  [
    { x: 0.06, y: 0.08, w: 0.26, h: 0.36 },
    { x: 0.38, y: 0.06, w: 0.24, h: 0.38 },
    { x: 0.68, y: 0.08, w: 0.26, h: 0.36 },
    { x: 0.08, y: 0.54, w: 0.28, h: 0.36 },
    { x: 0.40, y: 0.52, w: 0.22, h: 0.40 },
    { x: 0.68, y: 0.55, w: 0.26, h: 0.34 },
  ],
  // preset C:错落 4 框
  [
    { x: 0.10, y: 0.15, w: 0.36, h: 0.30 },
    { x: 0.54, y: 0.08, w: 0.32, h: 0.36 },
    { x: 0.06, y: 0.58, w: 0.30, h: 0.32 },
    { x: 0.46, y: 0.60, w: 0.44, h: 0.32 },
  ],
];

type Stage = 'photo' | 'diagnosing' | 'diag' | 'review' | 'confirm' | 'applied';
type Decision = 'accept' | 'skip';

/**
 * V028: draft 只持 frontend 私有状态(stage/decisions/...)。
 * diagnose / strategy 的结果与状态由后端 ensureXxx 落到 runtime.{diagnose,strategy}_*,
 * 前端轮询拿,不再二次往 draft 写。aiError 仍留:detect 报错走 detectError,Dify 报错走 aiError。
 */
interface DraftShape {
  stage: Stage;
  reviewIndex?: number;
  decisions?: Decision[];
  skipReasons?: (string | null)[];
  detectBoxes?: DetectBox[] | null;
  detectError?: string | null;
  aiError?: string | null;
}

const KIND_META: Record<StrategyKind, { label: string; color: string; bg: string; emoji: string }> = {
  remove:  { label: '建议：停止进货', color: TOKENS.red,   bg: TOKENS.redSoft,   emoji: '📦' },
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
    // V028: 诊断/选品状态来自 runtime.diagnose_status / strategy_status (后端 ensureXxx 落库)
    // 任一为 'processing' 就 5s 轮询一次。关 tab / 刷新照样能恢复。
    refetchInterval: (q) => {
      const r = q.state.data as
        | { diagnoseStatus?: string; strategyStatus?: string }
        | undefined;
      const inFlight = r?.diagnoseStatus === 'processing' || r?.strategyStatus === 'processing';
      return inFlight ? 5_000 : false;
    },
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
  //
  // 等 runtimeQ 既 isSuccess=true 又 isFetching=false 才 hydrate：
  // 重新进入 FlowPage 时 React Query 会先返陈旧 cache（isSuccess=true）再后台
  // refetch（isFetching=true）。只看 isSuccess 会用陈旧 draft 把 stage 锁回 photo，
  // 之后 refetch 拿到 stage='diagnosing' 也无法再恢复（hydrated 已 true）。

  useEffect(() => {
    if (hydrated || !runtimeQ.isSuccess || runtimeQ.isFetching) return;
    setHydrated(true);
    if (photosFromServer.length > 0) {
      setPhotos(photosFromServer.map((p) => ({ url: p.url })));
    }
    if (!draft) return;
    if (draft.detectBoxes) { setDetectBoxes(draft.detectBoxes); setDetectDone(true); }
    if (draft.detectError) setDetectError(draft.detectError);
    if (draft.aiError) setAiError(draft.aiError);
    if (draft.decisions) setDecisions(draft.decisions);
    if (draft.skipReasons) setSkipReasons(draft.skipReasons);
    if (typeof draft.reviewIndex === 'number') setReviewIndex(draft.reviewIndex);
    // diagnosing 也要恢复：让退出 → 重进的店长直接看到 spinner 而不是回到拍照页
    if (
      draft.stage === 'diagnosing' || draft.stage === 'diag' ||
      draft.stage === 'review' || draft.stage === 'confirm'
    ) {
      setStage(draft.stage);
    }
  }, [hydrated, runtimeQ.isSuccess, runtimeQ.isFetching, draft, photosFromServer]);

  // V028: 轮询 runtime 命中 'completed' 时,从 raw_outputs.parsed 同步到本地 state。
  // 跨页面 navigation 回来后,新挂载的 FlowPage 会通过这里恢复诊断/选品结果。
  useEffect(() => {
    if (diagnosis) return;
    const raw = runtimeQ.data?.diagnoseRawOutputs as { parsed?: DiagnosisResult } | null | undefined;
    if (runtimeQ.data?.diagnoseStatus === 'completed' && raw?.parsed) {
      setDiagnosis(raw.parsed);
    }
  }, [diagnosis, runtimeQ.data?.diagnoseStatus, runtimeQ.data?.diagnoseRawOutputs]);
  useEffect(() => {
    if (strategy) return;
    const raw = runtimeQ.data?.strategyRawOutputs as { parsed?: { items?: AiStrategyItem[] } } | null | undefined;
    if (runtimeQ.data?.strategyStatus === 'completed' && raw?.parsed?.items) {
      setStrategy(raw.parsed.items);
    }
  }, [strategy, runtimeQ.data?.strategyStatus, runtimeQ.data?.strategyRawOutputs]);

  // V028: 失败状态从 runtime 拿。
  // 诊断失败 → aiError(在 diagnosing 阶段展示);
  // 选品失败不进 aiError —— 选品对前端而言只在 stage='diag' 之后存在,
  // 失败直接靠 stage='diag' 底部按钮的 strategyFailed 分支呈现(避免诊断阶段就泄露选品在跑)。
  useEffect(() => {
    const diagErr = (runtimeQ.data?.diagnoseRawOutputs as { error?: string } | null)?.error;
    if (runtimeQ.data?.diagnoseStatus === 'failed' && diagErr) {
      setAiError(`诊断失败:${diagErr}`);
    }
  }, [runtimeQ.data?.diagnoseStatus, runtimeQ.data?.diagnoseRawOutputs]);

  // ---- 草稿写入（增量 merge） --------------------------------------------

  // saveDraft：每次 mutation 把 patch 合到 cache 里现有的 draft 上，再整段写回 DB。
  //
  // 关键点：mutationFn 和 onMutate 都从 React Query cache 读 latest，不用组件闭包里的 draft。
  // 原因：诊断阶段 3 个 IIFE（detect / diagnose / strategy）会从同一次点击的闭包里同时
  // 调 saveDraft，闭包里的 draft 是同一份 stale snapshot，3 个 `{...draft, ...patch}` 互相
  // 覆盖会把对方的字段全擦掉（最后落地那个的 patch 字段才留下）—— 用户表现：退出再进发现
  // strategy 已经没了，confirm 阶段被 `stage === 'confirm' && strategy` 的 strategy 短路成空白。
  //
  // onMutate 做乐观更新 + cancelQueries 拦截 refetch 乱序覆盖；onSettled 收尾再 invalidate。
  const saveDraft = useMutation({
    mutationFn: (patch: Partial<DraftShape>) => {
      const latest = qc.getQueryData<{ draft?: DraftShape | null }>(['scenes', scene, 'runtime']);
      const latestDraft = (latest?.draft ?? null) as DraftShape | null;
      return scenesApi.saveRuntime(scene, {
        draft: { ...(latestDraft ?? {}), ...patch, stage: patch.stage ?? latestDraft?.stage ?? stage } as any,
      } as any);
    },
    onMutate: async (patch: Partial<DraftShape>) => {
      await qc.cancelQueries({ queryKey: ['scenes', scene, 'runtime'] });
      const prev = qc.getQueryData<{ draft?: DraftShape | null }>(['scenes', scene, 'runtime']);
      const prevDraft = (prev?.draft ?? {}) as DraftShape;
      const nextDraft = { ...prevDraft, ...patch, stage: patch.stage ?? prevDraft.stage ?? stage };
      qc.setQueryData(['scenes', scene, 'runtime'], (old: any) =>
        old ? { ...old, draft: nextDraft } : old,
      );
      return { prev };
    },
    onError: (_err, _patch, ctx) => {
      const c = ctx as { prev?: unknown } | undefined;
      if (c?.prev !== undefined) qc.setQueryData(['scenes', scene, 'runtime'], c.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['scenes', scene, 'runtime'] });
    },
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

    // V028: stage 推进 + 清残留(diagnose/strategy 状态走 runtime,不再写 draft)
    saveDraft.mutate({
      stage: 'diagnosing',
      aiError: null,
      detectBoxes: null,
      detectError: null,
    });

    // detect：用第一张原图(fetch 拿回 blob → 调 detectApi) — 非 Dify, 保留前端 IIFE
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

    // V028: Dify align / selection 触发后台任务,不读 SSE。后端 ensureXxx 落
    // runtime.{diagnose,strategy}_status / _raw_outputs;轮询自动拉。
    void scenesApi.triggerDiagnose(scene, firstPhotoUrl).catch((e) => {
      setAiError(`诊断触发失败:${(e as Error).message}`);
    });
    void scenesApi.triggerStrategy(scene).catch((e) => {
      setAiError((prev) => prev ?? `方案触发失败:${(e as Error).message}`);
    });
    // 触发后立即 invalidate 让 refetchInterval 拉一次,把 status 切到 'processing'
    void qc.invalidateQueries({ queryKey: ['scenes', scene, 'runtime'] });
  };

  // 诊断结果出来就直接进 diag 展示（不等选品）；选品结果在按钮区域单独显示加载/启用状态。
  useEffect(() => {
    if (stage === 'diagnosing' && diagnosis) {
      setStage('diag');
      saveDraft.mutate({ stage: 'diag' });
    }
  }, [stage, diagnosis]); // eslint-disable-line react-hooks/exhaustive-deps

  // 进入 diag 阶段后强制 3 秒后才暴露选品的真实状态(避免选品先于诊断完成时
  // 体验上"诊断刚出选品就同时出现",店长会以为它们是同时跑的)。
  // 3 秒过后,无论选品已 ready / 还在转 / 已失败,按钮按真实状态渲染。
  //
  // 注意:这个过渡只在 diagnosing → diag 的首次推进时才需要。如果用户是从 review/confirm
  // 阶段通过进度条点回 diag,选品早已 ready,再强制 3 秒"正在生成"会让用户以为方案没了。
  // 用 prevStageRef 来区分两种入口。
  const prevStageRef = useRef<Stage | null>(null);
  const [strategyVisible, setStrategyVisible] = useState(false);
  useEffect(() => {
    const prev = prevStageRef.current;
    prevStageRef.current = stage;
    if (stage !== 'diag') {
      setStrategyVisible(false);
      return;
    }
    if (prev === 'diagnosing') {
      // 首次从诊断中推进到诊断结果 —— 3 秒过渡
      setStrategyVisible(false);
      const t = setTimeout(() => setStrategyVisible(true), 3000);
      return () => clearTimeout(t);
    }
    // 其余入口(从 review/confirm 回退、刷新页面恢复到 diag 等)立刻显示真实状态
    setStrategyVisible(true);
  }, [stage]);

  // 诊断 / 选品 5min 超时后 status='failed' — 提供单独重试,不要无脑重跑成功的那个
  const diagnoseFailed = runtimeQ.data?.diagnoseStatus === 'failed';
  const strategyFailed = runtimeQ.data?.strategyStatus === 'failed';

  const retryFailedWorkflow = async (kind: 'diagnose' | 'strategy' | 'both') => {
    setAiError(null);
    // 乐观把 cache 里失败状态改回 processing,防止 aiError useEffect 立刻又把消息塞回去
    qc.setQueryData(['scenes', scene, 'runtime'], (old: any) => {
      if (!old) return old;
      const next = { ...old };
      if (kind !== 'strategy') next.diagnoseStatus = 'processing';
      if (kind !== 'diagnose') next.strategyStatus = 'processing';
      return next;
    });

    // 触发 POST 必须 await 而不是 fire-and-forget —— 否则后面那行 invalidateQueries 引发的
    // GET 跟 POST 同时发,GET 经常比 POST 内部的 markAiStatusProcessing 早写完读 DB,
    // 拿到旧的 'failed' 覆盖乐观更新 → 用户看见"点了一下没反应,还得再点一次"。
    const tasks: Array<Promise<unknown>> = [];
    if (kind === 'diagnose' || kind === 'both') {
      const rawUrl = photos.find((p) => p.url)?.url ?? '';
      const photoUrl = rawUrl
        ? (rawUrl.startsWith('http') ? rawUrl : `${window.location.origin}${rawUrl}`)
        : '';
      if (photoUrl) {
        tasks.push(
          scenesApi.triggerDiagnose(scene, photoUrl).catch((e) => {
            setAiError(`诊断触发失败:${(e as Error).message}`);
          }),
        );
      }
    }
    if (kind === 'strategy' || kind === 'both') {
      tasks.push(
        scenesApi.triggerStrategy(scene).catch((e) => {
          setAiError((prev) => prev ?? `方案触发失败:${(e as Error).message}`);
        }),
      );
    }
    await Promise.all(tasks);
    // 这时 POST 路由内部的 markAiStatusProcessing 已经把 DB 推到 'processing',
    // 再 invalidate 触发的 GET 必然读得到 processing,不会把乐观更新覆盖回 failed。
    void qc.invalidateQueries({ queryKey: ['scenes', scene, 'runtime'] });
  };

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
        kind: kind === 'remove' ? 'remove' : 'add',
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

  /** "全部应用" 快进:把当前及之后所有未决条目默认 accept,直接跳到清单确认阶段 */
  const fastForwardAccept = () => {
    if (!strategy) return;
    const nextDec = [...decisions];
    const nextReasons = [...skipReasons];
    for (let i = reviewIndex; i < strategy.length; i++) {
      nextDec[i] = 'accept';
      nextReasons[i] = null;
    }
    setDecisions(nextDec);
    setSkipReasons(nextReasons);
    setStage('confirm');
    saveDraft.mutate({ stage: 'confirm', decisions: nextDec, skipReasons: nextReasons });
  };

  // 诊断结果 / 逐条确认 两个阶段都要 storeSku 列表:
  //   - diag:算日均销售额 / 日均销量 KPI
  //   - review:卡片下半的代码/销量/销售额/二维码
  // (key 与 SkuListPanel 同,react-query 自动去重)
  const storeSkusQ = useQuery({
    queryKey: ['store', 'skus', 'scene', scene],
    queryFn: () => storeApi.skus(scene),
    enabled: stage === 'review' || stage === 'diag',
  });
  // 逐条确认卡片的三个指标(销额/销量/环比)以及上架类型 chip 用的是"参考店"(跨店标杆)数据,
  // 不再用本店 storeSku。同场景下后端会按店配重均出 30 日销售额 / 销量 / PSD 环比。
  const benchmarkQ = useQuery({
    queryKey: ['scenes', scene, 'benchmark'],
    queryFn: () => scenesApi.benchmark(scene),
    enabled: stage === 'review',
    staleTime: 5 * 60_000,
  });
  const benchmarkByCode = useMemo(() => {
    const map = new Map<string, BenchmarkSku>();
    for (const b of benchmarkQ.data?.items ?? []) map.set(b.skuCode, b);
    return map;
  }, [benchmarkQ.data]);
  const storeSkuByCode = useMemo(() => {
    const map = new Map<string, StoreSku>();
    for (const s of storeSkusQ.data?.skus ?? []) map.set(s.skuCode, s);
    return map;
  }, [storeSkusQ.data]);
  /** 诊断卡 KPI:基于 30 日总额/总量算日均;动销率 = 30 天有销量的 SKU 数 / 全部 SKU 数 */
  const dailyKpi = useMemo(() => {
    const list = storeSkusQ.data?.skus ?? [];
    let amtSum = 0;
    let qtySum = 0;
    let active = 0;
    for (const r of list) {
      amtSum += Number(r.salesRealamt30d ?? 0);
      qtySum += Number(r.salesQty30d ?? 0);
      if (Number(r.salesQty30d ?? 0) > 0) active += 1;
    }
    const total = list.length;
    return {
      amount: amtSum / 30,
      qty: qtySum / 30,
      activeRatio: total > 0 ? active / total : 0,
      activeFraction: total > 0 ? `${active}/${total}` : '0/0',
    };
  }, [storeSkusQ.data]);

  // 场景名 — 用于 KPI 文案 "{冷藏}日均销售额" 这种带场景前缀
  const scenesListQ = useQuery({ queryKey: ['scenes', 'list'], queryFn: scenesApi.list });
  const sceneName = scenesListQ.data?.scenes.find((s) => s.scene === scene)?.name ?? '';

  // 诊断结果文本里可能出现的本店商品名 —— 提到的 SKU 在文中标蓝。匹配只看名字不带规格。
  // 排序按长度降序,避免短前缀(如"伊利")抢走更长的完整商品名(如"伊利金典纯牛奶")。
  const skuNames = useMemo(() => {
    const list = storeSkusQ.data?.skus ?? [];
    const set = new Set<string>();
    for (const s of list) {
      const n = (s.productName ?? '').trim();
      if (n.length >= 2) set.add(n);
    }
    return Array.from(set).sort((a, b) => b.length - a.length);
  }, [storeSkusQ.data]);

  const accepted = strategy
    ? strategy.filter((_, i) => decisions[i] === 'accept').map((s) => ({ ...s, kind: classifyStrategyKind(s.action) }))
    : [];
  const skippedIdx = strategy
    ? strategy.map((_, i) => i).filter((i) => decisions[i] === 'skip')
    : [];
  const counts = {
    remove: accepted.filter((s) => s.kind === 'remove').length,
    push: accepted.filter((s) => s.kind === 'push').length,
  };

  // ---- 阶段 7：应用调改 ----------------------------------------------------

  const apply = useMutation({
    mutationFn: async () => {
      const items = accepted.map((s) => ({
        action: s.kind === 'push' ? 'add' as const : 'remove' as const,
        skuCode: s.skuCode,
        productName: s.skuName,
        reasonCode: s.kind === 'push' ? 'ai_recommend_core' : 'low_sales',
        reasonText: s.reason,
      }));
      const summary = `上架了${counts.push}个品，停止进货了${counts.remove}个品`;
      // apply 后端会 RESET photos / draft / status / detection_data；
      // 但 last_snapshot 保留。把这一次的「照片 / 诊断 / 识别框 / 调改项」打包写入，
      // 供 LastPage 复现「上一次调改的详情」（照片、诊断、清单、虚拟货架图）。
      await scenesApi.saveRuntime(scene, {
        lastSnapshot: {
          at: new Date().toISOString(),
          summary,
          items: items.map((i) => ({
            skuCode: i.skuCode, skuName: i.productName, kind: i.action,
            spec: accepted.find((s) => s.skuCode === i.skuCode)?.spec ?? null,
          })),
          photos: photos.filter((p) => p.url).map((p) => ({ url: p.url })),
          diagnosis,
          detectBoxes,
        } as unknown as SceneRuntime['lastSnapshot'],
      });
      return scenesApi.apply(scene, { summaryText: summary, items });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scenes', 'overview'] });
      void qc.invalidateQueries({ queryKey: ['scenes', scene] });
      // 关键:apply 后端会重置 virtual_status=idle / virtual_raw_outputs=null,
      // 但 React Query cache 还残留着上一次调改的 'completed' 数据,这会让 AppliedPanel
      // 第一帧闪一下旧陈列图,几百毫秒后 refetch 才把它换成 "正在生成中…"。
      // 在切到 applied stage 之前,先把 cache 里这俩字段乐观清掉,refetch 返回前就是空状态。
      qc.setQueryData(['scenes', scene, 'runtime'], (old) => {
        if (!old || typeof old !== 'object') return old;
        return { ...(old as Record<string, unknown>), virtualStatus: 'processing', virtualRawOutputs: null };
      });
      setStage('applied');
      // V028: virtual-shelf 不再前端触发 — apply 路由内部已 fire-and-forget 触发 ensureVirtualShelf。
      // LastPage 通过 runtime.virtualStatus 轮询拿状态(5~10 分钟级,关 tab 仍然继续)。
      // 这里 invalidate 一次让 LastPage 即刻看到 virtual_status='processing'。
      void qc.invalidateQueries({ queryKey: ['scenes', scene, 'runtime'] });
    },
  });

  // ---- 渲染 -------------------------------------------------------------

  const stepIndex: number = { photo: 0, diagnosing: 1, diag: 2, review: 2, confirm: 2, applied: 2 }[stage];
  const [heroIdx, setHeroIdx] = useState(0);
  const safeHeroIdx = Math.min(heroIdx, Math.max(photos.length - 1, 0));
  const heroPhoto = photos[safeHeroIdx]?.url || photos[safeHeroIdx]?.localPreview || '';
  // 第 1 张用真实识别框(若已就绪),其他张用预设框组,每张套不同 preset 视觉上区分
  const heroBoxes: FrameBox[] = safeHeroIdx === 0
    ? (detectBoxes ?? PRESET_BOX_SETS[0]!)
    : PRESET_BOX_SETS[safeHeroIdx % PRESET_BOX_SETS.length]!;

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
      {stage !== 'applied' && (
        <FlowSteps
          current={stepIndex}
          steps={['拍照', 'AI 诊断', '确认方案']}
          /* 进度条点击导航:
             - 拍照(0)始终不允许点(用户明确要求)
             - AI 诊断(1)从 review/confirm 可点 → 跳回 diag(决定保留)
             - 确认方案(2)从 diag 可点 → 跳回 confirm,前提是 strategy 已 ready 且
               所有条目都做过决定(accepted+skipped 覆盖整张 strategy)。这样确保
               用户通过"AI 诊断"按钮从 confirm 切回来后,可以再点"确认方案"切回去 */
          clickableIndices={(() => {
            const idx: number[] = [];
            if (diagnosis && (stage === 'review' || stage === 'confirm')) idx.push(1);
            if (
              stage === 'diag' &&
              strategy && strategy.length > 0 &&
              (accepted.length + skippedIdx.length) >= strategy.length
            ) idx.push(2);
            return idx;
          })()}
          onStepClick={(i) => {
            if (i === 1) {
              setStage('diag');
              saveDraft.mutate({ stage: 'diag' });
            } else if (i === 2) {
              setStage('confirm');
              saveDraft.mutate({ stage: 'confirm' });
            }
          }}
        />
      )}

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
        // 外层只负责"装不下就滚"(flex:1 拿可用高度,overflowY:auto 开滚);
        // flex column 布局放到内层 wrapper —— 直接套一层会把所有子元素当 flex item,
        // 默认 flex-shrink:1 → 屏幕装不下时(尤其竖屏拍的照片)会把照片、SkuListPanel
        // 按钮、提示语全压扁,而不是触发滚动。一层只管滚 / 一层只管堆,各司其职。
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '12px 16px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* 跟诊断结果页保持一致 — 按原图比例完整展示,不裁切 */}
            {heroPhoto && (
              <>
                <PhotoWithBoxes src={heroPhoto} boxes={[]} scanning fit="natural" />
                {photos.length > 1 && (
                  <PhotoSwitcher photos={photos} active={safeHeroIdx} onPick={setHeroIdx} />
                )}
              </>
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
                <ProgressStep
                  label="结合门店周边环境与销售数据进行诊断"
                  done={!!diagnosis}
                  running={!diagnosis && !diagnoseFailed}
                  failed={diagnoseFailed && !diagnosis}
                />
                {/* 不在 diagnosing 阶段展示"生成选品方案" — 选品对用户的视角下应在诊断之后才发生 */}
              </div>
            </Card>
            {/* 等待期间让店长可以先看本场景的商品数据 */}
            {/* 改成 bottom sheet 后默认不自动弹出,避免铺满整屏挡住诊断进度 */}
            <SkuListPanel scene={scene} />
            <div style={{ fontSize: 12, color: TOKENS.inkMuted, textAlign: 'center' }}>
              {diagnoseFailed
                ? '诊断已超过 5 分钟,可点下方按钮重试'
                : '诊断需要 30-60 秒，请耐心等待'}
            </div>
            {(aiError || diagnoseFailed) && (
              <Card pad={12} style={{ background: TOKENS.redSoft, boxShadow: 'none' }}>
                <div style={{ fontSize: 12.5, color: TOKENS.red, lineHeight: 1.55 }}>
                  {aiError ?? '诊断生成已超时,请重试。'}
                </div>
                <button onClick={() => {
                  if (diagnoseFailed) void retryFailedWorkflow('diagnose');
                  else void startDiagnosis();
                }} style={{
                  appearance: 'none', border: 0, marginTop: 8, padding: '6px 12px',
                  background: '#fff', color: TOKENS.red, borderRadius: 14,
                  fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                }}>
                  {diagnoseFailed ? '重试诊断' : '重试'}
                </button>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ===== 阶段 3：诊断结果（诊断先出就先展，选品在底部按钮区域同步加载状态） ===== */}
      {stage === 'diag' && diagnosis && (
        <>
          {/* 外层只负责"出了就滚"(flex:1 拿可用高度,overflowY:auto 开滚);
              flex column 布局下移到内层 wrapper,这样内部 Card 按自然高度堆叠
              不会被 flex-shrink:1 压扁。 */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div style={{ padding: '12px 16px 130px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* 诊断已出 → 此时才显示识别红框(如 detect 已就绪)
                诊断结果页要看清完整照片,所以用 natural 模式不裁切、按原图比例渲染 */}
            {heroPhoto && (
              <>
                <PhotoWithBoxes src={heroPhoto} boxes={heroBoxes} scanning={false} fit="natural" />
                {photos.length > 1 && (
                  <PhotoSwitcher photos={photos} active={safeHeroIdx} onPick={setHeroIdx} />
                )}
              </>
            )}

            {/* 1) 诊断摘要 + 季节叙事 + KPI(日均销售额 / 日均销量) */}
            <Card pad={16}>
              {diagnosis.summary && (
                <div style={{ fontSize: 17, fontWeight: 800, color: TOKENS.ink, lineHeight: 1.55 }}>
                  <HighlightText text={diagnosis.summary} skuNames={skuNames} />
                </div>
              )}
              {diagnosis.paragraphSeason && (
                <div style={{
                  fontSize: 13.5, fontWeight: 600, color: TOKENS.inkSoft,
                  marginTop: diagnosis.summary ? 8 : 0, lineHeight: 1.7,
                }}>
                  <HighlightText text={diagnosis.paragraphSeason} skuNames={skuNames} />
                </div>
              )}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
                marginTop: (diagnosis.summary || diagnosis.paragraphSeason) ? 14 : 0,
              }}>
                <KpiTile
                  label={`${sceneName}日均销售额`}
                  value={fmtCnyRound(dailyKpi.amount)}
                  sub="（近30天）"
                />
                <KpiTile
                  label="日均销量"
                  value={fmtQtyOne(dailyKpi.qty)}
                  sub="（近30天）"
                />
                <KpiTile
                  label="动销率"
                  value={fmtPct(dailyKpi.activeRatio)}
                  sub={`（近30天 ${dailyKpi.activeFraction}）`}
                />
              </div>
            </Card>

            {/* 2) 客群 chips */}
            {diagnosis.paragraphCustomer.length > 0 && (
              <Card pad={16}>
                <div style={{ fontSize: 14, fontWeight: 800, color: TOKENS.ink, marginBottom: 10 }}>
                  来你店里买东西的，主要是这些人
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {diagnosis.paragraphCustomer.map((c, i) => (
                    <CustomerChip key={`${i}-${c}`} index={i} label={c} skuNames={skuNames} />
                  ))}
                </div>
              </Card>
            )}

            {/* 3) 各中类现状卡 */}
            {diagnosis.paragraphStatus.map((item, i) => (
              <StatusCard key={`${i}-${item.midCategory}`} item={item} skuNames={skuNames} />
            ))}

            {/* 4) "查看{场景}月销额详情" — 跟诊断中阶段同款,放在滚动内容最后 */}
            <SkuListPanel scene={scene} />

            </div>
          </div>
          <BottomBar>
            {!strategyVisible ? (
              // 进入 diag 后强制 3 秒 "正在生成方案…"; 即便后端选品已先于诊断 ready 也不立刻显示
              <PrimaryBtn disabled icon={<Spin size={18} />}>
                正在生成调改方案…
              </PrimaryBtn>
            ) : strategy === null && strategyFailed ? (
              <PrimaryBtn
                onClick={() => void retryFailedWorkflow('strategy')}
                icon={I.ArrowR({ size: 20, color: '#fff' })}
                style={{ background: TOKENS.red }}
              >
                方案生成已超时,点击重试
              </PrimaryBtn>
            ) : strategy === null ? (
              <PrimaryBtn disabled icon={<Spin size={18} />}>
                正在生成调改方案…
              </PrimaryBtn>
            ) : strategy.length === 0 ? (
              <PrimaryBtn disabled>AI 未返回方案</PrimaryBtn>
            ) : (accepted.length + skippedIdx.length) >= strategy.length ? (
              // 已经在 confirm 阶段确认完(或本次回到 diag 是从 confirm 跳来的) — 直接回方案清单,
              // 不再走 startReview 把决定清掉
              <PrimaryBtn
                onClick={() => { setStage('confirm'); saveDraft.mutate({ stage: 'confirm' }); }}
                icon={I.ArrowR({ size: 20, color: '#fff' })}
              >
                返回方案清单（共 {strategy.length} 条）
              </PrimaryBtn>
            ) : (
              <PrimaryBtn
                onClick={startReview}
                icon={I.ArrowR({ size: 20, color: '#fff' })}
              >
                {`查看调改方案（共 ${strategy.length} 条）`}
              </PrimaryBtn>
            )}
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
          onFastForward={fastForwardAccept}
          storeSkuByCode={storeSkuByCode}
          benchmarkByCode={benchmarkByCode}
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
        <AppliedPanel
          counts={counts}
          scene={scene}
          sceneStr={sceneStr}
          pushedSkuCodes={accepted.filter((s) => s.kind === 'push').map((s) => s.skuCode)}
        />
      )}
    </ScreenWrap>
  );
}

// ---- 子组件:诊断结果(KPI / 客群 chip / 中类现状卡) ----------------------

const fmtCnyRound = (n: number) =>
  Number.isFinite(n) && n > 0
    ? `¥${Math.round(n).toLocaleString('zh-CN')}`
    : '—';
const fmtQtyOne = (n: number) =>
  Number.isFinite(n) && n > 0
    ? `${(Math.round(n * 10) / 10).toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} 件`
    : '—';
const fmtPct = (n: number) =>
  Number.isFinite(n) && n > 0
    ? `${Math.round(n * 1000) / 10}%`
    : '—';

// ---- 诊断文本里的高亮:数字 → 橙色 / 命中商品库的商品名 → 蓝色 -----------
//
// 用一个 span 列表的"切片合并"模型:先把所有数字 / 商品名匹配段的 [start, end) 收齐,
// 商品名按长度降序排,后插入的若跟已存在的段重叠则丢弃(保留先到的更长 / 更专的命中)。
// 渲染时按 start 排序,在空隙里塞回普通文本。
const NUM_RE = /\d+(?:[.,]\d+)*%?/g;
const COLOR_NUM = '#e8541e';
const COLOR_SKU = '#3b6cd4';

function HighlightText({ text, skuNames }: { text: string; skuNames: string[] }) {
  const segments = useMemo(() => {
    if (!text) return [] as Array<{ text: string; kind: 'plain' | 'num' | 'sku' }>;
    const spans: Array<{ start: number; end: number; kind: 'num' | 'sku' }> = [];
    NUM_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NUM_RE.exec(text)) != null) {
      spans.push({ start: m.index, end: m.index + m[0].length, kind: 'num' });
    }
    for (const name of skuNames) {
      let idx = 0;
      while ((idx = text.indexOf(name, idx)) !== -1) {
        const end = idx + name.length;
        const overlap = spans.some((s) => Math.max(s.start, idx) < Math.min(s.end, end));
        if (!overlap) spans.push({ start: idx, end, kind: 'sku' });
        idx = end;
      }
    }
    spans.sort((a, b) => a.start - b.start);
    const out: Array<{ text: string; kind: 'plain' | 'num' | 'sku' }> = [];
    let cur = 0;
    for (const s of spans) {
      if (s.start > cur) out.push({ text: text.slice(cur, s.start), kind: 'plain' });
      out.push({ text: text.slice(s.start, s.end), kind: s.kind });
      cur = s.end;
    }
    if (cur < text.length) out.push({ text: text.slice(cur), kind: 'plain' });
    return out;
  }, [text, skuNames]);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === 'num') return <span key={i} style={{ color: COLOR_NUM, fontWeight: 700 }}>{seg.text}</span>;
        if (seg.kind === 'sku') return <span key={i} style={{ color: COLOR_SKU, fontWeight: 700 }}>{seg.text}</span>;
        return <span key={i}>{seg.text}</span>;
      })}
    </>
  );
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      background: TOKENS.bg, borderRadius: 12, padding: '10px 10px 11px',
      display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0,
    }}>
      <div style={{
        fontSize: 20, fontWeight: 800, color: TOKENS.red, lineHeight: 1.1,
        fontVariantNumeric: 'tabular-nums', letterSpacing: 0.2,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{value}</div>
      <div style={{
        fontSize: 12, fontWeight: 700, color: TOKENS.ink, lineHeight: 1.35,
        wordBreak: 'break-word',
      }}>{label}</div>
      {sub && (
        <div style={{ fontSize: 10.5, color: TOKENS.inkMuted, marginTop: 1, lineHeight: 1.3 }}>{sub}</div>
      )}
    </div>
  );
}

/** 客群 chip:轮换 3 种柔和底色让一行 chip 不至于单调 */
const CHIP_TONES: Array<{ bg: string; color: string }> = [
  { bg: '#e8f1fb', color: '#1d63b8' },
  { bg: '#e6f5ee', color: '#0f7a4a' },
  { bg: '#fdf1d6', color: '#9a6700' },
  { bg: '#f1ece4', color: '#5e5142' },
];
function CustomerChip({ index, label, skuNames }: { index: number; label: string; skuNames: string[] }) {
  const tone = CHIP_TONES[index % CHIP_TONES.length]!;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '6px 12px', borderRadius: 16,
      background: tone.bg, color: tone.color,
      fontSize: 13, fontWeight: 700, lineHeight: 1.3,
    }}>
      <HighlightText text={label} skuNames={skuNames} />
    </span>
  );
}

/** 中类现状卡:左边一道彩条 + 标题 + 右上角销额占比·日均销量 + 描述
 * 图标与彩条均不做语义化分类(按用户决策):图标固定为 📊,彩条用品牌红;
 * 让趋势由"数据(销售额%、日均件数)+描述文本"自身去表达,而不是 emoji 偷偷代言。
 */
function StatusCard({ item, skuNames }: { item: DiagnosisStatusItem; skuNames: string[] }) {
  const salesPctText = item.salesPct > 0 ? `${Math.round(item.salesPct * 10) / 10}` : '';
  const dailyAvgText = item.dailyAvgVolume > 0 ? `${Math.round(item.dailyAvgVolume * 10) / 10}` : '';
  return (
    <Card pad={0} style={{ overflow: 'hidden' }}>
      <div style={{ display: 'flex' }}>
        <div style={{ width: 4, background: TOKENS.red, flexShrink: 0 }} />
        <div style={{ flex: 1, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: TOKENS.ink, lineHeight: 1.4 }}>
                <span style={{ marginRight: 6 }}>📊</span>
                {item.midCategory && (
                  <span>{item.midCategory}</span>
                )}
                {item.midCategory && item.headline && <span style={{ color: TOKENS.inkMuted, margin: '0 4px' }}>·</span>}
                {item.headline && <HighlightText text={item.headline} skuNames={skuNames} />}
              </div>
            </div>
            {(salesPctText || dailyAvgText) && (
              <div style={{
                flexShrink: 0, fontSize: 12, color: TOKENS.inkSoft, fontWeight: 600, lineHeight: 1.45,
                textAlign: 'right', fontVariantNumeric: 'tabular-nums', paddingTop: 2,
              }}>
                {salesPctText && (
                  <div>销售额 <span style={{ color: COLOR_NUM, fontWeight: 700 }}>{salesPctText}%</span></div>
                )}
                {dailyAvgText && (
                  <div>日均 <span style={{ color: COLOR_NUM, fontWeight: 700 }}>{dailyAvgText}</span> 件</div>
                )}
              </div>
            )}
          </div>
          {item.description && (
            <div style={{ fontSize: 13, color: TOKENS.ink, lineHeight: 1.75, marginTop: 8 }}>
              <HighlightText text={item.description} skuNames={skuNames} />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---- 子组件：进度阶段步骤 ------------------------------------------------

function ProgressStep({ label, done, running, failed }: {
  label: string; done: boolean; running: boolean; failed?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, opacity: done || running || failed ? 1 : 0.4 }}>
      {done ? (
        <div style={{
          width: 22, height: 22, borderRadius: '50%', background: TOKENS.green, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{I.Check({ size: 13, color: '#fff' })}</div>
      ) : failed ? (
        <div style={{
          width: 22, height: 22, borderRadius: '50%', background: TOKENS.red, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 800, color: '#fff', lineHeight: 1,
        }}>!</div>
      ) : running ? <Spin size={22} /> : (
        <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${TOKENS.line}`, flexShrink: 0 }} />
      )}
      <div style={{
        fontSize: 14,
        fontWeight: running || failed ? 800 : 600,
        color: failed ? TOKENS.red : running ? TOKENS.ink : TOKENS.inkSoft,
      }}>
        {label}{failed ? '·已超时' : running && !done ? '…' : ''}
      </div>
    </div>
  );
}

// ---- 子组件：带红框的照片 ------------------------------------------------

function PhotoWithBoxes({
  src, boxes, scanning, height, fit = 'cover',
}: {
  src: string; boxes: FrameBox[]; scanning: boolean;
  height?: number;
  /** 'cover': 固定高度按需裁切(诊断中阶段);'natural': 原始比例完整展示(诊断结果页用) */
  fit?: 'cover' | 'natural';
}) {
  const isNatural = fit === 'natural';
  return (
    <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: TOKENS.bg }}>
      <img src={src} alt="货架" style={isNatural ? {
        width: '100%', height: 'auto', display: 'block',
      } : {
        width: '100%', height, objectFit: 'cover', display: 'block', background: TOKENS.bg,
      }} />
      {boxes.map((b, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${b.x * 100}%`,
          top: `${b.y * 100}%`,
          width: `${b.w * 100}%`,
          height: `${b.h * 100}%`,
          border: `3px solid ${TOKENS.red}`,
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

// ---- 子组件：多照片切换器(诊断中 / 诊断结果阶段共用) ---------------------
// 只有 photos.length > 1 时才会渲染;当前选中的高亮红边,其他灰边。点击切换主图。

function PhotoSwitcher({
  photos, active, onPick,
}: {
  photos: Array<{ url: string; localPreview?: string }>;
  active: number;
  onPick: (i: number) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {photos.map((p, i) => {
        const src = p.url || p.localPreview || '';
        const isActive = i === active;
        return (
          <button
            key={i}
            onClick={() => onPick(i)}
            aria-label={`查看第 ${i + 1} 张照片`}
            style={{
              appearance: 'none', padding: 0, cursor: 'pointer', background: 'transparent',
              border: `2px solid ${isActive ? TOKENS.red : TOKENS.line}`,
              borderRadius: 8, overflow: 'hidden',
              width: 56, height: 56, position: 'relative',
              boxShadow: isActive ? `0 0 0 2px ${TOKENS.redSoft}` : 'none',
            }}
          >
            {src && (
              <img src={src} alt="" style={{
                width: '100%', height: '100%', objectFit: 'cover', display: 'block',
              }} />
            )}
            <span style={{
              position: 'absolute', right: 2, bottom: 2,
              fontSize: 10, fontWeight: 800, color: '#fff',
              background: isActive ? TOKENS.red : 'rgba(0,0,0,0.55)',
              padding: '1px 5px', borderRadius: 6,
              lineHeight: 1.2,
            }}>{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---- 子组件：逐条确认（沿用原 UI） ---------------------------------------

function ReviewDeck({
  skus, index, onDecide, onUndo, onFastForward, storeSkuByCode, benchmarkByCode,
}: {
  skus: AiStrategyItem[];
  index: number;
  onDecide: (c: Decision, reason?: string | null) => void;
  onUndo: () => void;
  onFastForward: () => void;
  storeSkuByCode: Map<string, StoreSku>;
  benchmarkByCode: Map<string, BenchmarkSku>;
}) {
  const s = skus[index]!;
  const kind = classifyStrategyKind(s.action);
  const meta = KIND_META[kind];
  const [skipAsk, setSkipAsk] = useState(false);
  const storeSku = storeSkuByCode.get(s.skuCode);
  // 三个指标 tile 的来源按 kind 分:
  //   remove (停止进货)  → 本店快照(SKU 本就在本店,自己的数据就是判断依据)
  //   push   (上架)      → 参考店(本店还没这 SKU,只能看标杆店)
  // 同步影响下方 "* 参考店数据 / * 本店数据" 标注 + tags chip 的 "(参考店)" 后缀。
  const benchmark = benchmarkByCode.get(s.skuCode);
  const useStoreMetrics = kind === 'remove';
  const metricAmount = useStoreMetrics
    ? (storeSku?.salesRealamt30d ?? null)
    : (benchmark ? Number(benchmark.sales30d) : null);
  const metricQty = useStoreMetrics
    ? (storeSku?.salesQty30d ?? null)
    : (benchmark ? Number(benchmark.salesVolume30d) : null);
  const metricChange = useStoreMetrics
    ? (storeSku?.psdHb30d ?? null)
    : (benchmark ? Number(benchmark.psdChange) : null);
  // 规格优先用 Dify 选品输出的 s.spec;若该字段缺失/空(常见),回退到本店 storeSku.spec(数据库 canonical);
  // 若名字里已经含规格(如 AI 自己拼了),避免重复拼接。
  const rawSpec = (s.spec || storeSku?.spec || '').trim();
  const displayName = rawSpec && !s.skuName.includes(rawSpec)
    ? `${s.skuName} ${rawSpec}`
    : s.skuName;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '8px 16px 0' }}>
      <div style={{ flexShrink: 0, marginBottom: 10 }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center', marginBottom: 6, gap: 8,
        }}>
          <button onClick={onUndo} disabled={index === 0} style={{
            justifySelf: 'start',
            appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit',
            fontSize: 12.5, fontWeight: 700, color: index === 0 ? '#d0c9bf' : TOKENS.inkSoft,
            cursor: index === 0 ? 'default' : 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', gap: 3,
          }}>{I.Back({ size: 13, color: index === 0 ? '#d0c9bf' : TOKENS.inkSoft })} 上一条</button>
          <div style={{
            justifySelf: 'center',
            fontSize: 12.5, fontWeight: 800, color: TOKENS.inkSoft, fontVariantNumeric: 'tabular-nums',
          }}>
            第 <span style={{ color: TOKENS.red, fontSize: 15 }}>{index + 1}</span> / {skus.length} 条
          </div>
          <button onClick={onFastForward} style={{
            justifySelf: 'end',
            appearance: 'none', border: `1px solid ${TOKENS.red}`, background: '#fff', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 800, color: TOKENS.red,
            cursor: 'pointer', padding: '3px 9px', borderRadius: 11,
            display: 'flex', alignItems: 'center', gap: 3,
          }}>全部应用 {I.ArrowR({ size: 12, color: TOKENS.red })}</button>
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
              <span style={{ marginLeft: 'auto', maxWidth: '60%' }}>
                <Chip tone={kind === 'remove' ? 'red' : 'green'}>
                  {s.tags.join(' · ')}
                </Chip>
              </span>
            )}
          </div>

          <div style={{
            padding: '14px 14px 14px', flex: 1, minHeight: 0,
            display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto',
          }}>
            {/* SKU 头:图(适当增大)+ 名称(大字)+ 代码(小字置于名称下方);
                右列垂直居中, 让图整体高度跟"名称+代码"两行齐高。 */}
            <div style={{ display: 'flex', gap: 13, alignItems: 'center', flexShrink: 0 }}>
              <SkuThumb skuCode={s.skuCode} size={86} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: TOKENS.ink, lineHeight: 1.3 }}>
                  {displayName}
                </div>
                <div style={{
                  fontSize: 12, color: TOKENS.inkMuted, fontWeight: 600,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  letterSpacing: 0.3,
                }}>
                  {s.skuCode}
                </div>
              </div>
            </div>

            {/* 卡片 1:理由(占大部分空间);"理由"标签 + 正文 16,比商品名小一号 */}
            <div style={{
              flex: 1, minHeight: 120,
              background: TOKENS.bg, borderRadius: 14, padding: '14px 16px',
              display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto',
            }}>
              <div style={{
                fontSize: 16, fontWeight: 800, color: meta.color,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {I.Sparkles({ size: 18, color: meta.color })} 理由
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: TOKENS.ink, lineHeight: 1.7 }}>
                {s.reason || '（AI 未提供原因）'}
              </div>
            </div>

            {/* 卡片 2:三个指标方块并排(销额 / 销量 / 销量环比)
                数值来自参考店(标杆店,跨店加权)。原来想在每个 tile label 后挂 (参考店)
                小字,但"30日销售额(参考店)" / "30日销量环比(参考店)" 在窄屏会截断,
                只有中间"30日销量"恰好放得下 —— 三个 tile 一致性丢失。
                现在改成在 grid 下方挂一条统一标注,信息没丢、tile 标签更干净。 */}
            <div style={{ flexShrink: 0 }}>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
              }}>
                <MetricTile label="30日销售额" value={fmtCnyShort(metricAmount)} />
                <MetricTile label="30日销量"   value={fmtQtyShort(metricQty)} />
                <MetricTile
                  label="30日销量环比"
                  value={fmtChange(metricChange)}
                  tone={changeTone(metricChange)}
                />
              </div>
              <div style={{
                marginTop: 4, fontSize: 10, color: TOKENS.inkMuted, fontWeight: 600,
                textAlign: 'right', letterSpacing: 0.2,
              }}>
                {/* 新品尝试 = 本店和参考店都没历史数据,标注直接换成 "新品尝试" */}
                * {s.tags.includes('新品尝试') ? '新品尝试' : useStoreMetrics ? '本店数据' : '参考店数据'}
              </div>
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

// ---- ReviewDeck 子卡片(三指标方块) ---------------------------------------

/** 价格短格式:小额带 2 位小数,千以上不带小数,过万走 X.X 万 */
const fmtCnyShort = (n: number | null | undefined) => {
  if (n == null) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 10_000) return `¥${(Math.round(v / 100) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}万`;
  if (v >= 100) return `¥${Math.round(v).toLocaleString('zh-CN')}`;
  return `¥${(Math.round(v * 100) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtQtyShort = (n: number | null | undefined) => {
  if (n == null) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v.toLocaleString('zh-CN')} 件`;
};

/** 环比:带符号 + %。null → "—",0 → "0%",正数 "+X%",负数 "-X%" */
const fmtChange = (n: number | null | undefined) => {
  if (n == null) return '—';
  const v = Math.round(Number(n) * 10) / 10;
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0%';
  return `${v > 0 ? '+' : ''}${v}%`;
};

const changeTone = (n: number | null | undefined): 'up' | 'down' | 'flat' => {
  if (n == null || !Number.isFinite(Number(n))) return 'flat';
  const v = Number(n);
  if (v > 0) return 'up';
  if (v < 0) return 'down';
  return 'flat';
};

function MetricTile({
  label, value, tone = 'flat',
}: { label: string; value: string; tone?: 'up' | 'down' | 'flat' }) {
  const valueColor = tone === 'up' ? TOKENS.green : tone === 'down' ? TOKENS.red : TOKENS.ink;
  return (
    <div style={{
      background: TOKENS.bg, borderRadius: 12, padding: '10px 10px 11px',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
    }}>
      <div style={{
        fontSize: 11.5, color: TOKENS.inkMuted, fontWeight: 700, lineHeight: 1.3,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{label}</div>
      <div style={{
        fontSize: 17, fontWeight: 800, color: valueColor, lineHeight: 1.2,
        fontVariantNumeric: 'tabular-nums', letterSpacing: 0.2,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{value}</div>
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
  counts: { remove: number; push: number };
  onRestore: (idx: number) => void;
  onRecheck: () => void;
  onApply: () => void;
  applying: boolean;
  applyError: boolean;
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  // 进 confirm 页自动弹一次操作提示。背景不虚化,清单仍可见;按"我知道了"关闭。
  const [showHint, setShowHint] = useState(true);
  const groups = [
    { kind: 'remove' as const, label: '停止进货', color: TOKENS.red,   bg: TOKENS.redSoft },
    { kind: 'push'   as const, label: '上架新品', color: TOKENS.green, bg: TOKENS.greenSoft },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 130px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
                  <ProductRow key={s.skuCode} sku={s} right={s.tags[0] ? <Chip tone={g.kind === 'remove' ? 'red' : 'green'} style={{ flexShrink: 0 }}>{s.tags[0]}</Chip> : undefined} />
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
          {applying ? '正在提交…' : accepted.length === 0 ? '清单是空的，恢复几条再应用' : '我已在经营系统中完成操作'}
        </PrimaryBtn>
      </BottomBar>

      {/* 进页面的操作提示弹窗 —— 跟全站其他弹窗一致:半透明黑色遮罩淡入,弹窗本体不做位移
          动画(shv-pop 的 scale 会覆盖居中用的 translate(-50%, -50%),导致从角落飞入)。
          只在用户点"我知道了"后消失,关闭后不再自动复现(再回到本页又是新挂载,自然又是 true)。 */}
      {showHint && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 280 }}>
          <div
            onClick={() => setShowHint(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', animation: 'shv-fadein 0.2s ease' }}
          />
          <div style={{
            position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
            width: 'min(86%, 320px)', background: '#fff', borderRadius: 16,
            padding: 18, display: 'flex', flexDirection: 'column', gap: 14,
            boxShadow: '0 12px 36px rgba(0,0,0,0.28)',
          }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: TOKENS.ink, lineHeight: 1.7 }}>
              请在经营系统中按清单进行进货与商品上下限的调整，以完成货盘的调改。
              <div style={{ fontSize: 13, color: TOKENS.inkMuted, fontWeight: 600, marginTop: 6 }}>
                （可点击商品查看二维码）
              </div>
            </div>
            <button
              onClick={() => setShowHint(false)}
              style={{
                appearance: 'none', border: 0,
                background: TOKENS.red, color: '#fff', borderRadius: 12,
                padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductRow({ sku, right, dim }: { sku: AiStrategyItem; right?: React.ReactNode; dim?: boolean }) {
  const [detail, setDetail] = useState<SkuDetailLike | null>(null);
  return (
    <>
      <button
        onClick={() => setDetail({ skuCode: sku.skuCode, productName: sku.skuName, spec: sku.spec })}
        style={{
          appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit',
          width: '100%', textAlign: 'left', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 9, padding: 0,
        }}>
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
      </button>
      <SkuDetailDialog sku={detail} onClose={() => setDetail(null)} />
    </>
  );
}

function AppliedPanel({
  counts, scene, sceneStr, pushedSkuCodes,
}: {
  counts: { push: number; remove: number };
  scene: number;
  sceneStr: string;
  pushedSkuCodes: string[];
}) {
  const navigate = useNavigate();
  const rtQ = useQuery({
    queryKey: ['scenes', scene, 'runtime'],
    queryFn: () => scenesApi.runtime(scene),
    // Dify virtual-shelf 5~10 分钟才完成,状态非终态时本面板自轮询。
    // 不能光等 FlowPage 顶层那个 IIFE 完成时的 invalidate —— 用户停在 applied 阶段才看得到状态翻转。
    // 轮询间隔 2 秒:用户已等了好几分钟,Dify 一返回就要立刻看到陈列图,不要再额外卡 5 秒空窗。
    refetchInterval: (q) => {
      const status = (q.state.data as { virtualStatus?: string } | undefined)?.virtualStatus;
      return status === 'processing' || status === 'idle' ? 2_000 : false;
    },
  });
  const virtualStatus = rtQ.data?.virtualStatus;
  const virtualReady = virtualStatus === 'completed';
  const virtualFailed = virtualStatus === 'failed';

  // 跟 LastPage 同款 unwrap + shelfWidths 推导;陈列图渲染逻辑一致
  const virtualOutputs = (() => {
    const v = rtQ.data?.virtualRawOutputs as Record<string, unknown> | null | undefined;
    if (!v) return null;
    if ('raw' in v && v.raw && typeof v.raw === 'object') return v.raw as Record<string, unknown>;
    return v;
  })();
  const shelfWidths = (() => {
    const raw = virtualOutputs;
    if (!raw) return [120];
    const groups = unwrapSkuLct(raw.sku_lct);
    const maxByShelf = new Map<number, number>();
    for (const g of groups) {
      for (const s of g.skus ?? []) {
        const cur = maxByShelf.get(s.shelf_id) ?? 0;
        if (s.end_x > cur) maxByShelf.set(s.shelf_id, s.end_x);
      }
    }
    const sorted = Array.from(maxByShelf.entries()).sort((a, b) => a[0] - b[0]).map(([, w]) => Math.ceil(w));
    return sorted.length ? sorted : [120];
  })();

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 16px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%', background: TOKENS.greenSoft, margin: '0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'shv-pop 0.45s cubic-bezier(0.2, 1.4, 0.5, 1)',
        }}>{I.Check({ size: 32, color: TOKENS.green })}</div>
        <div style={{ fontSize: 19, fontWeight: 800, color: TOKENS.ink, marginTop: 12 }}>调改已完成</div>
        <div style={{ fontSize: 13, color: TOKENS.inkSoft, marginTop: 5 }}>
          上架了 {counts.push} 个品，停止进货了 {counts.remove} 个品
        </div>
      </div>

      {/* 陈列示意图直接 inline 渲染:就绪即出,加载中 / 失败用占位卡 */}
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, letterSpacing: 1, margin: '4px 2px 8px' }}>
          调改后的陈列示意图
        </div>
        {virtualFailed ? (
          <Card pad={18} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: TOKENS.red }}>陈列示意图生成失败</div>
            <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginTop: 5 }}>
              稍后回到「上一次调改」再看,或重新发起调改触发生成
            </div>
          </Card>
        ) : !virtualReady ? (
          <Card pad={18} style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}><Spin size={28} /></div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: TOKENS.ink, marginTop: 12 }}>正在帮你生成陈列示意图…</div>
            <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginTop: 5 }}>通常 5~10 分钟,生成好会直接显示在这里</div>
            <div style={{ marginTop: 14, height: 6, borderRadius: 3, background: TOKENS.bgWarm, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '40%', borderRadius: 3, background: TOKENS.red, animation: 'shv-progress 1.6s ease-in-out infinite' }} />
            </div>
          </Card>
        ) : (
          <Card pad={10}>
            <VirtualShelfRenderer
              rawOutputs={virtualOutputs}
              context={{ shelfWidths, newListedCodes: pushedSkuCodes }}
            />
          </Card>
        )}
      </div>

      <Card pad={13} style={{ background: TOKENS.amberSoft, boxShadow: 'none' }}>
        <div style={{ fontSize: 12.5, color: TOKENS.amber, lineHeight: 1.65 }}>
          接下来记得，新品到货后参考该示意图摆上货架。<span style={{ fontWeight: 800 }}>过两周再回来</span>，在工作台的「调改效果追踪」里就能看到销量变化了。
        </div>
      </Card>

      <GhostBtn onClick={() => navigate({ to: '/shelves/scene/$scene', params: { scene: sceneStr } })} style={{ marginTop: 4 }}>
        返回工作台
      </GhostBtn>
    </div>
  );
}

// ---- 子组件：{场景}月销额面板 ----------------------------------------
// 触发器为一行 inline 卡片;诊断中阶段 / 诊断结果阶段都用同一份文案,跟随
// 周围内容流式展示。点击会从底部弹出 bottom sheet,几乎铺满屏幕。

function SkuListPanel({
  scene, defaultOpen = false,
}: {
  scene: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [detail, setDetail] = useState<SkuDetailLike | null>(null);
  const skusQ = useQuery({
    queryKey: ['store', 'skus', 'scene', scene],
    queryFn: () => storeApi.skus(scene),
  });
  const scenesQ = useQuery({ queryKey: ['scenes', 'list'], queryFn: scenesApi.list });
  const sceneName = scenesQ.data?.scenes.find((s) => s.scene === scene)?.name ?? '';
  const skus = skusQ.data?.skus ?? [];
  const count = skus.length;

  return (
    <>
      <Card pad={0} style={{ overflow: 'hidden' }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit',
            width: '100%', padding: '12px 14px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 800, color: TOKENS.ink }}>
            查看{sceneName}月销额详情
          </span>
          <span style={{ display: 'flex', alignItems: 'center' }}>
            {skusQ.isLoading
              ? <Spin size={12} />
              : I.ChevronR({ size: 16, color: TOKENS.red })}
          </span>
        </button>
      </Card>

      {/* Bottom sheet:几乎铺满,顶部留 48px 空隙 + 上沿阴影,点击遮罩或拖拽条收回 */}
      {open && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 250 }}>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)',
              animation: 'shv-fadein 0.2s ease',
            }}
          />
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, top: 48,
            background: '#fff', borderRadius: '18px 18px 0 0',
            boxShadow: '0 -10px 28px rgba(0,0,0,0.18), 0 -2px 6px rgba(0,0,0,0.08)',
            display: 'flex', flexDirection: 'column',
            animation: 'shv-sheet-up 0.28s ease',
            overflow: 'hidden',
          }}>
            {/* 拖拽条 + 标题 + 收起 */}
            <button
              onClick={() => setOpen(false)}
              aria-label="收起"
              style={{
                appearance: 'none', border: 0, background: 'transparent', cursor: 'pointer',
                padding: '8px 0 4px', width: '100%',
              }}
            >
              <div style={{
                width: 40, height: 4, borderRadius: 2, background: TOKENS.line,
                margin: '0 auto',
              }} />
            </button>
            <div style={{
              padding: '6px 16px 12px',
              borderBottom: `1px solid ${TOKENS.lineSoft}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: TOKENS.ink, display: 'flex', alignItems: 'center', gap: 6 }}>
                📋 本店{sceneName}月销额
                {skusQ.isLoading
                  ? <Spin size={13} />
                  : <span style={{ fontSize: 13, fontWeight: 700, color: TOKENS.red }}>· {count} 个 SKU</span>}
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="关闭"
                style={{
                  appearance: 'none', border: 0, background: 'transparent', cursor: 'pointer',
                  padding: 4, marginRight: -4, flexShrink: 0,
                }}
              >
                {I.Close({ size: 22, color: TOKENS.inkSoft })}
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
              {skusQ.isLoading ? (
                <div style={{ padding: 24, textAlign: 'center', color: TOKENS.inkMuted, fontSize: 13 }}>
                  <Spin size={18} /> 正在加载…
                </div>
              ) : count === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: TOKENS.inkMuted, fontSize: 13 }}>
                  本场景暂无商品数据
                </div>
              ) : (
                skus.map((s) => (
                  <SkuRow
                    key={s.skuCode}
                    sku={s}
                    onClick={() => setDetail({
                      skuCode: s.skuCode, productName: s.productName, spec: s.spec, brand: s.brand,
                    })}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <SkuDetailDialog sku={detail} onClose={() => setDetail(null)} />
    </>
  );
}

function SkuRow({ sku, onClick }: { sku: StoreSku; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit',
        width: '100%', textAlign: 'left', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderBottom: `1px solid ${TOKENS.lineSoft}`,
      }}>
      <SkuThumb skuCode={sku.skuCode} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: TOKENS.ink,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{sku.productName}</div>
        <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginTop: 1 }}>
          {sku.spec ?? ''}{sku.spec && (sku.brand || sku.categoryPath) ? ' · ' : ''}{sku.brand ?? ''}
        </div>
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.ink }}>
          {sku.salesRealamt30d != null ? `¥${Math.round(sku.salesRealamt30d)}` : '—'}
        </div>
        <div style={{ fontSize: 10.5, color: TOKENS.inkMuted, marginTop: 1 }}>
          30 日 {sku.salesQty30d ?? 0} 件
        </div>
      </div>
    </button>
  );
}
