/**
 * Swagger UI + OpenAPI spec
 *
 * 挂 3 个路径（全部在 /api/v1 下）：
 *   - GET /docs           交互式 Swagger UI（默认入口）
 *   - GET /docs.json      OpenAPI spec（JSON 格式）
 *   - GET /docs.yaml      OpenAPI spec（YAML 原文）
 *
 * spec 文件维护在 apps/api/openapi.yaml，手写 + 渐进式补充。
 * 路由代码本身零侵入：所有 schema / 描述都集中在 yaml 里。
 */
import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yamljs';
import swaggerUi from 'swagger-ui-express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 解析 openapi.yaml：src/routes/docs.routes.ts → 上溯两级到 apps/api/ 再拼
const YAML_PATH = join(__dirname, '..', '..', 'openapi.yaml');

const spec = YAML.load(YAML_PATH);
const yamlRaw = readFileSync(YAML_PATH, 'utf-8');

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
