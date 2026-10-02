import type { Metadata } from "next";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create your account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your DAP Link</h1>
      <p className="mt-1 mb-6 text-[15px] text-ink-soft">
        Your first link takes about two minutes.
      </p>
      <AuthForm mode="signup" />
    </>
  );
}
