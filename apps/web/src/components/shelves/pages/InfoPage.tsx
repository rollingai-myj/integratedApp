import { useState, useEffect } from "react";
import { useParams } from "@/components/shelves/lib/router-shim";
import { Loader2, Plus, Minus } from "lucide-react";
import { useAppContext } from "@/components/shelves/contexts/AppContext";
import { SceneHeader } from "@/components/shelves/components/v2/SceneHeader";
import { usePlanPosition } from "@/components/shelves/hooks/usePlanPositions";
import { getEnvironmentInsight, saveEnvironmentInsight } from "@/components/shelves/services/storeEnvironment";
import { getShelfSurveyAnswers, saveShelfSurveyAnswers, type SurveyQA } from "@/components/shelves/services/shelfSurvey";
import { sceneShelfId, getShelfGroups, saveShelfGroups, type ShelfGroup } from "@/components/shelves/services/scenes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/shelves/hooks/use-toast";
import { toastSuccess } from "@/components/ui/sonner";

const SHELF_TYPES = ["标准货架", "冷柜", "端架", "收银台旁", "烘焙架"];

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
    <h3 className="text-sm font-semibold">{title}</h3>
    {children}
  </div>
);

const InfoPage = () => {
  const { code } = useParams();
  const sceneId = Number(code);
  const { selectedStore } = useAppContext();
  const { position } = usePlanPosition(sceneId);
  const shelfId = sceneShelfId(sceneId);

  const [loading, setLoading] = useState(true);
  // env
  const [category, setCategory] = useState("");
  const [crowd, setCrowd] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [topCompetitors, setTopCompetitors] = useState<string[]>([]);
  // survey
  const [answers, setAnswers] = useState<SurveyQA[]>([]);
  // shelf groups
  const [groups, setGroups] = useState<ShelfGroup[]>([]);

  const [savingEnv, setSavingEnv] = useState(false);
  const [savingQa, setSavingQa] = useState(false);
  const [savingGroups, setSavingGroups] = useState(false);

  useEffect(() => {
    if (!selectedStore || !Number.isFinite(sceneId)) return;
    (async () => {
      const [env, qa, gs] = await Promise.all([
        getEnvironmentInsight(selectedStore),
        getShelfSurveyAnswers(selectedStore, shelfId),
        getShelfGroups(selectedStore, sceneId),
      ]);
      if (env) {
        setCategory(env.category ?? "");
        setCrowd(env.crowd_source_analysis ?? "");
        setCompetitor(env.competitor_analysis ?? "");
        setTopCompetitors(env.top_competitors ?? []);
      }
      setAnswers(qa ?? []);
      setGroups(gs);
      setLoading(false);
    })();
  }, [selectedStore, sceneId, shelfId]);

  const saveEnv = async () => {
    setSavingEnv(true);
    try {
      await saveEnvironmentInsight({
        storeId: selectedStore,
        category,
        crowdSourceAnalysis: crowd,
        topCompetitors,
        competitorAnalysis: competitor,
      } as any);
      toastSuccess("周边环境洞察已保存");
    } catch (e) { toast({ title: "保存失败", description: String(e), variant: "destructive" }); }
    finally { setSavingEnv(false); }
  };

  const saveQa = async () => {
    setSavingQa(true);
    try {
      await saveShelfSurveyAnswers(selectedStore, shelfId, answers);
      toastSuccess("问答已保存");
    } catch (e) { toast({ title: "保存失败", description: String(e), variant: "destructive" }); }
    finally { setSavingQa(false); }
  };

  const saveGroups = async () => {
    if (!position) {
      // 进入页面太早、场景定义还没拉到时点击保存 → 不能闷掉，否则用户以为按钮坏了
      toast({ title: "场景信息加载中，请稍候再保存", variant: "destructive" });
      return;
    }
    setSavingGroups(true);
    try {
      await saveShelfGroups({
        storeId: selectedStore, sceneId,
        positionName: position.position_name, categories: position.categories, groups,
      });
      toastSuccess("货架信息已保存");
    } catch (e) { toast({ title: "保存失败", description: String(e), variant: "destructive" }); }
    finally { setSavingGroups(false); }
  };

  const updateGroup = (i: number, patch: Partial<ShelfGroup>) =>
    setGroups((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <SceneHeader storeId={selectedStore} sceneName={position?.position_name} backTo={`/position/${code}/index`} />
        <div className="py-20 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />加载中…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <SceneHeader storeId={selectedStore} sceneName={position?.position_name} backTo={`/position/${code}/index`} />
      <div className="p-4 space-y-4">
        {/* 环境洞察 */}
        <Section title="周边环境洞察">
          <label className="text-xs text-muted-foreground">商圈类型</label>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} />
          <label className="text-xs text-muted-foreground">客群分析</label>
          <Textarea value={crowd} onChange={(e) => setCrowd(e.target.value)} rows={3} />
          <label className="text-xs text-muted-foreground">竞争分析</label>
          <Textarea value={competitor} onChange={(e) => setCompetitor(e.target.value)} rows={3} />
          <Button onClick={saveEnv} disabled={savingEnv} className="w-full" size="sm">
            {savingEnv ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存环境洞察"}
          </Button>
        </Section>

        {/* 问答 */}
        <Section title="调研问答">
          {answers.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无问答记录</p>
          ) : (
            answers.map((qa, i) => (
              <div key={i} className="space-y-1">
                <label className="text-xs text-muted-foreground">{qa.question}</label>
                <Input
                  value={qa.answer}
                  onChange={(e) => setAnswers((as) => as.map((a, idx) => (idx === i ? { ...a, answer: e.target.value } : a)))}
                />
              </div>
            ))
          )}
          {answers.length > 0 && (
            <Button onClick={saveQa} disabled={savingQa} className="w-full" size="sm">
              {savingQa ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存问答"}
            </Button>
          )}
        </Section>

        {/* 货架信息 */}
        <Section title="货架信息">
          {groups.map((g, i) => (
            <div key={i} className="rounded-xl border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">货架组 {i + 1}</span>
                <button onClick={() => setGroups((gs) => gs.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive">
                  <Minus className="w-4 h-4" />
                </button>
              </div>
              <Select value={g.shelf_type} onValueChange={(v) => updateGroup(i, { shelf_type: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{SHELF_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex gap-2">
                <Input type="number" value={String(g.shelf_width || "")} onChange={(e) => updateGroup(i, { shelf_width: Number(e.target.value) || 0 })} placeholder="宽度cm" className="h-9" />
                <Input type="number" value={String(g.shelf_layers || "")} onChange={(e) => updateGroup(i, { shelf_layers: Number(e.target.value) || 0 })} placeholder="层数" className="h-9" />
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" className="w-full" onClick={() => setGroups((gs) => [...gs, { shelf_type: "标准货架", shelf_width: 75, shelf_layers: 5 }])}>
            <Plus className="w-4 h-4 mr-1" />增加货架组
          </Button>
          <Button onClick={saveGroups} disabled={savingGroups} className="w-full" size="sm">
            {savingGroups ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存货架信息"}
          </Button>
        </Section>
      </div>
    </div>
  );
};

export default InfoPage;
