/** Types for the virtual shelf rendering system */

export interface VirtualShelfBlock {
  id: string;
  subcategory: string;
  skuName: string;
  skuCode: string;
  facing: number;
  upfacing?: number;  // vertical stacking count
  widthCm: number;
  heightCm: number;
  startRatio: number; // 0-1 position within layer
  endRatio: number;   // 0-1 position within layer
  color: string;
  layerIndex: number; // 0 = bottom
  groupIndex: number;
  sales30d?: string;
  salesVolume30d?: string;
  reason?: string;
  /** True if this SKU was added via an applied "上架" strategy in the current run */
  isNewListing?: boolean;
  /** Promo activity description (e.g., "第2袋半价") */
  promo?: string;
  /** Promo group ID — used to group blocks sharing the same activity and render a tag */
  promoset?: string;
}

export interface VirtualShelfLayer {
  layerIndex: number;
  blocks: VirtualShelfBlock[];
  reason?: string;
}

export interface VirtualShelfGroup {
  groupIndex: number;
  layers: VirtualShelfLayer[];
  shelfWidthCm: number;
}

// Category color palette
export const VIRTUAL_SHELF_COLORS = [
  'hsl(355, 65%, 50%)',
  'hsl(210, 65%, 50%)',
  'hsl(145, 55%, 42%)',
  'hsl(35, 85%, 55%)',
  'hsl(270, 50%, 55%)',
  'hsl(185, 60%, 42%)',
  'hsl(330, 55%, 50%)',
  'hsl(55, 70%, 48%)',
  'hsl(15, 65%, 50%)',
  'hsl(240, 45%, 55%)',
  'hsl(160, 50%, 45%)',
  'hsl(0, 50%, 60%)',
  'hsl(200, 55%, 48%)',
  'hsl(290, 40%, 50%)',
  'hsl(80, 50%, 45%)',
];
