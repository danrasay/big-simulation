import { getConfig } from '../../server/context';

export default function NotOnRosterPage() {
  const { allowedDomain } = getConfig();
  return (
    <>
      <h1>You are not on the roster</h1>
      <p>
        You signed in with an {allowedDomain} account, but that account is not on the roster for a
        section that is using the simulation.
      </p>
      <p>
        If you are enrolled, ask your instructor to add you. Nothing about your account was saved.
      </p>
      <p>
        <a href="/login">Back to sign in</a>
      </p>
    </>
  );
}
