import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-8 text-center">
      <p className="text-sm font-medium text-muted">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">We couldn&apos;t find that link</h1>
      <p className="mt-2 text-[15px] leading-snug text-ink-soft">
        It may have been removed, or the address might be mistyped.
      </p>
      <Link href="/" className="mt-6 text-sm font-semibold underline underline-offset-4">
        Go to DAP Link
      </Link>
    </main>
  );
}
