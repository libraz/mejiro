import { describe, expect, it } from 'vitest';
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
    expect(output().stderr).toContain('--iterations must be a positive number');
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
});
