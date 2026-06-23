/**
 * Corelays · Gemini 原生 generateContent 服务(海报生图)
 *
 * 设计:
 *   - 走 Gemini 原生协议:`${COCO_BASE_URL}/models/${model}:generateContent`
 *     这个 Corelays 订阅的 token 不放行 OpenAI Images API(/images/* 一律 404),
 *     只能走原生 Gemini contents/generateContent
 *   - 模型从 sys_settings.poster_image_model 读取(默认 gemini-3.1-flash-image)
 *   - 参考图统一作为 inlineData parts 塞进同一个 user content:
 *     · 无参考图 → 单 part `{text: prompt}`
 *     · 有参考图 → `{text: prompt}` + 多个 `{inlineData: {mimeType, data}}`
 *     软失败:能拉到几张用几张,全军覆没则只发 prompt
 *   - 响应:candidates[0].content.parts[] 找 inlineData 取 base64,
 *     按 mimeType 包成 data URL 交给 posters.service.ts 转存 OSS
 *   - 失败 → 502 UPSTREAM_ERROR;未配置 key → 502 友好提示
 */
import { config } from '../config/env.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { query } from '../db/index.js';

export interface PosterGenerateInput {
  template: 'vibrant' | 'premium' | 'minimal' | 'custom';
  mode: 'photo_compose' | 'official_bg_only' | 'multi_product';
  copyText: string;
  sourcePhotoUrl?: string;
  productImageUrl?: string;
  productImageUrls?: string[];
  customStyleDescription?: string;
  skuCode?: string;
  categoryName?: string;
}

export interface PosterGenerateOutput {
  posterUrl: string;
  thumbnailUrl?: string;
  modelUsed: string;
  promptUsed: string;
  generationMs: number;
}

const TEMPLATE_STYLE: Record<PosterGenerateInput['template'], string> = {
  vibrant: '活力风格,明亮红黄配色,大字号文案,醒目促销标签',
  premium: '高端简约风,深色背景配金属/亮色点缀,留白多',
  minimal: '极简风,白底加单色文案,强调商品本身',
  custom: '自定义风格',
};

const MODE_DESC: Record<PosterGenerateInput['mode'], string> = {
  photo_compose: '拍照合成:将原图作为背景,叠加促销文案与价格标签',
  official_bg_only: '官方图模式:使用商品官方包装图,配设计感背景',
  multi_product: '多商品混排:把多个 SKU 排列成系列海报',
};

export function buildPosterPrompt(input: PosterGenerateInput): string {
  const parts: string[] = [
    '生成一张美宜佳便利店促销海报。',
    `模板风格:${TEMPLATE_STYLE[input.template]}。`,
    `生成模式:${MODE_DESC[input.mode]}。`,
    `海报文案要醒目展示:"${input.copyText}"。`,
  ];
  if (input.categoryName) parts.push(`品类:${input.categoryName}。`);
  if (input.skuCode) parts.push(`SKU:${input.skuCode}。`);
  if (input.customStyleDescription) {
    parts.push(`额外风格要求:${input.customStyleDescription}。`);
  }
  if (input.mode === 'photo_compose') {
    parts.push('已附门店实拍参考图,请将其作为背景或主体并叠加文案。');
  } else if (input.mode === 'official_bg_only') {
    parts.push('已附商品官方图,请保留商品本体并设计背景与文案。');
  } else if (input.mode === 'multi_product') {
    parts.push('已附多张商品图,请将其混排成系列海报。');
  }
  parts.push('输出竖版海报,中文文案,不要水印。');
  return parts.join('\n');
}

// 与 admin-stats.service 同源(同 key + 同默认);切模型从 PUT /admin/settings/image-model 走。
const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';

async function getCurrentImageModel(): Promise<string> {
  const res = await query<{ value: string }>(
    `SELECT value FROM sys_settings WHERE key = 'poster_image_model' LIMIT 1`,
  );
  return res.rows[0]?.value ?? DEFAULT_IMAGE_MODEL;
}

/**
 * 收集所有要喂给 Gemini 的参考图。
 *
 * 旧版只按 mode 二选一:multi_product 只挑 productImageUrls,official_bg_only
 * 只挑 productImageUrl —— 把用户上传的 sourcePhotoUrl(门店背景照)直接丢了,
 * 海报背景全靠 prompt 文字瞎编。
 *
 * 现在三种模式都把可用的图全收上来。顺序约定:**sourcePhotoUrl(底图)放前面**,
 * 后面是商品图;Gemini 多模态输入按出现顺序参考,底图先到模型脑子里更可能被当
 * 背景看待。mode 仍然影响 prompt 文字(由 buildPosterPrompt 处理)。
 */
