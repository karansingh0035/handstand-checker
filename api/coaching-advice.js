// 🔒 SERVERLESS PROXY — keeps your Gemini API key off the browser.
// The frontend calls THIS endpoint (same-origin, no key attached);
// this function is the only thing that ever talks to Gemini directly, using
// a key stored in an environment variable that never reaches client code.
//
// Deploy target: Vercel serverless function at POST /api/coaching-advice.

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// 🛡️ RATE LIMITING
const requestLog = new Map(); // ip -> array of request timestamps (ms)
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 10;     // Max requests per IP per window

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
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

const MAX_FAULTS_ACCEPTED = 10;

export default async function handler(req, res) {
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

  // Basic shape validation
  if (typeof score !== "number" || !Array.isArray(faults) || typeof skill !== "string" || !skill.trim()) {
    res.status(400).json({ error: "Request must include a numeric 'score', a 'faults' array, and a 'skill' name." });
    return;
  }

  const cappedFaults = faults.slice(0, MAX_FAULTS_ACCEPTED);
  const apiKey = process.env.GEMINI_API_KEY;

  // Graceful fallback if GEMINI_API_KEY is not configured in Vercel environment variables
  if (!apiKey) {
    console.warn("GEMINI_API_KEY environment variable is not set. Serving deterministic biomechanical advice fallback.");
    const fallbackAdvice = buildFallbackAdvice(score, cappedFaults, skill);
    res.status(200).json({ advice: fallbackAdvice, isFallback: true });
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
          temperature: 0.4,
          maxOutputTokens: 400,
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      console.warn("Gemini API error, falling back to deterministic advice:", geminiResponse.status, errorBody);
      const fallbackAdvice = buildFallbackAdvice(score, cappedFaults, skill);
      res.status(200).json({ advice: fallbackAdvice, isFallback: true });
      return;
    }

    const data = await geminiResponse.json();
    const candidate = data?.candidates?.[0];
    const adviceText = candidate?.content?.parts?.[0]?.text?.trim();

    if (!adviceText) {
      const fallbackAdvice = buildFallbackAdvice(score, cappedFaults, skill);
      res.status(200).json({ advice: fallbackAdvice, isFallback: true });
      return;
    }

    res.status(200).json({ advice: adviceText });
  } catch (err) {
    console.error("Error calling Gemini API, falling back to deterministic advice:", err);
    const fallbackAdvice = buildFallbackAdvice(score, cappedFaults, skill);
    res.status(200).json({ advice: fallbackAdvice, isFallback: true });
  }
}

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

function buildFallbackAdvice(score, faults, skill) {
  if (!faults || faults.length === 0) {
    return `Solid form! Your ${skill} looks well aligned and controlled with no detected form faults. Keep up the consistent work!`;
  }
  const details = faults.map((f) => f.detail).join(" ");
  return `${details} Focus on correcting these key positions on your next set to maximize your form score.`;
}