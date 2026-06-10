/**
 * 策略动作分类工具
 *
 * AI 选品策略输出的 action 字段共三类：
 *  - remove  下架/停止进货 → 红色 Badge
 *  - observe 保留观察       → 琥珀色 Badge（既不计入下架，也不计入上架）
 *  - push    上架/力推/陈列 → 绿色 Badge
 */

export type StrategyActionKind = "remove" | "observe" | "push";

export const isRemoveAction = (a: string): boolean =>
  /下架|停止|清退|淘汰/.test(a || "");

export const isObserveAction = (a: string): boolean =>
  /保留观察|观察|保留/.test(a || "");

export const classifyAction = (a: string): StrategyActionKind => {
  if (isRemoveAction(a)) return "remove";
  if (isObserveAction(a)) return "observe";
  return "push";
};

/** Tailwind className for the action Badge */
export const actionBadgeClass = (a: string): string => {
  const k = classifyAction(a);
  if (k === "remove") return "bg-red-100 text-red-700 hover:bg-red-100";
  if (k === "observe") return "bg-amber-100 text-amber-700 hover:bg-amber-100";
  return "bg-green-100 text-green-700 hover:bg-green-100";
};
