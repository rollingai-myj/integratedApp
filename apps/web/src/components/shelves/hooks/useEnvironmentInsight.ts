import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast, toastSuccess } from "@/components/ui/sonner";
import { useAppContext } from "@/components/shelves/contexts/AppContext";
import { getStoreId } from "@/components/shelves/lib/utils";
import {
  amapSearchByText,
  amapSearchAroundAll,
  amapRegeo,
  convertWgsToGcj,
  COMPETITOR_POI_TYPES,
  CROWD_SOURCE_POI_TYPES,
  AmapPoi,
} from "@/components/shelves/lib/amapApi";
import { runEnvironmentInsightWorkflow } from "@/components/shelves/lib/difyInsightApi";
import {
  getEnvironmentInsight,
  saveEnvironmentInsight,
  updateEnvironmentCategory,
  StoreEnvironmentInsight,
} from "@/components/shelves/services/storeEnvironment";
import { getStoreCoordinates } from "@/components/shelves/data/storeCoordinates";

const RADIUS_M = 300;

export type InsightStatus =
  | "idle"
  | "checking"
  | "locating"
  | "fetching-poi"
  | "ai-analyzing"
  | "ready"
  | "error";

export interface UseEnvironmentInsightResult {
  status: InsightStatus;
  insight: StoreEnvironmentInsight | null;
  errorMessage: string | null;
  questionsReady: boolean;
  isQuestionsRunning: boolean;
  reanalyze: () => Promise<void>;

  updateCategory: (category: string) => Promise<void>;
}


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

export function useEnvironmentInsight(): UseEnvironmentInsightResult {
  const { selectedStore, storeAddress, storeName } = useAppContext();
  const storeId = getStoreId(selectedStore);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<InsightStatus>("idle");
  const [insight, setInsight] = useState<StoreEnvironmentInsight | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isQuestionsRunning] = useState(false);
  const runningRef = useRef(false);
  // Tracks which storeId the auto-pipeline last ran for, so we don't re-trigger
  // when storeAddress resolves asynchronously after the storeId was already processed.
  const pipelineStoreRef = useRef<string>("");

  const questionsReady = (insight?.questions?.length ?? 0) > 0;

  // Cache the DB lookup across navigations. staleTime: Infinity means we never
  // auto-refetch — insight only changes when the user explicitly re-analyzes.
  const { data: dbInsight, isLoading: isDbLoading } = useQuery({
    queryKey: ["environment_insight", storeId],
    queryFn: () => getEnvironmentInsight(storeId),
    enabled: !!storeId,
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
  });

  const runPipeline = useCallback(
    async (centerLocation: string, centerAddress: string) => {
      setStatus("fetching-poi");
      // 顺序执行：避免两个类目并发翻页触发高德 QPS 限流（CUQPS_HAS_EXCEEDED_THE_LIMIT）
      const competitorPois = await amapSearchAroundAll(centerLocation, RADIUS_M, COMPETITOR_POI_TYPES, 200);
      const crowdPois = await amapSearchAroundAll(centerLocation, RADIUS_M, CROWD_SOURCE_POI_TYPES, 200);
      setStatus("ai-analyzing");
      const competitorSummary = summarizePois(competitorPois);
      const crowdSummary = summarizePois(crowdPois);
      const result = await runEnvironmentInsightWorkflow(competitorSummary, crowdSummary);
      await saveEnvironmentInsight({
        storeId,
        poiCount: competitorPois.length + crowdPois.length,
        category: result.category,
        crowdSourceAnalysis: result.crowdSource_analysis,
        topCompetitors: result.top_competitors,
        competitorAnalysis: result.competitor_analysis,
        questions: [],
      });
      const fresh = await getEnvironmentInsight(storeId);
      // Push result into React Query cache so future navigations skip the DB fetch.
      queryClient.setQueryData(["environment_insight", storeId], fresh);
      setInsight(fresh);
      setStatus("ready");
    },
    [storeId, queryClient]
  );

  // Sync DB query result → local status; trigger pipeline when no cache exists.
  useEffect(() => {
    if (!storeId) return;

    if (isDbLoading) {
      setStatus("checking");
      return;
    }

    if (dbInsight) {
      setInsight(dbInsight);
      setStatus("ready");
      return;
    }

    // No cached insight for this store — run the full pipeline once.
    if (pipelineStoreRef.current === storeId) return;
    if (runningRef.current) return;
    pipelineStoreRef.current = storeId;
    runningRef.current = true;

    let cancelled = false;
    (async () => {
      setErrorMessage(null);
      try {
        setStatus("locating");
        const coord = getStoreCoordinates(storeId);
        let centerLocation = "";
        let centerAddress = storeAddress || "";
        if (coord) {
          centerLocation = coord;
          if (!centerAddress || centerAddress === "待配置") {
            centerAddress = await amapRegeo(coord);
          }
        } else {
          if (!storeAddress || storeAddress === "待配置") {
            throw new Error("门店未配置经纬度或地址");
          }
          const results = await amapSearchByText(storeAddress);
          const first = results.find((p) => !!p.location);
          if (cancelled) return;
          if (!first || !first.location) {
            throw new Error("无法根据门店地址定位");
          }
          centerLocation = first.location;
          centerAddress = first.address || storeAddress;
        }
        if (cancelled) return;
        await runPipeline(centerLocation, centerAddress);
      } catch (e: any) {
        if (cancelled) return;
        console.error(e);
        setErrorMessage(e?.message || "周边环境分析失败");
        setStatus("error");
      } finally {
        runningRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, isDbLoading, dbInsight, storeAddress]);

  const reanalyze = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setErrorMessage(null);
    try {
      setStatus("locating");
      const coord = getStoreCoordinates(storeId);
      let centerLocation = "";
      let centerAddress = storeAddress || "";
      if (coord) {
        centerLocation = coord;
        if (!centerAddress || centerAddress === "待配置") {
          centerAddress = await amapRegeo(coord);
        }
      } else {
        if (!storeAddress || storeAddress === "待配置") {
          throw new Error("门店未配置经纬度或地址");
        }
        const results = await amapSearchByText(storeAddress);
        const first = results.find((p) => !!p.location);
        if (!first) throw new Error("无法根据门店地址定位");
        centerLocation = first.location;
        centerAddress = first.address || storeAddress;
      }
      // Allow pipeline to re-run for this store (user explicitly requested it).
      pipelineStoreRef.current = "";
      await runPipeline(centerLocation, centerAddress);
      toastSuccess("周边环境分析完成");
    } catch (e: any) {
      console.error(e);
      setErrorMessage(e?.message || "重新分析失败");
      setStatus("error");
      toast.error("重新分析失败");
    } finally {
      runningRef.current = false;
    }
  }, [storeId, storeAddress, runPipeline]);

  const updateCategory = useCallback(
    async (category: string) => {
      if (!storeId) return;
      try {
        await updateEnvironmentCategory(storeId, category);
        setInsight((prev) => (prev ? { ...prev, category } : prev));
        queryClient.setQueryData(
          ["environment_insight", storeId],
          (old: StoreEnvironmentInsight | null | undefined) =>
            old ? { ...old, category } : old
        );
        toastSuccess("商圈类型已更新");
      } catch (e) {
        console.error(e);
        toast.error("更新失败");
      }
    },
    [storeId, queryClient]
  );

  return {
    status,
    insight,
    errorMessage,
    questionsReady,
    isQuestionsRunning,
    reanalyze,
    updateCategory,
  };
}
