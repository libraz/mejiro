import { describe, it } from 'vitest';
import { expectTypeErrors } from '../type-probe.js';

const HEADER = `import { createOverlayDragSession } from '@libraz/mejiro/browser';
import type { OverlayDragSession, OverlayDragSessionOptions } from '@libraz/mejiro/browser';
`;

describe('overlay drag session types', () => {
  it('reports rectangle changes through onRectChange and ends through dispose', () => {
    expectTypeErrors(
      `${HEADER}const session: OverlayDragSession = createOverlayDragSession({
  mode: 'move',
  rect: { x: 0, y: 0, width: 10, height: 10 },
  startX: 0,
  startY: 0,
  onRectChange: (rect) => rect.width,
});
export const stop: () => void = session.dispose;
export const options: OverlayDragSessionOptions['onRectChange'] = (rect) => rect.height;
`,
      { fails: [] },
    );
  });

  it('rules out the former handler and teardown names', () => {
    expectTypeErrors(
      `${HEADER}const session = createOverlayDragSession({
  mode: 'move',
  rect: { x: 0, y: 0, width: 10, height: 10 },
  startX: 0,
  startY: 0,
  onRectChange: () => {},
});
export const cancel = session.cancel;
export const stale = createOverlayDragSession({ mode: 'move', rect: { x: 0, y: 0, width: 10, height: 10 }, startX: 0, startY: 0, onChange: () => {} });
export const narrow = createOverlayDragSession({ mode: 'move', rect: { x: 0, y: 0, w: 10, h: 10 }, startX: 0, startY: 0, onRectChange: () => {} });
`,
      { fails: ['const cancel', 'const stale', 'const narrow'] },
    );
  });
});
