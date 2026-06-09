// Maps fine-grained Excel categories (37 of them) into ~14 "规划位" display
// groups used by the home screen category scroller. Pure presentation —
// the database still stores the original `category` value untouched.

export const CATEGORY_GROUP_MAP: Record<string, string> = {
  // Drinks aggregation (果汁 goes to 冷藏品 instead per shop layout)
  "20碳酸饮料": "饮料",
  "21水": "饮料",
  "22茶饮品": "饮料",
  "24功能饮料": "饮料",
  "26其它饮品": "饮料",

  // Alcohol — 啤酒/预调酒 stays separate from 酒
  "11酒类": "酒",
  "28啤酒／预调酒": "啤酒",

  // Dairy
  "27常温乳制品": "常温奶",

  // Snacks
  "10膨化食品": "休闲零食",
  "31坚果炒货": "休闲零食",
  "32果干蜜饯": "休闲零食",
  "34休闲素食": "休闲零食",
  "35休闲肉脯": "休闲零食",
  "36定量小包装": "休闲零食",

  // Biscuits & candy
  "02糖果&巧克力": "饼干糖巧",
  "39饼干": "饼干糖巧",

  // Bakery
  "06烘焙糕点": "烘焙",

  // Convenience food
  "05方便食品": "方便食品",

  // Seasoning & instant drinks
  "12调味副食": "调味冲调",
  "13冲调品": "调味冲调",

  // Grain & oil
  "40粮油": "粮油",

  // Personal/household care
  "49口腔护理": "日化",
  "50个人护理": "日化",
  "51家庭护理": "日化",
  "52卫生用品": "日化",
  "57生活用纸": "日化",

  // Misc household goods
  "53针织品及鞋类": "百货",
  "55餐厨用品": "百货",
  "58数码电器": "百货",

  // Kept separate — display name only (drop numeric prefix / cleanup)
  "08雪糕": "雪糕",
  "15冷藏品": "冷藏品",
  "23果汁": "冷藏品",
  "29保鲜鲜食": "保鲜鲜食",
  "07熟食&饮品": "熟食",
  "14计生情趣": "计生情趣",
  "01香烟": "香烟",
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

export function mapCategoryToGroup(rawCategory: string | null | undefined): string {
  const c = (rawCategory ?? "").trim();
  if (!c) return "其他";
  return CATEGORY_GROUP_MAP[c] ?? "其他";
}
