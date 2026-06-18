// 共享的促销文案格式化逻辑（前后端复用）

function isValidPromotionUnit(unit: string | null | undefined) {
  const text = (unit ?? "").trim();
  if (!text) return false;
  const upper = text.toUpperCase();
  return upper !== "#N/A" && upper !== "NAN" && upper !== "N/A" && upper !== "#REF!" && upper !== "#VALUE!";
}

export function stripSpec(name: string | null | undefined): string {
  let s = (name ?? "").trim();
  // 去掉美宜佳内部代号前缀：N / X / NX / NM / NN，
  // 仅当其后紧跟中文或左括号时才剥离，避免误伤 NDARLIE/XAji/Opal 等真品牌
  s = s.replace(/^(NX|NM|NN|N|X)(?=[（(\u4e00-\u9fff])/, "");
  // 去掉紧随其后的产地/语言代码括号：(ZH) (意大利) (马来西亚) 等
  s = s.replace(/^\s*[（(][^)）]{1,10}[)）]\s*/, "");
  s = s.replace(/[（(][^)）]*[)）]/g, "");
  const tailRe = /\s*\d+(\.\d+)?\s*(kg|ml|g|l|支|片|包|袋|盒|瓶|罐|个|只|条|串|枚|块|根|斤|两)\s*$/i;
  for (let i = 0; i < 4; i++) {
    const next = s.replace(tailRe, "").trim();
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim();
}

// 直接剥掉任意字符串开头的美宜佳内部代号（N/X/NX/NM/NN）+ 可选国别括号。
// 用于兜底清洗存量 DB 里旧版本写入的 display_text / brand_label。
export function stripLeadingPromoCodes(text: string | null | undefined): string {
  let s = (text ?? "").trim();
  if (!s) return s;
  // 仅当代号后紧跟中文 / 左括号 / 数字时才剥离，避免误伤真品牌（NDARLIE、Xaji 等）
  s = s.replace(/^(NX|NM|NN|N|X)(?=[（(\u4e00-\u9fff0-9])/, "");
  s = s.replace(/^\s*[（(][^)）]{1,10}[)）]\s*/, "");
  return s.trim();
}

// 把开头的商品名（含可能的空格）从一段 displayText 里剥掉。
// 单品/组合两条路径共用，保证文案框默认值不含商品名。
// 注:仅做"按 productName 原文做前缀匹配"的剥离,不再清洗内部代号 / 括号 / 规格。
export function stripLeadingProductName(
  text: string | null | undefined,
  productName: string | null | undefined,
): string {
  const t = (text ?? "").trim();
  const name = (productName ?? "").trim();
  if (!t || !name) return t;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return t.replace(new RegExp("^" + escaped + "\\s*"), "").trim();
}

/**
 * 卡片左下角的促销文案。规则(见 docs/promotion-flow.md § 11):
 *
 *   原价 X/单位 {baseLabel} {baseTotal}/{N 单位}
 *       [到店领券 {addonDescription}]
 *       [相当于 Z/单位]
 *
 * - 多件凑单(N>1)的 base 价单独写一段:"会员价 11/2 罐",顾客看得清需要凑几件
 * - 叠了一张可叠券就追加 "到店领券 {具体满减规则}",再补 "相当于 Z/单位" 让顾客看叠后实际单价
 * - 单件(N=1) + 无 addon → 不写"相当于"(baseTotal 本身就是单价)
 * - 商品名 / addonDescription 全部原样使用,不做任何代号 / 括号 / 规格清洗
 */
export function formatPromotionDisplayText(input: {
  /** 主活动标签,如 "会员价" / "周末啤酒日" */
  baseLabel: string | null;
  /** 可叠的具体优惠描述,如 "怡宝饮料 满 88 减 10" / "9 折券";无叠加时传 null */
  addonDescription: string | null;
  /** base 单独算出的 N 件总价(不含 addon),如 "会员价 11 元/2 罐" 里的 11 */
  baseTotalPrice: number | null;
  /** 凑齐几件;<=1 时不写凑数后缀 */
  requiredQty: number | null;
  /** 叠完 addon 后的实际成交单价;无叠加时 == baseTotal / qty */
  effectiveUnitPrice: number | null;
  originalPrice: number | null;
  unit: string | null;
  productName: string | null;
  fallback: string | null;
}): string | null {
  const baseLabel = input.baseLabel ?? "";
  const baseTotal = Number(input.baseTotalPrice ?? 0);
  const requiredQty = Math.max(1, Number(input.requiredQty ?? 1) || 1);
  const effectiveUnitPrice = Number(input.effectiveUnitPrice ?? 0);
  const originalPrice = Number(input.originalPrice ?? 0);
  const unit = (input.unit ?? "").trim();
  if (!baseLabel || !baseTotal || !effectiveUnitPrice || !originalPrice || !isValidPromotionUnit(unit)) {
    return input.fallback;
  }

  const fmt = (n: number) => `¥${n.toFixed(2).replace(/\.?0+$/, '')}`;
  const qtyUnit = requiredQty <= 1 ? unit : `${requiredQty}${unit}`;
  const namePart = input.productName ? `${input.productName} ` : "";

  const parts: string[] = [];
  parts.push(`${namePart}原价${fmt(originalPrice)}/${unit}`);
  parts.push(`${baseLabel} ${fmt(baseTotal)}/${qtyUnit}`);
  if (input.addonDescription) {
    parts.push(`到店领券 ${input.addonDescription}`);
    parts.push(`相当于${fmt(effectiveUnitPrice)}/${unit}`);
  }
  return parts.join(" ");
}
