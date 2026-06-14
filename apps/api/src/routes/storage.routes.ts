/**
 * 文件存储路由
 *
 * 两条路径：
 *   1. /storage/local/<key>  — dev fallback。OSS 凭证未配齐时 ossService.upload
 *      落到 /tmp/myj-uploads，此路由把请求映射到本地文件流。
 *   2. /storage/oss-image    — OSS 反代。我们的 bucket 在 OSS console 里被设为
 *      "强制浏览器下载"，匿名访问返回 `Content-Disposition: attachment` +
 *      `x-oss-force-download: true`，iOS Safari 收到这俩 header 会拒绝
 *      `<img src>` 渲染（显示纯黑）。OSS 不允许匿名请求用 query 覆盖响应头，
 *      于是 API 拉好对象、用 Content-Disposition: inline 返回给浏览器。
 *
 * 注：拍照、海报、商品图三类资源 URL 都从 ossService.upload 返回；前端 <img>
 * 直接 GET 这个 URL，所以本端点不能要求登录鉴权（否则 <img> 拿不到 cookie）。
 * 安全：key 必须 `myjadviser/` 开头（OSS bucket policy 限定的前缀），杜绝 SSRF。
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { pipeline } from 'node:stream/promises';
import { config } from '../config/env.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { ossService } from '../services/oss.service.js';

export const storageRouter = Router();

storageRouter.get(
  '/storage/local/:key',
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const key = req.params.key!; // express 已自动 decode
        const { stream, contentType } = ossService.readLocal(key);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        await pipeline(stream, res);
      } catch (err) {
        next(err);
      }
    })();
  },
);

storageRouter.get(
  '/storage/oss-image',
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const rawKey = req.query.key;
        if (typeof rawKey !== 'string' || !rawKey) {
          throw new AppError(400, ErrorCodes.BAD_REQUEST, 'key 必填');
        }
        // 限制只能代理 myjadviser/ 前缀的 OSS 对象（bucket policy 本身锁的也是这个前缀）。
        if (!rawKey.startsWith('myjadviser/')) {
          throw new AppError(400, ErrorCodes.BAD_REQUEST, 'key 非法');
        }
        if (!config.OSS_BUCKET || !config.OSS_REGION) {
          throw new AppError(500, ErrorCodes.INTERNAL_ERROR, 'OSS 未配置');
        }
        const ossUrl = `https://${config.OSS_BUCKET}.${config.OSS_REGION}.aliyuncs.com/${rawKey}`;
        const { body, contentType } = await ossService.proxyImage(ossUrl);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
        res.end(Buffer.from(body));
      } catch (err) {
        next(err);
      }
    })();
  },
);
