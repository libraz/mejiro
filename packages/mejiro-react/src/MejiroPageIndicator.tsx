import { type ComponentPropsWithoutRef, forwardRef, type ReactNode } from 'react';

/** Props for {@link MejiroPageIndicator}; other `div` attributes go to the root element. */
export interface MejiroPageIndicatorProps extends ComponentPropsWithoutRef<'div'> {
  /** Zero-based navigation index, as `useSpread` reports it in `index`. Shown one-based. */
  index: number;
  /** Number of navigation positions, as `useSpread` reports it in `count`. */
  count: number;
}

/** Displays the one-based position out of the total, e.g. `3 / 12`, under the book. */
export const MejiroPageIndicator = forwardRef<HTMLDivElement, MejiroPageIndicatorProps>(
  function MejiroPageIndicator({ index, count, className, ...rest }, ref): ReactNode {
    return (
      <div
        {...rest}
        ref={ref}
        className={
          className ? `mejiro-reader-page-indicator ${className}` : 'mejiro-reader-page-indicator'
        }
      >
        {index + 1} / {count}
      </div>
    );
  },
);
