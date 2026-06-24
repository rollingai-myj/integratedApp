// Client-side wrapper around the poster generation server function.
import { generatePoster as generatePosterFn, type PosterStyleId, type PosterResult } from "@/lib/poster.functions";

export type { PosterStyleId, PosterResult };

export type GeneratePosterInput = {
  photo: string;            // data URL (base64) of user's photo
  copy: string;             // promotional copy
  styleId: PosterStyleId;
  customStyle?: string;
  storeId?: string | null;
  sku?: string | null;
  category?: string | null;
  mode?: 'normal' | 'bg_only';
  productImageUrl?: string | null;
  /** 活动类型 raw 枚举,后端用来挑右下角二维码 */
  baseActivityType?: string | null;
  addonActivityType?: string | null;
};

export async function generatePoster(input: GeneratePosterInput): Promise<PosterResult> {
  return await generatePosterFn({ data: input });
}
