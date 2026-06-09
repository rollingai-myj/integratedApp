// 货架配置 & 品类分配 类型定义 + 颜色表

export type ShelfWidth = "60cm" | "75cm" | "90cm";

export interface ShelfUnit {
  id: string;
  type: "标准货架" | "冷柜" | "端架" | "收银台旁";
  width: ShelfWidth;
}

export interface CategoryAllocation {
  category: string;
  color: string;
  beforeGroups: number;
  afterGroups: number;
  change: number;
  aiReason: string;
}

export interface ShelfSegment {
  category: string;
  groups: number;
}

export interface ShelfCategoryMapping {
  shelfId: string;
  position: string;
  beforeSegments: ShelfSegment[];
  afterSegments: ShelfSegment[];
  isChanged: boolean;
  changeDescription: string;
  aiReason?: string;
}

export interface ShelfPhotoData {
  shelfId: string;
  photoUrl: string | null;
  uploadTime: string | null;
  analysisStatus: "待上传" | "分析中" | "已完成";
  recognizedProducts: {
    code: string;
    name: string;
    spec: string;
    confidence: number;
  }[];
  aiDiagnosis?: string;
}

// 品类颜色表
export const categoryColors: Record<string, string> = {
  "糖果&巧克力": "#E040FB",
  方便食品: "#2196F3",
  烘焙糕点: "#FFAB91",
  "熟食&饮品": "#FF7043",
  雪糕: "#81D4FA",
  膨化食品: "#E91E63",
  酒类: "#FF9800",
  调味副食: "#795548",
  冲调品: "#9E9E9E",
  计生情趣: "#CE93D8",
  冷藏品: "#4DD0E1",
  "生鲜&水果": "#66BB6A",
  母婴产品: "#F48FB1",
  碳酸饮料: "#EF5350",
  水: "#29B6F6",
  茶饮品: "#A5D6A7",
  果汁: "#FFA726",
  功能饮料: "#AB47BC",
  其它饮品: "#78909C",
  常温乳制品: "#00BCD4",
  "啤酒／预调酒": "#FFB300",
  保鲜鲜食: "#26A69A",
  冷冻食品: "#5C6BC0",
  坚果炒货: "#FFC107",
  果干蜜饯: "#CDDC39",
  槟榔: "#8D6E63",
  休闲素食: "#8BC34A",
  休闲肉脯: "#F44336",
  定量小包装: "#9C27B0",
  玩具: "#FFD54F",
  饼干: "#FF5722",
  粮油: "#4CAF50",
  宠物产品: "#BCAAA4",
  口腔护理: "#80CBC4",
  个人护理: "#FF80AB",
  家庭护理: "#0097A7",
  卫生用品: "#3F51B5",
  针织品及鞋类: "#4A148C",
  家庭杂品: "#A5D6A7",
  餐厨用品: "#607D8B",
  文具用品: "#7E57C2",
  生活用纸: "#D7CCC8",
  数码电器: "#1A237E",
  "药品&医护": "#E53935",
};

// Helper: 获取品类颜色
export const getCategoryColor = (category: string): string => {
  return categoryColors[category] || "#CBD5E0";
};
