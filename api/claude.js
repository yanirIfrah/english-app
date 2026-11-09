import { SB_URL, ANON, body } from "./_lib.js";

// AI for plan creation, scanning and translation. Uses Anthropic (ANTHROPIC_API_KEY) when set,
// otherwise Google Gemini (GEMINI_API_KEY). Keys stay on the server.
const MODELS = {
  quick: process.env.CLAUDE_MODEL_QUICK || "claude-haiku-5-5",
  default: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
  complex: process.env.CLAUDE_MODEL_COMPLEX || "claude-opus-5-5"
};
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
export const provider = () => process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.GEMINI_API_KEY ? "gemini" : null;

async function viaAnthropic(messages, imgs, tier) {
  if (imgs.length) {
    const last = messages[messages.length - 1];
    messages = [...messages.slice(0, -1), { role: "user", content: [...imgs.map(i => ({ type: "image", source: { type: "base64", media_type: i.type, data: i.data } })), { type: "text", text: String(last.content) }] }];
  }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELS[tier], max_tokens: tier === "quick" ? 2000 : 8000, messages })
  });
  if (r.status === 429) return { status: 429 };
  if (!r.ok) return { status: 502, detail: (await r.text()).slice(0, 300) };
  const j = await r.json();
  return { text: (j.content || []).filter(c => c.type === "text").map(c => c.text).join(""), truncated: j.stop_reason === "max_tokens" };
}

async function viaGemini(messages, imgs, tier) {
  const contents = messages.map((m, idx) => {
    const parts = [];
    if (idx === messages.length - 1) imgs.forEach(i => parts.push({ inlineData: { mimeType: i.type, data: i.data } }));
    parts.push({ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: tier === "quick" ? 2000 : 8000 } })
  });
  if (r.status === 429) return { status: 429 };
  if (!r.ok) return { status: 502, detail: (await r.text()).slice(0, 300) };
  const j = await r.json();
  const c = (j.candidates || [])[0] || {};
  return { text: ((c.content && c.content.parts) || []).map(p => p.text || "").join(""), truncated: c.finishReason === "MAX_TOKENS" };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const prov = provider();
  if (req.method === "GET") return res.status(200).json({ enabled: !!prov, provider: prov });
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!prov) return res.status(503).json({ error: "disabled" });
  // only signed-in users of this app may use the key
  const auth = req.headers.authorization || "";
  const u = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: auth } }).catch(() => null);
  if (!u || !u.ok) return res.status(401).json({ error: "auth" });
  const b = body(req);
  const messages = typeof b.input === "string" ? [{ role: "user", content: b.input }] : (Array.isArray(b.input) ? b.input : []);
  if (!messages.length) return res.status(400).json({ error: "empty" });
  const imgs = (Array.isArray(b.images) ? b.images : []).slice(0, 5).filter(i => i && i.data && /^image\/(jpeg|png|webp|gif)$/.test(i.type));
  const tier = MODELS[b.tier] ? b.tier : "default";
  const out = prov === "anthropic" ? await viaAnthropic(messages, imgs, tier) : await viaGemini(messages, imgs, tier);
  if (out.status === 429) return res.status(429).json({ error: "rate_limited" });
  if (out.status) return res.status(502).json({ error: "upstream", detail: out.detail });
  return res.status(200).json({ text: out.text, truncated: out.truncated });
}
