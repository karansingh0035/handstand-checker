// 🔒 SERVERLESS PROXY — this is what keeps your Gemini API key off the
// browser. The frontend calls THIS endpoint (same-origin, no key attached);
// this function is the only thing that ever talks to Gemini directly, using
// a key stored in an environment variable that never reaches client code.
//
// Deploy target: Vercel. Drop this file at `api/coaching-advice.js` in your
// project root (alongside index.html/app.js) and Vercel automatically turns
// it into a live endpoint at POST /api/coaching-advice.
//
// Required setup: in your Vercel project settings, add an environment
// variable named GEMINI_API_KEY with your key from Google AI Studio.

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// 🛡️ RATE LIMITING
// This is an IN-MEMORY limiter — it lives in this function instance's
// memory, which Vercel may reuse across nearby requests ("warm" instances)
// but does NOT guarantee persistence: a cold start, a scale-up to multiple
// instances, or traffic hitting a different region resets or splits this
// state. In practice that means a determined abuser COULD get more than
// this limit through by getting routed to fresh instances. This is a
// reasonable first line of defense for a small/hobby-scale deployment —
// it stops casual accidental hammering (e.g. a bug in the frontend retrying
// in a loop) — but if this app gets real traffic or becomes a cost concern,
// the correct upgrade is a shared store like Vercel KV or Upstash Redis,
// which all instances read/write to consistently.
const requestLog = new Map(); // ip -> array of request timestamps (ms)
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 5;      // Max requests per IP per window

function isRateLimited(ip) {
  const now = Date.now();
  const recentTimestamps = (requestLog.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  recentTimestamps.push(now);
  requestLog.set(ip, recentTimestamps);
  return recentTimestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

function getClientIp(req) {
  // Vercel sets x-forwarded-for; it can contain a comma-separated chain if
  // the request passed through proxies, so take the first (original client) entry.
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

const MAX_FAULTS_ACCEPTED = 10; // Defensive cap — no legitimate skill check should ever produce more than this

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Only POST requests are allowed." });
    return;
  }

  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    res.status(429).json({ error: "Too many requests. Please wait a moment before trying again." });
    return;
  }

  const { score, faults, skill } = req.body || {};

  // Basic shape validation — don't trust the request body blindly
  if (typeof score !== "number" || !Array.isArray(faults) || typeof skill !== "string" || !skill.trim()) {
    res.status(400).json({ error: "Request must include a numeric 'score', a 'faults' array, and a 'skill' name." });
    return;
  }

  // Defensive cap: even if something upstream is misbehaving, never let an
  // oversized faults array balloon the prompt (and therefore the cost) sent to Gemini.
  const cappedFaults = faults.slice(0, MAX_FAULTS_ACCEPTED);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY environment variable is not set.");
    res.status(500).json({ error: "Server is not configured correctly." });
    return;
  }

  const prompt = buildPrompt(score, cappedFaults, skill);

  try {
    const geminiResponse = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,   // Lower temperature: consistent, grounded coaching tone, not creative flair
          maxOutputTokens: 400,
          // 🎯 IMPORTANT: gemini-2.5-flash has "thinking" enabled by default,
          // and those internal reasoning tokens count against
          // maxOutputTokens. For a short, simple task like this, that
          // silently ate almost the entire budget before any visible text
          // was written, causing responses to cut off mid-sentence. We don't
          // need step-by-step reasoning here, so thinking is disabled
          // entirely — thinkingBudget: 0 means all tokens go to the actual answer.
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      console.error("Gemini API error:", geminiResponse.status, errorBody);
      res.status(502).json({ error: "Coaching advice service is temporarily unavailable." });
      return;
    }

    const data = await geminiResponse.json();
    const candidate = data?.candidates?.[0];
    const adviceText = candidate?.content?.parts?.[0]?.text?.trim();

    if (candidate?.finishReason === "MAX_TOKENS") {
      console.warn("Gemini response was cut off by the token limit — consider raising maxOutputTokens further.");
    }

    if (!adviceText) {
      res.status(502).json({ error: "Coaching advice service returned an empty response." });
      return;
    }

    res.status(200).json({ advice: adviceText });
  } catch (err) {
    console.error("Error calling Gemini API:", err);
    res.status(500).json({ error: "Something went wrong generating coaching advice." });
  }
};

// Builds a tightly-constrained prompt: the model is only allowed to comment
// on faults we actually detected, in a short, fixed format. This is the
// guardrail against the model inventing plausible-sounding issues that
// weren't actually detected by the pose analysis.
function buildPrompt(score, faults, skill) {
  if (faults.length === 0) {
    return (
      `You are a calisthenics coach. A student just performed a ${skill} and scored ` +
      `${score}/100 with no detected form faults. Write 1-2 short, encouraging ` +
      "sentences praising their form. Do not invent any specific faults or " +
      "corrections — there are none to mention."
    );
  }

  const faultList = faults
    .map((f, i) => `${i + 1}. ${f.detail} (severity: ${f.severity})`)
    .join("\n");

  return (
    `You are a calisthenics coach giving feedback on a student's ${skill}. ` +
    `They scored ${score}/100. Here is the EXACT and COMPLETE list of form ` +
    "issues detected by pose analysis:\n\n" +
    `${faultList}\n\n` +
    "Write 2-3 short sentences of coaching advice. Rules:\n" +
    "- Only reference the faults listed above. Do not mention, imply, or invent " +
    `any other issue, even if it seems plausible for a ${skill}.\n` +
    "- For each fault, briefly explain the likely cause and one concrete fix.\n" +
    "- Keep the tone encouraging and plain-language, like a supportive coach — " +
    "no technical jargon, no headers, no bullet points, just flowing sentences."
  );
}