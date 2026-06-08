/**
 * 商品检测服务（Python YOLO + PE + OCR）调用客户端
 *
 * env: DETECT_SERVICE_URL (默认 http://localhost:8000)
 * 接口约定：
 *   POST {DETECT_SERVICE_URL}/detect (multipart/form-data with image)
 *   返回 { boxes: [{ x, y, w, h, sku_code, confidence }], elapsed_ms }
 *
 * 若服务不可达 → 502 UPSTREAM_ERROR
 */
import { config } from '../config/env.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export interface DetectBox {
  x: number;
  y: number;
  w: number;
  h: number;
  skuCode: string;
  confidence: number;
}

export interface DetectResult {
  boxes: DetectBox[];
  elapsedMs: number;
}

export class DetectService {
  async detect(image: Buffer, filename: string): Promise<DetectResult> {
    const form = new FormData();
    form.append(
      'image',
      new Blob([image], { type: 'application/octet-stream' }),
      filename,
    );

    let res: Response;
    try {
      res = await fetch(`${config.DETECT_SERVICE_URL.replace(/\/$/, '')}/detect`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      logger.error({ err }, 'detect-service fetch failed');
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `检测服务不可达：${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `检测服务返回 ${res.status}`,
      );
    }

    const data = (await res.json()) as {
      boxes?: Array<{
        x: number;
        y: number;
        w: number;
        h: number;
        sku_code?: string;
        confidence?: number;
      }>;
      elapsed_ms?: number;
    };
    return {
      elapsedMs: data.elapsed_ms ?? 0,
      boxes: (data.boxes ?? []).map((b) => ({
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        skuCode: b.sku_code ?? '',
        confidence: b.confidence ?? 0,
      })),
    };
  }
}

export const detectService = new DetectService();
