// Type-checks every demo and example against the built packages: `tsc --noEmit -p <dir>`,
// or `vue-tsc --noEmit -p <dir>` when the directory contains .vue files.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

/** Lists the direct subdirectories of `parent` that satisfy `keep`. */
function subdirs(parent, keep = () => true) {
  return readdirSync(join(root, parent), { withFileTypes: true })
    .filter((e) => e.isDirectory() && keep(e.name))
    .map((e) => join(parent, e.name));
}

/** Reports whether a directory tree (excluding dependencies and build output) contains a .vue file. */
function hasVueFile(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).some((e) => {
    if (e.name === 'node_modules' || e.name === 'dist') return false;
    if (e.isDirectory()) return hasVueFile(join(dir, e.name));
    return e.name.endsWith('.vue');
  });
}

const dirs = [...subdirs('packages', (n) => n.endsWith('-demo')), ...subdirs('examples')].filter(
  (d) => existsSync(join(root, d, 'tsconfig.json')),
);

let failed = 0;
for (const dir of dirs) {
  const bin = hasVueFile(dir) ? 'vue-tsc' : 'tsc';
  console.log(`${bin} --noEmit -p ${dir}`);
  const result = spawnSync(join(root, 'node_modules/.bin', bin), ['--noEmit', '-p', dir], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) failed += 1;
}
if (failed > 0) {
  console.error(`${failed} of ${dirs.length} demo/example projects failed to type-check`);
  process.exit(1);
}
