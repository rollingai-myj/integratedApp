import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';

// https://tanstack.com/start
export default defineConfig({
  // 环境变量统一从仓库根 .env 读 —— 单一事实源
  // Vite 只会暴露 VITE_* 前缀变量到 import.meta.env,后端密钥不会泄露到 bundle
  envDir: '../..',
  plugins: [
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tanstackStart({
      // 路由文件目录（约定）
      tsr: {
        appDirectory: 'src',
        routesDirectory: 'src/routes',
        generatedRouteTree: 'src/routeTree.gen.ts',
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
