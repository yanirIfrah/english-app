import webpush from "web-push";
import { SB_URL, SRK, admin } from "./_lib.js";

// Daily reminder: called by a Supabase pg_cron job at 14:00 and 15:00 UTC (= 17:00 Israel in winter / summer).
// Sends a push to employees who haven't recorded today yet.
const ilNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), wd: p.weekday };
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers["x-cron-secret"] !== secret) return res.status(401).json({ error: "auth" });
  if (!SB_URL || !SRK || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return res.status(500).json({ error: "not_configured" });
  const now = ilNow(), force = req.query && req.query.force === "1";
  if (!force && now.hour !== 17) return res.status(200).json({ skipped: "not 17:00 in Israel", hour: now.hour });
  const cfgR = await admin("/rest/v1/app_config?id=eq.1&select=data");
  const cfg = (cfgR.ok && cfgR.j && cfgR.j[0] && cfgR.j[0].data) || {};
  if (!force && cfg.reminder === false) return res.status(200).json({ skipped: "reminders off" });
  if (!force && cfg.reminderSkipWeekend === true && (now.wd === "Fri" || now.wd === "Sat")) return res.status(200).json({ skipped: "weekend" });
  const [subsR, profR, entR] = await Promise.all([
    admin("/rest/v1/push_subs?select=id,user_id,endpoint,p256dh,auth"),
    admin("/rest/v1/profiles?select=id,name,role,locked&role=eq.user&locked=eq.false"),
    admin(`/rest/v1/entries?select=user_id&day=eq.${now.day}`)
  ]);
  if (!subsR.ok || !profR.ok || !entR.ok) return res.status(502).json({ error: "db" });
  const active = new Map(profR.j.map(p => [p.id, p])), done = new Set(entR.j.map(e => e.user_id));
  webpush.setVapidDetails("mailto:noreply@lirad-shaon.vercel.app", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  let sent = 0, removed = 0, failed = 0;
  for (const s of subsR.j) {
    const p = active.get(s.user_id);
    if (!p || done.has(s.user_id)) continue;
    const payload = JSON.stringify({ title: "תזכורת: שעות העבודה של היום", body: `${p.name.split(" ")[0]}, לא לשכוח להזין את שעות הכניסה והיציאה של היום.`, url: "/", tag: "daily-" + now.day });
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 4 * 3600, urgency: "normal" }); sent++; }
    catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) { await admin(`/rest/v1/push_subs?id=eq.${s.id}`, { method: "DELETE" }); removed++; }
      else failed++;
    }
  }
  return res.status(200).json({ day: now.day, sent, removed, failed });
}
