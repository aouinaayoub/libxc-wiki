import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = dirname(here);
const source = join(site, 'node_modules', 'katex', 'dist');
const target = join(site, 'vendor', 'katex');

rmSync(target, { recursive: true, force: true });
mkdirSync(dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });

console.log(`Vendored KaTeX to ${target}`);
