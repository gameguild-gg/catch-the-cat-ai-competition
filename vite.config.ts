import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Base path for GitHub Pages: /<repo-name>/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'serve-bots-with-base-path',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const botsPrefix = '/catch-the-cat-ai-competition/' + 'bots/';
          if (req.url?.startsWith(botsPrefix)) {
            const file = req.url.slice(botsPrefix.length).split('?')[0];
            const botPath = path.join(process.cwd(), 'public', 'bots', file);
            if (fs.existsSync(botPath) && fs.statSync(botPath).isFile()) {
              const ext = path.extname(file);
              if (ext === '.js') res.setHeader('Content-Type', 'application/javascript');
              else if (ext === '.wasm') res.setHeader('Content-Type', 'application/wasm');
              else if (ext === '.json') res.setHeader('Content-Type', 'application/json');
              return res.end(fs.readFileSync(botPath));
            }
          }
          next();
        });
      },
    },
  ],
  base: '/catch-the-cat-ai-competition/',
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    exclude: ['**/node_modules/**', '**/dist/**', 'emsdk/**', 'forks/**', 'forks-native/**'],
  },
});
