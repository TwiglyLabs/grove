import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // PORT is injected by Grove's GenericDevServer
    port: parseInt(process.env.PORT || '5173'),
    strictPort: true,
    proxy: {
      '/api': {
        // GROVE_API_URL can override the full target URL;
        // otherwise GROVE_API_PORT is used (injected via .grove.yaml env template)
        target: process.env.GROVE_API_URL || `http://127.0.0.1:${process.env.GROVE_API_PORT || '3001'}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
