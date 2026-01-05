import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api/bitmex': {
        target: 'https://www.bitmex.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/bitmex/, '/api/v1'),
        secure: true,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.error('Proxy error:', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('Proxying to BitMEX:', proxyReq.path);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('BitMEX response:', proxyRes.statusCode, req.url);
          });
        },
      },
    },
  },
});

