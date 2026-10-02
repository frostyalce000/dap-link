import type { Metadata } from "next";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 mb-6 text-[15px] text-ink-soft">Log in to see what your customers are saying.</p>
      <AuthForm mode="login" />
    </>
  );
}
