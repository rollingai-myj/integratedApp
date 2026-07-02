/**
 * 价盘 · 规则诊断
 *
 * 完全在前端跑，对有 ≥2 个有销量的价格段的商品分析趋势。
 */
import type { CurveData, SKU } from './types';

export interface SkuDiagnosis {
  diagnosis: string;
  suggestion: 'raise' | 'lower' | 'keep';
  profitDirection: 'up' | 'down';
  /** 当前只有 'rule'；保留 source 字段为后续扩展留口 */
  source: 'rule';
}

function daysBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return Math.max(1, Math.round((endMs - startMs) / 86_400_000));
}

function formatYuan(value: number): string {
  return (Math.round(value * 100) / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * 规则引擎：基于价格段趋势给出建议
 * 复刻自原 priceChange/src/lib/dify-client.ts ruleBasedDiagnosis
 */
export function ruleBasedDiagnosis(_sku: SKU, curve: CurveData | null): SkuDiagnosis | null {
  if (!curve || curve.periods.length < 2) return null;

  // 只用"有真实销量"的价格段做对比：刚调完价时新段还没销量快照，
  // 不该立刻打"利润减少"标签，等下一期快照导入后才能下结论。
  const segsWithSales = curve.periods.filter((p) => p.hasSalesData);
  if (segsWithSales.length < 2) return null;

  const first = segsWithSales[0]!;
  const last = segsWithSales[segsWithSales.length - 1]!;

  if (Math.abs(first.price - last.price) < 0.01) return null;
  const priceDown = last.price < first.price;
  const profitUp = last.monthlyGrossProfit > first.monthlyGrossProfit;
  const days = daysBetween(first.endDate ?? first.startDate, last.endDate ?? last.startDate);
  const action = priceDown ? '降价' : '涨价';
  const profitDirection = profitUp ? 'up' : 'down';
  const profitText = profitUp ? '增加' : '减少';
  const profitDelta = Math.abs(last.monthlyGrossProfit - first.monthlyGrossProfit);
  const diagnosis = `${action}后${days != null ? `${days}天内` : ''}，月均利润${profitText}${formatYuan(profitDelta)}元`;

  if (priceDown && profitUp) {
    return { diagnosis, suggestion: 'lower', profitDirection, source: 'rule' };
  }
  if (priceDown && !profitUp) {
    return { diagnosis, suggestion: 'raise', profitDirection, source: 'rule' };
  }
  if (!priceDown && profitUp) {
    return { diagnosis, suggestion: 'raise', profitDirection, source: 'rule' };
  }
  if (!priceDown && !profitUp) {
    return { diagnosis, suggestion: 'lower', profitDirection, source: 'rule' };
  }
  return null;
}
