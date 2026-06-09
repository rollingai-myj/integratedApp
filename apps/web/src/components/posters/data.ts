export type Promo = {
  id: string;
  cat: string;
  hot: boolean;
  name: string;
  spec: string;
  couponPrice: number;
  origPrice: number;
  tag: string;
};

export const CATEGORIES = [
  { id: 'all',   name: '全部',   count: 24 },
  { id: 'drink', name: '饮料',   count: 8 },
  { id: 'snack', name: '零食',   count: 6 },
  { id: 'dairy', name: '乳品',   count: 4 },
  { id: 'inst',  name: '速食',   count: 3 },
  { id: 'daily', name: '日用',   count: 3 },
];

export const PROMOS: Promo[] = [
  { id: 'p1',  cat: 'dairy', hot: true,  name: '原味酸奶',   spec: '200ml×1瓶',  couponPrice: 5.9,  origPrice: 8.1,  tag: '券后5.9' },
  { id: 'p2',  cat: 'drink', hot: true,  name: '冰红茶',     spec: '500ml×1瓶',  couponPrice: 2.8,  origPrice: 4.5,  tag: '券后2.8' },
  { id: 'p3',  cat: 'snack', hot: false, name: '香脆薯片',   spec: '70g×1袋',    couponPrice: 4.5,  origPrice: 6.8,  tag: '券后4.5' },
  { id: 'p4',  cat: 'inst',  hot: false, name: '红烧牛肉面', spec: '120g×1桶',   couponPrice: 3.9,  origPrice: 5.5,  tag: '券后3.9' },
  { id: 'p5',  cat: 'drink', hot: true,  name: '纯净水',     spec: '550ml×1瓶',  couponPrice: 1.2,  origPrice: 2.0,  tag: '券后1.2' },
  { id: 'p6',  cat: 'snack', hot: false, name: '夹心饼干',   spec: '108g×1包',   couponPrice: 5.5,  origPrice: 7.9,  tag: '券后5.5' },
  { id: 'p7',  cat: 'dairy', hot: false, name: '高钙牛奶',   spec: '250ml×1盒',  couponPrice: 3.5,  origPrice: 4.9,  tag: '券后3.5' },
  { id: 'p8',  cat: 'drink', hot: false, name: '功能饮料',   spec: '250ml×1罐',  couponPrice: 5.0,  origPrice: 7.0,  tag: '券后5.0' },
  { id: 'p9',  cat: 'snack', hot: true,  name: '辣条经典味', spec: '108g×1包',   couponPrice: 3.2,  origPrice: 4.5,  tag: '券后3.2' },
  { id: 'p10', cat: 'inst',  hot: false, name: '自热米饭',   spec: '245g×1盒',   couponPrice: 12.9, origPrice: 16.9, tag: '券后12.9' },
  { id: 'p11', cat: 'daily', hot: false, name: '抽纸巾',     spec: '100抽×3包',  couponPrice: 6.8,  origPrice: 9.9,  tag: '券后6.8' },
  { id: 'p12', cat: 'drink', hot: false, name: '可乐汽水',   spec: '330ml×1罐',  couponPrice: 2.5,  origPrice: 3.5,  tag: '券后2.5' },
];
