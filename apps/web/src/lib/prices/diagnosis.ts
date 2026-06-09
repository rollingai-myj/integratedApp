/**
 * 价盘 · 诊断（规则引擎 + AI）
 *
 * - 规则引擎：完全在前端跑，对有 ≥2 个价格段的商品分析趋势
 * - AI：调统一后端 /prices/diagnose（密钥保护、配额、审计都在后端）
 */
import type { DiagnoseSkuResult } from '@myj/shared';
import type { CurveData, SKU } from './types';

export interface SkuDiagnosis {
  diagnosis: string;
  suggestion: 'raise' | 'lower' | 'keep';
  /** 'rule' = 规则引擎生成 / 'ai' = AI 智能体生成 */
  source: 'rule' | 'ai';
}

/** 后端 suggestion 字段到前端枚举的映射 */
function mapBackendSuggestion(s: DiagnoseSkuResult['suggestion']): SkuDiagnosis['suggestion'] {
  if (s === 'up') return 'raise';
  if (s === 'down') return 'lower';
  return 'keep';
}

/** 把后端单条诊断结果适配成前端 SkuDiagnosis */
export function adaptDiagnosis(r: DiagnoseSkuResult): SkuDiagnosis {
  return {
    diagnosis: r.reasoning.slice(0, 30),
    suggestion: mapBackendSuggestion(r.suggestion),
    source: 'ai',
  };
}

/**
 * 规则引擎：基于价格段趋势给出建议
 * 复刻自原 priceChange/src/lib/dify-client.ts ruleBasedDiagnosis
 */
export function ruleBasedDiagnosis(_sku: SKU, curve: CurveData | null): SkuDiagnosis | null {
  if (!curve || curve.periods.length < 2) return null;

  const periods = curve.periods;
  const first = periods[0]!;
  const last = periods[periods.length - 1]!;

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
