import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { currentUser } from '../server/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'The Big Simulation',
  description: 'A financial statement analysis simulation.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { colorScheme: 'only light' };

// Every page depends on who is signed in, so nothing is rendered ahead of time.
export const dynamic = 'force-dynamic';

async function Header() {
  const user = await currentUser();
  return (
    <header className="site-header">
      <a className="site-title" href="/">
        The Big Simulation
      </a>
      {user === undefined ? null : (
        <form action="/auth/signout" method="post">
          <span>
            {user.studentCode === null ? 'Instructor' : `Student code ${user.studentCode}`}
            {user.role === 'instructor' && user.studentCode !== null ? ' (instructor)' : ''}
          </span>
          <button type="submit">Sign out</button>
        </form>
      )}
    </header>
  );
}

/** Credit to the source project. Required on every page by its CC BY 4.0 license. */
function Footer() {
  return (
    <footer className="site-footer">
      Adapted from{' '}
      <a href="https://cupola.gettysburg.edu/oer/13">
        Financial Statement Analysis Project: &ldquo;The Big Simulation&rdquo;
      </a>{' '}
      by Luna Y. Goldblatt, João Branco Chaves, Andrew M. Landman, Salmin B. Mwinjuma and Braden C.
      Vitelli, Gettysburg College, 2022, licensed under{' '}
      <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. This version changes the
      original: the project was rebuilt as a web application. Not affiliated with or endorsed by the
      authors, Gettysburg College, Best Buy or NVIDIA.
    </footer>
  );
}

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
