import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const server = process.env.CONSOLE_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    proxy: {
      '/api': server,
      '/auth': server,
      '/open': { target: server, ws: true },
      '/ws': { target: server, ws: true },
    },
  },
});
