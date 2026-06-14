/**
 * Swagger UI + OpenAPI spec
 *
 * 挂 3 个路径（全部在 /api/v1 下）：
 *   - GET /docs           交互式 Swagger UI（默认入口）
 *   - GET /docs.json      OpenAPI spec（JSON 格式）
 *   - GET /docs.yaml      OpenAPI spec（YAML 原文）
 *
 * spec 优先读 docs/api-to-be.openapi.yaml（refactor 完成后的实现版 source of truth）；
 * 旧的 apps/api/openapi.yaml 仅作 fallback，后续可删。
 */
import { Router, type Request, type Response } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yamljs';
import swaggerUi from 'swagger-ui-express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// src/routes → apps/api/src/routes → ... → repo root → docs/
const PRIMARY = join(__dirname, '..', '..', '..', '..', 'docs', 'api-to-be.openapi.yaml');
const FALLBACK = join(__dirname, '..', '..', 'openapi.yaml');
const YAML_PATH = existsSync(PRIMARY) ? PRIMARY : FALLBACK;

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
