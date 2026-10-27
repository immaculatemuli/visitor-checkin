import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Same-origin /api in development, mirroring the Vercel/Netlify rewrite in production.
    proxy: { '/api': 'http://localhost:4000' },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
