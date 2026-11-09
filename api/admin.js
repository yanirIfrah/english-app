import { SB_URL, SRK, toEmail, validUser, body, admin, caller } from "./_lib.js";

const meta = b => ({
  username: String(b.username || "").toLowerCase(), name: String(b.name || "").slice(0, 20),
  age: b.age ?? null, gender: b.gender === "m" ? "m" : "f", level: b.level || 1,
  grade: b.grade || null, bagrut: b.bagrut || null, avatar: String(b.avatar || "a1").slice(0, 8)
});

async function createUser(b) {
  const u = String(b.username || "").trim().toLowerCase(), pw = String(b.password || "");
  const age = parseInt(b.age, 10);
  if (!validUser(u)) return [400, { error: "bad_username" }];
  if (pw.length < 6) return [400, { error: "weak_password" }];
  if (!String(b.name || "").trim()) return [400, { error: "bad_name" }];
  if (!(age >= 2 && age <= 120)) return [400, { error: "bad_age" }];
  const taken = await admin(`/rest/v1/profiles?username=eq.${encodeURIComponent(u)}&select=id`);
  if (taken.ok && taken.j.length) return [409, { error: "taken" }];
  const r = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: toEmail(u), password: pw, email_confirm: true, user_metadata: { ...meta(b), username: u, age }, app_metadata: { via: "api" } })
  });
  if (!r.ok) return [r.status === 422 ? 409 : 400, { error: r.status === 422 ? "taken" : "create_failed", detail: r.j && (r.j.msg || r.j.message) }];
  return [200, { ok: true, id: r.j.id }];
}
const can = (staff, perm) => staff && (staff.role === "admin" || (staff.role === "manager" && staff.mgr_perms && staff.mgr_perms[perm]));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!SB_URL || !SRK) return res.status(500).json({ error: "not_configured" });
  const b = body(req);
  try {
    if (b.action === "signup") {
      const [cfg, any] = await Promise.all([admin("/rest/v1/app_config?id=eq.1&select=data"), admin("/rest/v1/profiles?select=id&limit=1")]);
      const first = any.ok && Array.isArray(any.j) && any.j.length === 0;
      const allow = !(cfg.ok && cfg.j && cfg.j[0] && cfg.j[0].data && cfg.j[0].data.allowSignup === false);
      if (!first && !allow) return res.status(403).json({ error: "signup_closed" });
      const [st, out] = await createUser(b); return res.status(st).json(out);
    }
    if (b.action === "username_taken") {
      const u = String(b.username || "").trim().toLowerCase();
      const r = await admin(`/rest/v1/profiles?username=eq.${encodeURIComponent(u)}&select=id`);
      return res.status(200).json({ taken: !!(r.ok && r.j.length) });
    }
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: "auth" });
    if (b.action === "create_user") {
      if (me.role !== "admin") return res.status(403).json({ error: "forbidden" });
      const [st, out] = await createUser(b); return res.status(st).json(out);
    }
    const tgt = await admin(`/rest/v1/profiles?id=eq.${encodeURIComponent(b.user_id || "")}&select=id,role`);
    const target = tgt.ok && tgt.j[0];
    if (!target) return res.status(404).json({ error: "not_found" });
    const staffOver = perm => can(me, perm) && !(me.role === "manager" && target.role === "admin");
    if (b.action === "reset_password") {
      if (!staffOver("resetPw")) return res.status(403).json({ error: "forbidden" });
      if (String(b.password || "").length < 6) return res.status(400).json({ error: "weak_password" });
      const r = await admin(`/auth/v1/admin/users/${target.id}`, { method: "PUT", body: JSON.stringify({ password: String(b.password) }) });
      return res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true } : { error: "failed" });
    }
    if (b.action === "delete_user") {
      const self = target.id === me.id;
      if (!self && !staffOver("delete")) return res.status(403).json({ error: "forbidden" });
      if (target.role === "admin" && !self) return res.status(403).json({ error: "forbidden" });
      const r = await admin(`/auth/v1/admin/users/${target.id}`, { method: "DELETE" });
      return res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true } : { error: "failed" });
    }
    return res.status(400).json({ error: "unknown_action" });
  } catch (e) {
    return res.status(500).json({ error: "server", detail: String(e && e.message || e) });
  }
}
