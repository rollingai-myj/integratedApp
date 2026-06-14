/**
 * 选品策略 action 字符串归类（沿用原版 classifyAction 语义）
 *
 * Dify selection 工作流返回的 action 是中文：
 *   "停止进货" / "淘汰下架" / "清退" → remove
 *   "保留观察" / "观察" / "保留"     → observe
 *   "上架推广" / "补充上架" / "陈列" → push（默认归类）
 */

export type StrategyKind = 'remove' | 'observe' | 'push';

export const isRemoveAction = (a: string): boolean =>
  /下架|停止|清退|淘汰/.test(a || '');

export const isObserveAction = (a: string): boolean =>
  /保留观察|观察|保留/.test(a || '');

export function classifyStrategyKind(action: string): StrategyKind {
  if (isRemoveAction(action)) return 'remove';
  if (isObserveAction(action)) return 'observe';
  return 'push';
}
