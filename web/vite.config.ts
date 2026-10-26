import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// host: true so guests on the same Wi-Fi can open the page by LAN IP.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.PORT ?? 3100}`, ws: true } },
  },
});
