/**
 * Virtual shelf layout engine.
 * Takes SKU data and shelf config, generates a visual layout.
 */
import { type SkuRow } from "@/components/shelves/data/skuData";
import { type Strategy } from "@/components/shelves/contexts/AppContext";
import { type VirtualShelfBlock, type VirtualShelfGroup, VIRTUAL_SHELF_COLORS } from "@/components/shelves/types/virtualShelf";

interface LayoutInput {
  skus: SkuRow[];
  strategies: Strategy[];
  shelfWidthCm: number;
  layerCount: number;
}

/** Build a color map for subcategories */
function buildColorMap(subcategories: string[]): Record<string, string> {
  const unique = [...new Set(subcategories)];
  const map: Record<string, string> = {};
  unique.forEach((sc, i) => {
    map[sc] = VIRTUAL_SHELF_COLORS[i % VIRTUAL_SHELF_COLORS.length];
  });
  return map;
}

/** Estimate SKU width in cm from spec string or default */
function estimateSkuWidthCm(sku: SkuRow): number {
  // Try to parse width from spec (e.g., "100g", "500ml")
  // Default to ~5cm per facing for most convenience store products
  return 5;
}

/**
 * Generate virtual shelf layout from SKU data.
 * Groups by subcategory, sorts by sales, fills layers left-to-right.
 */
export function generateVirtualShelfLayout(input: LayoutInput): VirtualShelfGroup[] {
  const { skus, strategies, shelfWidthCm, layerCount } = input;

  if (skus.length === 0 || layerCount === 0) return [];

  // Determine which SKUs to show (apply strategies: remove delisted, keep rest)
  const delistedCodes = new Set<string>();
  const newListedCodes = new Set<string>();
  strategies.forEach(st => {
    if (st.applied) {
      st.skus.forEach(s => {
        if (s.action.includes("下架")) delistedCodes.add(s.skuCode);
        else if (s.action.includes("上架")) newListedCodes.add(s.skuCode);
      });
    }
  });

  const activeSkus = skus.filter(s => !delistedCodes.has(s.skuCode));

  // Sort: group by subcategory, within each sort by sales desc
  const bySubcat = new Map<string, SkuRow[]>();
  activeSkus.forEach(s => {
    const key = s.subCategory || "未分类";
    if (!bySubcat.has(key)) bySubcat.set(key, []);
    bySubcat.get(key)!.push(s);
  });

  // Sort subcategories by total sales
  const subcatOrder = [...bySubcat.entries()]
    .sort((a, b) => {
      const salesA = a[1].reduce((sum, s) => sum + parseFloat(s.sales30d || "0"), 0);
      const salesB = b[1].reduce((sum, s) => sum + parseFloat(s.sales30d || "0"), 0);
      return salesB - salesA;
    });

  // Sort SKUs within each subcat by sales desc
  subcatOrder.forEach(([, skuList]) => {
    skuList.sort((a, b) => parseFloat(b.sales30d || "0") - parseFloat(a.sales30d || "0"));
  });

  const colorMap = buildColorMap(subcatOrder.map(([sc]) => sc));
  const skuWidthCm = estimateSkuWidthCm(activeSkus[0]);

  // Flatten all SKUs in order
  const orderedSkus: { sku: SkuRow; subcat: string }[] = [];
  subcatOrder.forEach(([subcat, skuList]) => {
    skuList.forEach(sku => orderedSkus.push({ sku, subcat }));
  });

  // Calculate how many SKUs fit per layer
  const skusPerLayer = Math.max(1, Math.floor(shelfWidthCm / skuWidthCm));
  const totalLayersNeeded = Math.ceil(orderedSkus.length / skusPerLayer);
  const actualLayers = Math.max(layerCount, Math.min(totalLayersNeeded, 8));

  // Fill layers from top (highest index) to bottom
  const layers: VirtualShelfBlock[][] = Array.from({ length: actualLayers }, () => []);
  let skuIdx = 0;

  for (let li = actualLayers - 1; li >= 0 && skuIdx < orderedSkus.length; li--) {
    let usedWidth = 0;
    while (skuIdx < orderedSkus.length && usedWidth + skuWidthCm <= shelfWidthCm + 0.5) {
      const { sku, subcat } = orderedSkus[skuIdx];
      const startRatio = usedWidth / shelfWidthCm;
      const endRatio = Math.min(1, (usedWidth + skuWidthCm) / shelfWidthCm);

      layers[li].push({
        id: `vs-g0-l${li}-b${layers[li].length}`,
        subcategory: subcat,
        skuName: sku.skuName,
        skuCode: sku.skuCode,
        facing: 1,
        widthCm: skuWidthCm,
        heightCm: 15,
        startRatio,
        endRatio,
        color: colorMap[subcat] || 'hsl(0, 0%, 60%)',
        layerIndex: li,
        groupIndex: 0,
        sales30d: sku.sales30d,
        salesVolume30d: sku.salesVolume30d,
        isNewListing: newListedCodes.has(sku.skuCode),
      });

      usedWidth += skuWidthCm;
      skuIdx++;
    }
  }

  return [{
    groupIndex: 0,
    layers: layers.map((blocks, li) => ({ layerIndex: li, blocks })),
    shelfWidthCm,
  }];
}

/**
 * Get the SKU image URL from the external storage.
 */
const STORAGE_BASE = "https://rollingai-meiyijia.oss-cn-shanghai.aliyuncs.com";

export function getSkuImageUrl(skuCode: string | undefined): string | null {
  if (!skuCode) return null;
  const padded = /^\d+$/.test(skuCode) && skuCode.length < 8
    ? skuCode.padStart(8, "0")
    : skuCode;
  return `${STORAGE_BASE}/product_pic/${padded}.png`;
}
