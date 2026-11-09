import { SB_URL, ANON, body } from "./_lib.js";

const MODELS = {
  quick: process.env.CLAUDE_MODEL_QUICK || "claude-haiku-5-5",
  default: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
  complex: process.env.CLAUDE_MODEL_COMPLEX || "claude-opus-5-5"
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const key = process.env.ANTHROPIC_API_KEY;
  if (req.method === "GET") return res.status(200).json({ enabled: !!key });
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!key) return res.status(503).json({ error: "disabled" });
  // only signed-in users of this app may use the key
  const auth = req.headers.authorization || "";
  const u = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: auth } }).catch(() => null);
  if (!u || !u.ok) return res.status(401).json({ error: "auth" });
  const b = body(req);
  let messages = typeof b.input === "string" ? [{ role: "user", content: b.input }] : (Array.isArray(b.input) ? b.input : []);
  if (!messages.length) return res.status(400).json({ error: "empty" });
  const imgs = (Array.isArray(b.images) ? b.images : []).slice(0, 5).filter(i => i && i.data && /^image\/(jpeg|png|webp|gif)$/.test(i.type));
  if (imgs.length) {
    const last = messages[messages.length - 1];
    messages = [...messages.slice(0, -1), { role: "user", content: [...imgs.map(i => ({ type: "image", source: { type: "base64", media_type: i.type, data: i.data } })), { type: "text", text: String(last.content) }] }];
  }
  const tier = MODELS[b.tier] ? b.tier : "default";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELS[tier], max_tokens: tier === "quick" ? 2000 : 8000, messages })
  });
  if (r.status === 429) return res.status(429).json({ error: "rate_limited" });
  if (!r.ok) return res.status(502).json({ error: "upstream", detail: (await r.text()).slice(0, 300) });
  const j = await r.json();
  const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  return res.status(200).json({ text, truncated: j.stop_reason === "max_tokens" });
}
