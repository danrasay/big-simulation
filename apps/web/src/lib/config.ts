/** Settings read from environment variables. Secrets never come from anywhere else. */
export interface Config {
  /** The app's own origin, for example https://bigsim.example. No trailing slash. */
  readonly appOrigin: string;
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  /** Key for the hashes that stand in for emails and Google account ids. */
  readonly identityPepper: string;
  /** Key for signing the app's own cookies. */
  readonly sessionSecret: string;
  /** The Google Workspace domain whose accounts may sign in. */
  readonly allowedDomain: string;
  /** When true, a signed-in account must also be on a roster of an open section. */
  readonly requireRoster: boolean;
  /** Email of the first instructor. Compared in memory at sign-in and never stored. */
  readonly bootstrapInstructorEmail: string | undefined;
  /** True when the app is served over https, which turns on Secure, __Host- cookies. */
  readonly secureCookies: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

const MIN_SECRET_LENGTH = 32;

/**
 * Reads and checks the configuration. Throws one error that names every
 * problem, so a bad deployment fails loudly on its first request.
 */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];
  const required = (name: string): string => {
    const value = env[name]?.trim() ?? '';
    if (value === '') problems.push(`${name} is not set`);
    return value;
  };
  const secret = (name: string): string => {
    const value = required(name);
    if (value !== '' && value.length < MIN_SECRET_LENGTH) {
      problems.push(`${name} must be at least ${String(MIN_SECRET_LENGTH)} characters`);
    }
    return value;
  };

  const appUrl = required('APP_URL');
  let appOrigin = '';
  let secureCookies = true;
  if (appUrl !== '') {
    try {
      const parsed = new URL(appUrl);
      appOrigin = parsed.origin;
      secureCookies = parsed.protocol === 'https:';
      const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (!secureCookies && !local) problems.push('APP_URL must use https unless it is localhost');
    } catch {
      problems.push('APP_URL is not a valid URL');
    }
  }

  const requireRosterRaw = env.REQUIRE_ROSTER?.trim().toLowerCase() ?? 'true';
  if (requireRosterRaw !== 'true' && requireRosterRaw !== 'false') {
    problems.push('REQUIRE_ROSTER must be true or false');
  }

  const config: Config = {
    appOrigin,
    googleClientId: required('GOOGLE_CLIENT_ID'),
    googleClientSecret: required('GOOGLE_CLIENT_SECRET'),
    identityPepper: secret('IDENTITY_PEPPER'),
    sessionSecret: secret('SESSION_SECRET'),
    // Google sends the hd claim in lower case, and the comparison is exact.
    allowedDomain: (env.ALLOWED_DOMAIN?.trim().toLowerCase() ?? '') || 'lclark.edu',
    requireRoster: requireRosterRaw !== 'false',
    bootstrapInstructorEmail: env.BOOTSTRAP_INSTRUCTOR_EMAIL?.trim() || undefined,
    secureCookies,
  };

  if (problems.length > 0) {
    throw new Error(`Configuration problems:\n- ${problems.join('\n- ')}`);
  }
  return config;
}
