/**
 * 价盘模块本地化数据模型
 *
 * 原 priceChange repo 用一个胖 `SKU` 类型聚合"商品 + 当前价 + 历史 + 调价记录"。
 * 统一后端把它们拆成了几个表 / 接口（StoreSkuRow + PriceCurvePoint + PriceChangeRecord）。
 * 这里维护原版组件期望的 `SKU` 形状，从后端 row 适配过来，组件层尽可能不动。
 */
import type {
  PriceCurvePoint,
  PriceCurveSku,
  StoreSkuRow,
} from '@myj/shared';

// ── 原版数据形状（组件复用）───────────────────────────────────────────

export interface Adjustment {
  timestamp: string;
  fromPrice: number;
  toPrice: number;
  note: '手动调价' | '智能调价';
}

export interface SKU {
  code: string;
  name: string;
  imgUrl: string;
  spec: string;
  brand: string;
  wholesalePrice: number;
  currentPrice: number;
  originalPrice: number;
  ownStoreSales: number;
  adjustments: Adjustment[];
  /** 是否真的调过价（hasPriceChange from backend） */
  hasAdjusted: boolean;
}

/** 单价格段（同一价格连续若干天聚合而成） */
export interface CurvePeriod {
  startDate: string | null;
  endDate: string | null;
  price: number;
  monthlySales: number;       // 该价格段内的月化销量
  monthlyGrossProfit: number; // 该价格段内的月化毛利
}

export interface CurveData {
  wholesalePrice: number;
  periods: CurvePeriod[];
}

// ── 适配器 ─────────────────────────────────────────────────────────────

/** 由 SKU 编码拼出阿里云图片地址（沿用原 repo 约定） */
export const getSkuImageUrl = (code: string): string =>
  `https://rollingai-meiyijia.oss-cn-shanghai.aliyuncs.com/product_pic/${code}.png`;

/**
 * 由 SKU 编码拼出条形码图片地址。
 *
 * OSS 上条形码按 8 位 SKU 编码归档；纯数字短于 8 位的需要前补 0。
 * 货架模块同款规则在 shelves/lib/preloadSkuAssets.ts；这里独立维护
 * 避免价盘对货架模块反向依赖（规则极简，复制成本远低于跨模块耦合）。
 */
export const getSkuBarcodeUrl = (code: string | undefined): string | null => {
  if (!code) return null;
  const padded = /^\d+$/.test(code) && code.length < 8 ? code.padStart(8, '0') : code;
  return `https://rollingai-meiyijia.oss-cn-shanghai.aliyuncs.com/SKU_bar_code/${padded}.png`;
};

/** 数据库行 → 组件期望的 SKU 形状 */
export function rowToSku(row: StoreSkuRow): SKU {
  return {
    code: row.skuCode,
    name: row.productName,
    imgUrl: row.officialImageUrl ?? getSkuImageUrl(row.skuCode),
    spec: row.spec ?? '',
    brand: row.brand ?? '',
    wholesalePrice: Number(row.wholesalePrice ?? 0),
    currentPrice: Number(row.retailPrice ?? 0),
    originalPrice: Number(row.originalPrice ?? row.retailPrice ?? 0),
    ownStoreSales: Number(row.salesQty30d ?? 0),
    adjustments: [],
    hasAdjusted: row.hasPriceChange,
  };
}

/**
 * 价格曲线（日 snapshot）→ 价格段（连续同价合并）
 *
 * 后端返回的是按天的 snapshot，原版组件吃的是"一个稳定售价段"。
 * 这里做客户端合并：相邻日同价合并成一段，跨段切换记录 start/end。
 *
 * 月化毛利计算优先级：
 *   1. 该 snapshot 有 grossMargin30d 且 > 0 → 月化毛利 = 销量 × 售价 × 毛利率
 *   2. 否则用批发价回填：先看 snapshot.wholesalePrice，再 fallback 到入参（dim_product.wholesale_price）
 *      → 单件毛利 = 售价 - 批发价；月化毛利 = 销量 × 单件毛利
 *   3. 批发价也没有时 → 月化毛利 = 月销售额（salesAmount30d）作粗略代用
 */
export function pointsToPeriods(
  points: PriceCurvePoint[],
  fallbackWholesale = 0,
): CurvePeriod[] {
  if (!points || points.length === 0) return [];
  // 按日升序
  const sorted = [...points].sort((a, b) =>
    a.snapshotDate < b.snapshotDate ? -1 : 1,
  );

  const segments: Array<{ price: number; from: string; to: string; sumSales: number; sumProfit: number; days: number }> = [];
  for (const p of sorted) {
    const price = Number(p.retailPrice ?? 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    const sales = Number(p.salesQty30d ?? 0);
    const salesAmount = Number(p.salesAmount30d ?? 0);
    const margin = p.grossMargin30d != null ? Number(p.grossMargin30d) : null;
    const wholesale = p.wholesalePrice != null
      ? Number(p.wholesalePrice)
      : (fallbackWholesale > 0 ? fallbackWholesale : 0);

    let profit: number;
    if (margin != null && margin > 0) {
      profit = sales * price * margin;
    } else if (wholesale > 0 && wholesale < price) {
      profit = sales * (price - wholesale);
    } else if (salesAmount > 0) {
      profit = salesAmount;
    } else {
      profit = sales * price;   // 兜底：月销售额
    }

    const last = segments[segments.length - 1];
    if (last && Math.abs(last.price - price) < 0.01) {
      last.to = p.snapshotDate;
      last.sumSales += sales;
      last.sumProfit += profit;
      last.days += 1;
    } else {
      segments.push({
        price,
        from: p.snapshotDate,
        to: p.snapshotDate,
        sumSales: sales,
        sumProfit: profit,
        days: 1,
      });
    }
  }

  return segments.map((seg) => ({
    startDate: seg.from,
    endDate: seg.to,
    price: seg.price,
    // 取该段的均值（每天的 30 天销量本来就近似月化，这里再取均值平滑一下）
    monthlySales: Math.round(seg.sumSales / Math.max(seg.days, 1)),
    monthlyGrossProfit: Math.round((seg.sumProfit / Math.max(seg.days, 1)) * 100) / 100,
  }));
}

/** 一个 SKU 的曲线段 + 批发价聚合 */
export function curveSkuToData(
  curve: PriceCurveSku | undefined,
  fallbackWholesale: number,
): CurveData {
  const periods = curve?.points ? pointsToPeriods(curve.points, fallbackWholesale) : [];
  const lastPoint = curve?.points?.[curve.points.length - 1];
  const wholesale = Number(lastPoint?.wholesalePrice ?? fallbackWholesale);
  return {
    wholesalePrice: wholesale,
    periods,
  };
}

// ── 工具函数 ───────────────────────────────────────────────────────────

export const fmtMoney = (n: number): string =>
  `¥${(Math.round(n * 100) / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const monthlyProfit = (s: SKU): number =>
  (s.currentPrice - s.wholesalePrice) * s.ownStoreSales;

export const monthlySales = (s: SKU): number =>
  s.currentPrice * s.ownStoreSales;
