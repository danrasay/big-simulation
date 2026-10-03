import type { Config } from './config';

/**
 * True when a request that changes something came from the app's own pages.
 * Browsers send Origin on every cross-site POST, so a missing or different
 * value is refused. This is in addition to SameSite cookies.
 */
export function isSameOrigin(
  originHeader: string | null,
  config: Pick<Config, 'appOrigin'>,
): boolean {
  return originHeader !== null && originHeader === config.appOrigin;
}
