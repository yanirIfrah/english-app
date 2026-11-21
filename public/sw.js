/* Lirad attendance – service worker for reminders */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "לירד שעון נוכחות", {
    body: d.body || "לא לשכוח להזין את שעות העבודה של היום.", icon: "/icon-192.png", badge: "/icon-192.png",
    tag: d.tag || "lirad-reminder", renotify: true, dir: "rtl", lang: "he", data: { url: d.url || "/" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if ("focus" in c) { c.navigate && c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
