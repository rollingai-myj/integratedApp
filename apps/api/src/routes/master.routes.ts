/**
 * 模块 3 + 模块 4：门店主数据 + 商品/销售主数据
 *
 * 覆盖统一接口规划文档中：
 *   模块 3：
 *     - GET  /master/stores            门店主数据查询（SK-B1 升级）
 *     - PUT  /master/stores/:id        新增 / 更新门店（SK-B2）
 *     - GET  /master/environment/:storeId   门店周边洞察查询（SK-H1）
 *     - PUT  /master/environment/:storeId   门店周边洞察更新（SK-H2）
 *
 *   模块 4：
 *     - GET  /master/categories            商品分类树
 *     - GET  /master/products              商品基本信息
 *     - GET  /master/stores/:id/skus       门店在售 SKU（合并 SK-C1 + PR-A1）
 *     - POST /master/stores/:id/skus:import  批量导入门店 SKU 数据（SK-C2）
 *     - GET  /master/competitors           竞品价格（合并 SK-C3 + PR-A3）
 *     - GET  /master/baseline-skus         基准 SKU 名单（SK-C6）
 *     - GET  /master/promotion-skus        有促销文案的 SKU 列表（SK-C4）
 *     - GET  /master/promotions-text       促销文案详情（SK-C5）
 *
 * 注：周边洞察按规划文档归在「模块 3：门店与组织主数据」，因此挂在 master 下，
 *     未来若希望单独走 /api/v1/environment 也只是改 path 前缀，handler 不动。
 */
import { Router } from 'express';
import { NotImplementedError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';

export const masterRouter = Router();

// 模块 3 ------------------------------------------------------------------

/** 门店主数据查询（可带 ?id= 单查） */
masterRouter.get('/master/stores', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 新增 / 更新门店（PUT 同时承载 upsert） */
masterRouter.put('/master/stores/:id', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 门店周边洞察 - 查询（SK-H1） */
masterRouter.get(
  '/master/environment/:storeId',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** 门店周边洞察 - 更新（SK-H2） */
masterRouter.put(
  '/master/environment/:storeId',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

// 模块 4 ------------------------------------------------------------------

/** 商品分类树 */
masterRouter.get('/master/categories', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 商品基本信息（主数据查询） */
masterRouter.get('/master/products', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 门店在售 SKU（合并 SK-C1 + PR-A1） */
masterRouter.get(
  '/master/stores/:id/skus',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** 批量导入门店 SKU 数据（SK-C2 / ERP 同步） */
masterRouter.post(
  '/master/stores/:id/skus:import',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** 竞品价格（按大类或按 SKU 查，合并 SK-C3 + PR-A3） */
masterRouter.get('/master/competitors', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 基准 SKU 名单（SK-C6） */
masterRouter.get(
  '/master/baseline-skus',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** 有促销文案的 SKU 列表（SK-C4） */
masterRouter.get(
  '/master/promotion-skus',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** 促销文案详情（SK-C5） */
masterRouter.get(
  '/master/promotions-text',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);
