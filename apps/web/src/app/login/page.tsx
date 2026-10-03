import { redirect } from 'next/navigation';
import { currentUser } from '../../server/auth';
import { getConfig } from '../../server/context';

export default async function LoginPage() {
  if ((await currentUser()) !== undefined) redirect('/');
  const { allowedDomain } = getConfig();
  return (
    <>
      <h1>Sign in</h1>
      <p>
        You sign in with your {allowedDomain} Google account. You also need to be on the roster for
        a section that is using the simulation.
      </p>
      <p>
        {/* A plain link, so nothing fetches it ahead of time. */}
        <a className="button" href="/auth/start">
          Sign in with Google
        </a>
      </p>
      <p>
        The simulation does not keep your name or your email address. It knows you by a student code
        from your instructor.
      </p>
    </>
  );
}
