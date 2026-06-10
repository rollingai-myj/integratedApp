import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useParams } from "@/components/shelves/lib/router-shim";
import { Camera, Loader2, Check, ChevronDown, Sparkles, Home, PlusCircle } from "lucide-react";
import { useAppContext } from "@/components/shelves/contexts/AppContext";
import { SceneHeader } from "@/components/shelves/components/v2/SceneHeader";
import { PhotoCropper } from "@/components/shelves/components/v2/PhotoCropper";
import { PhotoWithBoxes } from "@/components/shelves/components/v2/PhotoWithBoxes";
import { VirtualShelfRenderer } from "@/components/shelves/components/v2/VirtualShelfRenderer";
import { DiagnosisListPanel } from "@/components/shelves/components/shelf-detail/DiagnosisListPanel";
import { StrategyTableSection } from "@/components/shelves/components/StrategyResultInline";
import { ShelfSkuTable } from "@/components/shelves/components/shelf-detail/ShelfSkuTable";
import { usePlanPosition } from "@/components/shelves/hooks/usePlanPositions";
import { getStoreSkuData } from "@/components/shelves/data/skuDataByStore";
import { sceneSkus, runSceneDiagnosis, runSceneSelection } from "@/components/shelves/services/sceneAnalysis";
import { problemSkuCodes } from "@/components/shelves/lib/problemSku";
import { uploadPhoto, getSceneRuntime, saveSceneRuntime, type ScenePhoto } from "@/components/shelves/services/sceneRuntime";
import { detectImage, applyAdjustment, sceneShelfId, getShelfGroups, type AdjustmentItem } from "@/components/shelves/services/scenes";
import { listCorrectionsByStore } from "@/components/shelves/services/skuCorrections";
import { startVirtualShelfJob } from "@/components/shelves/services/virtualShelfJob";
import type { DiagnosisResult } from "@/components/shelves/services/difyAlignApi";
import type { StrategyResult } from "@/components/shelves/services/difyApi";
import type { Strategy } from "@/components/shelves/contexts/AppContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/shelves/lib/utils";
import { toast } from "@/components/shelves/hooks/use-toast";
import { toastSuccess } from "@/components/ui/sonner";
import { classifyAction } from "@/components/shelves/lib/strategyAction";

type Section = "sales" | "diagnosis" | "plan" | null;

