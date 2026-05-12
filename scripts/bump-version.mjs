#!/usr/bin/env node
/**
 * Bump the version field of @libraz/mejiro, @libraz/mejiro-react, and
 * @libraz/mejiro-vue in lockstep.
 *
 *   yarn bump 0.5.0
 */
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!(version && /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version))) {
  console.error('Usage: yarn bump <version>  (e.g. yarn bump 0.5.0)');
  process.exit(1);
}

const packages = ['packages/mejiro', 'packages/mejiro-react', 'packages/mejiro-vue'];
for (const dir of packages) {
  const path = `${dir}/package.json`;
  const json = JSON.parse(readFileSync(path, 'utf8'));
  json.version = version;
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${path}: ${version}`);
}
