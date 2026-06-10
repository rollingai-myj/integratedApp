import { useQuery } from "@tanstack/react-query";
import { listPlanPositions, type PlanPosition } from "@/components/shelves/services/scenes";

/**
 * 场景身份说明：plan_position_mapping 的 position_code 不唯一（如 code 1 同时对应
 * 「面包架【常温奶】」和「面包架【烘焙】」）。真正唯一的是 position_name。
 * 为了得到 URL/OSS 安全的稳定标识，统一用「分组列表中的序号(index)」作为 sceneId。
 * 后端 v2 表的 position_code 列实际存的就是这个 index。
 */
export function usePlanPositions() {
  const query = useQuery({
    queryKey: ["plan_positions"],
    queryFn: listPlanPositions,
    staleTime: 60 * 60 * 1000,
  });
  return {
    positions: (query.data ?? []) as PlanPosition[],
    isLoading: query.isLoading,
  };
}

/** 按场景序号(index) 解析场景 */
export function usePlanPosition(index: number) {
  const { positions, isLoading } = usePlanPositions();
  const position = Number.isFinite(index) ? positions[index] ?? null : null;
  return { position, isLoading };
}
