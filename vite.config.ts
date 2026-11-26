import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/** La version affichée vient de package.json : on la monte à CHAQUE livraison. */
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  plugins: [react()],
  define: { __ENVO_VERSION__: JSON.stringify(version) },
  build: {
    target: 'es2022',
    sourcemap: false,
    // ⚠️ Jamais une police insérée en `data:` dans la CSS : la CSP du site (`font-src 'self'`) la bloque
    // (6 erreurs « Loading the font … violates … font-src », 26/11/2026). Les autres petits fichiers : règle par défaut.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf|eot)$/i.test(file) ? false : undefined),
  },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
  server: { proxy: { '/api': 'http://127.0.0.1:3880' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:3880' } },
});
