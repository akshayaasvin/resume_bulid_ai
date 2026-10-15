#!/usr/bin/env node
// Copies the pdf.js worker (legacy build) into public/ so it is served as a static file.
// Webpack's minifier can't process it as a bundled asset. Runs before `next dev` / `next build`.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'node_modules', 'pdfjs-dist');
const { version } = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const outDir = path.join(root, 'public', 'pdfjs');
mkdirSync(outDir, { recursive: true });
// keep only the current version's worker
for (const f of readdirSync(outDir)) rmSync(path.join(outDir, f));
copyFileSync(
  path.join(pkgDir, 'legacy', 'build', 'pdf.worker.min.mjs'),
  path.join(outDir, `pdf.worker.min.${version}.mjs`),
);
console.log(`pdf.js worker ${version} copied to public/pdfjs`);
