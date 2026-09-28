/**
 * Returns `base` with only the `patch` keys whose value is not `undefined`
 * applied, so `{ key: undefined }` keeps the base value exactly as an omitted
 * key does.
 */
export function mergeDefined<T extends object>(base: T, patch: Partial<T>): T {
  const next = { ...base };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined) next[key] = value as T[keyof T];
  }
  return next;
}
