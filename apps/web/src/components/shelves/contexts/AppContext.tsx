/**
 * AppContext shim —— 选品模块全局态
 *
 * 原 repo AppContext 是个超大对象（30+ 字段，含登录态/store 切换/SKU 缓存/strategies/
 * shelfUnits/viewMode/aiTargetGroups …）。整合 app 里 store/auth 是 useMe() 全局态，
 * v2 页面真正用到的只有 `selectedStore` 和 `skuDataVersion`。
 *
 * 这里：
 *   - selectedStore 从 useMe().currentStore.code 取（外部 ShelvesAppShell 注入）
 *   - skuDataVersion 提供一个递增 hook，让"远程拉 SKU 后触发重渲染"的旧 useEffect 仍能用
 *   - 旧字段全部用 no-op / 空值占位，确保未删的 legacy 组件挂载时不抛错
 *   - Strategy 类型在原 repo 被多处 import，保留导出
 */
import React, { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { type ShelfUnit, type ShelfCategoryMapping } from '@/components/shelves/data/shelfConfig';

export interface AiShelfResult {
  category: string;
  aiSuggestGroups: string;
  aiReason: string;
  finalGroups?: number;
}

export interface Strategy {
  name: string;
  description: string;
  skus: {
    skuCode: string;
    skuName: string;
    spec?: string;
    action: string;
    tags?: string[];
    reason: string;
    sales30d?: string;
    salesVolume30d?: string;
  }[];
  applied: boolean;
}

interface AppState {
  selectedStore: string;
  setSelectedStore: (s: string) => void;
  storeName: string;
  storeAddress: string;
  storeArea: string;
  storeType: string;
  consumptionLevel: string;
  competition: string;
  customerType: string;
  totalGroups: number;
  hasSelection: boolean;
  aiShelfResults: AiShelfResult[];
  setAiShelfResults: (r: AiShelfResult[]) => void;
  strategiesMap: Record<string, Strategy[]>;
  setStrategiesForSub: (subCat: string, strategies: Strategy[]) => void;
  toggleStrategy: (subCat: string, index: number) => void;
  appliedStrategies: Strategy[];
  strategies: Strategy[];
  setStrategies: (s: Strategy[]) => void;
  selectedSKUs: Set<string>;
  toggleSKU: (skuCode: string) => void;
  setSKUSelected: (skuCode: string, selected: boolean) => void;
  clearSelectedSKUs: () => void;
  shelfUnits: ShelfUnit[];
  setShelfUnits: (units: ShelfUnit[]) => void;
  viewMode: 'table' | 'shelf';
  setViewMode: (m: 'table' | 'shelf') => void;
  shelfMappingsFromConfig: ShelfCategoryMapping[];
  setShelfMappingsFromConfig: (m: ShelfCategoryMapping[]) => void;
  lastShelfDetailId: string | null;
  setLastShelfDetailId: (id: string | null) => void;
  aiTargetGroups: Record<string, number> | null;
  setAiTargetGroups: (g: Record<string, number> | null) => void;
  showAnalysisResults: boolean;
  setShowAnalysisResults: (s: boolean) => void;
  finalGroups: Record<string, number>;
  setFinalGroups: (g: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
  difyAdjustedCategories: Set<string>;
  setDifyAdjustedCategories: (s: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  isAnalyzing: boolean;
  setIsAnalyzing: (a: boolean) => void;
  skuDataVersion: number;
}

const AppContext = createContext<AppState | null>(null);

export const useAppContext = (): AppState => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be within AppProvider');
  return ctx;
};

/** 由路由层的 ShelvesAppShell 注入当前 store code */
export function AppProvider({
  selectedStore,
  storeName = '',
  storeAddress = '',
  children,
}: {
  selectedStore: string;
  storeName?: string;
  storeAddress?: string;
  children: ReactNode;
}) {
  const [skuDataVersion] = useState(0);
  const value = useMemo<AppState>(
    () => ({
      selectedStore,
      setSelectedStore: () => {/* 切店走整合 app 的 /portal/active-store，不在这里管 */},
      storeName: storeName || selectedStore,
      storeAddress,
      storeArea: '',
      storeType: '',
      consumptionLevel: '',
      competition: '',
      customerType: '',
      totalGroups: 0,
      hasSelection: true,
      aiShelfResults: [],
      setAiShelfResults: () => {},
      strategiesMap: {},
      setStrategiesForSub: () => {},
      toggleStrategy: () => {},
      appliedStrategies: [],
      strategies: [],
      setStrategies: () => {},
      selectedSKUs: new Set(),
      toggleSKU: () => {},
      setSKUSelected: () => {},
      clearSelectedSKUs: () => {},
      shelfUnits: [],
      setShelfUnits: () => {},
      viewMode: 'table',
      setViewMode: () => {},
      shelfMappingsFromConfig: [],
      setShelfMappingsFromConfig: () => {},
      lastShelfDetailId: null,
      setLastShelfDetailId: () => {},
      aiTargetGroups: null,
      setAiTargetGroups: () => {},
      showAnalysisResults: false,
      setShowAnalysisResults: () => {},
      finalGroups: {},
      setFinalGroups: () => {},
      difyAdjustedCategories: new Set(),
      setDifyAdjustedCategories: () => {},
      isAnalyzing: false,
      setIsAnalyzing: () => {},
      skuDataVersion,
    }),
    [selectedStore, storeName, storeAddress, skuDataVersion],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
