import { SB_URL, SRK, toEmail, validUser, body, admin, caller } from "./_lib.js";

// User management with the service key (server only).
async function createUser(b, role) {
  const u = String(b.username || "").trim().toLowerCase(), pw = String(b.password || "");
  const name = String(b.name || "").trim().slice(0, 60), emp_no = String(b.emp_no || "").trim().slice(0, 30);
  if (!validUser(u)) return [400, { error: "bad_username" }];
  if (pw.length < 6) return [400, { error: "weak_password" }];
  if (!name) return [400, { error: "bad_name" }];
  const taken = await admin(`/rest/v1/profiles?username=eq.${encodeURIComponent(u)}&select=id`);
  if (taken.ok && taken.j.length) return [409, { error: "taken" }];
  const r = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: toEmail(u), password: pw, email_confirm: true, user_metadata: { username: u, name, emp_no }, app_metadata: { via: "api" } })
  });
  if (!r.ok) return [r.status === 422 ? 409 : 400, { error: r.status === 422 ? "taken" : "create_failed" }];
  if (role === "manager") await admin(`/rest/v1/profiles?id=eq.${r.j.id}`, { method: "PATCH", body: JSON.stringify({ role: "manager", perms: b.perms && typeof b.perms === "object" ? b.perms : { editHours: true } }) });
  return [200, { ok: true, id: r.j.id }];
}
const can = (me, perm) => me && !me.locked && (me.role === "admin" || (me.role === "manager" && me.perms && me.perms[perm]));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SB_URL || !SRK) return res.status(500).json({ error: "not_configured" });
  try {
    if (req.method === "GET") { // health + first-run check (reveals only whether any account exists)
      const any = await admin("/rest/v1/profiles?select=id&limit=1");
      return res.status(200).json({ configured: true, serverKeyOk: any.ok, needsSetup: any.ok && Array.isArray(any.j) && any.j.length === 0 });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "method" });
    const b = body(req);
    if (b.action === "signup") {
      const [cfg, any] = await Promise.all([admin("/rest/v1/app_config?id=eq.1&select=data"), admin("/rest/v1/profiles?select=id&limit=1")]);
      const first = any.ok && Array.isArray(any.j) && any.j.length === 0;
      const allow = !!(cfg.ok && cfg.j && cfg.j[0] && cfg.j[0].data && cfg.j[0].data.allowSignup === true);
      if (!first && !allow) return res.status(403).json({ error: "signup_closed" });
      const [st, out] = await createUser(b, "user"); return res.status(st).json(out);
    }
    const me = await caller(req);
    if (!me || me.locked) return res.status(401).json({ error: "auth" });
    if (b.action === "create_user") {
      if (!can(me, "users")) return res.status(403).json({ error: "forbidden" });
      const role = b.role === "manager" && me.role === "admin" ? "manager" : "user";
      const [st, out] = await createUser(b, role); return res.status(st).json(out);
    }
    const tgt = await admin(`/rest/v1/profiles?id=eq.${encodeURIComponent(b.user_id || "")}&select=id,role`);
    const target = tgt.ok && tgt.j[0];
    if (!target) return res.status(404).json({ error: "not_found" });
    const self = target.id === me.id;
    // managers act only on regular employees; nobody but the user can touch an admin
    const over = me.role === "admin" ? (target.role !== "admin" || self) : (can(me, "users") && target.role === "user");
    if (b.action === "reset_password") {
      if (!over) return res.status(403).json({ error: "forbidden" });
      if (String(b.password || "").length < 6) return res.status(400).json({ error: "weak_password" });
      const r = await admin(`/auth/v1/admin/users/${target.id}`, { method: "PUT", body: JSON.stringify({ password: String(b.password) }) });
      return res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true } : { error: "failed" });
    }
    if (b.action === "delete_user") {
      if (self || !over) return res.status(403).json({ error: "forbidden" });
      const r = await admin(`/auth/v1/admin/users/${target.id}`, { method: "DELETE" });
      return res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true } : { error: "failed" });
    }
    return res.status(400).json({ error: "unknown_action" });
  } catch (e) {
    return res.status(500).json({ error: "server" });
  }
}
