import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API server runs separately (`pnpm dev` starts both); Vite forwards to it.
const apiServer = `http://127.0.0.1:${process.env['PORT'] ?? '8080'}`;

export default defineConfig({
  // The router plugin generates src/routeTree.gen.ts from src/routes, so it runs first.
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': apiServer, '/-/': apiServer },
  },
});
