"use client";

import { ArrowUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RequestError, sendChat, type SessionHandle, type Turn } from "./api";

type Message = { id: string; role: "assistant" | "user"; text: string };
type ChatBody = { clientTurnId: string; message: string } | { open: true };

type Props = {
  session: SessionHandle;
  /** First interviewer line, when the server already produced it. */
  opening: string | null;
  /** Turns from a voice call that was switched to typing part-way through. */
  history: Turn[];
  notice: string | null;
  onProgress: (questionNumber: number) => void;
  onAnswered: () => void;
  onDone: () => void;
};

/** The typed interview: a short chat with EDNA. */
export function TextInterview({ session, opening, history, notice, onProgress, onAnswered, onDone }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => [
    ...history.map((t) => ({ id: t.clientTurnId, role: t.role, text: t.text })),
    ...(opening ? [{ id: "opening", role: "assistant" as const, text: opening }] : []),
  ]);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(!opening);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  // The request that failed, kept so a retry reuses the same id and the server
  // can recognise it as the same message.
  const [failed, setFailed] = useState<ChatBody | null>(null);
  const openedRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const request = useCallback(
    async (body: ChatBody) => {
      setWaiting(true);
      setError(null);
      setFailed(null);
      try {
        const reply = await sendChat(session, body);
        setMessages((current) => [
          ...current,
          { id: `assistant-${current.length}`, role: "assistant", text: reply.reply },
        ]);
        if (reply.questionNumber) onProgress(reply.questionNumber);
        if (reply.done) {
          setFinished(true);
          // Leave the thank-you on screen long enough to read.
          setTimeout(onDone, 1400);
        }
      } catch (err) {
        if (err instanceof RequestError && err.code === "already_completed") {
          onDone();
          return;
        }
        setError(err instanceof RequestError ? err.message : "Something went wrong. Please try again.");
        setFailed(body);
      } finally {
        setWaiting(false);
      }
    },
    [onDone, onProgress, session],
  );

  useEffect(() => {
    if (opening || openedRef.current) return;
    openedRef.current = true;
    void request({ open: true });
  }, [opening, request]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, waiting, error]);

  const submit = () => {
    const message = draft.trim();
    if (!message || waiting || finished) return;
    setDraft("");
    if (inputRef.current) inputRef.current.style.height = "";
    setMessages((current) => [...current, { id: `user-${current.length}`, role: "user", text: message }]);
    onAnswered();
    void request({ clientTurnId: crypto.randomUUID(), message });
    inputRef.current?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-2.5 overflow-y-auto px-5 pt-2 pb-4" aria-live="polite">
        {notice && (
          <p className="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">{notice}</p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex animate-rise ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <p
              className={`max-w-[85%] rounded-3xl px-4 py-2.5 text-[15px] leading-snug whitespace-pre-wrap ${
                message.role === "user"
                  ? "rounded-br-lg bg-ink text-paper"
                  : "rounded-bl-lg bg-surface text-ink shadow-[0_1px_0_var(--color-line)]"
              }`}
            >
              {message.text}
            </p>
          </div>
        ))}
        {waiting && (
          <div className="flex justify-start" role="status" aria-label="EDNA is typing">
            <div className="flex gap-1 rounded-3xl rounded-bl-lg bg-surface px-4 py-3.5 shadow-[0_1px_0_var(--color-line)]">
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="size-1.5 animate-dots rounded-full bg-muted"
                  style={{ animationDelay: `${dot * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad" role="alert">
            <p>{error}</p>
            {failed && (
              <button
                type="button"
                className="mt-1 font-semibold underline underline-offset-2"
                onClick={() => void request(failed)}
              >
                Try again
              </button>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-line bg-paper px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor="answer" className="sr-only">
          Your answer
        </label>
        <textarea
          id="answer"
          ref={inputRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            // Grows with the text where CSS field-sizing isn't supported (Safari).
            const box = event.target;
            box.style.height = "auto";
            box.style.height = `${Math.min(box.scrollHeight, 128)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={1000}
          disabled={finished}
          placeholder={finished ? "All done" : "Type your answer…"}
          // 16px text stops iOS zooming the page when the field is focused.
          className="max-h-32 min-h-12 flex-1 resize-none rounded-3xl border border-line-strong bg-surface px-4 py-3 text-base leading-snug outline-none placeholder:text-muted focus:border-ink [field-sizing:content]"
        />
        <button
          type="submit"
          disabled={!draft.trim() || waiting || finished}
          aria-label="Send"
          className="grid size-12 shrink-0 place-items-center rounded-full bg-ink text-paper transition disabled:opacity-30"
        >
          <ArrowUp className="size-5" strokeWidth={2.5} />
        </button>
      </form>
    </div>
  );
}
