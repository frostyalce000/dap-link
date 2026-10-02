"use client";

import { Check, ChevronDown, Copy, Gift, Keyboard, Mic } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CONSENT_VERSION } from "@/lib/consent";
import {
  RequestError,
  completeSession,
  startSession,
  type RewardResult,
  type SessionHandle,
  type Turn,
  type VoiceSecret,
} from "./api";
import { Orb } from "./orb";
import { TextInterview } from "./text-interview";
import {
  requestMicrophone,
  useVoiceInterview,
  voiceSupported,
  type VoiceEndReason,
  type VoiceFailure,
} from "./use-voice-interview";

export type ExperienceProps = {
  slug: string;
  brandName: string;
  productName: string;
  productDescription: string;
  productImageUrl: string | null;
  rewardHeadline: string;
  questions: string[];
  interviewerName: string;
  voiceMaxSeconds: number;
  maxFollowUps: number;
};

type Stage = "intro" | "voice" | "text" | "email" | "reward";
type StoredReward = RewardResult & { email: string };

const FAILURE_NOTICES: Record<VoiceFailure, string> = {
  "mic-denied": "No microphone access, so let's do this by typing instead.",
  "mic-unavailable": "We couldn't find a microphone, so let's do this by typing instead.",
  unsupported: "Voice isn't supported in this browser, so let's do this by typing instead.",
  connection: "The voice connection dropped. Carry on by typing; nothing you said was lost.",
};

/** Remembers a claimed reward on this device so a return visit shows the code again. */
function useStoredReward(slug: string) {
  const key = `dap-link:reward:${slug}`;
  const raw = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      return () => window.removeEventListener("storage", onChange);
    },
    () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );
  let stored: StoredReward | null = null;
  if (raw) {
    try {
      stored = JSON.parse(raw) as StoredReward;
    } catch {
      stored = null;
    }
  }
  const store = (reward: StoredReward) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(reward));
    } catch {
      // Private browsing: the reward is still shown, just not remembered.
    }
  };
  return { stored, store };
}

export function Experience(props: ExperienceProps) {
  const [stage, setStage] = useState<Stage>("intro");
  const [session, setSession] = useState<SessionHandle | null>(null);
  const [microphone, setMicrophone] = useState<Promise<MediaStream> | null>(null);
  const [voiceSecret, setVoiceSecret] = useState<VoiceSecret | null>(null);
  const [starting, setStarting] = useState<"voice" | "text" | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [shareLocation, setShareLocation] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const [history, setHistory] = useState<Turn[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [questionNumber, setQuestionNumber] = useState(1);
  const [reward, setReward] = useState<StoredReward | null>(null);
  const { stored, store } = useStoredReward(props.slug);

  const begin = async (mode: "voice" | "text") => {
    if (starting) return;
    setStartError(null);
    setStarting(mode);
    // The permission prompt has to be triggered by the tap itself, so it is
    // requested here, before any network round trip.
    const mic = mode === "voice" ? requestMicrophone() : null;
    mic?.catch(() => {});
    try {
      const params = new URLSearchParams(window.location.search);
      const result = await startSession({
        slug: props.slug,
        mode,
        consent: {
          version: CONSENT_VERSION,
          responses: true,
          aiAnalysis: true,
          approximateLocation: shareLocation,
        },
        source: params.get("src") ?? params.get("utm_source"),
        referrer: document.referrer || null,
      });
      setSession({ sessionId: result.sessionId, token: result.token });
      if (mode === "voice") {
        setMicrophone(mic);
        setVoiceSecret(result.voice);
        setStage("voice");
      } else {
        setOpening(result.opening?.text ?? null);
        setStage("text");
      }
    } catch (err) {
      mic?.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => {});
      setStartError(
        err instanceof RequestError ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setStarting(null);
    }
  };

  const switchToText = useCallback((turns: Turn[], message: string | null) => {
    setHistory(turns);
    setOpening(null);
    setNotice(message);
    setStage("text");
  }, []);

  const shownReward = reward ?? (stage === "intro" ? stored : null);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-paper sm:my-6 sm:min-h-[calc(100dvh-3rem)] sm:overflow-hidden sm:rounded-[2rem] sm:border sm:border-line sm:shadow-xl">
      {shownReward ? (
        <RewardScreen {...props} reward={shownReward} returning={!reward} />
      ) : stage === "intro" ? (
        <Intro
          {...props}
          starting={starting}
          error={startError}
          shareLocation={shareLocation}
          onShareLocation={setShareLocation}
          onBegin={begin}
        />
      ) : (
        <>
          {stage !== "email" && (
            <InterviewHeader
              productName={props.productName}
              productImageUrl={props.productImageUrl}
              questionNumber={questionNumber}
              questionCount={props.questions.length}
            />
          )}
          {stage === "voice" && session && microphone && (
            <VoiceStage
              session={session}
              secret={voiceSecret}
              microphone={microphone}
              interviewerName={props.interviewerName}
              questions={props.questions}
              maxFollowUps={props.maxFollowUps}
              maxSeconds={props.voiceMaxSeconds}
              onProgress={setQuestionNumber}
              onFailed={(reason, turns) => switchToText(turns, FAILURE_NOTICES[reason])}
              onEnded={(reason, turns) => {
                if (reason === "switch") switchToText(turns, null);
                else setStage("email");
              }}
            />
          )}
          {stage === "text" && session && (
            <TextInterview
              session={session}
              opening={opening}
              history={history}
              notice={notice}
              onProgress={setQuestionNumber}
              onAnswered={() => {}}
              onDone={() => setStage("email")}
            />
          )}
          {stage === "email" && session && (
            <EmailStage
              {...props}
              session={session}
              onBack={() => switchToText([], "Answer at least one question to unlock your reward.")}
              onReward={(result) => {
                store(result);
                setReward(result);
                setStage("reward");
              }}
            />
          )}
        </>
      )}
    </main>
  );
}

