import type { ReactNode } from 'react';

/** Props for {@link MejiroPageIndicator}. */
export interface MejiroPageIndicatorProps {
  /** Current spread (1-based). */
  current: number;
  /** Total number of spreads. */
  total: number;
}

/** Displays "current / total" spread position under the book. */
export function MejiroPageIndicator({ current, total }: MejiroPageIndicatorProps): ReactNode {
  return (
    <div className="mejiro-reader-page-indicator">
      {current} / {total}
    </div>
  );
}
