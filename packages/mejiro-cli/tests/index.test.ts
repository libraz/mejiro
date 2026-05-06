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

  it('joins multiple positional words as text', () => {
    const { io, output } = createIo();
    const code = runCli(['layout', '--line-width', '1000', '吾輩は', '猫である'], io);

    expect(code).toBe(0);
    expect(output().stdout).toContain('吾輩は 猫である');
  });
});
