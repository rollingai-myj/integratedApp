/**
 * OpenRouter 服务（海报文生图）
 *
 * 设计：
 *   - 用 OPENROUTER_API_KEY 调 https://openrouter.ai/api/v1/chat/completions
 *   - 模型从 sys_settings.poster_image_model 读取（默认 google/gemini-2.5-flash-image，
 *     即 nano-banana 文生图 / 图编辑模型）
 *   - prompt 由 buildPosterPrompt 按 mode + 模板拼装
 *   - photo_compose / official_bg_only / multi_product 三种 mode 通过 messages
 *     的 content array 把参考图当 image_url 传给 Gemini（vision input），不是
 *     字符串拼到 prompt 里 —— 后者根本不会被模型看到
 *   - 输出按 OpenRouter 的 nano-banana 约定从 message.images[] 取 image_url
 *   - 失败 → 502 UPSTREAM_ERROR；未配置 key → 502 友好提示
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
  if (input.mode === 'photo_compose') {
    parts.push('已附门店实拍参考图，请将其作为背景或主体并叠加文案。');
  } else if (input.mode === 'official_bg_only') {
    parts.push('已附商品官方图，请保留商品本体并设计背景与文案。');
  } else if (input.mode === 'multi_product') {
    parts.push('已附多张商品图，请将其混排成系列海报。');
  }
  parts.push('输出竖版 3:4 海报，中文文案，不要水印。');
  return parts.join('\n');
}

// 与 admin-stats.service 同源（同 key + 同默认）；切模型从 PUT /admin/settings/image-model 走。
// OpenRouter 上 google 系图像输出模型实际可用 id：
//   google/gemini-2.5-flash-image           ← 默认（稳定 GA）
//   google/gemini-3.1-flash-image-preview   ← preview
//   google/gemini-3-pro-image-preview       ← pro preview
const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';

async function getCurrentImageModel(): Promise<string> {
  const res = await query<{ value: string }>(
    `SELECT value FROM sys_settings WHERE key = 'poster_image_model' LIMIT 1`,
  );
  return res.rows[0]?.value ?? DEFAULT_IMAGE_MODEL;
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

function buildMessageContent(
  input: PosterGenerateInput,
  prompt: string,
): string | ContentPart[] {
  const images: string[] = [];
  if (input.mode === 'multi_product' && input.productImageUrls?.length) {
    images.push(...input.productImageUrls);
  }
  if (input.mode === 'official_bg_only' && input.productImageUrl) {
    images.push(input.productImageUrl);
  }
  if (input.mode === 'photo_compose' && input.sourcePhotoUrl) {
    images.push(input.sourcePhotoUrl);
  }
  if (images.length === 0) return prompt;

  const parts: ContentPart[] = [{ type: 'text', text: prompt }];
  for (const url of images) {
    parts.push({ type: 'image_url', image_url: { url } });
  }
  return parts;
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
    const content = buildMessageContent(input, prompt);

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
          messages: [{ role: 'user', content }],
          // nano-banana 必须显式让响应包含 image modality；否则只返回文本说明
          modalities: ['image', 'text'],
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
          content?:
            | string
            | Array<{ type: string; image_url?: { url: string } }>;
          images?: Array<{ image_url?: { url: string } }>;
        };
      }>;
    };

    const posterUrl = extractImageUrl(data);
    if (!posterUrl) {
      logger.warn({ data: JSON.stringify(data).slice(0, 800) }, 'openrouter no image');
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        'OpenRouter 响应中未找到海报图片',
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

interface OpenRouterChoice {
  message?: {
    content?:
      | string
      | Array<{ type: string; image_url?: { url: string } }>;
    images?: Array<{ image_url?: { url: string } }>;
  };
}

function extractImageUrl(data: { choices?: OpenRouterChoice[] }): string {
  const msg = data.choices?.[0]?.message;
  if (!msg) return '';

  // nano-banana 主路径：message.images[0].image_url.url
  if (msg.images && msg.images.length > 0) {
    const url = msg.images[0]?.image_url?.url;
    if (url) return url;
  }

  // 兜底：content 数组里夹 image_url（旧 schema）
  if (Array.isArray(msg.content)) {
    for (const item of msg.content) {
      if (item.type === 'image_url' && item.image_url?.url) return item.image_url.url;
    }
  }

  // 兜底：content 字符串里含图片 URL（极少见）
  if (typeof msg.content === 'string') {
    const m = msg.content.match(/https?:\/\/\S+\.(?:png|jpg|jpeg|webp)/i);
    if (m) return m[0];
  }

  return '';
}

export const openRouterService = new OpenRouterService();
