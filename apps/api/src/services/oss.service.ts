/**
 * 阿里云 OSS 文件存储
 *
 * 设计：
 *   - 真实上传需要 OSS_REGION + OSS_BUCKET + OSS_ACCESS_KEY_ID + OSS_ACCESS_KEY_SECRET
 *   - 凭证齐全 → 走 ali-oss SDK 上传到 OSS（**生产 + Dify 调用都用这个**）
 *   - 任一未配置 → 走"本地 dev fallback"：写到 /tmp/myj-uploads/<key>，URL 指向
 *     /api/v1/storage/local/<key>（仅本机可达；Dify 在外网会拿不到）
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import OSS from 'ali-oss';
import { config } from '../config/env.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export type UploadPurpose =
  | 'shelf-photo'
  | 'poster-source'
  | 'poster-output'
  | 'avatar'
  | 'other';

export interface UploadInput {
  buffer: Buffer;
  filename: string;
  contentType: string;
  purpose: UploadPurpose;
  storeId?: string;
  shelfId?: string;
}

export interface UploadResult {
  url: string;
  key: string;
  size: number;
}

const LOCAL_DIR = '/tmp/myj-uploads';

// bucket owner 在 bucket policy 里只授权了 myjadviser/* 这个前缀的 List/Get/Put，
// 所有 key 必须以此开头，否则 PutObject 会 403。本地 fallback 也复用同样的 key，
// 数据库存的 key 字段在 dev/prod 间统一。
const KEY_ROOT = 'myjadviser';

function genKey(purpose: UploadPurpose, filename: string, storeId?: string): string {
  const ext = extname(filename) || '.bin';
  const ts = Math.floor(Date.now() / 1000);
  const rand = randomBytes(6).toString('hex');
  const sub = storeId ? `${purpose}/${storeId}` : purpose;
  return `${KEY_ROOT}/${sub}/${ts}-${rand}${ext}`;
}

function ossConfigured(): boolean {
  return (
    !!config.OSS_BUCKET &&
    !!config.OSS_REGION &&
    !!config.OSS_ACCESS_KEY_ID &&
    !!config.OSS_ACCESS_KEY_SECRET
  );
}

let cachedClient: OSS | null = null;
function getClient(): OSS {
  if (cachedClient) return cachedClient;
  cachedClient = new OSS({
    region: config.OSS_REGION,
    accessKeyId: config.OSS_ACCESS_KEY_ID,
    accessKeySecret: config.OSS_ACCESS_KEY_SECRET,
    bucket: config.OSS_BUCKET,
    secure: true,
  });
  return cachedClient;
}

export class OssService {
  async upload(input: UploadInput): Promise<UploadResult> {
    const key = genKey(input.purpose, input.filename, input.storeId);

    if (ossConfigured()) {
      try {
        const client = getClient();
        // 上传时设 Content-Disposition: inline 是 best-effort。bucket 控制台
        // 开了"强制浏览器下载"时仍会被覆盖回 attachment → 浏览器 `<img>` 渲染失败
        // 显示纯黑。`browserUrl` 走 /storage/oss-image 反代统一兜底。
        const res = await client.put(key, input.buffer, {
          headers: {
            'Content-Type': input.contentType,
            'Content-Disposition': 'inline',
          },
        });
        const directUrl = (res as { url?: string }).url
          ?? `https://${config.OSS_BUCKET}.${config.OSS_REGION}.aliyuncs.com/${key}`;
        // poster-output / avatar 只在浏览器渲染——返回反代 URL，绕开 OSS 强制下载头。
        // shelf-photo / poster-source 还要给 Dify / OpenRouter 外网抓——必须保留 OSS 直链。
        const browserOnly = input.purpose === 'poster-output' || input.purpose === 'avatar';
        const url = browserOnly
          ? `/api/v1/storage/oss-image?key=${encodeURIComponent(key)}`
          : directUrl;
        logger.info(
          { key, size: input.buffer.length, purpose: input.purpose, mode: 'oss', proxied: browserOnly },
          'upload',
        );
        return { key, size: input.buffer.length, url };
      } catch (err) {
        // OSS 凭证可能没写权限 → 警告 + 降级到本地，保证业务链路不挂
        logger.warn(
          { err: (err as Error).message, key },
          'OSS upload failed, falling back to local storage',
        );
      }
    }

    // 本地 fallback：写到 /tmp/myj-uploads（仅本机可达；Dify 外网拿不到）
    const path = join(LOCAL_DIR, key);
    await mkdir(join(LOCAL_DIR, key, '..'), { recursive: true });
    await writeFile(path, input.buffer);
    logger.info(
      { key, size: input.buffer.length, purpose: input.purpose, mode: 'local' },
      'upload',
    );
    return {
      key,
      size: input.buffer.length,
      url: `/api/v1/storage/local/${encodeURIComponent(key)}`,
    };
  }

  /**
   * 从本地 dev fallback 读取文件流
   */
  readLocal(key: string): { stream: NodeJS.ReadableStream; contentType: string } {
    const path = join(LOCAL_DIR, key);
    if (!existsSync(path)) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, '文件不存在');
    }
    // 根据扩展名猜 contentType
    const ext = extname(path).toLowerCase();
    const contentType =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.svg'
              ? 'image/svg+xml'
              : 'application/octet-stream';
    return { stream: createReadStream(path), contentType };
  }

  /**
   * 跨域图片代理：把外部 URL 的内容拉下来用自己的域返回，绕开浏览器跨域
   */
  async proxyImage(url: string): Promise<{
    body: ArrayBuffer;
    contentType: string;
  }> {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `代理图片失败：${(err as Error).message}`,
      );
    }
    if (!res.ok) {
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `代理图片返回 ${res.status}`,
      );
    }
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    const body = await res.arrayBuffer();
    return { body, contentType };
  }

  /**
   * 把 `data:<mime>;base64,<payload>` 解码上传到 OSS，返回 OSS URL。
   * Gemini 海报模型走 OpenRouter 返回的是 data URI——不能直接落库（1-2MB/张，
   * iOS Safari 渲染大 base64 img 经常失败显示纯黑；DB 也存不下规模化的图片）。
   * 必须先转存再持久化 URL。
   */
  async uploadDataUrl(
    dataUrl: string,
    args: { purpose: UploadPurpose; storeId?: string; filenameHint?: string },
  ): Promise<UploadResult> {
    const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
    if (!m) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'uploadDataUrl: 不是合法的 data URL');
    }
    const contentType = m[1]!;
    const buffer = Buffer.from(m[2]!, 'base64');
    const ext = contentType.split('/')[1] || 'bin';
    const filename = args.filenameHint || `inline.${ext}`;
    return this.upload({
      buffer,
      filename,
      contentType,
      purpose: args.purpose,
      storeId: args.storeId,
    });
  }

  /**
   * 由 SKU 拼商品官方图地址（统一按 OSS 命名约定：product_pic/{skuCode}.png）
   */
  buildSkuImageUrl(skuCode: string): string {
    const bucket = config.OSS_BUCKET || 'myj-public';
    const region = config.OSS_REGION || 'oss-cn-shanghai';
    return `https://${bucket}.${region}.aliyuncs.com/product_pic/${encodeURIComponent(skuCode)}.png`;
  }
}

export const ossService = new OssService();
