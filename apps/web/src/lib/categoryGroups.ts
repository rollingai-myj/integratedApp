// Maps fine-grained Excel categories (37 of them) into ~14 "规划位" display
// groups used by the home screen category scroller. Pure presentation —
// the database still stores the original `category` value untouched.
//
// 输入可能是 "15冷藏品"(Excel 大类带数字前缀)或 "冷藏品"(hq_categories 已去前缀);
// mapCategoryToGroup 在查表前会剥掉行首数字,所以键统一不带前缀。

export const CATEGORY_GROUP_MAP: Record<string, string> = {
  // Drinks aggregation (果汁 goes to 冷藏品 instead per shop layout)
  "碳酸饮料": "饮料",
  "水": "饮料",
  "茶饮品": "饮料",
  "功能饮料": "饮料",
  "其它饮品": "饮料",

  // Alcohol — 啤酒/预调酒 stays separate from 酒
  "酒类": "酒",
  "啤酒／预调酒": "啤酒",

  // Dairy
  "常温乳制品": "常温奶",

  // Snacks
  "膨化食品": "休闲零食",
  "坚果炒货": "休闲零食",
  "果干蜜饯": "休闲零食",
  "休闲素食": "休闲零食",
  "休闲肉脯": "休闲零食",
  "定量小包装": "休闲零食",

  // Biscuits & candy
  "糖果&巧克力": "饼干糖巧",
  "饼干": "饼干糖巧",

  // Bakery
  "烘焙糕点": "烘焙",

  // Convenience food
  "方便食品": "方便食品",

  // Seasoning & instant drinks
  "调味副食": "调味冲调",
  "冲调品": "调味冲调",

  // Grain & oil
  "粮油": "粮油",

  // Personal/household care
  "口腔护理": "日化",
  "个人护理": "日化",
  "家庭护理": "日化",
  "卫生用品": "日化",
  "生活用纸": "日化",

  // Misc household goods
  "针织品及鞋类": "百货",
  "餐厨用品": "百货",
  "数码电器": "百货",

  // Kept separate — display name only (drop numeric prefix / cleanup)
  "雪糕": "雪糕",
  "冷藏品": "冷藏品",
  "果汁": "冷藏品",
  "保鲜鲜食": "保鲜鲜食",
  "熟食&饮品": "熟食",
  "计生情趣": "计生情趣",
  "香烟": "香烟",
  "宠物产品": "百货",
};

// Fixed display order for the home screen scroller. Categories not in this
// list fall to the end (sorted by user preference + count fallback).
export const GROUP_ORDER: string[] = [
  "饮料",
  "啤酒",
  "酒",
  "常温奶",
  "雪糕",
  "冷藏品",
  "休闲零食",
  "饼干糖巧",
  "烘焙",
  "方便食品",
  "熟食",
  "保鲜鲜食",
  "调味冲调",
  "粮油",
  "日化",
  "百货",
  "计生情趣",
  "香烟",
  "其他",
];

// 剥掉行首阿拉伯数字 + 可能的空白(如 "15冷藏品" → "冷藏品", "02糖果&巧克力" → "糖果&巧克力")
function stripCategoryDigits(c: string): string {
  return c.replace(/^\d+\s*/, '').trim();
}

export function mapCategoryToGroup(rawCategory: string | null | undefined): string {
  const c = stripCategoryDigits((rawCategory ?? "").trim());
  if (!c) return "其他";
  return CATEGORY_GROUP_MAP[c] ?? "其他";
}
