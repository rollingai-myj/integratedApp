/**
 * 货架规格库 — 按货架类型组织,每个规格附带物理宽度与展示图片。
 * 首批仅提供「冷柜」规格;其它类型留空,UI 自动回退为 +/- 步进器。
 */
const STORAGE_BASE = 'https://rollingai-service-oss.oss-cn-beijing.aliyuncs.com';
const cold3ft   = `${STORAGE_BASE}/myjadviser/assets/shelf-specs/cold-3ft.png`;
const coldDouble = `${STORAGE_BASE}/myjadviser/assets/shelf-specs/cold-double.png`;
const cold6ft   = `${STORAGE_BASE}/myjadviser/assets/shelf-specs/cold-6ft.png`;

export interface ShelfSpec {
  id: string;
  name: string;
  width: number; // cm
  image: string;
}

export const SHELF_SPECS: Record<string, ShelfSpec[]> = {
  冷柜: [
    { id: "cold-3ft", name: "三尺风幕柜", width: 75, image: cold3ft },
    { id: "cold-double", name: "双门柜", width: 120, image: coldDouble },
    { id: "cold-6ft", name: "六尺风幕柜", width: 150, image: cold6ft },
  ],
};

// 模块加载时即预加载所有规格图片，避免用户点开弹层后才开始下载
if (typeof window !== "undefined") {
  Object.values(SHELF_SPECS).forEach((specs) => {
    specs.forEach((spec) => {
      const img = new Image();
      img.src = spec.image;
    });
  });
}

export function getSpecsByType(shelfType: string): ShelfSpec[] {
  return SHELF_SPECS[shelfType] ?? [];
}

export function findSpecByWidth(shelfType: string, widthCm: number): ShelfSpec | undefined {
  return getSpecsByType(shelfType).find((s) => s.width === widthCm);
}
