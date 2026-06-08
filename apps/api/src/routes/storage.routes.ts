/**
 * 模块 10：文件存储与图片代理
 *
 * 覆盖统一接口规划文档：
 *   - 上传文件（合并 SK-L1，海报模块改走这里）
 *   - 图片代理（SK-L2）
 *   - 商品官方图重定向（新增，按 SKU 拼地址）
 */
import { Router } from 'express';
import { NotImplementedError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';

export const storageRouter = Router();

/** 上传文件到云端（带 purpose 区分用途） */
storageRouter.post(
  '/storage/upload',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** 图片代理（绕开跨域） */
storageRouter.get('/storage/proxy', (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 商品官方图重定向（GET → 302 到真实 URL） */
storageRouter.get('/storage/sku-image/:sku', (_req, _res, next) => {
  next(new NotImplementedError());
});
