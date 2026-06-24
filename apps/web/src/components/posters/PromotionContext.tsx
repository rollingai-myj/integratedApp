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
  // 活动类型(后端拿来挑右下角二维码:周二会员日/品牌满减券/常规优惠券 三种)
  // 取自 CategoryItem.base_activity_type / addon_activity_type,raw 五种枚举:
  //   member_price / weekend_beer / brand_coupon / tuesday_member / regular_coupon
  baseActivityType?: string | null;
  addonActivityType?: string | null;
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
