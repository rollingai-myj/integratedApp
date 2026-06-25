/**
 * Swagger UI + OpenAPI spec
 *
 * 挂 3 个路径（全部在 /api/v1 下）：
 *   - GET /docs           交互式 Swagger UI（默认入口）
 *   - GET /docs.json      OpenAPI spec（JSON 格式）
 *   - GET /docs.yaml      OpenAPI spec（YAML 原文）
 *
 * ⚠️ **以 docs/api-contracts.md 为准**:apps/api/openapi.yaml 由于人工维护成本高，
 * 已经滞后于真实路由(admin-web 20+ 个新接口、stores CRUD、conflicts 预览等都没补进 yaml)。
 * 把 Swagger UI 当作"探索老接口"的工具用即可；以 docs/api-contracts.md 为最新契约。
 */
import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yamljs';
import swaggerUi from 'swagger-ui-express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// src/routes → apps/api/src → apps/api → openapi.yaml
const YAML_PATH = join(__dirname, '..', '..', 'openapi.yaml');

interface OpenApiSpec {
  info?: { description?: string; [k: string]: unknown };
  [k: string]: unknown;
}

const spec = YAML.load(YAML_PATH) as OpenApiSpec;
const yamlRaw = readFileSync(YAML_PATH, 'utf-8');

// 在 spec.info.description 顶部注入"本 spec 滞后"警告,Swagger UI 顶端会渲染 markdown
const STALE_WARNING_MD =
  '> ⚠️ **本 Swagger spec 部分滞后**:admin-web 体系的 20+ 个新接口' +
  '(`/admin/dashboard/*`、`/admin/changes*`、`/admin/uploads/*`、`/admin/stores*`)未补进 yaml。' +
  '以 [`docs/api-contracts.md`](https://github.com/rollingai-myj/integratedApp/blob/main/docs/api-contracts.md) 为最新接口契约。\n\n---\n\n';

if (spec.info) {
  spec.info.description = STALE_WARNING_MD + (spec.info.description ?? '');
}

export const docsRouter: Router = Router();

// Swagger UI 入口
docsRouter.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(spec, {
    customSiteTitle: '美宜佳 API · Swagger',
    customCss: '.swagger-ui .topbar { display: none; }',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      defaultModelsExpandDepth: 1,
      filter: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  }),
);

// 原始 spec：JSON 形式
docsRouter.get('/docs.json', (_req: Request, res: Response) => {
  res.json(spec);
});

// 原始 spec：YAML 形式
docsRouter.get('/docs.yaml', (_req: Request, res: Response) => {
  res.type('text/yaml').send(yamlRaw);
});
