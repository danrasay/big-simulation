import { greetingName, requireUser } from '../server/auth';

/** Placeholder home page. The simulation's own pages arrive in later phases. */
export default async function HomePage() {
  const user = await requireUser();
  const name = await greetingName(user);
  return (
    <>
      <h1>{name === undefined ? 'Hello.' : `Hello, ${name}.`}</h1>
      {user.studentCode === null ? (
        <p>You are signed in as the instructor.</p>
      ) : (
        <p>
          You are signed in. Your student code is <strong>{user.studentCode}</strong>. Your work
          here is saved under that code, not under your name.
        </p>
      )}
      <p>The simulation is not open yet. This page is where it will start.</p>
      {user.role === 'instructor' ? (
        <p>
          <a href="/instructor">Go to the instructor console</a>
        </p>
      ) : null}
    </>
  );
}