function Intro(
  props: ExperienceProps & {
    starting: "voice" | "text" | null;
    error: string | null;
    shareLocation: boolean;
    onShareLocation: (value: boolean) => void;
    onBegin: (mode: "voice" | "text") => void;
  },
) {
  // Resolved after hydration so the server and first client render agree.
  const canUseVoice = useSyncExternalStore(
    () => () => {},
    () => voiceSupported(),
    () => true,
  );
  const count = props.questions.length;

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative aspect-[5/4] w-full overflow-hidden bg-line sm:rounded-t-[2rem]">
        {props.productImageUrl ? (
          <Image
            src={props.productImageUrl}
            alt={props.productName}
            fill
            priority
            sizes="(max-width: 448px) 100vw, 448px"
            className="object-cover"
          />
        ) : (
          <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_30%_20%,#ffe1d6,#f6efe4_60%)] px-8 text-center text-3xl font-semibold tracking-tight text-ink/80">
            {props.productName}
          </div>
        )}
        <div className="absolute top-4 left-4 rounded-full bg-paper/90 px-3 py-1.5 text-xs font-medium text-ink backdrop-blur">
          {props.brandName}
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="inline-flex items-center gap-1.5 self-start rounded-full bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent-ink">
          <Gift className="size-4" aria-hidden="true" />
          {props.rewardHeadline}
        </div>
        <h1 className="mt-3 text-[1.7rem] leading-[1.15] font-semibold tracking-tight text-balance">
          Tell us what you think of {props.productName}
        </h1>
        <p className="mt-2 text-[15px] leading-snug text-ink-soft">
          {count === 1 ? "One quick question" : `${count} quick questions`}, about a minute. Your
          reward code appears as soon as you finish.
        </p>
        {props.productDescription && (
          <p className="mt-2 line-clamp-2 text-sm leading-snug text-muted">{props.productDescription}</p>
        )}

        <div className="mt-auto pt-6">
          {props.error && (
            <p className="mb-3 rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad" role="alert">
              {props.error}
            </p>
          )}

          {canUseVoice && (
            <button
              type="button"
              onClick={() => props.onBegin("voice")}
              disabled={props.starting !== null}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-ink text-base font-semibold text-paper transition active:scale-[0.98] disabled:opacity-60"
            >
              <Mic className="size-5" aria-hidden="true" />
              {props.starting === "voice" ? "Starting…" : "Start talking"}
            </button>
          )}
          <button
            type="button"
            onClick={() => props.onBegin("text")}
            disabled={props.starting !== null}
            className={
              canUseVoice
                ? "mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-medium text-ink-soft transition active:scale-[0.98] disabled:opacity-60"
                : "flex h-14 w-full items-center justify-center gap-2 rounded-full bg-ink text-base font-semibold text-paper transition active:scale-[0.98] disabled:opacity-60"
            }
          >
            <Keyboard className="size-5" aria-hidden="true" />
            {props.starting === "text" ? "Starting…" : canUseVoice ? "I'd rather type" : "Start"}
          </button>

          <details className="group mt-3 text-xs leading-relaxed text-muted">
            <summary className="cursor-pointer list-none text-center [&::-webkit-details-marker]:hidden">
              By starting, you agree to share your answers, email and approximate location with{" "}
              {props.brandName}. Your voice isn&apos;t recorded.{" "}
              <span className="inline-flex items-center gap-0.5 font-medium text-ink-soft underline underline-offset-2">
                Details
                <ChevronDown className="size-3 transition group-open:rotate-180" aria-hidden="true" />
              </span>
            </summary>
            <div className="mt-3 space-y-2 rounded-2xl border border-line bg-surface p-4 text-[13px] text-ink-soft">
              <p>
                <strong className="font-semibold text-ink">Your answers.</strong> A written transcript
                of this conversation is saved. If you use voice, your speech is turned into text as you
                talk and the audio itself is not stored.
              </p>
              <p>
                <strong className="font-semibold text-ink">AI analysis.</strong> {props.interviewerName},
                an AI, asks the questions, and AI summarises your answers for {props.brandName}.
              </p>
              <p>
                <strong className="font-semibold text-ink">Your email.</strong> Asked for at the end, to
                send your reward. It is shared with {props.brandName} alongside your answers.
              </p>
              <p>
                <strong className="font-semibold text-ink">Technical details.</strong> Your device type
                and the time. Your IP address itself is not stored, only a scrambled fingerprint of it
                that is used to prevent abuse.
              </p>
              <label className="flex items-start gap-2.5 border-t border-line pt-3">
                <input
                  type="checkbox"
                  checked={props.shareLocation}
                  onChange={(event) => props.onShareLocation(event.target.checked)}
                  className="mt-0.5 size-4 accent-ink"
                />
                <span>
                  <strong className="font-semibold text-ink">Approximate location.</strong> Your city
                  and country, estimated from your connection. Never your precise location. Untick to
                  leave this out.
                </span>
              </label>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function InterviewHeader(props: {
  productName: string;
  productImageUrl: string | null;
  questionNumber: number;
  questionCount: number;
}) {
  const current = Math.min(Math.max(props.questionNumber, 1), props.questionCount);
  return (
    <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
      <div className="flex items-center gap-3">
        <div className="relative size-10 shrink-0 overflow-hidden rounded-xl bg-line">
          {props.productImageUrl && (
            <Image src={props.productImageUrl} alt="" fill sizes="40px" className="object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{props.productName}</h1>
          <p className="text-xs text-muted">
            Question {current} of {props.questionCount}
          </p>
        </div>
      </div>
      <div
        className="mt-3 flex gap-1.5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={props.questionCount}
        aria-valuenow={current}
        aria-label="Interview progress"
      >
        {Array.from({ length: props.questionCount }, (_, index) => (
          <span
            key={index}
            className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
              index < current ? "bg-ink" : "bg-line-strong"
            }`}
          />
        ))}
      </div>
    </header>
  );
}

function VoiceStage(props: {
  session: SessionHandle;
  secret: VoiceSecret | null;
  microphone: Promise<MediaStream>;
  interviewerName: string;
  questions: string[];
  maxFollowUps: number;
  maxSeconds: number;
  onProgress: (questionNumber: number) => void;
  onEnded: (reason: VoiceEndReason, turns: Turn[]) => void;
  onFailed: (reason: VoiceFailure, turns: Turn[]) => void;
}) {
  const {
    audioRef,
    status,
    activity,
    assistantCaption,
    userCaption,
    questionNumber,
    answerCount,
    start,
    end,
    getLevel,
  } = useVoiceInterview({
    questions: props.questions,
    maxFollowUps: props.maxFollowUps,
    maxSeconds: props.maxSeconds,
    onEnded: props.onEnded,
    onFailed: props.onFailed,
  });
  const { session, secret, microphone, onProgress } = props;

  useEffect(() => {
    void start(session, secret, microphone);
  }, [start, session, secret, microphone]);

  useEffect(() => {
    onProgress(questionNumber);
  }, [onProgress, questionNumber]);

  const connecting = status === "idle" || status === "connecting";
  const label = connecting
    ? `Connecting you to ${props.interviewerName}…`
    : status === "ended"
      ? "All done"
      : activity === "speaking"
        ? `${props.interviewerName} is speaking`
        : activity === "hearing"
          ? "Listening…"
          : activity === "thinking"
            ? "One moment…"
            : "Your turn. Go ahead.";

  return (
    <div className="flex flex-1 flex-col">
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      <div className="flex flex-1 flex-col items-center px-6 pt-4 text-center">
        <Orb activity={connecting ? "connecting" : activity} getLevel={getLevel} />
        <p className="mt-3 text-sm font-medium text-muted" role="status">
          {label}
        </p>
        <p
          className="mt-5 min-h-[5.5rem] text-[1.35rem] leading-snug font-medium tracking-tight text-balance"
          aria-live="polite"
        >
          {connecting ? "Allow the microphone if your phone asks." : assistantCaption}
        </p>
        {userCaption && (
          <p className="mt-4 animate-rise rounded-3xl bg-surface px-4 py-2.5 text-[15px] leading-snug text-ink-soft shadow-[0_1px_0_var(--color-line)]">
            <span className="sr-only">You said: </span>“{userCaption}”
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => end("switch")}
          className="flex h-12 items-center gap-2 rounded-full px-4 text-[15px] font-medium text-ink-soft"
        >
          <Keyboard className="size-5" aria-hidden="true" />
          Type instead
        </button>
        {answerCount > 0 && (
          <button
            type="button"
            onClick={() => end("user")}
            className="h-12 rounded-full border border-line-strong bg-surface px-5 text-[15px] font-semibold"
          >
            Finish
          </button>
        )}
      </div>
    </div>
  );
}

function EmailStage(
  props: ExperienceProps & {
    session: SessionHandle;
    onReward: (reward: StoredReward) => void;
    onBack: () => void;
  },
) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; noAnswers: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await completeSession(props.session, email.trim());
      props.onReward({ ...result, email: email.trim() });
    } catch (err) {
      const requestError = err instanceof RequestError ? err : null;
      setError({
        message:
          requestError?.code === "invalid_request"
            ? "That email doesn't look right. Please check it."
            : (requestError?.message ?? "Something went wrong. Please try again."),
        noAnswers: requestError?.code === "no_answers",
      });
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 animate-rise flex-col px-5 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="grid size-14 place-items-center rounded-full bg-good-soft text-good">
        <Check className="size-7" strokeWidth={2.5} aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-[1.7rem] leading-[1.15] font-semibold tracking-tight text-balance">
        Thank you. Your reward is ready.
      </h1>
      <p className="mt-2 text-[15px] leading-snug text-ink-soft">
        Enter your email to see your code for <strong className="font-semibold">{props.rewardHeadline}</strong>.
        We&apos;ll send you a copy too.
      </p>

      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          ref={inputRef}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="mt-1.5 h-14 w-full rounded-2xl border border-line-strong bg-surface px-4 text-base outline-none placeholder:text-muted focus:border-ink"
        />
        {error && (
          <div className="mt-3 rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad" role="alert">
            <p>{error.message}</p>
            {error.noAnswers && (
              <button type="button" onClick={props.onBack} className="mt-1 font-semibold underline underline-offset-2">
                Answer a question
              </button>
            )}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-ink text-base font-semibold text-paper transition active:scale-[0.98] disabled:opacity-50"
        >
          <Gift className="size-5" aria-hidden="true" />
          {submitting ? "Getting your code…" : "Show my code"}
        </button>
      </form>
      <p className="mt-3 text-center text-xs leading-relaxed text-muted">
        Used to send your reward and shared with {props.brandName} with your answers. No marketing
        emails from this.
      </p>
    </div>
  );
}

function RewardScreen(props: ExperienceProps & { reward: StoredReward; returning: boolean }) {
  const [copied, setCopied] = useState(false);
  const { reward } = props;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reward.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the code is selectable on screen.
    }
  };

  return (
    <div className="flex flex-1 flex-col px-5 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="grid size-14 animate-pop place-items-center rounded-full bg-accent-soft text-accent-ink">
        <Gift className="size-7" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-[1.7rem] leading-[1.15] font-semibold tracking-tight text-balance">
        {props.returning || reward.alreadyClaimed ? "You've already claimed this one" : "Here's your code"}
      </h1>
      <p className="mt-2 text-[15px] leading-snug text-ink-soft">
        {props.returning || reward.alreadyClaimed
          ? `Here's the code you got from ${props.brandName}.`
          : `Thanks for helping ${props.brandName}. Enjoy.`}
      </p>

      <div className="mt-6 animate-pop rounded-[1.5rem] border-[1.5px] border-dashed border-ink bg-surface p-5 text-center">
        <p className="text-sm font-semibold text-accent-ink">{reward.rewardHeadline}</p>
        <p className="mt-2 font-mono text-[1.75rem] font-bold tracking-wider break-all select-all">
          {reward.code}
        </p>
        <button
          type="button"
          onClick={copy}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-[15px] font-semibold text-paper transition active:scale-[0.98]"
        >
          {copied ? <Check className="size-5" aria-hidden="true" /> : <Copy className="size-5" aria-hidden="true" />}
          <span aria-live="polite">{copied ? "Copied" : "Copy code"}</span>
        </button>
      </div>

      {reward.instructions && (
        <p className="mt-4 text-center text-sm leading-snug text-ink-soft">{reward.instructions}</p>
      )}
      {reward.emailQueued && !props.returning && (
        <p className="mt-3 text-center text-sm leading-snug text-muted">
          A copy is on its way to {reward.email}.
        </p>
      )}

      <p className="mt-auto pt-8 text-center text-xs text-muted">
        Powered by <span className="font-semibold text-ink-soft">DAP Link</span>
      </p>
    </div>
  );
}
