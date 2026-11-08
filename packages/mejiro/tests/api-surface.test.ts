import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs `scripts/check-api-surface.mjs` so the public-interface conventions are
 * enforced on every test run: the vocabulary and structure rules over the
 * whole surface, and React/Vue parity of components and hooks.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../../scripts/check-api-surface.mjs', import.meta.url));

interface CheckRun {
  /** Process exit status; 0 means no violation. */
  status: number | null;
  /** Report printed by the script, `violations N` followed by one line per violation. */
  output: string;
}

function runCheck(mode: string): CheckRun {
  const result = spawnSync(process.execPath, [SCRIPT, mode], { cwd: REPO_ROOT, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('public API surface conventions', () => {
  let surface: CheckRun;
  let parity: CheckRun;

  beforeAll(() => {
    surface = runCheck('--all');
    parity = runCheck('--parity');
  }, 120_000);

  it('reports no vocabulary or structure violation over the whole surface', () => {
    expect(surface.output).toMatch(/^violations 0$/mu);
    expect(surface.status).toBe(0);
  });

  it('reports no React/Vue parity difference', () => {
    expect(parity.output).toMatch(/^violations 0$/mu);
    expect(parity.status).toBe(0);
  });
});
