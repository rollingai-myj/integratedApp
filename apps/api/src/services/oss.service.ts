/**
 * 阿里云 OSS 文件存储
 *
 * 设计：
 *   - 真实上传需要 OSS_REGION + OSS_BUCKET + OSS_ACCESS_KEY_ID + OSS_ACCESS_KEY_SECRET
 *   - 若任一未配置 → 走"本地 dev fallback"：把文件存到 /tmp/myj-uploads/<key>，
 *     URL 指向本地后端的 /api/v1/storage/proxy?url=... 方便前端能拿到
 *   - 生产环境应配齐 OSS 变量，使用真实 ali-oss SDK
 *
 * 注：完整 ali-oss SDK 接入留到 M5 上线前；本 PR 只保证接口契约 + dev fallback 可用。
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config/env.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

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

function genKey(purpose: UploadPurpose, filename: string, storeId?: string): string {
  const ext = extname(filename) || '.bin';
  const ts = Math.floor(Date.now() / 1000);
  const rand = randomBytes(6).toString('hex');
  const prefix = storeId ? `${purpose}/${storeId}` : purpose;
  return `${prefix}/${ts}-${rand}${ext}`;
}

function ossConfigured(): boolean {
  return (
    !!config.OSS_BUCKET &&
    !!config.OSS_ACCESS_KEY_ID &&
    !!config.OSS_ACCESS_KEY_SECRET
  );
}

export class OssService {
  async upload(input: UploadInput): Promise<UploadResult> {
    const key = genKey(input.purpose, input.filename, input.storeId);

    if (ossConfigured()) {
      // 真实 OSS 上传留 TODO（M5 接 ali-oss SDK）
      // 这里也走本地 fallback，以确保本 PR 不依赖 OSS 也能跑
    }

    // 本地 fallback：写到 /tmp/myj-uploads
    const path = join(LOCAL_DIR, key);
    await mkdir(join(LOCAL_DIR, key, '..'), { recursive: true });
    await writeFile(path, input.buffer);

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
   * 由 SKU 拼商品官方图地址（M0 决策 D8：dim_product.official_image_url 优先；
   * 若未设置则按 OSS 命名约定回退）
   */
  buildSkuImageUrl(skuCode: string): string {
    const bucket = config.OSS_BUCKET || 'myj-public';
    const region = config.OSS_REGION || 'oss-cn-shanghai';
    return `https://${bucket}.${region}.aliyuncs.com/product_pic/${encodeURIComponent(skuCode)}.png`;
  }
}

export const ossService = new OssService();
