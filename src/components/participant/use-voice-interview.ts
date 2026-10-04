"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveTurns, type SessionHandle, type Turn, type VoiceSecret } from "./api";

export type VoiceStatus = "idle" | "connecting" | "live" | "ended" | "failed";
export type VoiceActivity = "speaking" | "listening" | "hearing" | "thinking";
export type VoiceFailure = "mic-denied" | "mic-unavailable" | "unsupported" | "connection";
export type VoiceEndReason = "completed" | "timeout" | "user" | "switch";

type Options = {
  /** The merchant's questions, used to follow where the interview has got to. */
  questions: string[];
  /** Most follow-up questions the interviewer may ask. */
  maxFollowUps: number;
  /** Longest a call may run before it is wrapped up automatically. */
  maxSeconds: number;
  onEnded: (reason: VoiceEndReason, turns: Turn[]) => void;
  onFailed: (reason: VoiceFailure, turns: Turn[]) => void;
};

type RealtimeEvent = { type: string; [key: string]: unknown };
type OutputItem = { type: string; name?: string; call_id?: string; arguments?: string };

const CONNECT_TIMEOUT_MS = 15_000;

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Which merchant question an interviewer utterance is asking, if any.
 *
 * The model is asked to report its progress with a tool call, but it does not
 * always do so. Comparing what it actually said with the questions gives a
 * second signal that does not depend on the model remembering.
 */
export function matchQuestion(utterance: string, questions: string[]): number | null {
  const spoken = new Set(words(utterance));
  let best: { number: number; score: number } | null = null;
  questions.forEach((question, index) => {
    const wanted = words(question);
    if (wanted.length === 0) return;
    const score = wanted.filter((word) => spoken.has(word)).length / wanted.length;
    if (score >= 0.6 && (!best || score > best.score)) best = { number: index + 1, score };
  });
  return (best as { number: number; score: number } | null)?.number ?? null;
}

export function voiceSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.RTCPeerConnection === "function" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Asks for the microphone. Call directly from a tap so the browser allows it. */
export function requestMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

/**
 * Runs a live voice interview over WebRTC with the OpenAI Realtime API.
 *
 * The browser streams microphone audio straight to OpenAI and plays the
 * interviewer's audio back, using a short-lived secret from our server. Events
 * arriving on the data channel drive the captions, the progress indicator and
 * the saved transcript.
 */
