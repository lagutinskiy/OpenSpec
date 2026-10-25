/**
 * CI environment detection for suppressing interactive CLI hints.
 *
 * Providers set CI to "true", "1", "yes", etc. Only an explicit off-value
 * counts as "not CI", so an unknown value still suppresses interactive hints
 * rather than surprising an automated run.
 */

const CI_DISABLED_VALUES = new Set(['', 'false', '0', 'no', 'off']);

/**
 * True when `CI` is set to anything other than an explicit off-value.
 */
export function isCiEnvironment(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const value = env.CI;
  return value !== undefined && !CI_DISABLED_VALUES.has(value.trim().toLowerCase());
}
