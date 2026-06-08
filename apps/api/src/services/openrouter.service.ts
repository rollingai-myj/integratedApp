/**
 * OpenRouter 服务（海报文生图）
 *
 * 设计：
 *   - 用 OPENROUTER_API_KEY 调 https://openrouter.ai/api/v1/chat/completions
 *   - 模型从 app_settings.image_model 读取（默认 google/gemini-3.1-flash-image-preview）
 *   - prompt 由 buildPosterPrompt 按 mode + 模板拼装
 *   - 失败 → 502 UPSTREAM_ERROR
 *   - 未配置 key → 502 友好提示
 *
 * 真实接入时 Gemini image 模型返回图像 URL 或 base64；本实现按 OpenRouter 的
 * gemini-flash-image-preview 约定解析 message.content 里的 image_url。
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
  officialImageUrls?: string[];
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
  vibrant: '活力风格，明亮红黄配色，大字号文案，醒目促销标签',
  premium: '高端简约风，深色背景配金属/亮色点缀，留白多',
  minimal: '极简风，白底加单色文案，强调商品本身',
  custom: '自定义风格',
};

const MODE_DESC: Record<PosterGenerateInput['mode'], string> = {
  photo_compose: '拍照合成：将原图作为背景，叠加促销文案与价格标签',
  official_bg_only: '官方图模式：使用商品官方包装图，配设计感背景',
  multi_product: '多商品混排：把多个 SKU 排列成系列海报',
};

export function buildPosterPrompt(input: PosterGenerateInput): string {
  const parts: string[] = [
    '生成一张美宜佳便利店促销海报。',
    `模板风格：${TEMPLATE_STYLE[input.template]}。`,
    `生成模式：${MODE_DESC[input.mode]}。`,
    `海报文案要醒目展示："${input.copyText}"。`,
  ];
  if (input.categoryName) parts.push(`品类：${input.categoryName}。`);
  if (input.skuCode) parts.push(`SKU：${input.skuCode}。`);
  if (input.customStyleDescription) {
    parts.push(`额外风格要求：${input.customStyleDescription}。`);
  }
  if (input.mode === 'multi_product' && input.officialImageUrls?.length) {
    parts.push(`混排商品参考图：${input.officialImageUrls.join('、')}`);
  } else if (input.mode === 'official_bg_only' && input.productImageUrl) {
    parts.push(`商品官方图：${input.productImageUrl}`);
  } else if (input.mode === 'photo_compose' && input.sourcePhotoUrl) {
    parts.push(`门店实拍参考图：${input.sourcePhotoUrl}`);
  }
  parts.push('输出竖版 3:4 海报，中文文案，不要水印。');
  return parts.join('\n');
}

async function getCurrentImageModel(): Promise<string> {
  const res = await query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'image_model' LIMIT 1`,
  );
  return res.rows[0]?.value ?? 'google/gemini-3.1-flash-image-preview';
}

export class OpenRouterService {
  async generatePoster(input: PosterGenerateInput): Promise<PosterGenerateOutput> {
    if (!config.OPENROUTER_API_KEY) {
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        '未配置 OPENROUTER_API_KEY，海报生成不可用',
      );
    }

    const model = await getCurrentImageModel();
    const prompt = buildPosterPrompt(input);

    const start = Date.now();
    let res: Response;
    try {
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://myj.app',
          'X-Title': 'MYJ Store Assistant',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (err) {
      logger.error({ err }, 'openrouter fetch failed');
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `OpenRouter 调用失败：${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn({ status: res.status, body: body.slice(0, 500) }, 'openrouter non-2xx');
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `OpenRouter 返回 ${res.status}`,
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type: string; image_url?: { url: string } }>;
        };
      }>;
    };

    // 解析图像 URL：兼容字符串 content（含 URL）或 array content（标准 vision schema）
    let posterUrl = '';
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      const m = content.match(/https?:\/\/\S+\.(?:png|jpg|jpeg|webp)/i);
      if (m) posterUrl = m[0];
    } else if (Array.isArray(content)) {
      for (const item of content) {
        if (item.type === 'image_url' && item.image_url?.url) {
          posterUrl = item.image_url.url;
          break;
        }
      }
    }

    if (!posterUrl) {
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        'OpenRouter 响应中未找到海报图片 URL',
      );
    }

    return {
      posterUrl,
      modelUsed: model,
      promptUsed: prompt,
      generationMs: Date.now() - start,
    };
  }
}

export const openRouterService = new OpenRouterService();
