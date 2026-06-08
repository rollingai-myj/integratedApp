/**
 * 全局 pino 日志实例
 *
 * - 开发环境用 pino-pretty 美化输出
 * - 生产环境输出 JSON，便于聚合
 */
import pino from 'pino';
import { config, isDev } from '../config/env.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'myj-api' },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname,service',
          },
        },
      }
    : {}),
});

export type Logger = typeof logger;
