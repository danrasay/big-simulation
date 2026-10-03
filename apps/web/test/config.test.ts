import { describe, expect, it } from 'vitest';
import { connectionOptions } from '../src/db/client';
import { loadConfig } from '../src/lib/config';

const valid = {
  APP_URL: 'https://bigsim.example/',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  IDENTITY_PEPPER: 'pepper-pepper-pepper-pepper-pepper-1',
  SESSION_SECRET: 'secret-secret-secret-secret-secret-1',
};

describe('loadConfig', () => {
  it('reads a complete configuration and applies the defaults', () => {
    expect(loadConfig(valid)).toEqual({
      appOrigin: 'https://bigsim.example',
      googleClientId: 'client-id',
      googleClientSecret: 'client-secret',
      identityPepper: valid.IDENTITY_PEPPER,
      sessionSecret: valid.SESSION_SECRET,
      allowedDomain: 'lclark.edu',
      requireRoster: true,
      bootstrapInstructorEmail: undefined,
      secureCookies: true,
    });
  });

  it('requires a roster unless told otherwise', () => {
    expect(loadConfig({ ...valid, REQUIRE_ROSTER: 'false' }).requireRoster).toBe(false);
    expect(loadConfig({ ...valid, REQUIRE_ROSTER: 'TRUE' }).requireRoster).toBe(true);
    expect(() => loadConfig({ ...valid, REQUIRE_ROSTER: 'no' })).toThrow(/REQUIRE_ROSTER/);
  });

  it('names every missing setting in one error', () => {
    expect(() => loadConfig({})).toThrow(
      /APP_URL is not set[\s\S]*GOOGLE_CLIENT_ID is not set[\s\S]*GOOGLE_CLIENT_SECRET is not set[\s\S]*IDENTITY_PEPPER is not set[\s\S]*SESSION_SECRET is not set/,
    );
  });

  it('refuses short secrets', () => {
    expect(() => loadConfig({ ...valid, IDENTITY_PEPPER: 'short' })).toThrow(
      /IDENTITY_PEPPER must be at least 32 characters/,
    );
    expect(() => loadConfig({ ...valid, SESSION_SECRET: 'short' })).toThrow(
      /SESSION_SECRET must be at least 32/,
    );
  });

  it('allows http only on localhost, and then turns secure cookies off', () => {
    expect(loadConfig({ ...valid, APP_URL: 'http://localhost:3000' })).toMatchObject({
      appOrigin: 'http://localhost:3000',
      secureCookies: false,
    });
    expect(() => loadConfig({ ...valid, APP_URL: 'http://bigsim.example' })).toThrow(
      /must use https/,
    );
    expect(() => loadConfig({ ...valid, APP_URL: 'not a url' })).toThrow(/not a valid URL/);
  });

  it('reads the optional settings', () => {
    const config = loadConfig({
      ...valid,
      ALLOWED_DOMAIN: ' Example.EDU ',
      BOOTSTRAP_INSTRUCTOR_EMAIL: ' instructor@college.example ',
    });
    expect(config.allowedDomain).toBe('example.edu');
    expect(config.bootstrapInstructorEmail).toBe('instructor@college.example');
  });
});

describe('database connection settings', () => {
  it('requires TLS for any database that is not on this machine', () => {
    const remote = connectionOptions(
      'postgres://user:pw@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
    );
    expect(remote.ssl).toBe('require');
    expect(
      connectionOptions('postgres://user:pw@db.example.com/postgres?sslmode=disable').ssl,
    ).toBe('require');
  });

  it('allows a plain connection to a local database', () => {
    expect(connectionOptions('postgres://postgres@127.0.0.1:5432/bigsim_test').ssl).toBe(false);
    expect(connectionOptions('postgres://postgres@localhost/bigsim_test').ssl).toBe(false);
  });

  it('never uses prepared statements, which the transaction pooler cannot serve', () => {
    expect(connectionOptions('postgres://u@h.example/db').prepare).toBe(false);
  });
});
