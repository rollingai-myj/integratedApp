/**
 * 场景展示辅助 —— 价盘和选品两边共用同一份 emoji/排序规则
 *
 * 数据本身从 /api/v1/scenes 读（useScenes 在 lib/hooks.ts）；这里只负责展示侧
 * 的派生：emoji 规则、enable 判定。改 emoji 或者新增 enable 场景都改这里一处。
 */

/**
 * 场景名 → emoji 映射；命中"包含"关系即可（兼容"面包架【常温奶】"等带括号变体）。
 * 顺序敏感：更具体的规则放前面（如 "常温奶/乳" 必须在 "面包/烘焙" 前命中）。
 */
const EMOJI_RULES: Array<[RegExp, string]> = [
  [/常温奶|乳/, '🥛'],
  [/糖|巧/, '🍬'],
  [/面包|烘焙|糕点/, '🍞'],
  [/小零食/, '🍿'],
  [/大休闲/, '🎯'],
  [/饼干|膨化/, '🍪'],
  [/方便|速食/, '🍜'],
  [/粮|油|调味/, '🍚'],
  [/酒/, '🍷'],
  [/玩具/, '🧸'],
  [/日化|护理/, '🧴'],
  [/家杂|家庭杂/, '🧰'],
  [/冷藏|冷冻|冰/, '❄️'],
];

export function emojiForScene(name: string): string {
  for (const [re, e] of EMOJI_RULES) if (re.test(name)) return e;
  return '🏷️';
}
