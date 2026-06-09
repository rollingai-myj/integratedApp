/**
 * 货架展示名计算
 * 规则：基于品类名 + 编号
 *  - 优先使用用户自定义的 display_label（任意字符串，如 "01"、"靠门第一排"）
 *  - 回退：按 sort_order 顺序自动补 NN（兼容旧数据）
 */
export interface ShelfConfigLite {
  shelf_id: string;
  categories: { category: string; ratio?: number }[];
  sort_order: number;
  display_label?: string | null;
}

export const getShelfPrimaryCategory = (
  shelfId: string,
  configs: ShelfConfigLite[] | undefined | null,
): string => {
  const cfg = configs?.find((c) => c.shelf_id === shelfId);
  return cfg?.categories?.[0]?.category || "未分类";
};

export const getShelfDisplayName = (
  shelfId: string,
  configs: ShelfConfigLite[] | undefined | null,
): string => {
  if (!configs || configs.length === 0) return shelfId;
  const cfg = configs.find((c) => c.shelf_id === shelfId);
  if (!cfg) return shelfId;
  const primary = cfg.categories?.[0]?.category;
  if (!primary) return shelfId;

  // Prefer user-defined display_label
  if (cfg.display_label && cfg.display_label.trim()) {
    return `${primary} ${cfg.display_label.trim()}`;
  }

  // Fallback: legacy positional numbering
  const sameCat = configs
    .filter((c) => c.categories?.[0]?.category === primary)
    .sort((a, b) => (a.sort_order - b.sort_order) || a.shelf_id.localeCompare(b.shelf_id));

  const idx = sameCat.findIndex((c) => c.shelf_id === shelfId);
  const num = (idx < 0 ? 0 : idx) + 1;
  return `${primary} ${String(num).padStart(2, "0")}`;
};

/**
 * 计算同品类下下一个可用的自动编号（仅识别纯数字 label，取 max+1）
 * 删除货架后剩余 label 不变，新建只递增不回填。
 */
/**
 * 计算同品类下下一个可用的两位数编号。
 * 真源策略：只看已持久化的 display_label（纯数字部分），取 max+1。
 * 不再参考“隐式位置编号”——所有未带 label 的旧数据已通过迁移回填。
 * 删除中间货架后，新建编号继续 max+1，不回填空缺。
 */
export const getNextDisplayLabel = (
  category: string,
  configs: ShelfConfigLite[] | undefined | null,
  reservedLabels: string[] = [],
): string => {
  const sameCat = (configs || []).filter(
    (c) => c.categories?.[0]?.category === category,
  );

  let maxNum = 0;
  for (const c of sameCat) {
    const lbl = (c.display_label || "").trim();
    if (/^\d+$/.test(lbl)) {
      const n = parseInt(lbl, 10);
      if (n > maxNum) maxNum = n;
    }
  }
  // Also account for in-flight / reserved labels (e.g., concurrent creates).
  for (const lbl of reservedLabels) {
    const trimmed = (lbl || "").trim();
    if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed, 10);
      if (n > maxNum) maxNum = n;
    }
  }

  return String(maxNum + 1).padStart(2, "0");
};

/**
 * 将旧数据中“未显式保存 display_label，但界面已按顺序展示出编号”的货架编号固化下来，
 * 避免后续新增货架时旧货架重新排序并发生编号漂移。
 */
export const hydrateShelfDisplayLabels = <T extends ShelfConfigLite>(
  configs: T[] | undefined | null,
): T[] => {
  if (!configs || configs.length === 0) return [];

  const sameCatOrderMap = new Map<string, T[]>();
  for (const config of configs) {
    const category = config.categories?.[0]?.category || "未分类";
    const list = sameCatOrderMap.get(category) || [];
    list.push(config);
    sameCatOrderMap.set(category, list);
  }

  const hydratedLabelByShelfId = new Map<string, string | null | undefined>();
  sameCatOrderMap.forEach((list) => {
    const ordered = [...list].sort(
      (a, b) => (a.sort_order - b.sort_order) || a.shelf_id.localeCompare(b.shelf_id),
    );
    ordered.forEach((config, index) => {
      const label = (config.display_label || "").trim();
      hydratedLabelByShelfId.set(
        config.shelf_id,
        label || String(index + 1).padStart(2, "0"),
      );
    });
  });

  return configs.map((config) => ({
    ...config,
    display_label: hydratedLabelByShelfId.get(config.shelf_id) ?? config.display_label ?? null,
  }));
};
