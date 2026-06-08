/**
 * OpenRouter 服务（海报文生图等）
 *
 * 涉及接口：
 * - POST /api/v1/posters/generate  (PO-C1)
 * - POST /api/v1/posters/queue/process  (PO-D2)
 *
 * M0：占位。M4 接入。
 */
import { NotImplementedError } from '../lib/errors.js';

export interface PosterGenerateInput {
  photoUrl: string;
  copywriting: string;
  templateId: string;
  mode?: 'photo-compose' | 'official-only' | 'multi-mix';
  customStyle?: string;
  officialImageUrls?: string[];
  sku?: string;
  category?: string;
}

export interface PosterGenerateOutput {
  posterUrl: string;
  modelUsed: string;
  promptUsed: string;
}

export class OpenRouterService {
  async generatePoster(
    _input: PosterGenerateInput,
  ): Promise<PosterGenerateOutput> {
    throw new NotImplementedError(
      '[openrouter.generatePoster] will be implemented in M4',
    );
  }
}

export const openRouterService = new OpenRouterService();
