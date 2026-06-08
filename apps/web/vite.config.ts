import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';

// https://tanstack.com/start
export default defineConfig({
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
