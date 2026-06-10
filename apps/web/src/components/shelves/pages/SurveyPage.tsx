import { useState, useEffect } from "react";
import { useNavigate, useParams } from "@/components/shelves/lib/router-shim";
import { Plus, Minus, Loader2, Check } from "lucide-react";
import { useAppContext } from "@/components/shelves/contexts/AppContext";
import { SceneHeader } from "@/components/shelves/components/v2/SceneHeader";
import { usePlanPosition } from "@/components/shelves/hooks/usePlanPositions";
import { useShelfQuestions } from "@/components/shelves/hooks/useShelfQuestions";
import { saveShelfSurveyAnswers, type SurveyQA } from "@/components/shelves/services/shelfSurvey";
import { sceneShelfId, saveShelfGroups, getShelfGroups, type ShelfGroup } from "@/components/shelves/services/scenes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/components/shelves/lib/utils";
import { toast } from "@/components/shelves/hooks/use-toast";
import { toastSuccess } from "@/components/ui/sonner";

const WIDTH_PRESETS = [60, 75, 90];
const OTHER = "其他";

const newGroup = (): ShelfGroup => ({ shelf_type: "标准货架", shelf_width: 75, shelf_layers: 5 });

interface AnswerState { selected: string[]; other: string; }

const SurveyPage = () => {
  const navigate = useNavigate();
  const { code } = useParams();
  const sceneId = Number(code);
  const { selectedStore } = useAppContext();
  const { position } = usePlanPosition(sceneId);
  const shelfId = sceneShelfId(sceneId);

  const [groups, setGroups] = useState<ShelfGroup[]>([newGroup()]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);          // 货架已保存（按钮态）

  // 仅在保存货架后才开始生成问题
  const positionLabel = position?.position_name ?? "";
  const { questions, hasQuestions, isGenerating, failed, retry } = useShelfQuestions(
    selectedStore, shelfId, positionLabel, saved,
  );

  const [showQna, setShowQna] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<AnswerState[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // 预填已存在的货架组
  useEffect(() => {
    if (!selectedStore || !Number.isFinite(sceneId)) return;
    getShelfGroups(selectedStore, sceneId).then((g) => { if (g.length > 0) setGroups(g); });
  }, [selectedStore, sceneId]);

  // 编辑货架后回到「保存」态
  const markDirty = () => setSaved(false);
  const updateGroup = (i: number, patch: Partial<ShelfGroup>) => {
    setGroups((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g))); markDirty();
  };
  const addGroup = () => { setGroups((gs) => [...gs, newGroup()]); markDirty(); };
  const removeGroup = (i: number) => { setGroups((gs) => (gs.length <= 1 ? gs : gs.filter((_, idx) => idx !== i))); markDirty(); };

  const handleSave = async () => {
    if (!position || saved) return;
    // 验证：每组必须选大类
    const missingCategory = groups.some((g) => !g.category);
    if (missingCategory) {
      toast({ title: "请为每组货架选择大类", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await saveShelfGroups({ storeId: selectedStore, sceneId, positionName: position.position_name, categories: position.categories, groups });
      setSaved(true);
      toastSuccess("货架信息已保存");
    } catch (e) {
      toast({ title: "保存失败", description: String(e), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const startQna = () => {
    setAnswers(questions.map(() => ({ selected: [], other: "" })));
    setStep(0);
    setShowQna(true);
  };

  const toggleOption = (label: string) => {
    setAnswers((as) => as.map((a, idx) => {
      if (idx !== step) return a;
      const has = a.selected.includes(label);
      return { ...a, selected: has ? a.selected.filter((x) => x !== label) : [...a.selected, label] };
    }));
  };
  const setOther = (text: string) =>
    setAnswers((as) => as.map((a, idx) => (idx === step ? { ...a, other: text } : a)));

  const composeAnswer = (q: typeof questions[number], a: AnswerState): string => {
    const parts = a.selected.filter((s) => s !== OTHER);
    if (a.selected.includes(OTHER) && a.other.trim()) parts.push(a.other.trim());
    return parts.join("、");
  };

  const [navigating, setNavigating] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const qa: SurveyQA[] = questions.map((q, i) => ({
        id: q.id, question: q.question, direction: q.direction, context: q.context, options: q.options,
        answer: composeAnswer(q, answers[i] ?? { selected: [], other: "" }),
      }));
      await saveShelfSurveyAnswers(selectedStore, shelfId, qa);
      setDone(true);
      setNavigating(true);
      setTimeout(() => navigate(`/position/${sceneId}/index`), 1000);
    } catch (e) {
      toast({ title: "保存失败", description: String(e), variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  const currentQ = questions[step];
  const currentA = answers[step] ?? { selected: [], other: "" };
  const isLast = step === questions.length - 1;
  // 有效答案：至少选一项，且如选了"其他"必须有输入
  const canProceed = currentA.selected.length > 0 &&
    (!currentA.selected.includes(OTHER) || currentA.other.trim().length > 0);

  if (navigating) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-foreground">正在进入调改系统…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <SceneHeader storeId={selectedStore} sceneName={position?.position_name} backTo="/position" />
      <div className="p-4 space-y-4">
        <div className="rounded-2xl bg-primary/5 border border-primary/20 p-4 space-y-1.5">
          <p className="text-sm font-medium text-foreground">尊敬的店长，</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            在您开始调改前，请先根据指引完成两项配置。首先，请您选择
            <span className="font-medium text-foreground">「{position?.position_name ?? "当前场景"}」</span>
            下所占的货架组数及层数，我们将基于此为您推荐最终的陈列规则。
          </p>
        </div>
        <p className="text-sm text-muted-foreground">请选择品类及其所占货架规格</p>

        {/* 货架组卡片 */}
        <div className="space-y-3">
          {groups.map((g, i) => (
            <div key={i} className="flex items-stretch gap-2">
              <button onClick={() => removeGroup(i)} disabled={groups.length <= 1}
                className="shrink-0 w-9 self-center inline-flex items-center justify-center h-9 rounded-lg border border-border hover:bg-muted disabled:opacity-40" aria-label="删除该组">
                <Minus className="w-4 h-4" />
              </button>
              <div className="flex-1 rounded-2xl border border-border bg-card p-3 space-y-3">
                <div className="text-xs font-medium text-muted-foreground">货架组 {i + 1}</div>
                <div className="flex items-center gap-2">
                  <span className="text-xs w-12 shrink-0">大类</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(position?.categories ?? []).map((cat) => (
                      <button key={cat} onClick={() => updateGroup(i, { category: cat })}
                        className={cn("px-3 h-8 rounded-full border text-xs font-medium transition-colors",
                          g.category === cat ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted")}>
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs w-12 shrink-0">宽度</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {WIDTH_PRESETS.map((w) => (
                      <button key={w} onClick={() => updateGroup(i, { shelf_width: w })}
                        className={cn("px-3 h-9 rounded-lg border text-sm",
                          g.shelf_width === w ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted")}>
                        {w}cm
                      </button>
                    ))}
                    <div className="flex items-center gap-1">
                      <Input type="number" value={WIDTH_PRESETS.includes(g.shelf_width) ? "" : String(g.shelf_width || "")}
                        placeholder="自定义" onChange={(e) => updateGroup(i, { shelf_width: Number(e.target.value) || 0 })} className="h-9 w-20" />
                      <span className="text-xs text-muted-foreground">cm</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs w-12 shrink-0">层数</span>
                  <Input type="number" value={String(g.shelf_layers || "")} onChange={(e) => updateGroup(i, { shelf_layers: Number(e.target.value) || 0 })} className="h-9 w-24" />
                </div>
              </div>
              {i === groups.length - 1 && (
                <button onClick={addGroup} className="shrink-0 w-9 self-center inline-flex items-center justify-center h-9 rounded-lg border border-border hover:bg-muted" aria-label="增加一组">
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        <Button onClick={handleSave} disabled={saving || saved} className="w-full">
          {saving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />保存中…</> : saved ? "已保存" : "保存"}
        </Button>

        {/* 保存后：问答 */}
        {saved && (
          <div className="mt-4 rounded-2xl border border-border bg-card p-4 space-y-3 animate-in fade-in-0">
            {done ? (
              <div className="flex items-center gap-2 text-green-600 text-sm font-medium"><Check className="w-4 h-4" /> 结果已保存</div>
            ) : !showQna ? (
              <>
                <p className="text-sm">最后，我们还需要向您询问几个关于门店客群的问题，可以有助于我们为您提供更精准的选品建议，您可以多选或输入</p>
                {failed ? (
                  <Button variant="outline" onClick={retry} className="w-full">问题生成失败，点击重试</Button>
                ) : (
                  <Button onClick={startQna} disabled={!hasQuestions} className="w-full">
                    {hasQuestions ? "准备好了" : <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />{isGenerating ? "正在生成问题…" : "准备中…"}</>}
                  </Button>
                )}
              </>
            ) : currentQ ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">第 {step + 1} / {questions.length} 题</span>
                  <span className="text-[11px] text-muted-foreground">可多选</span>
                </div>
                {currentQ.context && <p className="text-xs text-muted-foreground">{currentQ.context}</p>}
                <p className="text-sm font-medium">{currentQ.question}</p>
                <div className="flex flex-wrap gap-1.5">
                  {currentQ.options.map((opt) => {
                    const active = currentA.selected.includes(opt);
                    return (
                      <button key={opt} onClick={() => toggleOption(opt)}
                        className={cn("px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                          active ? "bg-primary/10 text-primary border-primary/50" : "bg-background border-border hover:border-primary/50")}>
                        {opt}
                      </button>
                    );
                  })}
                </div>
                {/* 其他选项单独一行，自带输入框 */}
                <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors",
                  currentA.selected.includes(OTHER) ? "border-primary/50 bg-primary/5" : "border-border bg-background")}>
                  <button onClick={() => toggleOption(OTHER)}
                    className={cn("shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border transition-all",
                      currentA.selected.includes(OTHER) ? "bg-primary/10 text-primary border-primary/50" : "border-border hover:border-primary/50")}>
                    其他
                  </button>
                  <Input
                    placeholder="请输入其他内容"
                    value={currentA.other}
                    onChange={(e) => setOther(e.target.value)}
                    onFocus={() => { if (!currentA.selected.includes(OTHER)) toggleOption(OTHER); }}
                    className="h-7 text-xs border-0 bg-transparent p-0 focus-visible:ring-0 flex-1"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  {step > 0 && (
                    <Button variant="outline" className="flex-1" onClick={() => setStep((s) => s - 1)}>上一题</Button>
                  )}
                  {isLast ? (
                    <Button className="flex-1" onClick={handleSubmit} disabled={submitting || !canProceed}>
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "提交"}
                    </Button>
                  ) : (
                    <Button className="flex-1" onClick={() => setStep((s) => s + 1)} disabled={!canProceed}>下一题</Button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default SurveyPage;
