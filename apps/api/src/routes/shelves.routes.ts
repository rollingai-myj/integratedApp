/**
 * 模块 5：货盘选品（业务接口）
 *
 * 覆盖统一接口规划文档：
 *   - 货架配置：SK-D1 / SK-D2 / SK-D3 / SK-D4 / SK-D5
 *   - 场景定义：SK-D6
 *   - 场景调改：SK-E1 / SK-E2 / SK-E3 / SK-E4 / SK-E5
 *   - 货架运行时：SK-F1 / SK-F2 / SK-F3 / SK-F4 / SK-F5 / SK-F6
 *   - 调研问卷：SK-G1 / SK-G2 / SK-G3 / SK-G4
 *   - 勘误反馈：SK-N1 / SK-N2
 *
 *   注：商品检测 SK-I1 和虚拟货架触发 SK-K1 放在 detect.routes.ts。
 */
import { Router } from 'express';
import { NotImplementedError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';

export const shelvesRouter = Router();

// 货架配置 SK-D1～D5 -------------------------------------------------------

/** SK-D1 查询门店所有货架配置 */
shelvesRouter.get(
  '/shelves/config/:storeId',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-D2 新增一个货架配置 */
shelvesRouter.post(
  '/shelves/config/:storeId',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-D3 更新一个货架配置 */
shelvesRouter.put(
  '/shelves/config/:storeId/:shelfId',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-D4 删除一批货架配置 */
shelvesRouter.delete(
  '/shelves/config/:storeId',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-D5 整店替换货架配置 */
shelvesRouter.put(
  '/shelves/config/:storeId:replace-all',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

// 场景定义 SK-D6 -----------------------------------------------------------

/** SK-D6 查询场景定义（全部场景的元数据） */
shelvesRouter.get('/scenes', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});

// 场景调改 SK-E1～E5 -------------------------------------------------------

/** SK-E1 查询场景的调改次数 */
shelvesRouter.get(
  '/scenes/:storeId/adjustments-count',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-E2 一键应用调改（上下架） */
shelvesRouter.post(
  '/scenes/:storeId/:sceneId/apply',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-E3 查询某场景的历史调改记录 */
shelvesRouter.get(
  '/scenes/:storeId/:sceneId/history',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-E4 查询某场景的虚拟货架历史 */
shelvesRouter.get(
  '/scenes/:storeId/:sceneId/virtual-shelf-history',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-E5 记录一条虚拟货架 */
shelvesRouter.post(
  '/scenes/:storeId/:sceneId/virtual-shelf',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

// 货架运行时 SK-F1～F6 -----------------------------------------------------

/** SK-F1 查询货架当前状态 */
shelvesRouter.get(
  '/shelves/state/:storeId',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-F2 更新货架当前状态 */
shelvesRouter.put(
  '/shelves/state/:storeId/:shelfId',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-F3 删除货架当前状态 */
shelvesRouter.delete(
  '/shelves/state/:storeId',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-F4 查询货架照片历史 */
shelvesRouter.get(
  '/shelves/photos/:storeId/:shelfId',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-F5 新增一条照片历史 */
shelvesRouter.post(
  '/shelves/photos/:storeId/:shelfId',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-F6 更新当前货架照片（只更新"最新一张"） */
shelvesRouter.put(
  '/shelves/photos/:storeId/:shelfId/current',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

// 调研问卷 SK-G1～G4 -------------------------------------------------------

/** SK-G1 查询货架调研问题 */
shelvesRouter.get(
  '/surveys/:storeId/:shelfId/questions',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-G2 保存货架调研问题 */
shelvesRouter.put(
  '/surveys/:storeId/:shelfId/questions',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-G3 查询货架调研答案 */
shelvesRouter.get(
  '/surveys/:storeId/:shelfId/answers',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-G4 保存货架调研答案 */
shelvesRouter.put(
  '/surveys/:storeId/:shelfId/answers',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

// 勘误反馈 SK-N1 / SK-N2 ---------------------------------------------------

/** SK-N1 查询门店的勘误记录 */
shelvesRouter.get(
  '/shelves/errata/:storeId',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** SK-N2 提交勘误（误识别为 add / remove） */
shelvesRouter.post(
  '/shelves/errata/:storeId',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);
