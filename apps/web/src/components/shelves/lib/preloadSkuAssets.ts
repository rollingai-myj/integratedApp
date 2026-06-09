/**
 * Preload SKU product image and barcode image into the browser HTTP cache,
 * so dialogs/lightboxes open instantly without a loading flash.
 */
import { getSkuImageUrl } from "@/components/shelves/lib/virtualShelfLayout";

const preloaded = new Set<string>();

const preloadUrl = (url: string) => {
  if (preloaded.has(url)) return;
  preloaded.add(url);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
};

export const getSkuBarcodeUrl = (skuCode: string | undefined): string | null => {
  if (!skuCode) return null;
  const padded = /^\d+$/.test(skuCode) && skuCode.length < 8
    ? skuCode.padStart(8, "0")
    : skuCode;
  return `https://rollingai-meiyijia.oss-cn-shanghai.aliyuncs.com/SKU_bar_code/${padded}.png`;
};

export const preloadSkuAssets = (skuCode: string | undefined) => {
  if (!skuCode) return;
  const product = getSkuImageUrl(skuCode);
  const barcode = getSkuBarcodeUrl(skuCode);
  if (product) preloadUrl(product);
  if (barcode) preloadUrl(barcode);
};

export const preloadSkuAssetsBatch = (skuCodes: Array<string | undefined>) => {
  for (const code of skuCodes) preloadSkuAssets(code);
};
