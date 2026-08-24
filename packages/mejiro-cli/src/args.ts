/**
 * Reads the value following a flag.
 *
 * @param args - Command arguments, after the command name.
 * @param flag - The flag to look for, including its leading dashes.
 * @returns The value, or `undefined` when the flag is absent or has no value.
 */
export function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

/**
 * Parses a flag value that has to be a positive number.
 *
 * @param value - The raw value, or `undefined` when the flag was not given.
 * @param defaultValue - The value to use when the flag was not given.
 * @param name - The flag name, used in the error message.
 * @returns The parsed number.
 * @throws When the value is present but is not a positive finite number.
 */
export function parsePositiveNumber(
  value: string | undefined,
  defaultValue: number,
  name: string,
): number {
  const parsed = value == null ? defaultValue : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

/**
 * Collects the arguments that are neither a flag nor a flag value.
 *
 * @param args - Command arguments, after the command name.
 * @returns The positional arguments, in order.
 */
export function positionalArgs(args: string[]): string[] {
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-hanging') continue;
    if (arg.startsWith('--')) {
      i++;
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}
