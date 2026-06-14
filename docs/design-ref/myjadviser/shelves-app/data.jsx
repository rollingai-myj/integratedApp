// 数据 —— 场景/SKU/诊断/方案，按代码库真实结构抽样
// 结构对应 SkuRow / DiagnosisResult / Strategy / SceneAdjustment

const STORE = { code: '粤37893', name: '东莞南城鸿福路店' };

// 13 个场景（与 /api/v1/scenes 及价盘 CATEGORIES 一致）
const SCENES = [
  { id: 0,  name: '糖巧',           emoji: '🍬', categories: ['糖果&巧克力'] },
  { id: 1,  name: '面包架【常温奶】', emoji: '🥛', categories: ['常温乳品'] },
  { id: 2,  name: '面包架【烘焙】',   emoji: '🍞', categories: ['烘焙糕点'] },
  { id: 3,  name: '小零食',         emoji: '🍿', categories: ['蜜饯果干', '肉干豆制品'] },
  { id: 4,  name: '大休闲',         emoji: '🎯', categories: ['坚果炒货', '大包装零食'] },
  { id: 5,  name: '饼干膨化',       emoji: '🍪', categories: ['饼干', '膨化食品'] },
  { id: 6,  name: '方便速食',       emoji: '🍜', categories: ['方便面', '自热食品'] },
  { id: 7,  name: '粮油调味',       emoji: '🍚', categories: ['调味副食', '冲调品'] },
  { id: 8,  name: '酒',             emoji: '🍷', categories: ['酒类'] },
  { id: 9,  name: '玩具',           emoji: '🧸', categories: ['玩具文具'] },
  { id: 10, name: '日化',           emoji: '🧴', categories: ['个人护理'] },
  { id: 11, name: '家杂',           emoji: '🧰', categories: ['家庭杂货'] },
  { id: 12, name: '冷藏',           emoji: '❄️', categories: ['冷藏乳品', '低温饮品'] },
];

const SHELF_TYPES = [
  { type: '标准货架', hint: '最常见的多层背板货架' },
  { type: '端架',     hint: '货架两端的促销陈列位' },
  { type: '冷柜',     hint: '冷藏/冷冻陈列柜' },
  { type: '收银台旁', hint: '收银台附近的小型陈列' },
];
const WIDTH_PRESETS = [60, 75, 90];

// 糖巧场景在售 SKU（销售数据表用，按 30 日销售额降序）
const SKUS = [
  { skuCode: '06210334', skuName: '牛轧糖原味',     spec: '160g', sales30d: 486.0, salesChange30d: 12.4,  salesVolume30d: 54 },
  { skuCode: '06210187', skuName: '果汁软糖混合装', spec: '135g', sales30d: 421.2, salesChange30d: 8.1,   salesVolume30d: 65 },
  { skuCode: '06210512', skuName: '黑巧克力65%',    spec: '100g', sales30d: 396.0, salesChange30d: 21.7,  salesVolume30d: 33 },
  { skuCode: '06210095', skuName: '海盐太妃糖',     spec: '90g',  sales30d: 312.0, salesChange30d: 4.2,   salesVolume30d: 39 },
  { skuCode: '06210278', skuName: '牛奶巧克力豆',   spec: '45g',  sales30d: 258.4, salesChange30d: -2.3,  salesVolume30d: 76 },
  { skuCode: '06210443', skuName: '薄荷无糖口香糖', spec: '32g',  sales30d: 244.8, salesChange30d: 6.0,   salesVolume30d: 102 },
  { skuCode: '06210366', skuName: '巧克力威化',     spec: '58g',  sales30d: 187.5, salesChange30d: -8.9,  salesVolume30d: 50 },
  { skuCode: '06210129', skuName: '棒棒糖混合口味', spec: '6支',  sales30d: 156.0, salesChange30d: 3.5,   salesVolume30d: 52 },
  { skuCode: '06210601', skuName: '黑糖话梅糖',     spec: '95g',  sales30d: 98.6,  salesChange30d: -15.2, salesVolume30d: 17 },
  { skuCode: '06210234', skuName: '榛仁巧克力排块', spec: '90g',  sales30d: 76.0,  salesChange30d: -22.8, salesVolume30d: 8 },
  { skuCode: '06210488', skuName: '酒心巧克力',     spec: '120g', sales30d: 45.0,  salesChange30d: -31.4, salesVolume30d: 3 },
  { skuCode: '06210157', skuName: '棉花糖',         spec: '60g',  sales30d: 32.4,  salesChange30d: -18.0, salesVolume30d: 9 },
  { skuCode: '06210372', skuName: '跳跳糖',         spec: '9g',   sales30d: 18.0,  salesChange30d: -42.5, salesVolume30d: 12 },
  { skuCode: '06210520', skuName: '水果硬糖混合装', spec: '150g', sales30d: 12.8,  salesChange30d: -55.1, salesVolume30d: 2 },
];

