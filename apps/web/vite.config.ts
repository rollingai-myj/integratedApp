import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';

// TanStack router-generator 用 tmp 文件 + rename 写入 routeTree.gen.ts。
// 在 docker 内 .tanstack/tmp 落在容器 overlay，而 src 是 bind mount → 跨设备 EXDEV。
// 必须把 tmpDir 指到 bind mount 内同卷，rename 才能原子完成。
// 该字段不在 tanstackStart 的 schema 里，必须通过 router-generator 直接读的 env 注入。
if (!process.env.TSR_TMP_DIR) {
  process.env.TSR_TMP_DIR = 'src/.tsr-tmp';
}

// https://tanstack.com/start
export default defineConfig({
  // 环境变量统一从仓库根 .env 读 —— 单一事实源
  // Vite 只会暴露 VITE_* 前缀变量到 import.meta.env,后端密钥不会泄露到 bundle
  envDir: '../..',
  plugins: [
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tanstackStart({
      // 路径拼接为 path.resolve(root, srcDirectory, routesDirectory)
      // 所以 router.* 字段必须是相对 srcDirectory 的，不能再带 src/
      // 同时 srcDirectory 必须显式给出以便正确解析 router.tsx 入口
      srcDirectory: 'src',
      router: {
        routesDirectory: 'routes',
        generatedRouteTree: 'routeTree.gen.ts',
      },
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    // 开发时把 /api 代理到后端，避免 CORS
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
