import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';

// admin-web 是纯客户端 SPA(无 SSR),用 TanStack Router(不带 Start)。
// TSR_TMP_DIR 同 web,避免容器内 .tanstack/tmp 跨设备 rename 失败。
if (!process.env.TSR_TMP_DIR) {
  process.env.TSR_TMP_DIR = 'src/.tsr-tmp';
}

export default defineConfig({
  envDir: '../..',
  plugins: [
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    TanStackRouterVite({
      target: 'react',
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    react(),
  ],
  server: {
    port: 5174,
    host: '0.0.0.0',
    // Vite 5+ 默认对非 localhost 的 Host header 返回 403。
    // 这里 nginx 反代过来时 Host = admin-web / 域名,需要放行。
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
