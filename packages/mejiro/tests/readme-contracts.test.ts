import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
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

  it('lists every module subpath in each subpath listing', async () => {
    const pkg = JSON.parse(await read('packages/mejiro/package.json')) as {
      exports: Record<string, unknown>;
    };
    const subpaths = Object.keys(pkg.exports)
      .filter((subpath) => !(subpath.endsWith('.css') || subpath.endsWith('.json')))
      .map((subpath) => `@libraz/mejiro${subpath.slice(1)}`);
    expect(subpaths).toContain('@libraz/mejiro/analysis');

    const listings = [
      'README.md',
      'packages/mejiro/README.md',
      'docs/en/02-core-concepts.md',
      'docs/ja/02-core-concepts.md',
    ];
    for (const path of listings) {
      const text = await read(path);
      for (const subpath of subpaths) {
        expect(text, `${subpath} is missing from ${path}`).toContain(`\`${subpath}\``);
      }
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

/** GitHub's heading anchor: lowercased, punctuation dropped, spaces to hyphens. */
function headingSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/ /gu, '-');
}

/** Anchors a markdown file offers, with GitHub's `-1`, `-2` suffixes on repeats. */
async function headingAnchors(path: string): Promise<Set<string>> {
  const text = (await read(path)).replace(/```[\s\S]*?```/gu, '');
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gmu)) {
    const slug = headingSlug(match[1]);
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return anchors;
}

/** Markdown files a reader follows links through. */
async function linkedMarkdown(): Promise<string[]> {
  const paths = ['README.md', 'README_ja.md', ...publishedReadmes.slice(1)];
  for (const dir of ['docs/en', 'docs/ja']) {
    for (const name of await readdir(resolve(repoRoot, dir))) {
      if (name.endsWith('.md')) paths.push(`${dir}/${name}`);
    }
  }
  for (const entry of await readdir(resolve(repoRoot, 'examples'), { withFileTypes: true })) {
    const path = `examples/${entry.name}/README.md`;
    if (entry.isDirectory() && (await exists(path))) paths.push(path);
  }
  return paths;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(resolve(repoRoot, path));
    return true;
  } catch {
    return false;
  }
}

describe('repository links', () => {
  it('resolves every link into the repository to an existing file and heading', async () => {
    const broken: string[] = [];
    for (const path of await linkedMarkdown()) {
      // Code fences and inline code show link syntax without linking.
      const text = (await read(path)).replace(/```[\s\S]*?```/gu, '').replace(/`[^`\n]*`/gu, '');
      for (const match of text.matchAll(/\]\(([^)\s]+)\)/gu)) {
        const url = match[1];
        const github = url.match(
          /^https:\/\/github\.com\/libraz\/mejiro\/(?:tree|blob)\/main\/(.*)$/u,
        );
        if (!github && /^[a-z]+:/iu.test(url)) continue;
        const [target, anchor] = (github ? github[1] : url).split('#');
        let file = github ? target : target ? resolve('/', dirname(path), target).slice(1) : path;
        if (!(await exists(file))) {
          broken.push(`${path}: ${url} (no such file)`);
          continue;
        }
        if (!file.endsWith('.md') && (await exists(`${file}/README.md`)))
          file = `${file}/README.md`;
        if (
          anchor &&
          file.endsWith('.md') &&
          !(await headingAnchors(file)).has(decodeURIComponent(anchor))
        ) {
          broken.push(`${path}: ${url} (no heading #${anchor})`);
        }
      }
    }
    expect(broken).toEqual([]);
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
