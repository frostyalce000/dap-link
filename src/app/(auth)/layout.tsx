import Link from "next/link";
import { Logo } from "@/components/ui";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-12">
      <Link href="/" className="mb-8 self-start">
        <Logo className="text-lg" />
      </Link>
      {children}
    </main>
  );
}
