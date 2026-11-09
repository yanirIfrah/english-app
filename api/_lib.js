export const SB_URL = process.env.SUPABASE_URL;
export const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const ANON = process.env.SUPABASE_ANON_KEY;
export const EMAIL_DOMAIN = "users.lomdim-anglit.app";
export const toEmail = u => "u" + Buffer.from(String(u).toLowerCase(), "utf8").toString("hex") + "@" + EMAIL_DOMAIN;
export const validUser = u => /^[a-z0-9֐-׿._-]{3,20}$/.test(u);

export function body(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body;
}
export async function admin(path, opts = {}) {
  const r = await fetch(SB_URL + path, {
    ...opts,
    // new-style secret keys (sb_secret_...) go only in the apikey header; legacy service_role JWTs also as Bearer
    headers: { apikey: SRK, ...(String(SRK).startsWith("sb_") ? {} : { Authorization: "Bearer " + SRK }), "Content-Type": "application/json", ...(opts.headers || {}) }
  });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { ok: r.ok, status: r.status, j };
}
// the signed-in user making this request, with their profile row (or null)
export async function caller(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ") || h.length < 20) return null;
  const r = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: ANON || SRK, Authorization: h } });
  if (!r.ok) return null;
  const u = await r.json();
  const p = await admin(`/rest/v1/profiles?id=eq.${u.id}&select=id,role,mgr_perms,username,locked`);
  return (p.ok && Array.isArray(p.j) && p.j[0]) || null;
}
