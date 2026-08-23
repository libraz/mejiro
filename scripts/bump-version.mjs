#!/usr/bin/env node
/**
 * Bump every version string the repository publishes in lockstep: the `version`
 * field of @libraz/mejiro, @libraz/mejiro-react and @libraz/mejiro-vue, plus the
 * released version referenced by the `npx degit` starter recipe in each
 * `examples/<name>/README.md`.
 *
 *   yarn bump 0.5.0
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const version = process.argv[2];
if (!(version && /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version))) {
  console.error('Usage: yarn bump <version>  (e.g. yarn bump 0.5.0)');
  process.exit(1);
}

/** Repository root, so the script works from any working directory. */
const repoRoot = resolve(import.meta.dirname, '..');

const packages = ['packages/mejiro', 'packages/mejiro-react', 'packages/mejiro-vue'];
for (const dir of packages) {
  const path = join(repoRoot, dir, 'package.json');
  const json = JSON.parse(readFileSync(path, 'utf8'));
  json.version = version;
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${dir}/package.json: ${version}`);
}

/**
 * Matches only the version literal the starter recipe substitutes for
 * `"workspace:*"`, so unrelated version-shaped strings elsewhere in a README
 * (tool versions, changelog entries, sample data) are never touched.
 */
const starterVersion =
  /(replaceAll\('\\"workspace:\*\\"',\s*'\\"\^)\d+\.\d+\.\d+(?:-[\w.]+)?(\\"'\))/gu;

/** Marks a README that documents the `npx degit` starter recipe. */
const starterRecipe = /npx degit [\w-]+\/[\w-]+\/examples\//u;

const examplesDir = join(repoRoot, 'examples');
const stale = [];
for (const entry of readdirSync(examplesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const path = join(examplesDir, entry.name, 'README.md');
  if (!existsSync(path)) continue;

  const before = readFileSync(path, 'utf8');
  if (!starterRecipe.test(before)) continue;

  const after = before.replace(starterVersion, `$1${version}$2`);
  if (after === before) {
    stale.push(`examples/${entry.name}/README.md`);
    continue;
  }
  writeFileSync(path, after);
  console.log(`examples/${entry.name}/README.md: ${version}`);
}

if (stale.length > 0) {
  console.error(
    `No starter version literal found in:\n  ${stale.join('\n  ')}\nUpdate the pattern in scripts/bump-version.mjs or the README recipe.`,
  );
  process.exit(1);
}
