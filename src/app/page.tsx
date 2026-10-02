import { ArrowRight, BarChart3, Link2, MessageCircle } from "lucide-react";
import Link from "next/link";
import { Logo, primaryButtonClass } from "@/components/ui";

const STEPS = [
  {
    icon: Link2,
    title: "Make a link",
    body: "Add a product, three questions and a reward. It takes about two minutes.",
  },
  {
    icon: MessageCircle,
    title: "Share it anywhere",
    body: "Followers tap it and have a one-minute conversation with EDNA, by voice or text.",
  },
  {
    icon: BarChart3,
    title: "See what they think",
    body: "Sentiment, purchase intent, price expectations and the reasons behind them.",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5">
      <header className="flex h-16 items-center justify-between">
        <Logo className="text-lg" />
        <Link href="/login" className="text-sm font-semibold underline-offset-4 hover:underline">
          Log in
        </Link>
      </header>

      <main className="flex flex-1 flex-col justify-center py-12">
        <p className="text-sm font-semibold text-accent-ink">For merchants, designers and creators</p>
        <h1 className="mt-3 max-w-3xl text-[2.6rem] leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
          Ask your audience. Reward them for answering.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-snug text-ink-soft">
          DAP Link turns one shareable link into a one-minute customer interview. People tell you what
          they really think and get a discount code; you get answers you can act on.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/signup" className={`${primaryButtonClass} h-12 px-6 text-base`}>
            Create your link
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>

        <ol className="mt-16 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <step.icon className="size-5 text-accent-ink" aria-hidden="true" />
              <h2 className="mt-3 font-semibold">
                {index + 1}. {step.title}
              </h2>
              <p className="mt-1 text-[15px] leading-snug text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </main>

      <footer className="py-6 text-[13px] text-muted">
        Participants always see what is collected and agree before they start.
      </footer>
    </div>
  );
}
