# Deploying

The app runs on Vercel. The database is Postgres on Supabase, used as a plain database. Sign-in is Google.

Three rules hold throughout:

- Secrets go into the host's environment settings. They never go into the repo, a chat, or an issue.
- The app gets its own Supabase project. It does not share one with anything else.
- Nobody, and no agent, runs ad hoc queries against the production database. Schema changes go through the migration files in `apps/web/drizzle/`.

## 1. Supabase

1. Create a new project for this app, in the region nearest Portland.
2. Turn the web API off: open the Data API page under Integrations and turn **Enable Data API** off. The app talks to Postgres directly and never uses that API.
3. Do not set up Supabase Auth. Sign-in is handled by the app.
4. From **Connect**, copy two connection strings:
   - **Transaction pooler** (port 6543). This is `DATABASE_URL`, used by the running app.
   - **Session pooler** (port 5432). This is `DIRECT_DATABASE_URL`, used only to run migrations.

Every table has row-level security turned on with no policies. If the web API were ever turned back on, its roles could still read nothing. The app connects as the table owner, which row-level security does not restrict.

## 2. Google

Follow the checklist in `docs/PLAN.md` under "Google Cloud setup". The redirect URIs are:

- `https://<production-domain>/auth/callback`
- `http://localhost:3000/auth/callback`

The client ID is not a secret. The client secret is.

## 3. Vercel

1. Import the `big-simulation` repository as a new project.
2. Set **Root Directory** to `apps/web`. The app imports the engine from `packages/engine`, so files outside the root directory must be available to the build (Vercel's default for a workspace).
3. Framework preset: Next.js. Node 22 or 24.
4. Add the environment variables below to the **Production** environment only.

| Variable | Value |
| --- | --- |
| `APP_URL` | The production address, for example `https://bigsim.example.edu`. No trailing slash |
| `DATABASE_URL` | Supabase transaction pooler string |
| `GOOGLE_CLIENT_ID` | From Google Cloud |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud |
| `IDENTITY_PEPPER` | `openssl rand -base64 48`. Set once per term. Changing it disconnects every roster row |
| `SESSION_SECRET` | `openssl rand -base64 48`, a different value |
| `ALLOWED_DOMAIN` | `lclark.edu` (the default) |
| `REQUIRE_ROSTER` | `true` (the default) |
| `BOOTSTRAP_INSTRUCTOR_EMAIL` | Your own college address. Used to let you in before any roster exists |

Preview deployments get no variables, so they fail on their first request by design. Sign-in could not work on them anyway: Google only returns to the redirect URIs you registered.

`APP_URL` must be the address people actually use. The sign-in redirect and the same-origin check on sign-out both compare against it.

## 4. Migrations

Run from your own machine, with `DIRECT_DATABASE_URL` set in `apps/web/.env.local`:

```sh
pnpm install
pnpm migrate
```

Run this before the first deployment and again whenever a pull request adds a file under `apps/web/drizzle/`.

## 5. First sign-in

1. Open the production address and sign in with the account named in `BOOTSTRAP_INSTRUCTOR_EMAIL`.
2. Go to the instructor console, create a section, and upload its roster.
3. If you put yourself on the roster with the role `instructor`, you can remove `BOOTSTRAP_INSTRUCTOR_EMAIL` afterwards.

The roster file has the columns `email,student_code,section`, and optionally `role`. It is read in memory and not kept. Keep the file that matches codes to names on your own computer.

Use each person's primary college address, the one Google reports at sign-in. An alias will not match, and that person will see the not-on-roster page.

## 6. Checks after the first deployment

These are the parts of phase 1 that only a live deployment can show:

- [ ] A personal Gmail account is refused. You see "You are not signed in" with the note about Gmail accounts.
- [ ] A college account that is not on the roster sees "You are not on the roster". Afterwards the `users` and `sessions` tables have no new row.
- [ ] A student account on the roster reaches the home page and sees its code. Opening `/instructor` shows "This page is for instructors".
- [ ] In the browser's developer tools, the cookie is named `__Host-session` and is marked HttpOnly and Secure, with SameSite Lax.
- [ ] In the Supabase table editor, no table contains an email address or a name.

## Local development

```sh
cp apps/web/.env.example apps/web/.env.local   # then fill it in
pnpm migrate
pnpm dev
```

You need a Postgres database you can throw away and the Google client with the localhost redirect URI. There is no sign-in bypass for development, on purpose.

## Tests that need a database

`pnpm test` needs nothing: it runs the database tests against an in-process Postgres.

`pnpm test:http` drives the built app over HTTP and needs a real, throwaway Postgres:

```sh
pnpm build
HTTP_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/bigsim_http_test pnpm test:http
```

The database name must contain `test`. The tests empty every table.
