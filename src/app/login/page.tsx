import Link from 'next/link';
import { sanitizeReturnTo } from '@/lib/auth/cookies';

interface PageProps {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}

export const metadata = {
  title: 'Sign in - Vane',
};

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = Array.isArray(params.returnTo)
    ? params.returnTo[0]
    : params.returnTo;
  const returnTo = sanitizeReturnTo(raw);
  const href = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <main className="min-h-screen flex items-center justify-center bg-light-primary dark:bg-dark-primary px-6">
      <div className="w-full max-w-sm flex flex-col items-center space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <h1 className="text-2xl font-medium text-black dark:text-white">
            Sign in to Vane
          </h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Use your PocketID account to continue.
          </p>
        </div>
        <Link
          href={href}
          className="w-full inline-flex items-center justify-center rounded-lg bg-light-200 dark:bg-dark-200 px-4 py-3 text-sm font-medium text-black dark:text-white border border-light-300 dark:border-dark-300 transition hover:bg-light-300 dark:hover:bg-dark-300"
        >
          Sign in with PocketID
        </Link>
      </div>
    </main>
  );
}
