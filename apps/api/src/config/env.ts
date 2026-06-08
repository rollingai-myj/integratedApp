/**
 * 环境变量校验与强类型导出
 *
 * 启动时一次性校验所有环境变量，缺失必填项立即抛错。
 * 其它模块从这里 import { config }，绝不直接读 process.env。
 */
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // 服务
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // 数据库（必填）
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // 飞书（M1 用，M0 允许空）
  FEISHU_APP_ID: z.string().optional().default(''),
  FEISHU_APP_SECRET: z.string().optional().default(''),
  FEISHU_REDIRECT_URI: z
    .string()
    .optional()
    .default('http://localhost:5173/auth/callback'),

  // 会话
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(7200),
  COOKIE_DOMAIN: z.string().default('localhost'),
  COOKIE_SECURE: z.coerce.boolean().default(false),

  // 阿里云 OSS（M2+ 用，M0 允许空）
  OSS_REGION: z.string().optional().default('oss-cn-shanghai'),
  OSS_BUCKET: z.string().optional().default(''),
  OSS_ACCESS_KEY_ID: z.string().optional().default(''),
  OSS_ACCESS_KEY_SECRET: z.string().optional().default(''),

  // Dify（M2+ 用，M0 允许空）
  DIFY_BASE_URL: z.string().optional().default('https://dify.rollingai.cn/v1'),
  DIFY_KEY_SELECTION: z.string().optional().default(''),
  DIFY_KEY_ALIGN: z.string().optional().default(''),
  DIFY_KEY_INSIGHT: z.string().optional().default(''),
  DIFY_KEY_QUESTIONS: z.string().optional().default(''),
  DIFY_KEY_VIRTUAL_SHELF: z.string().optional().default(''),
  DIFY_KEY_PRICE_DIAGNOSE: z.string().optional().default(''),

  // OpenRouter（M4 用）
  OPENROUTER_API_KEY: z.string().optional().default(''),

  // Detect Service（M2 用）
  DETECT_SERVICE_URL: z.string().optional().default('http://localhost:8000'),
});

export type AppConfig = z.infer<typeof envSchema>;

function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`[config] Invalid environment variables:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}

export const config: AppConfig = loadConfig();

export const isProd = config.NODE_ENV === 'production';
export const isDev = config.NODE_ENV === 'development';
export const isTest = config.NODE_ENV === 'test';
