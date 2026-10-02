/**
 * End-to-end smoke test of the typed interview against a running server.
 * Plays a participant through a whole campaign and prints what happened.
 *
 *   node scripts/smoke-text-interview.mjs [baseUrl] [slug] [email]
 */
const base = process.argv[2] ?? "http://localhost:3000";
const slug = process.argv[3] ?? "studio-north-hoodie";
const email = process.argv[4] ?? `smoke+${Date.now()}@example.com`;

const answers = [
  "Honestly I love how heavy it looks, the oat colour is really nice. Not sure about the fit though.",
  "Probably around 70 dollars? 95 feels like a lot for a hoodie.",
  "If it came in a cropped fit and there was free returns I'd buy it.",
  "Yeah mostly the price.",
  "No that's everything.",
];

async function post(path, body, token) {
  const started = Date.now();
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, ms: Date.now() - started };
}

const start = await post("/api/public/sessions", {
  slug,
  mode: "text",
  consent: { version: "smoke", responses: true, aiAnalysis: true, approximateLocation: true },
  source: "smoke-test",
  referrer: null,
});
console.log("start", start.status, `${start.ms}ms`);
if (start.status !== 201) {
  console.log(start.data);
  process.exit(1);
}
const { sessionId, token, opening } = start.data;
console.log("EDNA:", opening.text);

let done = false;
for (const message of answers) {
  if (done) break;
  console.log("YOU: ", message);
  const reply = await post(
    `/api/public/sessions/${sessionId}/chat`,
    { clientTurnId: crypto.randomUUID(), message },
    token,
  );
  if (reply.status !== 200) {
    console.log("chat failed", reply.status, reply.data);
    process.exit(1);
  }
  console.log(`EDNA: ${reply.data.reply}  [q${reply.data.questionNumber} done=${reply.data.done} ${reply.ms}ms]`);
  done = reply.data.done;
}

const complete = await post(`/api/public/sessions/${sessionId}/complete`, { email }, token);
console.log("complete", complete.status, complete.data, `${complete.ms}ms`);
const again = await post(`/api/public/sessions/${sessionId}/complete`, { email }, token);
console.log("complete again (same code expected)", again.status, again.data?.code);
const wrongToken = await post(`/api/public/sessions/${sessionId}/complete`, { email }, "not-the-token");
console.log("wrong token (401 expected)", wrongToken.status);
console.log("sessionId", sessionId);
