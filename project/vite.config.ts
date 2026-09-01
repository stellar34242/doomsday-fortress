import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'plugin-inspect-react-code'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  cacheDir: process.env.TD_VITE_CACHE_DIR ?? 'node_modules/.vite',
  build: {
    copyPublicDir: false, // fuse 挂载不支持 copy_file_range（EPERM），public 由构建后 rsync 补拷
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll('\\', '/')
          if (
            normalized.includes('/node_modules/react/')
            || normalized.includes('/node_modules/react-dom/')
            || normalized.includes('/node_modules/react-router/')
            || normalized.includes('/node_modules/scheduler/')
          ) return 'react-vendor'
          if (
            normalized.includes('/src/game/')
            && !normalized.endsWith('/ammoFxPreview.ts')
            && !normalized.endsWith('/bundledProject.ts')
            && !normalized.endsWith('/config_transfer.ts')
          ) return 'game-runtime'
          if (normalized.includes('/node_modules/lucide-react/')) return 'icons'
        },
      },
    },
  },
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