export function useVoiceInterview(options: Options) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [activity, setActivity] = useState<VoiceActivity>("thinking");
  const [assistantCaption, setAssistantCaption] = useState("");
  const [userCaption, setUserCaption] = useState("");
  const [questionNumber, setQuestionNumber] = useState(1);
  const [answerCount, setAnswerCount] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<SessionHandle | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Transcript bookkeeping. Each conversation item gets its position the
  // first time it is seen, because the text of a turn can arrive later than
  // the turn that follows it (speech transcription runs in the background).
  const nextSeqRef = useRef(0);
  const itemSeqRef = useRef(new Map<string, number>());
  const turnsRef = useRef(new Map<string, Turn>());
  const unsavedRef = useRef(new Map<string, Turn>());
  const savingRef = useRef<Promise<void>>(Promise.resolve());
  const awaitingTranscriptRef = useRef(new Set<string>());
  const assistantItemRef = useRef<string | null>(null);
  const userItemRef = useRef<string | null>(null);

  // Where the interview has got to, kept in refs so event handlers always
  // see the latest values.
  const questionRef = useRef(1);
  const answerCountRef = useRef(0);
  const answersWhenLastAskedRef = useRef<number | null>(null);
  const lastAssistantTextRef = useRef("");

  const startedRef = useRef(false);
  const overRef = useRef(false);
  const finishingRef = useRef(false);
  const playingRef = useRef(false);
  const playedResponsesRef = useRef(new Set<string>());

  const seqFor = (itemId: string) => {
    let seq = itemSeqRef.current.get(itemId);
    if (seq === undefined) {
      seq = nextSeqRef.current++;
      itemSeqRef.current.set(itemId, seq);
    }
    return seq;
  };

  const allTurns = () => [...turnsRef.current.values()].sort((a, b) => a.seq - b.seq);

  /** Moves the progress indicator forward; it never goes backwards. */
  const advanceTo = (number: number) => {
    const total = optionsRef.current.questions.length;
    const next = Math.min(number, total);
    if (next > questionRef.current) {
      questionRef.current = next;
      setQuestionNumber(next);
    }
    if (questionRef.current >= total && answersWhenLastAskedRef.current === null) {
      answersWhenLastAskedRef.current = answerCountRef.current;
    }
  };

  /**
   * Whether the interviewer's last utterance was its sign-off. The model is
   * meant to call a tool to end the interview but sometimes just says goodbye,
   * which would leave the participant waiting. A statement with no question in
   * it, after the last question has been answered, is treated as the end.
   */
  const lookedLikeSignOff = () => {
    const { questions, maxFollowUps } = optionsRef.current;
    const text = lastAssistantTextRef.current;
    if (!text || /[?？]/.test(text)) return false;
    // A follow-up can be phrased as a request ("tell me more") rather than a question.
    if (/\b(tell me|could you|can you|would you|share|describe|explain|say more|what|why|how)\b/i.test(text)) return false;
    // The sign-off EDNA is asked to give thanks them and mentions the reward.
    if (!/(thank|reward|appreciate|gracias|merci|danke|obrigad)/i.test(text)) return false;
    const askedAt = answersWhenLastAskedRef.current;
    const lastQuestionAnswered = askedAt !== null && answerCountRef.current > askedAt;
    const everythingAnswered = answerCountRef.current >= questions.length + maxFollowUps;
    return lastQuestionAnswered || everythingAnswered;
  };

  /** Sends unsaved turns to the server. Failed turns stay queued for the next flush. */
  const flush = useCallback((): Promise<void> => {
    savingRef.current = savingRef.current.then(async () => {
      const session = sessionRef.current;
      const batch = [...unsavedRef.current.values()];
      if (!session || batch.length === 0) return;
      try {
        await saveTurns(session, batch);
        for (const turn of batch) {
          if (unsavedRef.current.get(turn.clientTurnId) === turn) {
            unsavedRef.current.delete(turn.clientTurnId);
          }
        }
      } catch {
        // Left in the queue; retried on the next flush.
      }
    });
    return savingRef.current;
  }, []);

  const recordTurn = useCallback(
    (itemId: string, role: Turn["role"], text: string) => {
      const clean = text.trim();
      if (!clean) return;
      const turn: Turn = { clientTurnId: itemId, seq: seqFor(itemId), role, text: clean };
      turnsRef.current.set(itemId, turn);
      unsavedRef.current.set(itemId, turn);
      void flush();
    },
    [flush],
  );

  const send = (event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") dc.send(JSON.stringify(event));
  };

  const teardown = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close().catch(() => {});
    dcRef.current = null;
    pcRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
    analyserRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
  }, []);

  const fail = useCallback(
    (reason: VoiceFailure) => {
      if (overRef.current) return;
      overRef.current = true;
      teardown();
      setStatus("failed");
      void flush().then(() => optionsRef.current.onFailed(reason, allTurns()));
    },
    [flush, teardown],
  );

  const end = useCallback(
    (reason: VoiceEndReason) => {
      if (overRef.current) return;
      overRef.current = true;
      // Stop listening straight away, but give a transcript that is still
      // being produced a moment to arrive before the connection closes.
      streamRef.current?.getTracks().forEach((track) => (track.enabled = false));
      setStatus("ended");
      const startedWaiting = Date.now();
      const settle = () => {
        if (awaitingTranscriptRef.current.size > 0 && Date.now() - startedWaiting < 2000) {
          timersRef.current.push(setTimeout(settle, 150));
          return;
        }
        teardown();
        void flush().then(() => optionsRef.current.onEnded(reason, allTurns()));
      };
      settle();
    },
    [flush, teardown],
  );

  const handleResponseDone = useCallback(
    (response: { id?: string; output?: OutputItem[] } | undefined) => {
      const output = response?.output ?? [];
      const calls = output.filter((item) => item.type === "function_call");
      if (calls.length === 0) return;
      const spoke = output.some((item) => item.type === "message");

      let finish = false;
      for (const call of calls) {
        if (call.name === "set_current_question") {
          try {
            const number = Number(JSON.parse(call.arguments ?? "{}").number);
            if (Number.isInteger(number) && number > 0) advanceTo(number);
          } catch {
            // Malformed arguments only affect the progress indicator.
          }
        }
        if (call.name === "finish_interview") finish = true;
        send({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: call.call_id, output: '{"ok":true}' },
        });
      }

      if (finish) {
        finishingRef.current = true;
        const goodbyeStillToPlay =
          playingRef.current || (spoke && !!response?.id && !playedResponsesRef.current.has(response.id));
        if (!goodbyeStillToPlay) {
          end("completed");
        } else {
          // Ends when playback stops; this is the fallback if that event is lost.
          timersRef.current.push(setTimeout(() => end("completed"), 12_000));
        }
      } else if (!spoke) {
        // The model reported progress without speaking; prompt it to carry on.
        send({ type: "response.create" });
      }
    },
    [end],
  );

  const handleEvent = useCallback(
    (event: RealtimeEvent) => {
      const itemId = typeof event.item_id === "string" ? event.item_id : null;
      switch (event.type) {
        case "input_audio_buffer.speech_started":
          setActivity("hearing");
          break;
        case "input_audio_buffer.speech_stopped":
          setActivity("thinking");
          break;
        case "input_audio_buffer.committed":
          if (itemId) {
            seqFor(itemId);
            awaitingTranscriptRef.current.add(itemId);
          }
          break;
        case "conversation.item.input_audio_transcription.delta":
          if (itemId && typeof event.delta === "string") {
            const delta = event.delta;
            if (userItemRef.current !== itemId) {
              userItemRef.current = itemId;
              setUserCaption(delta);
            } else {
              setUserCaption((previous) => previous + delta);
            }
          }
          break;
        case "conversation.item.input_audio_transcription.completed":
          if (itemId) {
            awaitingTranscriptRef.current.delete(itemId);
            const transcript = typeof event.transcript === "string" ? event.transcript.trim() : "";
            if (transcript) {
              userItemRef.current = itemId;
              setUserCaption(transcript);
              if (!turnsRef.current.has(itemId)) {
                answerCountRef.current += 1;
                setAnswerCount(answerCountRef.current);
              }
              recordTurn(itemId, "user", transcript);
            }
          }
          break;
        case "conversation.item.input_audio_transcription.failed":
          if (itemId) awaitingTranscriptRef.current.delete(itemId);
          break;
        case "response.output_audio_transcript.delta":
          if (itemId && typeof event.delta === "string") {
            const delta = event.delta;
            if (assistantItemRef.current !== itemId) {
              assistantItemRef.current = itemId;
              seqFor(itemId);
              setAssistantCaption(delta);
              setUserCaption("");
            } else {
              setAssistantCaption((previous) => previous + delta);
            }
          }
          break;
        case "response.output_audio_transcript.done":
          if (itemId && typeof event.transcript === "string") {
            assistantItemRef.current = itemId;
            lastAssistantTextRef.current = event.transcript;
            setAssistantCaption(event.transcript);
            recordTurn(itemId, "assistant", event.transcript);
            // Only trusted to move one question ahead: a follow-up that happens
            // to share words with a later question must not skip progress.
            const asked = matchQuestion(event.transcript, optionsRef.current.questions);
            if (asked && asked <= questionRef.current + 1) advanceTo(asked);
          }
          break;
        case "output_audio_buffer.started":
          playingRef.current = true;
          if (typeof event.response_id === "string") playedResponsesRef.current.add(event.response_id);
          setActivity("speaking");
          break;
        case "output_audio_buffer.stopped":
          if (!finishingRef.current && lookedLikeSignOff()) finishingRef.current = true;
        // falls through
        case "output_audio_buffer.cleared":
          playingRef.current = false;
          // If the participant has already started talking over the end of
          // the question, keep showing that they are being heard.
          setActivity((current) => (current === "hearing" ? current : "listening"));
          if (finishingRef.current) end("completed");
          break;
        case "response.done":
          handleResponseDone(event.response as { id?: string; output?: OutputItem[] } | undefined);
          break;
        case "error":
          console.warn("[voice] realtime error event");
          break;
      }
    },
    [end, handleResponseDone, recordTurn],
  );

  /**
   * Connects the call. `secret` comes from starting the session; `microphone`
   * is the pending permission request, started by the caller inside the tap
   * handler.
   */
  const start = useCallback(
    async (session: SessionHandle, secret: VoiceSecret | null, microphone: Promise<MediaStream>) => {
      if (startedRef.current) return;
      startedRef.current = true;
      sessionRef.current = session;
      setStatus("connecting");

      const [micResult] = await Promise.allSettled([microphone]);
      if (overRef.current) {
        if (micResult.status === "fulfilled") micResult.value.getTracks().forEach((t) => t.stop());
        return;
      }
      if (micResult.status === "rejected") {
        const name = micResult.reason instanceof DOMException ? micResult.reason.name : "";
        fail(name === "NotAllowedError" || name === "SecurityError" ? "mic-denied" : "mic-unavailable");
        return;
      }
      const stream = micResult.value;
      streamRef.current = stream;
      if (!secret) {
        fail("connection");
        return;
      }

      try {
        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        pc.ontrack = (event) => {
          const audio = audioRef.current;
          if (!audio) return;
          audio.srcObject = event.streams[0] ?? null;
          // Some browsers refuse to start audio on their own; the screen then
          // offers a button that starts it from a tap.
          void audio.play().then(() => setAudioBlocked(false), () => setAudioBlocked(true));
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed") fail("connection");
          // "disconnected" can recover by itself; give it a few seconds.
          if (pc.connectionState === "disconnected") {
            timersRef.current.push(
              setTimeout(() => {
                if (pc.connectionState === "disconnected" || pc.connectionState === "failed") fail("connection");
              }, 5000),
            );
          }
        };
        for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;
        dc.onmessage = (message) => {
          try {
            handleEvent(JSON.parse(message.data as string) as RealtimeEvent);
          } catch {
            // Ignore anything that is not a JSON event.
          }
        };
        // The other side closing the channel (the call ended or dropped) moves
        // the participant to typing instead of leaving them in silence.
        dc.onclose = () => {
          if (!overRef.current) fail("connection");
        };
        dc.onopen = () => {
          setStatus("live");
          // The interviewer speaks first.
          send({ type: "response.create" });
          timersRef.current.push(
            setTimeout(() => end("timeout"), optionsRef.current.maxSeconds * 1000),
          );
        };

        timersRef.current.push(
          setTimeout(() => {
            if (dc.readyState !== "open") fail("connection");
          }, CONNECT_TIMEOUT_MS),
        );

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const answer = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret.clientSecret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        });
        if (!answer.ok) throw new Error("call setup rejected");
        await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });

        // Microphone level for the listening animation. Purely cosmetic, so a
        // browser that refuses an AudioContext just gets a static orb.
        try {
          const context = new AudioContext();
          const analyser = context.createAnalyser();
          analyser.fftSize = 256;
          context.createMediaStreamSource(stream).connect(analyser);
          // Safari starts an AudioContext created outside a tap as suspended.
          void context.resume().catch(() => {});
          audioContextRef.current = context;
          analyserRef.current = analyser;
        } catch {
          // No level meter.
        }
      } catch {
        fail("connection");
      }
    },
    [end, fail, handleEvent],
  );

  /** Starts the interviewer's audio from a tap, when the browser blocked autoplay. */
  const resumeAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    void audio.play().then(() => setAudioBlocked(false), () => setAudioBlocked(true));
    void audioContextRef.current?.resume().catch(() => {});
  }, []);

  /** Current microphone loudness from 0 to 1, for animation. */
  const getLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const centred = (sample - 128) / 128;
      sum += centred * centred;
    }
    return Math.min(1, Math.sqrt(sum / samples.length) * 4);
  }, []);

  useEffect(() => {
    // Reset on mount: in development React mounts effects twice.
    overRef.current = false;
    return () => {
      overRef.current = true;
      teardown();
    };
  }, [teardown]);

  return {
    audioRef,
    status,
    activity,
    assistantCaption,
    userCaption,
    questionNumber,
    answerCount,
    audioBlocked,
    resumeAudio,
    start,
    end,
    getLevel,
  };
}
