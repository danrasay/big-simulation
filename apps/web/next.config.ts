import { join } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The engine is consumed as TypeScript source from the workspace.
  transpilePackages: ['@big-simulation/engine'],
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
  poweredByHeader: false,
  experimental: {
    // Lets a page answer 403 with forbidden(). If this flag is ever removed,
    // forbidden() throws and the page fails closed: no instructor data renders.
    authInterrupts: true,
  },
  // Next.js is async here by contract, even with nothing to await.
  // eslint-disable-next-line @typescript-eslint/require-await
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