// 诊断结论（DiagnosisResult：客群 / 竞争 / 现状）
const DIAGNOSIS = {
  paragraph_customer: '门店位于鸿福路商圈写字楼底商，主力客群为 25–35 岁上班族，下午茶与加班时段是糖巧消费高峰。该客群偏好低糖、小包装与高品质黑巧，对传统大包装散糖需求弱。',
  paragraph_competition: '300 米内有 2 家连锁便利店与 1 家零食量贩店。量贩店以大包装低价散糖为主，价格难以正面竞争；但其黑巧、无糖品类覆盖少，是本店可以做出差异的空档。',
  paragraph_status: '货架上 14 个在售单品中有 4 个连续两个月动销垫底（跳跳糖、水果硬糖、棉花糖、酒心巧克力），合计仅贡献 2.1% 销售额，却占用约 18% 陈列面。黑巧与软糖类动销强劲但缺少延伸口味，存在补充空间。',
};

// 问题单品（照片红框标注）
const PROBLEM_SKUS = ['06210372', '06210520', '06210157', '06210488'];

// 调改方案（Strategy）：action 分 remove / observe / push
const STRATEGY = {
  name: '聚焦白领客群的提质方案',
  description: '压缩低动销散糖，补强黑巧与软糖延伸口味',
  skus: [
    { skuCode: '06210520', skuName: '水果硬糖混合装', spec: '150g', action: '淘汰下架', kind: 'remove',  tag: '低动销',  reason: '30 日仅售 2 件，环比 -55%，与量贩店同质且价格无优势' },
    { skuCode: '06210372', skuName: '跳跳糖',         spec: '9g',   action: '淘汰下架', kind: 'remove',  tag: '低动销',  reason: '客群以上班族为主，儿童糖果动销持续走低' },
    { skuCode: '06210157', skuName: '棉花糖',         spec: '60g',  action: '淘汰下架', kind: 'remove',  tag: '低动销',  reason: '连续两月动销垫底，占用一节陈列面' },
    { skuCode: '06210488', skuName: '酒心巧克力',     spec: '120g', action: '淘汰下架', kind: 'remove',  tag: '滞销',    reason: '30 日仅售 3 件，保质期临近，建议清仓处理' },
    { skuCode: '06210234', skuName: '榛仁巧克力排块', spec: '90g',  action: '保留观察', kind: 'observe', tag: '待观察',  reason: '环比下滑但毛利高，建议调整陈列位置后观察一个月' },
    { skuCode: '06210601', skuName: '黑糖话梅糖',     spec: '95g',  action: '保留观察', kind: 'observe', tag: '待观察',  reason: '中年客群仍有稳定复购，暂不调整' },
    { skuCode: '06210710', skuName: '黑巧克力85%',    spec: '100g', action: '上架推广', kind: 'push',    tag: '趋势款',  reason: '黑巧 65% 动销 +21.7%，向上延伸高浓度规格，白领客群接受度高' },
    { skuCode: '06210725', skuName: '生椰拿铁味软糖', spec: '108g', action: '上架推广', kind: 'push',    tag: '网红款',  reason: '软糖品类动销强，咖啡风味契合写字楼客群' },
    { skuCode: '06210733', skuName: '0糖薄荷软糖',    spec: '76g',  action: '上架推广', kind: 'push',    tag: '高毛利',  reason: '无糖品类周边竞对未覆盖，差异化空档' },
    { skuCode: '06210741', skuName: '每日黑巧小包装', spec: '42g',  action: '上架推广', kind: 'push',    tag: '趋势款',  reason: '小包装单价低、试错成本低，适合下午茶即买即食' },
    { skuCode: '06210758', skuName: '芒果味果汁软糖', spec: '135g', action: '上架推广', kind: 'push',    tag: '延伸款',  reason: '果汁软糖为货架销量第二，补充热门口味' },
  ],
};

