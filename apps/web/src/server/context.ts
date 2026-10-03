import { loadConfig } from '../lib/config';
import type { Config } from '../lib/config';

export { getDb } from '../db/client';

let cached: Config | undefined;

/** The checked configuration, read from the environment on first use. */
export function getConfig(): Config {
  cached ??= loadConfig();
  return cached;
}
