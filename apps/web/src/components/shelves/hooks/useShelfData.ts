import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/components/shelves/lib/api-client";
import type { ShelfCategoryMapping, ShelfSegment } from "@/components/shelves/data/shelfConfig";

export interface DbShelfConfig {
  id: string; store_id: string; shelf_id: string;
  group_name: string; group_sort: number; shelf_type: string;
  shelf_width: string; shelf_layers: number;
  categories: { category: string; ratio: number }[];
  sort_order: number; display_label?: string | null;
}

export const useShelfData = (storeId: string) => {
  const queryClient = useQueryClient();

  const shelfConfigQuery = useQuery({
    queryKey: ["store_shelf_config", storeId],
    queryFn: async (): Promise<DbShelfConfig[]> => {
      const res = await apiFetch(`/api/config/shelf-config?storeId=${encodeURIComponent(storeId)}`);
      return ((await res.json()) || []) as DbShelfConfig[];
    },
  });

  const createShelfConfig = useMutation({
    mutationFn: async (config: Omit<DbShelfConfig, "id">) => {
      await apiFetch('/api/config/shelf-config', {
        method: 'POST',
        body: JSON.stringify({
          store_id: config.store_id, shelf_id: config.shelf_id,
          group_name: config.group_name, group_sort: config.group_sort,
          shelf_type: config.shelf_type, shelf_width: config.shelf_width,
          shelf_layers: config.shelf_layers, categories: config.categories,
          sort_order: config.sort_order, display_label: config.display_label ?? null,
        }),
      });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["store_shelf_config", storeId] }); },
  });

  const updateShelfConfig = useMutation({
    mutationFn: async (params: { shelfId: string; patch: Partial<Omit<DbShelfConfig, "id" | "store_id" | "shelf_id">> }) => {
      await apiFetch('/api/config/shelf-config', {
        method: 'PATCH',
        body: JSON.stringify({ storeId, shelfId: params.shelfId, patch: params.patch }),
      });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["store_shelf_config", storeId] }); },
  });

  const deleteShelfConfig = useMutation({
    mutationFn: async (shelfIds: string[]) => {
      if (!shelfIds.length) return;
      await apiFetch('/api/config/shelf-config', {
        method: 'DELETE',
        body: JSON.stringify({ storeId, shelfIds }),
      });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["store_shelf_config", storeId] }); },
  });

  const upsertShelfConfig = useMutation({
    mutationFn: async (configs: Omit<DbShelfConfig, "id">[]) => {
      await apiFetch('/api/config/shelf-config/replace', {
        method: 'POST',
        body: JSON.stringify({ storeId, configs }),
      });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["store_shelf_config", storeId] }); },
  });

  return {
    shelfConfigs: shelfConfigQuery.data,
    isLoading: shelfConfigQuery.isLoading,
    error: shelfConfigQuery.error,
    refetchShelfConfigs: shelfConfigQuery.refetch,
    createShelfConfig, updateShelfConfig, deleteShelfConfig, upsertShelfConfig,
  };
};

export const configsToMappings = (configs: DbShelfConfig[]): ShelfCategoryMapping[] =>
  configs.map(c => {
    const segments: ShelfSegment[] = (c.categories as { category: string; ratio: number }[]).map(cat => ({
      category: cat.category, groups: cat.ratio,
    }));
    return { shelfId: c.shelf_id, position: c.group_name, beforeSegments: segments, afterSegments: segments, isChanged: false, changeDescription: "" };
  });
