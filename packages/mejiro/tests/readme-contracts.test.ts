import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

const repoRoot = resolve(import.meta.dirname, '../../..');
const publishedReadmes = [
  'README.md',
  'packages/mejiro/README.md',
  'packages/mejiro-react/README.md',
  'packages/mejiro-vue/README.md',
];

/** Reads a repository-relative text file. */
function read(path: string): Promise<string> {
  return readFile(resolve(repoRoot, path), 'utf8');
}

describe('readme contracts', () => {
  it('lists every published stylesheet subpath in the root README', async () => {
    const pkg = JSON.parse(await read('packages/mejiro/package.json')) as {
      exports: Record<string, unknown>;
    };
    const stylesheets = Object.keys(pkg.exports)
      .filter((subpath) => subpath.endsWith('.css'))
      .map((subpath) => subpath.slice(subpath.lastIndexOf('/') + 1));
    expect(stylesheets.length).toBeGreaterThan(0);

    const readme = await read('README.md');
    for (const stylesheet of stylesheets) {
      expect(readme, `${stylesheet} is missing from the root README`).toContain(stylesheet);
    }
  });

  it('keeps package versions out of the published READMEs', async () => {
    for (const path of publishedReadmes) {
      const readme = await read(path);
      expect(readme.match(/@libraz\/mejiro(?:-react|-vue)?@\d/gu), path).toBeNull();
      expect(readme.match(/["']\^?\d+\.\d+\.\d+["']/gu), path).toBeNull();
    }
  });

  it('points every starter template at an existing example', async () => {
    const templates = new Set<string>();
    for (const path of publishedReadmes) {
      const readme = await read(path);
      for (const match of readme.matchAll(/degit libraz\/mejiro\/examples\/([\w-]+)/gu)) {
        templates.add(match[1]);
      }
    }
    expect(templates.size).toBeGreaterThan(0);

    for (const template of templates) {
      await expect(
        access(resolve(repoRoot, 'examples', template, 'package.json')),
        `examples/${template} does not exist`,
      ).resolves.toBeUndefined();
    }
  });
});

/** Matches the version literal the `npx degit` starter recipe substitutes in. */
const STARTER_VERSION =
  /replaceAll\('\\"workspace:\*\\"',\s*'\\"\^(\d+\.\d+\.\d+(?:-[\w.]+)?)\\"'\)/gu;

/** Reads the version the workspace currently publishes. */
async function currentVersion(): Promise<string> {
  const pkg = JSON.parse(await read('packages/mejiro/package.json')) as { version: string };
  return pkg.version;
}

/** Returns every `examples/<name>/README.md` that documents the starter recipe. */
async function starterReadmes(): Promise<string[]> {
  const entries = await readdir(resolve(repoRoot, 'examples'), { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = `examples/${entry.name}/README.md`;
    try {
      const text = await read(path);
      if (/npx degit [\w-]+\/[\w-]+\/examples\//u.test(text)) paths.push(path);
    } catch {
      // Example without a README; nothing to pin.
    }
  }
  return paths;
}

describe('example starter versions', () => {
  it('pins every starter recipe to the version the workspace publishes', async () => {
    const version = await currentVersion();
    const readmes = await starterReadmes();
    expect(readmes.length).toBeGreaterThan(0);

    for (const path of readmes) {
      const found = [...(await read(path)).matchAll(STARTER_VERSION)].map((match) => match[1]);
      expect(found, `${path} has no starter version literal`).not.toEqual([]);
      for (const literal of found) {
        expect(literal, `${path} still points at ^${literal}, published is ${version}`).toBe(
          version,
        );
      }
    }
  });

  it('rewrites starter versions when the bump script runs', async () => {
    // The script is executed against a throwaway copy of the repository layout,
    // so running the test never bumps the working tree.
    const root = await mkdtemp(resolve(tmpdir(), 'mejiro-bump-'));
    await mkdir(resolve(root, 'scripts'), { recursive: true });
    await copyFile(
      resolve(repoRoot, 'scripts/bump-version.mjs'),
      resolve(root, 'scripts/bump-version.mjs'),
    );
    for (const name of ['mejiro', 'mejiro-react', 'mejiro-vue']) {
      await mkdir(resolve(root, 'packages', name), { recursive: true });
      await writeFile(
        resolve(root, 'packages', name, 'package.json'),
        `${JSON.stringify({ name: `@libraz/${name}`, version: '0.0.1' }, null, 2)}\n`,
      );
    }
    const readmePath = resolve(root, 'examples/demo/README.md');
    await mkdir(resolve(root, 'examples/demo'), { recursive: true });
    await writeFile(
      readmePath,
      [
        '# demo',
        '',
        'Requires Node 22.0.0 or newer.',
        '',
        '```bash',
        'npx degit libraz/mejiro/examples/demo my-reader',
        `node -e "const fs = require('node:fs'); const p = 'package.json'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('\\"workspace:*\\"', '\\"^0.0.1\\"'));"`,
        '```',
        '',
      ].join('\n'),
    );

    await run(process.execPath, [resolve(root, 'scripts/bump-version.mjs'), '9.8.7']);

    const rewritten = await readFile(readmePath, 'utf8');
    expect([...rewritten.matchAll(STARTER_VERSION)].map((match) => match[1])).toEqual(['9.8.7']);
    // Version-shaped text outside the starter recipe stays untouched.
    expect(rewritten).toContain('Requires Node 22.0.0 or newer.');
    const bumped = JSON.parse(
      await readFile(resolve(root, 'packages/mejiro/package.json'), 'utf8'),
    ) as { version: string };
    expect(bumped.version).toBe('9.8.7');
  });
});
