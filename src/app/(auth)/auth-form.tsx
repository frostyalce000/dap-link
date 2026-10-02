"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, inputClass, primaryButtonClass } from "@/components/ui";
import { login, signup, type AuthState } from "./actions";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    mode === "signup" ? signup : login,
    {},
  );

  return (
    <form action={action} className="space-y-4">
      {mode === "signup" && (
        <Field label="Brand or creator name" htmlFor="brandName" hint="Shown to people who open your links.">
          <input
            id="brandName"
            name="brandName"
            required
            maxLength={60}
            autoComplete="organization"
            defaultValue={state.fields?.brandName}
            placeholder="Studio North"
            className={inputClass}
          />
        </Field>
      )}
      <Field label="Email" htmlFor="email">
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={state.fields?.email}
          placeholder="you@brand.com"
          className={inputClass}
        />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        hint={mode === "signup" ? "At least 8 characters." : undefined}
      >
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          maxLength={72}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className={inputClass}
        />
      </Field>

      {state.error && (
        <p className="rounded-xl bg-bad-soft px-3.5 py-2.5 text-sm text-bad" role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className={`${primaryButtonClass} h-12 w-full`}>
        {pending
          ? mode === "signup"
            ? "Creating your account…"
            : "Logging in…"
          : mode === "signup"
            ? "Create account"
            : "Log in"}
      </button>

      <p className="text-center text-sm text-muted">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-ink underline underline-offset-4">
              Log in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="font-semibold text-ink underline underline-offset-4">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
