import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  amapSearchAroundAll,
  COMPETITOR_POI_TYPES,
  CROWD_SOURCE_POI_TYPES,
  type AmapPoi,
} from "@/components/shelves/lib/amapApi";
import { runQuestionsWorkflow } from "@/components/shelves/lib/difyQuestionsApi";
import { getStoreCoordinates } from "@/components/shelves/data/storeCoordinates";
import {
  getShelfSurveyQuestions,
  saveShelfSurveyQuestions,
} from "@/components/shelves/services/shelfSurvey";
import type { InsightQuestion } from "@/components/shelves/lib/difyInsightApi";

const RADIUS_M = 600;
const QUESTION_TIMEOUT_MS = 90_000; // 90s timeout for the whole generation flow

function summarizePois(pois: AmapPoi[]) {
  return pois.map((p) => ({
    name: p.name,
    type: p.type,
    typecode: p.typecode,
    address: p.address,
    location: p.location,
    business: p.business,
  }));
}

export function useShelfQuestions(storeId: string, shelfId: string, category: string = "", enabled: boolean = true) {
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [failed, setFailed] = useState(false);
  const runningRef = useRef<string>("");
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);
  const attemptRef = useRef(0);

  const questionsQuery = useQuery({
    queryKey: ["shelf_survey_questions", storeId, shelfId],
    queryFn: () => getShelfSurveyQuestions(storeId, shelfId),
    enabled: !!storeId && !!shelfId && enabled,
    staleTime: 60_000,
    refetchInterval: (query) => {
      if (!enabled) return false;
      const d = query.state.data;
      if (Array.isArray(d) && d.length > 0) return false;
      return 3000;
    },
  });

  const questions: InsightQuestion[] = questionsQuery.data ?? [];
  const hasQuestions = questions.length > 0;

  const runGeneration = useCallback(
    async (forced: boolean, ignoreExisting = false) => {
      if (!storeId || !shelfId) return;
      if (!ignoreExisting && hasQuestions) return;
      const key = `${storeId}::${shelfId}::${attemptRef.current}`;
      if (!forced && runningRef.current === key) return;
      runningRef.current = key;
      const cancelToken = { cancelled: false };
      cancelRef.current = cancelToken;
      setFailed(false);
      setIsGenerating(true);

      const timeoutId = setTimeout(() => {
        cancelToken.cancelled = true;
        setIsGenerating(false);
        setFailed(true);
        runningRef.current = "";
      }, QUESTION_TIMEOUT_MS);

      try {
        const centerLocation = getStoreCoordinates(storeId);
        if (cancelToken.cancelled) return;
        if (!centerLocation) throw new Error("门店未配置经纬度");

        // 顺序执行：避免高德 QPS 限流
        const competitorPois = await amapSearchAroundAll(centerLocation, RADIUS_M, COMPETITOR_POI_TYPES, 200);
        if (cancelToken.cancelled) return;
        const crowdPois = await amapSearchAroundAll(centerLocation, RADIUS_M, CROWD_SOURCE_POI_TYPES, 200);
        if (cancelToken.cancelled) return;
        const generated = await runQuestionsWorkflow(
          summarizePois(competitorPois),
          summarizePois(crowdPois),
          category,
        );
        if (cancelToken.cancelled) return;
        if (!generated || generated.length === 0) {
          throw new Error("empty questions from agent");
        }
        await saveShelfSurveyQuestions(storeId, shelfId, generated);
        queryClient.invalidateQueries({
          queryKey: ["shelf_survey_questions", storeId, shelfId],
        });
        setFailed(false);
      } catch (e) {
        if (!cancelToken.cancelled) {
          console.error("[useShelfQuestions] failed", e);
          setFailed(true);
          runningRef.current = "";
        }
      } finally {
        clearTimeout(timeoutId);
        if (!cancelToken.cancelled) setIsGenerating(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storeId, shelfId, hasQuestions, category, queryClient],
  );

  // Auto-trigger first attempt（仅在 enabled 时）
  useEffect(() => {
    if (!enabled) return;
    if (!storeId || !shelfId) return;
    if (questionsQuery.isLoading) return;
    if (hasQuestions) return;
    if (failed) return; // don't auto-retry after failure; require user action
    void runGeneration(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, storeId, shelfId, hasQuestions, questionsQuery.isLoading, failed]);

  const retry = useCallback(() => {
    if (cancelRef.current) cancelRef.current.cancelled = true;
    attemptRef.current += 1;
    runningRef.current = "";
    setFailed(false);
    void runGeneration(true);
  }, [runGeneration]);

  // 强制重新生成：忽略已有问题（用户关闭问答后重新点击「开始诊断」）
  const regenerate = useCallback(() => {
    if (cancelRef.current) cancelRef.current.cancelled = true;
    attemptRef.current += 1;
    runningRef.current = "";
    setFailed(false);
    void runGeneration(true, true);
  }, [runGeneration]);

  return {
    questions,
    hasQuestions,
    isLoading: questionsQuery.isLoading,
    isGenerating,
    failed,
    retry,
    regenerate,
  };
}
