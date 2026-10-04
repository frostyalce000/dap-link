"use client";

/**
 * Shown when a page fails unexpectedly, instead of the framework's default
 * error screen. Nothing about the error is displayed: it may contain data.
 */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-[15px] leading-snug text-ink-soft">
        That didn&apos;t load properly. Please try again in a moment.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 h-11 rounded-full bg-ink px-5 text-sm font-semibold text-paper"
      >
        Try again
      </button>
    </main>
  );
}