function collectReferenceImageUrls(input: PosterGenerateInput): string[] {
  const urls: string[] = [];
  if (input.sourcePhotoUrl) urls.push(input.sourcePhotoUrl);
  if (input.productImageUrl) urls.push(input.productImageUrl);
  if (input.productImageUrls?.length) {
    urls.push(...input.productImageUrls.filter(Boolean));
  }
  return urls;
}

interface InlinePart {
  mimeType: string;
  /** raw base64,不带 data: 前缀 */
  data: string;
}

/**
 * 拉一张参考图 → base64 inlineData;失败(404 / 超时 / 网络抖动)返回 null。
 * 调用方按"能拉到几张用几张"处理 —— 不让单张图缺失废掉整个海报任务。
 */
async function tryFetchImageAsInline(url: string): Promise<InlinePart | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      logger.warn(
        { status: res.status, url: url.slice(0, 200) },
        'coco-image ref image non-2xx, skipping',
      );
      return null;
    }
    const arrayBuf = await res.arrayBuffer();
    const mimeType = res.headers.get('content-type') ?? 'image/png';
    const data = Buffer.from(arrayBuf).toString('base64');
    return { mimeType, data };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, url: url.slice(0, 200) },
      'coco-image ref image fetch failed, skipping',
    );
    return null;
  }
}

interface GeminiResponsePart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  /** 兼容 snake_case(部分网关回 inline_data)*/
  inline_data?: { mime_type?: string; data?: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiResponsePart[];
    };
  }>;
  promptFeedback?: { blockReason?: string };
}

export class CocoImageService {
  async generatePoster(input: PosterGenerateInput): Promise<PosterGenerateOutput> {
    if (!config.COCO_API_KEY) {
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        '未配置 COCO_API_KEY,海报生成不可用',
      );
    }

    const model = await getCurrentImageModel();
    const prompt = buildPosterPrompt(input);
    const refUrls = collectReferenceImageUrls(input);

    // 软失败:并发拉所有参考图,能拿到几张用几张;一张都拿不到就只发 prompt
    const inlineParts = refUrls.length
      ? (await Promise.all(refUrls.map((u) => tryFetchImageAsInline(u)))).filter(
          (p): p is InlinePart => p !== null,
        )
      : [];
    if (refUrls.length > 0 && inlineParts.length === 0) {
      logger.warn(
        { model, requested: refUrls.length },
        'coco-image all ref images failed, falling back to prompt-only',
      );
    } else if (inlineParts.length < refUrls.length) {
      logger.warn(
        { model, got: inlineParts.length, requested: refUrls.length },
        'coco-image some ref images skipped',
      );
    }

    const start = Date.now();
    let res: Response;
    try {
      res = await this.callGenerateContent(model, prompt, inlineParts);
    } catch (err) {
      logger.error({ err }, 'coco-image fetch failed');
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `Corelays 调用失败:${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let detail = body.slice(0, 1000);
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string; code?: string | number } };
        if (parsed.error?.message) {
          detail = String(parsed.error.message).slice(0, 600);
        }
      } catch {
        // 不是 JSON,保留原文截断
      }
      logger.warn(
        { status: res.status, body: body.slice(0, 2000), model, refCount: inlineParts.length },
        'coco-image non-2xx',
      );
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `Corelays 返回 ${res.status}: ${detail}`,
      );
    }

    const data = (await res.json()) as GeminiResponse;

    if (data.promptFeedback?.blockReason) {
      logger.warn(
        { reason: data.promptFeedback.blockReason, model },
        'coco-image blocked by safety',
      );
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `Corelays 内容审核拦截:${data.promptFeedback.blockReason}`,
      );
    }

    const posterUrl = extractImageDataUrl(data);
    if (!posterUrl) {
      logger.warn({ data: JSON.stringify(data).slice(0, 800) }, 'coco-image no image');
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        'Corelays 响应中未找到海报图片',
      );
    }

    return {
      posterUrl,
      modelUsed: model,
      promptUsed: prompt,
      generationMs: Date.now() - start,
    };
  }

  private async callGenerateContent(
    model: string,
    prompt: string,
    inlineParts: InlinePart[],
  ): Promise<Response> {
    const url = `${config.COCO_BASE_URL}/models/${encodeURIComponent(
      model,
    )}:generateContent`;
    const parts: Array<{ text: string } | { inlineData: InlinePart }> = [
      { text: prompt },
    ];
    for (const p of inlineParts) parts.push({ inlineData: p });

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.COCO_API_KEY}`,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
      }),
      signal: AbortSignal.timeout(180_000),
    });
  }
}

function extractImageDataUrl(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const inline = p.inlineData ?? p.inline_data;
    if (!inline) continue;
    const mimeType =
      (p.inlineData?.mimeType ?? p.inline_data?.mime_type ?? 'image/png') as string;
    const b64 = inline.data;
    if (b64) return `data:${mimeType};base64,${b64}`;
  }
  return '';
}

export const cocoImageService = new CocoImageService();
