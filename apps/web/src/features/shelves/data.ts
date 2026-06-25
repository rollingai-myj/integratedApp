/**
 * 选品模块 mock 数据（仅 UI 演示用）
 *
 * 13 场景的 demo SKU + 诊断 + 方案 + 问题单品框等。生产环境这些应由 AI 工作流
 * 生成，但 Dify key 在 dev/CI 不一定有，先用 mock 保流程跑通，后端切到真 SSE
 * 后只换 fetcher，不动 UI。
 */

export interface DemoSku {
  skuCode: string;
  skuName: string;
  spec: string;
  sales30d: number;
  salesChange30d: number;
  salesVolume30d: number;
}

export const DEMO_SKUS: DemoSku[] = [
  { skuCode: '06210334', skuName: '牛轧糖原味',     spec: '160g', sales30d: 486.0, salesChange30d: 12.4,  salesVolume30d: 54 },
  { skuCode: '06210187', skuName: '果汁软糖混合装', spec: '135g', sales30d: 421.2, salesChange30d: 8.1,   salesVolume30d: 65 },
  { skuCode: '06210512', skuName: '黑巧克力65%',    spec: '100g', sales30d: 396.0, salesChange30d: 21.7,  salesVolume30d: 33 },
  { skuCode: '06210095', skuName: '海盐太妃糖',     spec: '90g',  sales30d: 312.0, salesChange30d: 4.2,   salesVolume30d: 39 },
  { skuCode: '06210278', skuName: '牛奶巧克力豆',   spec: '45g',  sales30d: 258.4, salesChange30d: -2.3,  salesVolume30d: 76 },
  { skuCode: '06210443', skuName: '薄荷无糖口香糖', spec: '32g',  sales30d: 244.8, salesChange30d: 6.0,   salesVolume30d: 102 },
  { skuCode: '06210366', skuName: '巧克力威化',     spec: '58g',  sales30d: 187.5, salesChange30d: -8.9,  salesVolume30d: 50 },
  { skuCode: '06210129', skuName: '棒棒糖混合口味', spec: '6支',  sales30d: 156.0, salesChange30d: 3.5,   salesVolume30d: 52 },
  { skuCode: '06210601', skuName: '黑糖话梅糖',     spec: '95g',  sales30d: 98.6,  salesChange30d: -15.2, salesVolume30d: 17 },
  { skuCode: '06210488', skuName: '酒心巧克力',     spec: '120g', sales30d: 45.0,  salesChange30d: -31.4, salesVolume30d: 3 },
  { skuCode: '06210157', skuName: '棉花糖',         spec: '60g',  sales30d: 32.4,  salesChange30d: -18.0, salesVolume30d: 9 },
  { skuCode: '06210372', skuName: '跳跳糖',         spec: '9g',   sales30d: 18.0,  salesChange30d: -42.5, salesVolume30d: 12 },
  { skuCode: '06210520', skuName: '水果硬糖混合装', spec: '150g', sales30d: 12.8,  salesChange30d: -55.1, salesVolume30d: 2 },
];

export const DEMO_DIAGNOSIS = {
  paragraph_customer:
    '门店位于商圈写字楼底商，主力客群为 25–35 岁上班族，下午茶与加班时段是该品类消费高峰。该客群偏好低糖、小包装与高品质。',
  paragraph_competition:
    '周边竞争对手以大包装、低价散装为主，价格难以正面竞争；但低糖与高品质细分品类覆盖少，是本店可以做出差异的空档。',
  paragraph_status:
    '货架上若干在售单品连续两个月动销垫底，占用陈列面但贡献销售额低；热门品类缺少口味延伸，存在补充空间。',
};

export const DEMO_PROBLEM_SKUS = new Set(['06210372', '06210520', '06210157', '06210488']);

export type StrategyKind = 'remove' | 'push';
export interface StrategyItem {
  skuCode: string;
  skuName: string;
  spec: string;
  action: string;
  kind: StrategyKind;
  tag: string;
  reason: string;
}

