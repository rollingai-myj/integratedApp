/**
 * 价盘 · 规则诊断
 *
 * 完全在前端跑，对有 ≥2 个有销量的价格段的商品分析趋势。
 */
import type { CurveData, SKU } from './types';

export interface SkuDiagnosis {
  diagnosis: string;
  suggestion: 'raise' | 'lower' | 'keep';
  /** 当前只有 'rule'；保留 source 字段为后续扩展留口 */
  source: 'rule';
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

  if (priceDown && profitUp) {
    return { diagnosis: '降价后利润增加，可尝试继续降价', suggestion: 'lower', source: 'rule' };
  }
  if (priceDown && !profitUp) {
    return { diagnosis: '降价后利润减少，可尝试回调价格', suggestion: 'raise', source: 'rule' };
  }
  if (!priceDown && profitUp) {
    return { diagnosis: '涨价后利润增加，可尝试继续涨价', suggestion: 'raise', source: 'rule' };
  }
  if (!priceDown && !profitUp) {
    return { diagnosis: '涨价后利润减少，可尝试回调价格', suggestion: 'lower', source: 'rule' };
  }
  return null;
}
