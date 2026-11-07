import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In production Django (WhiteNoise) serves the build under /static/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/static/' : '/',
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
}));
