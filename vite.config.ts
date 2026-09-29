import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Base path for GitHub Pages: /<repo-name>/
export default defineConfig({
  plugins: [react()],
  base: '/catch-the-cat-ai-competition/',
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
  },
});
