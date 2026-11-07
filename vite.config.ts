import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/** La version affichée vient de package.json : on la monte à CHAQUE livraison. */
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  plugins: [react()],
  define: { __ENVO_VERSION__: JSON.stringify(version) },
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
  server: { proxy: { '/api': 'http://127.0.0.1:3880' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:3880' } },
});
