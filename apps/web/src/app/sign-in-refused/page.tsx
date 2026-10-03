import { getConfig } from '../../server/context';

function explain(reason: string | undefined, domain: string): string {
  switch (reason) {
    case 'domain':
      return `That Google account is not an ${domain} account. Sign in again and choose your ${domain} account. A personal Gmail account will not work.`;
    case 'unverified':
      return 'Google has not verified the email address on that account, so it cannot be used here.';
    case 'cancelled':
      return 'You left the Google sign-in before it finished.';
    default:
      return 'The sign-in did not finish. It may have taken too long, or been started in another browser. Try again.';
  }
}

export default async function SignInRefusedPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reason } = await searchParams;
  const { allowedDomain } = getConfig();
  return (
    <>
      <h1>You are not signed in</h1>
      <p>{explain(typeof reason === 'string' ? reason : undefined, allowedDomain)}</p>
      <p>
        <a href="/login">Back to sign in</a>
      </p>
    </>
  );
}
