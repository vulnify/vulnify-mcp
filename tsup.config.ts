import { defineConfig } from 'tsup';

const shared = {
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: 'es2022' as const,
  platform: 'node' as const,
  outDir: 'dist',
};

export default defineConfig([
  {
    ...shared,
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
  },
  {
    ...shared,
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
