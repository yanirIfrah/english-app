#!/usr/bin/env python3
"""Build web/index.html (Vercel + Supabase edition) from the shared app source."""
import re, sys, shutil, pathlib
ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT.parent / "english-app.html"
h = SRC.read_text(encoding="utf-8")

def rep(old, new, count=1, required=True):
    global h
    n = h.count(old)
    if required and n < count:
        sys.exit(f"build: pattern not found ({n}/{count}): {old[:80]!r}")
    h = h.replace(old, new)

def rep_tr(he_old, he_new, en_new):
    """Replace a Hebrew UI string and its I18N dictionary entry."""
    global h
    h, n = re.subn(re.escape(f'"{he_old}":') + r'"(?:[^"\\]|\\.)*"', f'"{he_new}":"{en_new}"', h)
    rep(he_old, he_new, required=False)

# --- edition ---
rep('const EDITION="public";', 'const EDITION="web";')
rep('const APP_URL=EDITION==="community"?COMMUNITY_URL:PUBLIC_URL;', 'const APP_URL=location.origin;')
# the artifact-only cloud init must not overwrite the Supabase role
rep('CLOUD.owner=us?await us.isOwner():false;', 'if(us) CLOUD.owner=await us.isOwner();')
# drawer: no per-device admin, staff entry only for staff
h = re.sub(r'\$\{CLOUD\.owner\?item\("d-cloud".*?:""\)\}\$\{item\("d-parent","phone","ניהול מכשיר","החשבונות במכשיר הזה, גיבוי ושחזור"\)\}', '', h, count=1)
# renamed base console dispatcher (web.js wraps it)
rep('function renderCloud(){\n  if(!CLOUD.owner&&!MGR) return renderMgrLogin();', 'function renderCloudBase(){\n  if(!CLOUD.owner&&!MGR) return renderMgrLogin();')
# admin password reset goes to the server
rep('const v=$("#xpw").value; if(v.length<4) return err("סיסמה: לפחות 4 תווים"); const salt=newSalt(); W({pw:{salt,hash:await hashPw(v,salt),at:Date.now()}},null,"הסיסמה תוחלף בפעם הבאה שהמכשיר מתחבר");',
    'const v=$("#xpw").value; if(v.length<6) return err("סיסמה: לפחות 6 תווים"); W({pwPlain:v},null,"הסיסמה הוחלפה");')
rep_tr("סיסמה חדשה (לפחות 4 תווים)", "סיסמה חדשה (לפחות 6 תווים)", "New password (at least 6 characters)")
rep_tr("יימחק מהמכשיר בפעם הבאה שהאפליקציה תיפתח בו", "החשבון וכל ההתקדמות יימחקו מיד", "The account and all progress are deleted immediately")
# notice dismissal clears it on the server too
rep('if(nk) nk.onclick=()=>{ p.notice=null; save(); renderHome(); };', 'if(nk) nk.onclick=()=>{ p.notice=null; clearNotice(); renderHome(); };')
# global settings → app_config
rep('try{ await CLOUD.db.doc("config/app").set(c); CLOUD.cfg=c;', 'try{ const {error}=await WEB.sb.from("app_config").update({data:c}).eq("id",1); if(error) throw error; CLOUD.cfg=c;')
h = re.sub(r'\s*<div class="card" style="margin-top:12px"><h3 style="font-size:16px">ניהול המכשיר הזה</h3>.*?</div>`\);', '`);', h, count=1, flags=re.S)
rep('  $("#gdev").onclick=()=>renderParent();\n', '')
rep_tr("הגדרות לכל המשתמשים בכל המכשירים", "הגדרות לכל המשתמשים", "Settings for all users")
# texts that referred to running inside Claude
rep_tr("הסריקה זמינה כשהאפליקציה פתוחה בתוך Claude.", "הסריקה לא זמינה כרגע – המנהל צריך להגדיר מפתח Claude בשרת.", "Scanning is unavailable – the admin needs to set a Claude key on the server.")
rep_tr("יצירת תוכנית זמינה כשהאפליקציה פתוחה בתוך Claude (claude.ai או אפליקציית Claude).", "יצירת תוכנית לא זמינה כרגע – המנהל צריך להגדיר מפתח Claude בשרת.", "Plan creation is unavailable – the admin needs to set a Claude key on the server.")
rep_tr("תרגום של מילים חדשות זמין כשהאפליקציה פתוחה בתוך Claude", "תרגום של מילים חדשות דורש מפתח Claude בשרת", "Translating new words needs a Claude key on the server")
rep_tr("חסר תרגום ל-{} מילים. הוסיפו תרגום (word - תרגום), או פתחו את האפליקציה בתוך Claude לתרגום אוטומטי.", "חסר תרגום ל-{} מילים. הוסיפו תרגום (word - תרגום).", "Missing translation for {} words. Add a translation (word - translation).")
rep("או פתחו את האפליקציה בתוך Claude לתרגום אוטומטי.", "", required=False)
rep('<div class="hint">${EDITION==="community"?"זו גרסת הקהילה (נפתחת רק למי שקיבל שיתוף אישי).":"זו הגרסה הציבורית. משחקים אונליין נמצאים בגרסת הקהילה."}</div>',
    '<div class="hint">כל משתמש נכנס עם שם המשתמש והסיסמה שלו, מכל מכשיר.</div>')
h = re.sub(r'<p style="color:var\(--ink-2\);margin:14px 0 6px">משחק אונליין עובד כשכל המשתתפים:</p>\s*<ol.*?</ol>',
           '<p style="color:var(--ink-2);margin:14px 0 6px">אין כרגע חיבור לשרת המשחקים. בדקו את החיבור לאינטרנט ונסו שוב.</p>', h, count=1, flags=re.S)
rep_tr("ניהול האפליקציה זמין בתוך Claude", "ניהול האפליקציה זמין למנהלים", "App admin is available to admins")

# --- scripts ---
shim = (ROOT / "src/shim.js").read_text(encoding="utf-8")
web = (ROOT / "src/web.js").read_text(encoding="utf-8")
rep('<script>\nconst LOGO_SVG=',
    '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js"></script>\n<script>\n' + shim + '\n</script>\n<script>\nconst LOGO_SVG=')
i = h.index("/* ========================== BOOT ========================== */")
j = h.index("</script>", i)
h = h[:i] + web + "\n" + h[j:]
for bad in ("�",):
    if bad in h: sys.exit("build: replacement char in output")
out = ROOT / "public"
out.mkdir(exist_ok=True)
(out / "index.html").write_text(h, encoding="utf-8")
for f in ["icon-180.png", "icon-192.png", "icon-512.png", "manifest.json"]:
    src = ROOT.parent / f
    if src.exists(): shutil.copy(src, out / f)
print("built", out / "index.html", len(h) // 1024, "KB")