export const DEMO_STRATEGY: StrategyItem[] = [
  { skuCode: '06210520', skuName: '水果硬糖混合装', spec: '150g', action: '淘汰下架', kind: 'remove',  tag: '低动销',  reason: '30 日仅售 2 件，环比 -55%，与量贩店同质且价格无优势' },
  { skuCode: '06210372', skuName: '跳跳糖',         spec: '9g',   action: '淘汰下架', kind: 'remove',  tag: '低动销',  reason: '客群以上班族为主，儿童糖果动销持续走低' },
  { skuCode: '06210157', skuName: '棉花糖',         spec: '60g',  action: '淘汰下架', kind: 'remove',  tag: '低动销',  reason: '连续两月动销垫底，占用一节陈列面' },
  { skuCode: '06210488', skuName: '酒心巧克力',     spec: '120g', action: '淘汰下架', kind: 'remove',  tag: '滞销',    reason: '30 日仅售 3 件，保质期临近，建议清仓处理' },
  { skuCode: '06210710', skuName: '黑巧克力85%',    spec: '100g', action: '上架推广', kind: 'push',    tag: '趋势款',  reason: '黑巧 65% 动销 +21.7%，向上延伸高浓度规格，白领客群接受度高' },
  { skuCode: '06210725', skuName: '生椰拿铁味软糖', spec: '108g', action: '上架推广', kind: 'push',    tag: '网红款',  reason: '软糖品类动销强，咖啡风味契合写字楼客群' },
  { skuCode: '06210733', skuName: '0糖薄荷软糖',    spec: '76g',  action: '上架推广', kind: 'push',    tag: '高毛利',  reason: '无糖品类周边竞对未覆盖，差异化空档' },
  { skuCode: '06210741', skuName: '每日黑巧小包装', spec: '42g',  action: '上架推广', kind: 'push',    tag: '趋势款',  reason: '小包装单价低、试错成本低，适合下午茶即买即食' },
];

/** 设计稿写死的问题单品在照片上的固定位置（PS：当前没有真实识别） */
export const DEMO_PHOTO_BOXES = [
  { left: '8%',  top: '58%', width: '17%', height: '24%' },
  { left: '37%', top: '60%', width: '15%', height: '22%' },
  { left: '63%', top: '14%', width: '18%', height: '26%' },
  { left: '78%', top: '62%', width: '16%', height: '23%' },
];

export const SHELF_TYPES = [
  { type: '标准货架', hint: '最常见的多层背板货架' },
  { type: '端架',     hint: '货架两端的促销陈列位' },
  { type: '冷柜',     hint: '冷藏 / 冷冻陈列柜' },
  { type: '收银台旁', hint: '收银台附近的小型陈列' },
];

export const WIDTH_PRESETS = [60, 75, 90];

// ---- 场景元数据：emoji 等只供 UI 装饰（场景定义本身来自后端） -----------

const EMOJI_BY_SCENE: Record<number, string> = {
  0: '🍬', 1: '🥛', 2: '🍞', 3: '🍿', 4: '🎯', 5: '🍪', 6: '🍜',
  7: '🍚', 8: '🍷', 9: '🧸', 10: '🧴', 11: '🧰', 12: '❄️',
};
export function emojiForScene(scene: number): string {
  return EMOJI_BY_SCENE[scene] ?? '📦';
}

export const fmtMoney = (n: number) => `¥${Number(n).toFixed(n >= 100 ? 0 : 1)}`;
export const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// ---- 跳过原因预设（按建议类型） -----------------------------------------

export const SKIP_REASONS: Record<StrategyKind, string[]> = {
  remove:  ['其实卖得还可以', '有老顾客常买', '还有库存要卖完', '想再观察一阵子'],
  push:    ['进不到这个货', '不看好这个品', '货架实在放不下', '想先少上几个试试'],
};
