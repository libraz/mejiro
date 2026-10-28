import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCorpusParagraphs, SENTENCE_POOLS } from '../src/corpus.js';
import { runCli } from '../src/index.js';

function createIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: {
        write: (chunk: string) => {
          stdout += chunk;
          return true;
        },
      },
      stderr: {
        write: (chunk: string) => {
          stderr += chunk;
          return true;
        },
      },
    },
    output: () => ({ stdout, stderr }),
  };
}

describe('mejiro CLI', () => {
  it('rejects layout without positional text', () => {
    const { io, output } = createIo();
    const code = runCli(['layout', '--line-width', '80'], io);

    expect(code).toBe(1);
    expect(output().stderr).toContain('no text provided');
  });

  it('rejects invalid numeric flags', () => {
    const { io, output } = createIo();
    const code = runCli(['layout', '--line-width', 'abc', '本文'], io);

    expect(code).toBe(1);
    expect(output().stderr).toContain('--line-width must be a positive number');
  });

  it('rejects invalid kinsoku mode', () => {
    const { io, output } = createIo();
    const code = runCli(['layout', '--mode', 'invalid', '本文'], io);

    expect(code).toBe(1);
    expect(output().stderr).toContain('--mode must be strict or loose');
  });

  it('runs bench and reports the timings on stdout', () => {
    const { io, output } = createIo();
    const code = runCli(['bench', '--chars', '64', '--iterations', '2'], io);

    expect(code).toBe(0);
    expect(output().stderr).toBe('');
    expect(output().stdout).toContain('64 chars x 2 iterations');
    expect(output().stdout).toMatch(/Total: \d+\.\d{2}ms/);
    expect(output().stdout).toMatch(/Per iteration: \d+\.\d{4}ms/);
  });

  it('rejects invalid bench flags', () => {
    const { io, output } = createIo();
    const code = runCli(['bench', '--iterations', '0'], io);

    expect(code).toBe(1);
    expect(output().stderr).toContain('--iterations must be a positive integer');
  });

  it('prints usage and succeeds when no command is given', () => {
    const { io, output } = createIo();
    const code = runCli([], io);

    expect(code).toBe(0);
    expect(output().stdout).toContain('layout');
    expect(output().stdout).toContain('bench');
    expect(output().stderr).toBe('');
  });

  it('prints usage and fails for an unknown command', () => {
    const { io, output } = createIo();
    const code = runCli(['nope'], io);

    expect(code).toBe(1);
    expect(output().stdout).toContain('layout');
  });

  it('joins multiple positional words as text', () => {
    const { io, output } = createIo();
    const code = runCli(['layout', '--line-width', '1000', '吾輩は', '猫である'], io);

    expect(code).toBe(0);
    expect(output().stdout).toContain('吾輩は 猫である');
  });

  it('rejects fractional count flags and names the flag', () => {
    for (const [flag, value] of [
      ['--chars', '1.5'],
      ['--iterations', '0.5'],
    ]) {
      const { io, output } = createIo();
      const code = runCli(['bench', flag, value], io);

      expect(code).toBe(1);
      expect(output().stderr).toContain(`${flag} must be a positive integer`);
    }
  });
});

describe('benchmark corpus', () => {
  it('visits every sentence of each pool before any repeat, never back to back', () => {
    const text = buildCorpusParagraphs(60000).join('\n');
    for (const pool of SENTENCE_POOLS) {
      const draws: { at: number; sentence: string }[] = [];
      for (const sentence of pool) {
        for (let at = text.indexOf(sentence); at !== -1; at = text.indexOf(sentence, at + 1)) {
          draws.push({ at, sentence });
        }
      }
      draws.sort((a, b) => a.at - b.at);
      const order = draws.map((d) => d.sentence);
      expect(order.length).toBeGreaterThanOrEqual(pool.length * 2);
      for (let i = 0; i + pool.length <= order.length; i += pool.length) {
        expect(new Set(order.slice(i, i + pool.length)).size).toBe(pool.length);
      }
      for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
    }
  });
});

describe('entry guard', () => {
  const dirs: string[] = [];
  const argv = process.argv;
  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('runs the CLI when invoked through a symlink to the entry file', async () => {
    const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'mejiro-cli-'));
    dirs.push(dir);
    const link = join(dir, 'mejiro');
    symlinkSync(entry, link);

    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.argv = [argv[0], link, 'layout', '--line-width', '1000', '本文'];
    vi.resetModules();
    await import('../src/index.js');

    expect(write).toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });
});
