/**
 * Run the TypeScript sample-clip scorer through Vite SSR.
 * Avoids adding a second TypeScript runner on top of Vite, which we already have.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vite = await createServer({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const mod = await vite.ssrLoadModule('/scripts/score-sample-clips.ts');
  await mod.main();
} finally {
  await vite.close();
}