// 预置的历史调改记录（调改效果追踪用）
const SEED_RECORDS = [
  {
    id: 2,
    at: '2026-05-28T15:42:00',
    summary: '上架了3个品，停止进货了2个品',
    salesDelta: 12.4,
    items: [
      { skuName: '果汁软糖混合装', spec: '135g', action: '上架推广', kind: 'push' },
      { skuName: '海盐太妃糖',     spec: '90g',  action: '上架推广', kind: 'push' },
      { skuName: '薄荷无糖口香糖', spec: '32g',  action: '上架推广', kind: 'push' },
      { skuName: '麦芽糖夹心',     spec: '110g', action: '淘汰下架', kind: 'remove' },
      { skuName: '彩虹糖迷你装',   spec: '30g',  action: '淘汰下架', kind: 'remove' },
    ],
  },
  {
    id: 1,
    at: '2026-04-12T10:18:00',
    summary: '上架了2个品，停止进货了3个品',
    salesDelta: 6.8,
    items: [
      { skuName: '黑巧克力65%',   spec: '100g', action: '上架推广', kind: 'push' },
      { skuName: '牛轧糖原味',     spec: '160g', action: '上架推广', kind: 'push' },
      { skuName: '芝麻花生酥',     spec: '200g', action: '淘汰下架', kind: 'remove' },
      { skuName: '老式水果糖',     spec: '250g', action: '淘汰下架', kind: 'remove' },
      { skuName: '巧克力金币',     spec: '80g',  action: '淘汰下架', kind: 'remove' },
    ],
  },
];

// 虚拟货架示意（分层、分段，颜色对应品类色板 categoryColors）
const VIRTUAL_SHELF = {
  groupLabel: '标准货架 75cm × 5层',
  layers: [
    { label: '1层（黄金视线）', segments: [ { name: '黑巧克力系列', color: '#7B4B2A', w: 38 }, { name: '每日黑巧', color: '#9C6644', w: 30 }, { name: '0糖薄荷软糖', color: '#2E9E6B', w: 32 } ] },
    { label: '2层', segments: [ { name: '果汁软糖', color: '#E8744F', w: 34 }, { name: '生椰拿铁软糖', color: '#D9A05B', w: 33 }, { name: '芒果味软糖', color: '#F2B33D', w: 33 } ] },
    { label: '3层', segments: [ { name: '牛轧糖', color: '#C9899A', w: 36 }, { name: '海盐太妃糖', color: '#B07BAC', w: 32 }, { name: '黑糖话梅糖', color: '#8E7CC3', w: 32 } ] },
    { label: '4层', segments: [ { name: '巧克力豆/威化', color: '#5B8DB8', w: 52 }, { name: '榛仁排块', color: '#74A8D0', w: 48 } ] },
    { label: '5层', segments: [ { name: '口香糖/含片', color: '#6BA8A9', w: 50 }, { name: '棒棒糖', color: '#E29A68', w: 50 } ] },
  ],
};

// 诊断阶段的逐项进度（顺序揭示）
const DIAG_STAGES = [
  { key: 'detect', label: '识别货架上的商品', dur: 2600 },
  { key: 'sales',  label: '分析 30 日销售数据', dur: 2200 },
  { key: 'diag',   label: '结合你的回答与周边竞争生成诊断', dur: 3000 },
  { key: 'plan',   label: '生成选品调改方案', dur: 2600 },
];

// 问答环节：4–5 轮，聊天形式；选项点选进发送框，支持手输与语音
const QA_ROUNDS = [
  {
    q: '开始前先聊两句，帮我把诊断做准。这个货架最近卖得怎么样？',
    options: ['卖得不错', '一般般', '比较差', '说不上来'],
    multi: false,
    voice: '周末卖得还行，工作日下午比较一般',
  },
  {
    q: '平时来买这类商品的，多是哪些客人？可以多选。',
    options: ['上班族', '学生', '老人和小孩', '附近居民', '说不上来'],
    multi: true,
    voice: '中午和下班点上班族多，周末有带小孩的',
  },
  {
    q: '店附近有没有这些竞争对手？可以多选。',
    options: ['零食量贩店', '其他便利店', '大超市', '基本没有'],
    multi: true,
    voice: '马路对面有家零食量贩店，生意挺好',
  },
  {
    q: '这次调改，你最想做到什么？可以多选。',
    options: ['整体卖得更多', '清掉滞销品', '上一些新品', '提高毛利'],
    multi: true,
    voice: '想把不好卖的清一清，再上点新品',
  },
  {
    q: '最后：有没有不想动的商品，或者想补充的情况？',
    options: ['都可以动，听建议的'],
    multi: false,
    voice: '靠近收银台那排口香糖不要动，卖得挺稳',
  },
];

const fmtMoney = (n) => `¥${Number(n).toFixed(n >= 100 ? 0 : 1)}`;
const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

Object.assign(window, {
  STORE, SCENES, SHELF_TYPES, WIDTH_PRESETS, SKUS, DIAGNOSIS, PROBLEM_SKUS,
  STRATEGY, SEED_RECORDS, VIRTUAL_SHELF, DIAG_STAGES, QA_ROUNDS, fmtMoney, fmtDate,
});
