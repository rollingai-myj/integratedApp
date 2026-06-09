import * as React from 'react';

export type GroupMember = {
  sku: string;
  productName: string;
};

export type SelectedPromotion = {
  sku: string;
  productName: string;
  category: string | null;
  displayText: string;       // suggested copy
  unit: string | null;
  originalPrice: number | null;
  bestEffectivePrice: number | null;
  bestSavingPercent: number | null;
  // 可混搭组（仅当该选择是一个促销组时存在）
  groupId?: string | null;
  brandLabel?: string | null;
  groupMembers?: GroupMember[] | null;
};

type Ctx = {
  selected: SelectedPromotion | null;
  setSelected: (p: SelectedPromotion | null) => void;
  batch: SelectedPromotion[];
  setBatch: (list: SelectedPromotion[]) => void;
};

const PromotionCtx = React.createContext<Ctx>({
  selected: null, setSelected: () => {},
  batch: [], setBatch: () => {},
});

export function PromotionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = React.useState<SelectedPromotion | null>(null);
  const [batch, setBatch] = React.useState<SelectedPromotion[]>([]);
  return (
    <PromotionCtx.Provider value={{ selected, setSelected, batch, setBatch }}>
      {children}
    </PromotionCtx.Provider>
  );
}

export function usePromotion() {
  return React.useContext(PromotionCtx);
}