const PhotoPage = () => {
  const navigate = useNavigate();
  const { code } = useParams();
  const sceneId = Number(code);
  // skuDataVersion 订阅：确保 SKU 数据异步加载完成后组件重新渲染，problemIds 得到正确的问题单品集合
  const { selectedStore, skuDataVersion } = useAppContext();
  void skuDataVersion; // 只需订阅触发重渲染，不直接使用
  const { position } = usePlanPosition(sceneId);
  const shelfId = sceneShelfId(sceneId);
  const fileRef = useRef<HTMLInputElement>(null);

  const skus = sceneSkus(getStoreSkuData(selectedStore), position);
  const problemIds = problemSkuCodes(skus);

  const draftKey = `photo_draft_${selectedStore}_${sceneId}`;

  // 从 sessionStorage 恢复完整草稿（拍照开启新调改会在跳转前清除草稿）
  const draft = (() => {
    if (!selectedStore || !Number.isFinite(sceneId)) return null;
    try {
      const raw = sessionStorage.getItem(draftKey);
      return raw ? JSON.parse(raw) as {
        photos?: Array<{ url: string; matches?: import("@/components/shelves/services/scenes").DetectMatch[] }>;
        showSections?: boolean;
        section?: Section;
        salesReady?: boolean;
        diagnosis?: DiagnosisResult | null;
        strategy?: StrategyResult | null;
      } : null;
    } catch { return null; }
  })();

  const [photos, setPhotos] = useState<ScenePhoto[]>(
    () => (draft?.photos ?? []).map((p) => ({ url: p.url, matches: p.matches }))
  );
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [showSections, setShowSections] = useState(draft?.showSections ?? false);
  const [scanning, setScanning] = useState(false);
  const [salesReady, setSalesReady] = useState(draft?.salesReady ?? false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(draft?.diagnosis ?? null);
  const [strategy, setStrategy] = useState<StrategyResult | null>(draft?.strategy ?? null);
  const [section, setSection] = useState<Section>(draft?.section ?? null);
  const [applied, setApplied] = useState(false);

  // 增量合并写入草稿（不依赖组件挂载状态：dify 回调即使在卸载后也能写入）
  const patchDraft = useCallback((patch: Record<string, unknown>) => {
    if (!selectedStore || !Number.isFinite(sceneId)) return;
    try {
      const raw = sessionStorage.getItem(draftKey);
      const cur = raw ? JSON.parse(raw) : {};
      sessionStorage.setItem(draftKey, JSON.stringify({ ...cur, ...patch }));
    } catch { /* ignore */ }
  }, [selectedStore, sceneId, draftKey]);

  // 自动持久化基础状态（diagnosis/strategy 由 dify 回调单独 patch，避免被 null 覆盖）
  useEffect(() => {
    if (applied || photos.length === 0) return;
    patchDraft({
      photos: photos.map((p) => ({ url: p.url, matches: p.matches })),
      showSections,
      section,
      salesReady,
    });
  }, [photos, showSections, section, salesReady, applied, patchDraft]);

  // 重进恢复：若已开始诊断但结果未到，轮询草稿（接收旧 fetch 卸载后写入的结果）
  useEffect(() => {
    if (!showSections) return;
    if (diagnosis !== null && strategy !== null) return;
    const timer = setInterval(() => {
      try {
        const raw = sessionStorage.getItem(draftKey);
        if (!raw) return;
        const d = JSON.parse(raw) as { diagnosis?: DiagnosisResult | null; strategy?: StrategyResult | null };
        if (d.diagnosis != null) setDiagnosis(d.diagnosis);
        if (d.strategy != null) setStrategy(d.strategy);
      } catch { /* ignore */ }
    }, 1500);
    return () => clearInterval(timer);
  }, [showSections, diagnosis, strategy, draftKey]);

  // 恢复草稿时：如果照片已有匹配结果，短暂显示扫描动画表示"上次已扫描"
  const [resumeFlash, setResumeFlash] = useState(() =>
    !!(draft?.showSections && draft.photos?.some((p) => p.matches?.length))
  );
  useEffect(() => {
    if (!resumeFlash) return;
    const t = setTimeout(() => setResumeFlash(false), 1500);
    return () => clearTimeout(t);
  }, [resumeFlash]);

  const [vsStatus, setVsStatus] = useState<"idle" | "processing" | "completed" | "failed">("idle");
  const [vsRaw, setVsRaw] = useState<unknown>(null);
  const [vsCtx, setVsCtx] = useState<unknown>(null);
  // 识别服务降级提示：detect-service 不可达时显示，让用户知道红框可能没标
  const [detectError, setDetectError] = useState<string | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setCropSrc(URL.createObjectURL(f));
    e.target.value = "";
  };

  const handleCropConfirm = async (blob: Blob, preview: string) => {
    setCropSrc(null);
    setUploading(true);
    try {
      const url = await uploadPhoto(selectedStore, shelfId, blob);
      setPhotos((ps) => [...ps, { url, localPreview: preview, blob }]);
    } catch (err) {
      toast({ title: "上传失败", description: String(err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDiagnose = () => {
    if (photos.length === 0) { toast({ title: "请先上传照片" }); return; }

    setShowSections(true);
    setScanning(true);
    setSection("sales");
    setDiagnosis(null);
    setStrategy(null);
    setSalesReady(false);
    // 清掉草稿里上一轮的结果
    patchDraft({ showSections: true, section: "sales", diagnosis: null, strategy: null });

    // 销售数据延迟 3 秒展示
    setTimeout(() => setSalesReady(true), 3000);

    // Detect（完成后停止扫描动画）
    Promise.all(
      photos.map(async (p) => {
        if (!p.blob) return { photo: p, error: null as null | string };
        const result = await detectImage(p.blob);
        return {
          photo: { ...p, matches: result.matches },
          error: result.error ? result.error.message : null,
        };
      })
    ).then((results) => {
      const withMatches = results.map((r) => r.photo);
      const firstErr = results.find((r) => r.error)?.error;
      setPhotos(withMatches);
      setScanning(false);
      if (firstErr) setDetectError(firstErr);
      patchDraft({ photos: withMatches.map((p) => ({ url: p.url, matches: p.matches })) });
      saveSceneRuntime(selectedStore, shelfId, {
        photos: withMatches.map(({ localPreview: _lp, blob: _b, ...rest }) => rest),
      }).catch(() => {});
    });

    // 诊断 — 完成后立即持久化（即使已退出页面也写入草稿）
    runSceneDiagnosis(selectedStore, shelfId, sceneId, photos[0].url, skus, position)
      .catch(() => null)
      .then((diag) => { setDiagnosis(diag); patchDraft({ diagnosis: diag }); });

    // 选品 — 同上
    runSceneSelection(selectedStore, shelfId, sceneId, skus, position)
      .catch(() => null)
      .then((strat) => { setStrategy(strat); patchDraft({ strategy: strat }); });
  };

  const strategyForTable: Strategy | null = strategy
    ? { ...strategy, skus: strategy.skus.map((s) => ({ ...s })), applied }
    : null;

  const handleApply = async () => {
    if (!strategy || !position) return;
    // 过滤掉用户勘误标记为"不应下架"的 SKU
    const corrections = await listCorrectionsByStore(selectedStore).catch(() => []);
    const removeCorrected = new Set(
      corrections.filter((c) => c.correction_kind === "remove").map((c) => c.sku_code),
    );
    const effectiveSkus = strategy.skus.filter(
      (s) => !(classifyAction(s.action) === "remove" && removeCorrected.has(s.skuCode)),
    );
    const up = effectiveSkus.filter((s) => classifyAction(s.action) === "push").length;
    const down = effectiveSkus.filter((s) => classifyAction(s.action) === "remove").length;
    const summary = `上架了${up}个品，停止进货了${down}个品`;
    const items: AdjustmentItem[] = effectiveSkus.map((s) => ({
      skuCode: s.skuCode, skuName: s.skuName, spec: s.spec, action: s.action, tags: s.tags, reason: s.reason,
    }));
    try {
      await applyAdjustment({ storeId: selectedStore, positionCode: sceneId, positionName: position.position_name, summary, items });
      saveSceneRuntime(selectedStore, shelfId, {
        last_snapshot: {
          at: new Date().toISOString(),
          summary,
          photos: photos.map(({ localPreview: _lp, blob: _b, ...rest }) => rest),
          diagnosis,
          strategy,
        },
      } as any).catch(() => {});
      try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
      setApplied(true);
      toastSuccess("调改已完成");
    } catch (e) {
      toast({ title: "应用失败", description: String(e), variant: "destructive" });
    }
  };

  const pollVirtual = useCallback(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const rt = await getSceneRuntime(selectedStore, shelfId);
      const st = (rt?.virtual_shelf_status as string) || "idle";
      if (st === "completed") {
        setVsStatus("completed");
        const raw = rt?.virtual_shelf_raw_outputs ?? null;
        const ctx = rt?.virtual_shelf_context ?? null;
        setVsRaw(raw);
        setVsCtx(ctx);
        const snap = rt?.last_snapshot as Record<string, unknown> | undefined;
        if (snap) {
          saveSceneRuntime(selectedStore, shelfId, {
            last_snapshot: { ...snap, virtual_shelf_raw_outputs: raw, virtual_shelf_context: ctx },
          } as any).catch(() => {});
        }
        return;
      }
      if (st === "failed") { setVsStatus("failed"); return; }
      setTimeout(tick, 5000);
    };
    tick();
    return () => { stop = true; };
  }, [selectedStore, shelfId]);

  const handleGenerateVirtual = async () => {
    if (!strategy || !position) return;
    setVsStatus("processing");
    try {
      const groups = await getShelfGroups(selectedStore, sceneId);
      await startVirtualShelfJob({
        storeId: selectedStore, shelfId,
        skus, strategies: [{ ...strategy, applied: true } as Strategy],
        shelfGroups: groups,
        position,
      });
      pollVirtual();
    } catch (e) {
      setVsStatus("failed");
      toast({ title: "启动生成失败", description: String(e), variant: "destructive" });
    }
  };

  const sectionLoading = (key: Section) => {
    if (key === "diagnosis") return showSections && diagnosis === null;
    if (key === "plan") return showSections && strategy === null;
    if (key === "sales") return showSections && !salesReady;
    return false;
  };

  const sectionBtn = (key: Section, label: string) => {
    const isActive = section === key;
    const isPlan = key === "plan";
    const isLoading = sectionLoading(key);
    return (
      <button
        onClick={() => setSection(isActive ? null : key)}
        className={cn(
          "flex-1 flex items-center justify-center gap-1 py-2.5 text-sm font-medium rounded-lg border transition-colors",
          isPlan
            ? isActive
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-primary/10 text-primary border-primary"
            : isActive
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:bg-muted"
        )}
      >
        {isLoading && !isActive && <Loader2 className="w-3 h-3 animate-spin" />}
        {label}
        {!isLoading && <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", isActive && "rotate-180")} />}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <SceneHeader storeId={selectedStore} sceneName={position?.position_name} backTo={`/position/${code}/index`} />
      <div className="p-4 space-y-4">
        {!showSections && (
          <p className="text-sm text-muted-foreground">
            请拍摄{position?.position_name ? `「${position.position_name}」` : "对应场景"}所在的货架照片，可以上传多张，尽量保证商品清晰
          </p>
        )}

        {cropSrc ? (
          <PhotoCropper src={cropSrc} onCancel={() => setCropSrc(null)} onConfirm={handleCropConfirm} />
        ) : (
          <>
            {/* 无照片时显示大拍照按钮 */}
            {photos.length === 0 && (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full rounded-2xl border-2 border-dashed border-border bg-muted/30 py-10 flex flex-col items-center gap-2 hover:border-primary/50 transition-colors"
              >
                {uploading
                  ? <Loader2 className="w-7 h-7 animate-spin text-primary" />
                  : <Camera className="w-7 h-7 text-muted-foreground" />}
                <span className="text-sm text-muted-foreground">点击拍照或从相册选择</span>
              </button>
            )}

            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />

            {/* 照片轮播 */}
            {photos.length > 0 && (
              <div className="space-y-2">
                <div className="flex overflow-x-auto snap-x snap-mandatory gap-3 pb-1 -mx-1 px-1">
                  {photos.map((p, i) => (
                    <div key={i} className="snap-start shrink-0 w-full relative">
                      <PhotoWithBoxes
                        src={p.localPreview || p.url}
                        matches={p.matches}
                        problemSkuIds={problemIds}
                      />
                      {/* 扫描动画覆盖层（scanning=真实扫描中，resumeFlash=恢复时短暂闪现） */}
                      {(scanning || resumeFlash) && (
                        <div className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none">
                          <div
                            className="absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-primary/25 to-transparent"
                            style={{ animation: "shelf-scan 2s linear infinite" }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {photos.length > 1 && (
                  <p className="text-[10px] text-center text-muted-foreground">← 左右滑动查看所有照片 →</p>
                )}
                {showSections && !scanning && !resumeFlash && photos.some((p) => p.matches?.some((m) => m.matched_sku_id && problemIds.has(m.matched_sku_id))) && (
                  <p className="text-xs text-muted-foreground">红框为问题单品，请留意观察</p>
                )}
                {(scanning || resumeFlash) && (
                  <p className="text-xs text-center text-muted-foreground animate-pulse">
                    {resumeFlash ? "正在加载上次扫描结果…" : "正在扫描货架，正在识别问题单品…"}
                  </p>
                )}
                {/* 识别服务降级提示：不显式标出，店长会以为图片真的"通过"了 */}
                {detectError && !scanning && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    商品识别服务暂不可用，无法标注问题单品；不影响后续诊断与调改方案，您可继续完成本次调改。
                    <span className="block mt-0.5 text-[10px] text-amber-700/70">原因：{detectError}</span>
                  </div>
                )}
              </div>
            )}

            {/* 按钮行：未开始诊断时 */}
            {photos.length > 0 && !showSections && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex-none"
                >
                  <PlusCircle className="w-4 h-4 mr-1.5" />添加照片
                </Button>
                <Button onClick={handleDiagnose} className="flex-1">
                  开始诊断
                </Button>
              </div>
            )}

            {/* 诊断结果区域 */}
            {showSections && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  {sectionBtn("sales", "销售数据")}
                  {sectionBtn("diagnosis", "诊断报告")}
                  {sectionBtn("plan", "调改方案")}
                </div>

                {section === "sales" && (
                  salesReady
                    ? <ShelfSkuTable
                        skus={skus}
                        selectedSKUs={new Set()}
                        toggleSKU={() => {}}
                        hoveredSkuCode={null}
                        onHoverSku={() => {}}
                        strategies={strategyForTable ? [strategyForTable] : []}
                        comparisonMode="before"
                      />
                    : <div className="py-8 text-center text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin inline mr-1.5" />正在分析销售数据…
                      </div>
                )}

                {section === "diagnosis" && (
                  diagnosis
                    ? <DiagnosisListPanel diagnosis={diagnosis} />
                    : <div className="py-8 text-center text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin inline mr-1.5" />正在总结诊断报告…
                      </div>
                )}

                {section === "plan" && (
                  <>
                    {!applied && strategy && (
                      <Button onClick={handleApply} className="w-full">一键应用</Button>
                    )}
                    {strategyForTable
                      ? <StrategyTableSection strategy={strategyForTable} storeId={selectedStore} shelfId={shelfId} readOnly={applied} />
                      : <div className="py-8 text-center text-sm text-muted-foreground">
                          <Loader2 className="w-4 h-4 animate-spin inline mr-1.5" />正在生成调改方案…
                        </div>
                    }
                  </>
                )}

                {applied && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                      <Check className="w-4 h-4" /> 调改已完成
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => navigate(`/position/${code}/index`)}>
                        <Home className="w-4 h-4 mr-1.5" />返回主页
                      </Button>
                      {vsStatus === "idle" && (
                        <Button className="flex-1" onClick={handleGenerateVirtual}>
                          <Sparkles className="w-4 h-4 mr-1.5" />一键生成虚拟货架
                        </Button>
                      )}
                    </div>
                    {vsStatus === "processing" && (
                      <div className="rounded-xl border border-dashed border-border bg-muted/30 py-8 text-center text-sm text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin inline mr-1.5" />
                        正在生成虚拟货架，大约需要5分钟，您也可以返回主页在虚拟货架示意图中查看
                      </div>
                    )}
                    {vsStatus === "completed" && <VirtualShelfRenderer rawOutputs={vsRaw} context={vsCtx as never} skus={skus} />}
                    {vsStatus === "failed" && <p className="text-sm text-destructive">虚拟货架生成失败，请稍后重试</p>}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PhotoPage;
