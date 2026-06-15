/**
 * vitest 配置
 *
 * 集成测试都打同一个 myj_test 数据库，所以必须串行运行，否则
 * 多个文件并行会互相搅乱数据（例如 portal-auth 创建账号、scenes
 * 调改记录与 feishu upsert 互相覆盖）。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
  },
});
