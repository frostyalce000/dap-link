import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "@/app/(auth)/actions";
import { Logo } from "@/components/ui";
import { requireMerchant } from "@/lib/auth";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const merchant = await requireMerchant();
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-5">
          <Link href="/dashboard">
            <Logo />
          </Link>
          <div className="flex min-w-0 items-center gap-4 text-sm">
            <span className="truncate text-muted">{merchant.brandName}</span>
            <form action={logout}>
              <button type="submit" className="font-medium underline-offset-4 hover:underline">
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">{children}</main>
    </>
  );
}
