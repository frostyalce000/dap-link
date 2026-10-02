/**
 * Concurrency test for the public link.
 *
 * Simulates many participants going through a campaign at once: start a
 * session, save an answer, claim the reward. Then checks the two things that
 * must hold under load: nobody gets an error, and nobody gets two codes.
 *
 *   node scripts/load-test.mjs [baseUrl] [slug] [participants] [concurrency]
 *
 * Each simulated participant triggers one AI analysis call after completing.
 */
const base = process.argv[2] ?? "http://localhost:3000";
const slug = process.argv[3] ?? "studio-north-hoodie";
const participants = Number(process.argv[4] ?? 50);
const concurrency = Number(process.argv[5] ?? 25);
const run = Date.now().toString(36);

const timings = { start: [], turns: [], complete: [] };
const failures = [];

async function post(step, path, body, headers = {}) {
  const started = performance.now();
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  timings[step].push(performance.now() - started);
  if (!response.ok) failures.push(`${step} ${response.status} ${data?.error?.code ?? ""}`);
  return { ok: response.ok, data };
}

const SAMPLE_ANSWERS = [
  "I love the colour but it looks a bit pricey to me.",
  "It looks really comfortable, I'd wear it every day.",
  "Not really my style, the fit looks too baggy.",
  "Nice quality. I'd pay about seventy dollars for it.",
  "I like it, but I'd want to see it in more colours first.",
];

async function participant(index, email) {
  // Each simulated person comes from their own address, as real traffic would.
  const ip = { "X-Forwarded-For": `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}` };
  const start = await post(
    "start",
    "/api/public/sessions",
    {
      slug,
      mode: "text",
      consent: { version: "load-test", responses: true, aiAnalysis: true, approximateLocation: false },
      source: "load-test",
      referrer: null,
    },
    ip,
  );
  if (!start.ok) return null;
  const auth = { Authorization: `Bearer ${start.data.token}`, ...ip };
  const turns = await post(
    "turns",
    `/api/public/sessions/${start.data.sessionId}/turns`,
    {
      turns: [
        { clientTurnId: "answer-1", seq: 1, role: "user", text: SAMPLE_ANSWERS[index % SAMPLE_ANSWERS.length] },
      ],
    },
    auth,
  );
  if (!turns.ok) return null;
  const complete = await post("complete", `/api/public/sessions/${start.data.sessionId}/complete`, { email }, auth);
  return complete.ok ? complete.data.code : null;
}

async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const index = next++;
        results[index] = await tasks[index]().catch((err) => {
          failures.push(`exception ${err.message}`);
          return null;
        });
      }
    }),
  );
  return results;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

console.log(`${participants} participants, ${concurrency} at a time, against ${base}/${slug}`);

const startedAt = performance.now();
const codes = await pool(
  Array.from({ length: participants }, (_, i) => () => participant(i, `load-${run}-${i}@resend.dev`)),
  concurrency,
);
const seconds = (performance.now() - startedAt) / 1000;

const issued = codes.filter(Boolean);
console.log(`\nCompleted ${issued.length}/${participants} in ${seconds.toFixed(1)}s (${(issued.length / seconds).toFixed(1)}/s)`);
console.log(`Unique codes: ${new Set(issued).size} of ${issued.length}`);
for (const [step, values] of Object.entries(timings)) {
  console.log(
    `${step.padEnd(9)} p50 ${percentile(values, 50).toFixed(0)}ms  p95 ${percentile(values, 95).toFixed(0)}ms  max ${Math.max(...values).toFixed(0)}ms`,
  );
}

// Duplicate handling: the same person submitting from many tabs at once must
// end up with exactly one code.
const sameEmail = `load-${run}-duplicate@resend.dev`;
const duplicateCodes = await pool(
  Array.from({ length: 12 }, (_, i) => () => participant(100000 + i, sameEmail)),
  12,
);
const distinct = new Set(duplicateCodes.filter(Boolean));
console.log(`\nSame email from 12 sessions at once: ${distinct.size} distinct code(s) issued (expected 1)`);

console.log(`\nFailures: ${failures.length}`);
if (failures.length) console.log([...new Set(failures)].slice(0, 10));
process.exit(failures.length === 0 && distinct.size === 1 && new Set(issued).size === issued.length ? 0 : 1);
