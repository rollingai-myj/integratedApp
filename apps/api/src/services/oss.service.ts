/**
 * 阿里云 OSS 文件存储
 *
 * 涉及接口：
 * - POST /api/v1/storage/upload  (SK-L1 升级版)
 * - GET  /api/v1/storage/proxy   (SK-L2 图片代理)
 * - GET  /api/v1/storage/sku-image/:sku  (新增 商品官方图重定向)
 *
 * M0：占位。M2 接入。
 */
import { NotImplementedError } from '../lib/errors.js';

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

export class OssService {
  async upload(_input: UploadInput): Promise<UploadResult> {
    throw new NotImplementedError(
      '[oss.upload] will be implemented in M2',
    );
  }

  async proxyImage(_url: string): Promise<{ stream: NodeJS.ReadableStream; contentType: string }> {
    throw new NotImplementedError(
      '[oss.proxyImage] will be implemented in M2',
    );
  }
}

export const ossService = new OssService();
