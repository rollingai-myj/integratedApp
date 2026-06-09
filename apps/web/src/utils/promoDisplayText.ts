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
export function stripLeadingProductName(
  text: string | null | undefined,
  productName: string | null | undefined,
): string {
  const t = (text ?? "").trim();
  const name = stripSpec(productName);
  if (!t || !name) return t;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return t.replace(new RegExp("^" + escaped + "\\s*"), "").trim();
}

export function formatPromotionDisplayText(input: {
  label: string | null;
  totalPrice: number | null;
  requiredQty: number | null;
  effectiveUnitPrice: number | null;
  originalPrice: number | null;
  unit: string | null;
  productName: string | null;
  fallback: string | null;
}): string | null {
  const label = input.label ?? "";
  const totalPrice = Number(input.totalPrice ?? 0);
  const requiredQty = Math.max(1, Number(input.requiredQty ?? 1) || 1);
  const effectiveUnitPrice = Number(input.effectiveUnitPrice ?? 0);
  const originalPrice = Number(input.originalPrice ?? 0);
  const unit = (input.unit ?? "").trim();
  if (!label || !totalPrice || !effectiveUnitPrice || !originalPrice || !isValidPromotionUnit(unit)) return input.fallback;

  const fmt = (n: number) => `¥${n.toFixed(2).replace(/\.?0+$/, '')}`;
  const prefix = label.includes(" + ") ? "叠券后" : (label === "抖音团购" ? "抖音" : label);
  const qtyUnit = requiredQty <= 1 ? unit : `${requiredQty}${unit}`;
  const cleanName = stripSpec(input.productName);
  const namePart = cleanName ? `${cleanName} ` : "";
  // 仅"会员价"一项时不写"到店领券"
  const connector = label === "会员价" ? prefix : `到店领券 ${prefix}`;
  const head = `${namePart}原价${fmt(originalPrice)}/${unit} ${connector} ${fmt(totalPrice)}/${qtyUnit}`;
  return requiredQty <= 1 ? head : `${head} 相当于${fmt(effectiveUnitPrice)}/${unit}`;
}
