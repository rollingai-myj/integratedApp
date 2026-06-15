/**
 * 选品策略 action 字符串归类
 *
 * Dify selection 工作流返回的 action 是中文：
 *   "停止进货" / "淘汰下架" / "清退" → remove
 *   其他（含"上架推广" / "补充上架" / "陈列"）→ push（默认归类）
 */

export type StrategyKind = 'remove' | 'push';

export const isRemoveAction = (a: string): boolean =>
  /下架|停止|清退|淘汰/.test(a || '');

export function classifyStrategyKind(action: string): StrategyKind {
  if (isRemoveAction(action)) return 'remove';
  return 'push';
}
