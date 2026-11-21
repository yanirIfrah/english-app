import crypto from "node:crypto";
import { SB_URL, SRK, ANON, toEmail, validUser, body, admin, caller } from "./_lib.js";

// User management with the service key (server only).
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120 && !e.endsWith("@users.lirad-shaon.app");
const siteOf = req => (req.headers["x-forwarded-proto"] || "https") + "://" + (req.headers["x-forwarded-host"] || req.headers.host);

// ask Supabase Auth to e-mail a "set your password" link (uses the project's SMTP settings)
async function sendSetPassword(email, req) {
  const r = await fetch(`${SB_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(siteOf(req) + "/")}`, {
    method: "POST", headers: { apikey: ANON || SRK, "Content-Type": "application/json" }, body: JSON.stringify({ email })
  });
  if (r.ok) return { sent: true };
  let j = {}; try { j = await r.json(); } catch {}
  return { sent: false, reason: j.error_code || j.code || String(r.status) };
}

async function createUser(b, role, req) {
  const u = String(b.username || "").trim().toLowerCase(), email = String(b.email || "").trim().toLowerCase();
  let pw = String(b.password || "");
  const name = String(b.name || "").trim().slice(0, 60), emp_no = String(b.emp_no || "").trim().slice(0, 30);
  if (!name) return [400, { error: "bad_name" }];
  if (!email && !u) return [400, { error: "need_login" }];
  if (email && !validEmail(email)) return [400, { error: "bad_email" }];
  if (u && !validUser(u)) return [400, { error: "bad_username" }];
  if (!email && pw.length < 6) return [400, { error: "weak_password" }];
  if (pw && pw.length < 6) return [400, { error: "weak_password" }];
  if (u) { const t = await admin(`/rest/v1/profiles?username=eq.${encodeURIComponent(u)}&select=id`); if (t.ok && t.j.length) return [409, { error: "taken" }]; }
  if (email) { const t = await admin(`/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id`); if (t.ok && t.j.length) return [409, { error: "email_taken" }]; }
  const invite = !!email && (!pw || b.invite === true);
  if (!pw) pw = crypto.randomBytes(24).toString("base64url"); // employee will set their own via the e-mail link
  const r = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: email || toEmail(u), password: pw, email_confirm: true, user_metadata: { username: u || null, name, emp_no }, app_metadata: { via: "api" } })
  });
  if (!r.ok) return [r.status === 422 ? 409 : 400, { error: r.status === 422 ? (email ? "email_taken" : "taken") : "create_failed" }];
  if (role === "manager") await admin(`/rest/v1/profiles?id=eq.${r.j.id}`, { method: "PATCH", body: JSON.stringify({ role: "manager", perms: b.perms && typeof b.perms === "object" ? b.perms : { editHours: true } }) });
  const out = { ok: true, id: r.j.id };
  if (invite) Object.assign(out, await sendSetPassword(email, req));
  return [200, out];
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
    if (b.action === "login_username") { // username → that account's sign-in address, password checked by Supabase Auth
      const u = String(b.username || "").trim().toLowerCase(), pw = String(b.password || "");
      const fail = () => res.status(400).json({ error: "invalid_login" });
      if (!validUser(u) || !pw) return fail();
      const p = await admin(`/rest/v1/profiles?username=eq.${encodeURIComponent(u)}&select=id`);
      if (!p.ok || !p.j.length) return fail();
      const au = await admin(`/auth/v1/admin/users/${p.j[0].id}`);
      if (!au.ok || !au.j || !au.j.email) return fail();
      const t = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON || SRK, "Content-Type": "application/json" }, body: JSON.stringify({ email: au.j.email, password: pw }) });
      if (t.status === 429) return res.status(429).json({ error: "rate_limited" });
      if (!t.ok) return fail();
      const s = await t.json();
      return res.status(200).json({ access_token: s.access_token, refresh_token: s.refresh_token });
    }
    if (b.action === "signup") {
      const [cfg, any] = await Promise.all([admin("/rest/v1/app_config?id=eq.1&select=data"), admin("/rest/v1/profiles?select=id&limit=1")]);
      const first = any.ok && Array.isArray(any.j) && any.j.length === 0;
      const allow = !!(cfg.ok && cfg.j && cfg.j[0] && cfg.j[0].data && cfg.j[0].data.allowSignup === true);
      if (!first && !allow) return res.status(403).json({ error: "signup_closed" });
      const [st, out] = await createUser({ ...b, invite: false }, "user", req); return res.status(st).json(out);
    }
    const me = await caller(req);
    if (!me || me.locked) return res.status(401).json({ error: "auth" });
    if (b.action === "create_user") {
      if (!can(me, "users")) return res.status(403).json({ error: "forbidden" });
      const role = b.role === "manager" && me.role === "admin" ? "manager" : "user";
      const [st, out] = await createUser(b, role, req); return res.status(st).json(out);
    }
    const tgt = await admin(`/rest/v1/profiles?id=eq.${encodeURIComponent(b.user_id || "")}&select=id,role,email`);
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
    if (b.action === "send_reset") {
      if (!over) return res.status(403).json({ error: "forbidden" });
      if (!target.email) return res.status(400).json({ error: "no_email" });
      const out = await sendSetPassword(target.email, req);
      return res.status(out.sent ? 200 : 502).json(out.sent ? { ok: true } : { error: "mail_failed", reason: out.reason });
    }
    if (b.action === "set_email") {
      if (!over) return res.status(403).json({ error: "forbidden" });
      const email = String(b.email || "").trim().toLowerCase();
      if (email === (target.email || "")) return res.status(200).json({ ok: true });
      if (!email) { // remove the e-mail → sign in with the username only
        const prof = await admin(`/rest/v1/profiles?id=eq.${target.id}&select=username`);
        const un = prof.ok && prof.j[0] && prof.j[0].username; if (!un) return res.status(400).json({ error: "need_login" });
        const r = await admin(`/auth/v1/admin/users/${target.id}`, { method: "PUT", body: JSON.stringify({ email: toEmail(un), email_confirm: true }) });
        if (!r.ok) return res.status(400).json({ error: "failed" });
        await admin(`/rest/v1/profiles?id=eq.${target.id}`, { method: "PATCH", body: JSON.stringify({ email: null }) });
        return res.status(200).json({ ok: true });
      }
      if (!validEmail(email)) return res.status(400).json({ error: "bad_email" });
      const t = await admin(`/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id`); if (t.ok && t.j.length) return res.status(409).json({ error: "email_taken" });
      const r = await admin(`/auth/v1/admin/users/${target.id}`, { method: "PUT", body: JSON.stringify({ email, email_confirm: true }) });
      if (!r.ok) return res.status(r.status === 422 ? 409 : 400).json({ error: r.status === 422 ? "email_taken" : "failed" });
      await admin(`/rest/v1/profiles?id=eq.${target.id}`, { method: "PATCH", body: JSON.stringify({ email }) });
      return res.status(200).json({ ok: true });
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
