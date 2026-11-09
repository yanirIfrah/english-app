/* ========================== WEB EDITION (Vercel + Supabase) – overrides ========================== */
const EMAIL_DOMAIN="users.lomdim-anglit.app";
const toEmail=u=>"u"+[...new TextEncoder().encode(String(u).toLowerCase())].map(b=>b.toString(16).padStart(2,"0")).join("")+"@"+EMAIL_DOMAIN;
const SYNC={t:null,last:{},busy:false}; let MY_SUBS=[];
const STAFF_COLS=["id","user","name","age","gender","level","grade","bagrut","avatar","stars","ctrl","locked","lockMsg","notice","role","mgrPerms","hash","salt","_adminAt","walletPaid","lastSeen"];
function rowToProfile(r){
  return {...(r.data||{}),id:r.id,user:r.username,name:r.name,age:r.age,gender:r.gender||"f",level:r.level||1,grade:r.grade||null,bagrut:r.bagrut||null,avatar:r.avatar||"a1",stars:r.stars||0,
    ctrl:r.ctrl||{},locked:!!r.locked,lockMsg:r.lock_msg||"",notice:r.notice?{text:r.notice}:null,role:r.role,mgrPerms:r.mgr_perms||{},walletPaid:Number(r.wallet_paid)||0,hash:"sb",_adminAt:r.admin_at||null};
}
function profileCols(p){ const data={}; for(const k in p) if(!STAFF_COLS.includes(k)) data[k]=p[k];
  return {name:p.name,age:p.age,gender:p.gender||"f",level:p.level||1,grade:p.grade||null,bagrut:p.bagrut||null,avatar:p.avatar||"a1",stars:p.stars||0,data}; }
function setBaseline(p){ const c=profileCols(p); SYNC.last={}; for(const k in c) SYNC.last[k]=JSON.stringify(c[k]); }
function save(){ if(!cur()||!WEB.sb) return; clearTimeout(SYNC.t); SYNC.t=setTimeout(syncMe,1500); }
async function syncMe(){
  clearTimeout(SYNC.t); const p=cur(); if(!p||!WEB.sb||SYNC.busy) return;
  const c=profileCols(p), patch={}; for(const k in c){ const js=JSON.stringify(c[k]); if(SYNC.last[k]!==js) patch[k]=c[k]; }
  if(!Object.keys(patch).length) return;
  patch.last_seen=new Date().toISOString(); SYNC.busy=true;
  try{ const {error}=await WEB.sb.from("profiles").update(patch).eq("id",p.id); if(!error) for(const k in patch) SYNC.last[k]=JSON.stringify(patch[k]); }catch(e){}
  SYNC.busy=false;
}
function syncRoster(){ return syncMe(); }
function scheduleSync(){} function subscribeManaged(){} function restoreSession(){}
function applyRole(r){ CLOUD.owner=r.role==="admin"; MGR=r.role==="manager"?{id:r.id,name:r.name,perms:r.mgr_perms||{}}:null; }
async function loadCfg(){ try{ const {data}=await WEB.sb.from("app_config").select("data").eq("id",1).maybeSingle(); CLOUD.cfg=(data&&data.data)||{}; }catch(e){} }
async function loadMe(){
  if(!WEB.sb) return null;
  const {data:{session}}=await WEB.sb.auth.getSession(); if(!session) return null;
  const {data:r}=await WEB.sb.from("profiles").select("*").eq("id",session.user.id).maybeSingle(); if(!r) return null;
  const p=rowToProfile(r); mem.profiles=[p]; mem.current=p.id; setBaseline(p); applyRole(r); await loadCfg(); subscribeMe(p.id);
  return p;
}
function subscribeMe(id){
  MY_SUBS.forEach(c=>{ try{ WEB.sb.removeChannel(c); }catch(e){} }); MY_SUBS=[];
  MY_SUBS.push(WEB.sb.channel("me-"+id).on("postgres_changes",{event:"UPDATE",schema:"public",table:"profiles",filter:"id=eq."+id},pl=>applyRow(pl.new))
    .on("postgres_changes",{event:"DELETE",schema:"public",table:"profiles",filter:"id=eq."+id},()=>signOutLocal("החשבון נמחק על ידי המנהל")).subscribe());
  MY_SUBS.push(WEB.sb.channel("cfg").on("postgres_changes",{event:"UPDATE",schema:"public",table:"app_config"},pl=>{ CLOUD.cfg=(pl.new&&pl.new.data)||{}; if(document.getElementById("home-screen")) renderHome(); }).subscribe());
}
function applyRow(r){
  const p=cur(); if(!p||!r||r.id!==p.id) return;
  p.ctrl=r.ctrl||{}; p.locked=!!r.locked; p.lockMsg=r.lock_msg||""; p.notice=r.notice?{text:r.notice}:null; p.role=r.role; p.walletPaid=Number(r.wallet_paid)||0; applyRole(r);
  if(r.admin_at&&r.admin_at!==p._adminAt){ p._adminAt=r.admin_at; ["name","age","level","gender","grade","bagrut"].forEach(k=>{ p[k]=r[k]; SYNC.last[k]=JSON.stringify(r[k]); }); logEvent(p,"admin","הגדרות עודכנו על ידי המנהל"); }
  if(p.locked) return signOutLocal("החשבון נעול"+(p.lockMsg?": "+p.lockMsg:""));
  if(document.getElementById("home-screen")) renderHome();
}
async function signOutLocal(msg){
  MY_SUBS.forEach(c=>{ try{ WEB.sb.removeChannel(c); }catch(e){} }); MY_SUBS=[];
  mem.current=null; mem.profiles=[]; CLOUD.owner=false; MGR=null;
  try{ await WEB.sb.auth.signOut(); }catch(e){}
  renderLogin(msg||"");
}
function clearSession(){
  if(COMM.lobby) leaveLobby(); if(COMM.G) endGame(false);
  if(mem.current){ const was=mem.current; mem.current=null; mem.profiles=[]; CLOUD.owner=false; MGR=null; MY_SUBS.forEach(c=>{ try{ WEB.sb.removeChannel(c); }catch(e){} }); MY_SUBS=[]; if(WEB.sb) WEB.sb.auth.signOut(); }
}
async function api(action,payload){
  const {data}=await WEB.sb.auth.getSession(); const tok=data&&data.session&&data.session.access_token;
  const r=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json",...(tok?{authorization:"Bearer "+tok}:{})},body:JSON.stringify({action,...payload})});
  let j={}; try{ j=await r.json(); }catch(e){}
  if(!r.ok) throw {status:r.status,code:j.error||"error"};
  return j;
}
const API_ERR={taken:"שם המשתמש הזה כבר תפוס",signup_closed:"ההרשמה סגורה. חשבונות חדשים נפתחים על ידי המנהל.",weak_password:"הסיסמה צריכה להכיל לפחות 6 תווים",bad_username:"שם המשתמש צריך להיות 3–20 תווים: אותיות, מספרים, נקודה, קו תחתון או מקף (בלי רווחים)",bad_age:"נא להזין גיל בין 2 ל-120",bad_name:"נא להזין שם",forbidden:"אין הרשאה לפעולה הזו",not_configured:"השרת עוד לא הוגדר (חסרים מפתחות Supabase ב-Vercel)"};
const apiErr=e=>API_ERR[e&&e.code]||"משהו השתבש. נסו שוב.";
function setupCard(){ return `<div class="auth"><div class="card pop"><div class="tile-ic">${icon("settings",22)}</div><h1>האתר עוד לא מחובר</h1><p class="sub">יש להגדיר ב-Vercel את המשתנים SUPABASE_URL ו-SUPABASE_ANON_KEY ולפרסם מחדש.</p></div></div>`; }

Object.assign(I18N,{"אין הרשאה לפעולה הזו":"You don't have permission for this","אין הרשאת ניהול":"No admin permission","את הרמה וגיל משנה המנהל.":"The admin changes level and age.",
"בוחרים משתמש קיים והופכים אותו למנהל. מנהל רואה את כל המשתמשים בניהול האפליקציה ופועל לפי ההרשאות שנבחרו כאן.":"Pick an existing user and make them a manager. Managers see all users in app admin and act with the permissions chosen here.",
"האתר עוד לא מחובר":"The site isn't connected yet","הגדרות עודכנו על ידי המנהל":"Settings updated by the admin","ההרשמה סגורה. חשבונות חדשים נפתחים על ידי המנהל.":"Sign-up is closed. The admin creates new accounts.",
"החשבון נוצר, אבל הכניסה נכשלה. נסו להיכנס.":"The account was created but sign-in failed. Try signing in.","החשבון נוצר. נסו להיכנס.":"The account was created. Try signing in.","החשבון נמחק":"The account was deleted","החשבון נמחק על ידי המנהל":"The account was deleted by the admin",
"החשבון נשמר בענן – אפשר להתחבר אליו מכל מכשיר.":"The account is saved in the cloud – sign in from any device.","החשבון נשמר בענן. מוסרים למשתמש את שם המשתמש והסיסמה, והוא נכנס מכל מכשיר.":"The account is saved in the cloud. Give the user the username and password, and they can sign in from any device.",
"היכנסו עם חשבון מנהל כדי לנהל משתמשים.":"Sign in with an admin account to manage users.","היכנסו עם שם המשתמש והסיסמה שלכם – מכל מכשיר.":"Sign in with your username and password – from any device.","הסיסמה צריכה להכיל לפחות 6 תווים":"The password needs at least 6 characters",
"העדכון נכשל. נסו שוב.":"The update failed. Try again.","השרת עוד לא הוגדר (חסרים מפתחות Supabase ב-Vercel)":"The server isn't set up yet (Supabase keys missing in Vercel)","חשבונות חדשים נפתחים על ידי המנהל.":"The admin creates new accounts.","טוען משתמשים…":"Loading users…",
"יצירת משתמש":"Create user","יש להגדיר ב-Vercel את המשתנים SUPABASE_URL ו-SUPABASE_ANON_KEY ולפרסם מחדש.":"Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel and redeploy.","לא נמצא פרופיל לחשבון הזה.":"No profile was found for this account.",
"(לפחות 6 תווים)":"(at least 6 characters)","(3–20 תווים: אותיות, מספרים, . _ -)":"(3–20 characters: letters, numbers, . _ -)","משתמש חדש":"New user","ניהול זמין למנהלים":"Admin is for managers","סיסמה (לפחות 6 תווים)":"Password (at least 6 characters)","עוד אין משתמשים אחרים.":"No other users yet.",
"פנו למנהל האפליקציה לאיפוס הסיסמה.":"Ask the app admin to reset your password.","רענון":"Refresh","רק ADMIN ומנהלים רואים את ניהול האפליקציה.":"Only the ADMIN and managers see app admin.","שם המשתמש הזה כבר תפוס":"This username is taken","הסיסמה הוחלפה":"Password changed",
"שם המשתמש צריך להיות 3–20 תווים: אותיות, מספרים, נקודה, קו תחתון או מקף (בלי רווחים)":"Usernames are 3–20 characters: letters, numbers, dot, underscore or hyphen (no spaces)","השרת":"the server",
"החשבון נעול":"The account is locked","משהו השתבש. נסו שוב.":"Something went wrong. Try again.","הגדרות כלליות":"General settings","מנהלים":"Managers","יש לפנות למנהל.":"Contact the admin."});
[["החשבון נעול: {}. יש לפנות למנהל.","The account is locked: {}. Contact the admin."],["החשבון נעול: {}","The account is locked: {}"],["מנהל: {}","Manager: {}"]].forEach(([k,v])=>PATS.push([new RegExp("^"+_escRe(k)+"$"),v])); PATS.sort((a,b)=>b[0].source.length-a[0].source.length);
/* ---------- login ---------- */
async function renderLogin(msg=""){
  PLAN=null;
  if(mem.current) await syncMe();
  clearSession();
  if(!WEB.sb){ app.innerHTML=topBar(" ")+setupCard(); return; }
  app.innerHTML=topBar(" ")+`<div class="auth"><div class="card pop">
    <div class="tile-ic">${icon("login",22)}</div>
    <h1>כניסה לחשבון</h1><p class="sub">היכנסו עם שם המשתמש והסיסמה שלכם – מכל מכשיר.</p><div class="login-new"><b>חדשים כאן?</b> לומדים אנגלית היא אפליקציה ללימוד אנגלית בכיף לכל המשפחה, מותאמת לגיל ולרמה. <button type="button" class="link" id="tosign2">להרשמה ←</button></div>
    <form id="lf" autocomplete="on">
      <label class="lbl" for="lu">שם משתמש</label><input class="field" id="lu" autocomplete="username" autocapitalize="off" spellcheck="false">
      <label class="lbl" for="lp">סיסמה</label>${pwField("lp")}
      <div class="err" id="lerr">${esc(msg)}</div>
      <button class="btn block" id="lgo" type="submit">כניסה</button>
    </form>
    <div class="divider"></div>
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:14px">
      <span style="color:var(--muted)">אין לך חשבון? <button class="link" id="tosign">הרשמה</button></span>
      <button class="link muted" id="forgot">שכחתי סיסמה</button></div></div></div>`;
  wireEyes(app);
  $("#tosign").onclick=renderSignup; $("#tosign2").onclick=renderSignup;
  $("#forgot").onclick=()=>{ $("#lerr").style.color="var(--ink-2)"; $("#lerr").textContent="פנו למנהל האפליקציה לאיפוס הסיסמה."; };
  $("#lf").onsubmit=async e=>{
    e.preventDefault(); const err=$("#lerr"); err.style.color="";
    if(Date.now()<LOCK_UNTIL){ err.textContent=`יותר מדי ניסיונות. נסו שוב בעוד ${Math.ceil((LOCK_UNTIL-Date.now())/1000)} שניות.`; return; }
    const u=normUser($("#lu").value), pw=$("#lp").value;
    if(!u||!pw){ err.textContent="נא למלא שם משתמש וסיסמה"; return; }
    $("#lgo").disabled=true; err.innerHTML=`<span class="spin"></span>`;
    const {error}=await WEB.sb.auth.signInWithPassword({email:toEmail(u),password:pw});
    if(error){ $("#lgo").disabled=false; FAILS++; if(FAILS>=5){ LOCK_UNTIL=Date.now()+30000; FAILS=0; } err.textContent="שם המשתמש או הסיסמה לא נכונים"; $("#lp").value=""; return; }
    FAILS=0; const p=await loadMe(); $("#lgo").disabled=false;
    if(!p){ err.textContent="לא נמצא פרופיל לחשבון הזה."; await WEB.sb.auth.signOut(); return; }
    if(p.locked){ const m="החשבון נעול"+(p.lockMsg?": "+p.lockMsg:"")+". יש לפנות למנהל."; mem.current=null; mem.profiles=[]; await WEB.sb.auth.signOut(); err.textContent=m; return; }
    logEvent(p,"login","כניסה"); renderHome();
  };
  setTimeout(()=>{ const f=$("#lu"); if(f&&!("ontouchstart" in window)) f.focus(); },50);
}
Object.assign(I18N,{"כמה מילים באנגלית כבר מוכרות לך?": "How many English words do you already know?", "עד כמה קל לך לקרוא שלטים או טקסטים באנגלית?": "How easily can you read signs or texts in English?", "כשמדברים באנגלית בסרטונים או במשחקים, כמה מזה מובן לך?": "When people speak English in videos or games, how much do you understand?", "כמה קל לך לענות כשמישהו שואל אותך משהו באנגלית?": "How easy is it to answer when someone asks you something in English?", "כמה קל לך לכתוב משפט באנגלית בלי שגיאות?": "How easy is it to write a sentence in English without mistakes?", "לומדים אנגלית": "Learn English", "אפליקציה ללימוד אנגלית לכל המשפחה – מגיל 2 ועד מבוגרים. המטרה: ללמוד אנגלית בכיף, בקצב אישי ובהתאם לגיל ולרמה, ולהתקדם בביטחון כל יום.": "An English-learning app for the whole family – from age 2 to adults. The goal: learn English with fun, at your own pace, matched to age and level, and grow more confident every day.", "מילים, האזנה, קריאה ודקדוק – מותאמים לגיל ולרמה": "Words, listening, reading and grammar – matched to age and level", "לפי תוכנית משרד החינוך: מכיתה ג׳ ועד הכנה לבגרות 4–5 יח״ל": "Follows the Israeli Ministry of Education curriculum: grade 3 to Bagrut prep (4–5 units)", "כוכבים על כל הצלחה, וקופה שצוברת כסף למתנה": "Stars for every success, and a wallet that saves money toward a gift", "משחקי מילים אונליין מול חברים ובני משפחה": "Online word games with friends and family", "חשבון אישי לכל אחד – נכנסים מכל מכשיר": "A personal account for everyone – sign in from any device", "1. פרטים": "1. Details", "2. הרמה שלך": "2. Your level", "יצירת חשבון": "Create account", "המשך ←": "Continue →", "5 שאלות קצרות על הרמה שלך": "5 quick questions about your level", "אין תשובות נכונות או לא נכונות. לפי התשובות נתאים לך תרגולים ברמה הנכונה.": "There are no right or wrong answers. We'll use them to match practice to your level.", "→ חזרה לפרטים": "← Back to details", "חדשים כאן?": "New here?", "לומדים אנגלית היא אפליקציה ללימוד אנגלית בכיף לכל המשפחה, מותאמת לגיל ולרמה.": "Learn English is a fun English-learning app for the whole family, matched to age and level.", "להרשמה ←": "Sign up →", "כמעט כלום": "almost nothing", "המון מילים": "lots of words", "בכלל לא": "not at all", "קריאה בקלות": "read easily", "שום דבר": "nothing", "כמעט הכול": "almost everything", "מביך / אין לי מושג": "awkward / no idea", "תשובה חופשית ובביטחון": "answer freely and confidently", "עוד לא מצליחים לכתוב": "can't write yet", "בלי שום בעיה": "no problem at all"});
[["1 = {}", "1 = {}"], ["5 = {}", "5 = {}"], ["נא לענות על שאלה {}", "Please answer question {}"], ["התאמנו לך {}. אפשר לשנות בהגדרות.", "We matched you to {}. You can change it in settings."]].forEach(([k,v])=>PATS.push([new RegExp("^"+_escRe(k)+"$"),v])); PATS.sort((a,b)=>b[0].source.length-a[0].source.length);
/* ---------- signup: intro → details → 5 self-assessment questions ---------- */
const SELF_Q=[
  {q:"כמה מילים באנגלית כבר מוכרות לך?",lo:"כמעט כלום",hi:"המון מילים"},
  {q:"עד כמה קל לך לקרוא שלטים או טקסטים באנגלית?",lo:"בכלל לא",hi:"קריאה בקלות"},
  {q:"כשמדברים באנגלית בסרטונים או במשחקים, כמה מזה מובן לך?",lo:"שום דבר",hi:"כמעט הכול"},
  {q:"כמה קל לך לענות כשמישהו שואל אותך משהו באנגלית?",lo:"מביך / אין לי מושג",hi:"תשובה חופשית ובביטחון"},
  {q:"כמה קל לך לכתוב משפט באנגלית בלי שגיאות?",lo:"עוד לא מצליחים לכתוב",hi:"בלי שום בעיה"}
];
function appIntro(){
  const f=(ic,t)=>`<div class="ai-f"><span class="ai-i">${icon(ic,17)}</span><span>${t}</span></div>`;
  return `<div class="app-intro"><div class="ai-logo" data-notr>${LOGO_SVG}</div>
    <h1 style="margin:10px 0 4px">לומדים אנגלית</h1>
    <p class="ai-lead">אפליקציה ללימוד אנגלית לכל המשפחה – מגיל 2 ועד מבוגרים. המטרה: ללמוד אנגלית בכיף, בקצב אישי ובהתאם לגיל ולרמה, ולהתקדם בביטחון כל יום.</p>
    <div class="ai-fs">${f("cards","מילים, האזנה, קריאה ודקדוק – מותאמים לגיל ולרמה")}${f("trophy","לפי תוכנית משרד החינוך: מכיתה ג׳ ועד הכנה לבגרות 4–5 יח״ל")}${f("wallet","כוכבים על כל הצלחה, וקופה שצוברת כסף למתנה")}${f("users","משחקי מילים אונליין מול חברים ובני משפחה")}${f("phone","חשבון אישי לכל אחד – נכנסים מכל מכשיר")}</div></div>`;
}
function selfLevel(ans,age,grade,bagrut){
  const avg=ans.reduce((a,b)=>a+b,0)/ans.length;
  const level=avg<2.3?1:avg<3.7?2:3;
  let wl=1+(avg-1)*1.1;
  const tmp={age,grade,bagrut};
  if(isSchool(tmp)){ const [lo,hi]=LV_RANGE[bandOf(tmp)]; wl=Math.max(lo,Math.min(hi,(defaultWl(tmp)+wl)/2)); }
  return {avg:Math.round(avg*10)/10,level,wl:Math.round(Math.max(1,Math.min(5.9,wl))*100)/100};
}
function renderSignup(){
  PLAN=null; clearSession();
  if(!WEB.sb){ app.innerHTML=topBar(" ")+setupCard(); return; }
  if(CLOUD.cfg&&CLOUD.cfg.allowSignup===false){ app.innerHTML=topBar(" ")+`<div class="auth"><div class="card pop">${appIntro()}<div class="divider"></div><h2 style="font-size:19px">ההרשמה סגורה</h2><p class="sub">חשבונות חדשים נפתחים על ידי המנהל.</p><div class="row"><button class="btn ghost" id="tl">חזרה לכניסה</button></div></div></div>`; $("#tl").onclick=()=>renderLogin(); return; }
  const st={level:1,avatar:"a1",cat:"anime",gender:"f"}; let D=null; const ans=Array(SELF_Q.length).fill(0);
  app.innerHTML=topBar(" ")+`<div class="auth wide"><div class="card pop">
    ${appIntro()}
    <div class="divider"></div>
    <div id="su-step1">
    <div class="steps"><span class="on">1. פרטים</span><span>2. הרמה שלך</span></div>
    <h2 style="font-size:20px;margin:6px 0 2px">יצירת חשבון</h2><p class="sub">החשבון נשמר בענן – אפשר להתחבר אליו מכל מכשיר.</p>
    <form id="sf" autocomplete="off">
      <div class="two"><div><label class="lbl" for="sn">השם שלך</label><input class="field" id="sn" maxlength="20" placeholder="למשל: נועה"></div>
        <div><label class="lbl" for="sa">גיל</label><input class="field" id="sa" type="number" min="2" max="120" inputmode="numeric" placeholder="8"></div></div>
      <label class="lbl" for="su">שם משתמש <span style="font-weight:400;color:var(--muted)">(3–20 תווים: אותיות, מספרים, . _ -)</span></label>
      <input class="field" id="su" autocomplete="username" autocapitalize="off" spellcheck="false">
      <div class="two"><div><label class="lbl" for="sp">סיסמה <span style="font-weight:400;color:var(--muted)">(לפחות 6 תווים)</span></label>${pwField("sp","","new-password")}</div>
        <div><label class="lbl" for="sp2">אימות סיסמה</label>${pwField("sp2","","new-password")}</div></div>
      <label class="lbl">מין</label><div id="sgn">${genderChoices("f")}</div>
      ${gradeFields("",null)}
      <label class="lbl">דמות לפרופיל</label><div id="sav"></div>
      <div class="err" id="serr"></div>
      <div class="row"><button type="button" class="link" id="tologin">כבר יש לי חשבון</button><button class="btn" id="snext" type="submit">המשך ←</button></div>
    </form></div>
    <div id="su-step2" hidden>
      <div class="steps"><span class="done">1. פרטים</span><span class="on">2. הרמה שלך</span></div>
      <h2 style="font-size:20px;margin:6px 0 2px">5 שאלות קצרות על הרמה שלך</h2>
      <p class="sub">אין תשובות נכונות או לא נכונות. לפי התשובות נתאים לך תרגולים ברמה הנכונה.</p>
      <div id="sq">${SELF_Q.map((x,i)=>`<div class="sq" data-q="${i}"><div class="sq-t"><span class="sq-n">${i+1}</span>${x.q}</div>
        <div class="sq-sc">${[1,2,3,4,5].map(n=>`<button type="button" class="sq-b" data-v="${n}" aria-label="${n}">${n}</button>`).join("")}</div>
        <div class="sq-ends"><span>1 = <span>${x.lo}</span></span><span>5 = <span>${x.hi}</span></span></div></div>`).join("")}</div>
      <div class="err" id="qerr"></div>
      <div class="row"><button type="button" class="btn ghost" id="sback">→ חזרה לפרטים</button><button class="btn" id="sgo" type="button">יצירת חשבון</button></div>
    </div></div></div>`;
  wireEyes(app); avatarPicker($("#sav"),st); wireGender($("#sgn"),st,genderAvatarSync(st,$("#sav"))); wireGradeFields();
  $("#tologin").onclick=()=>renderLogin();
  const show=n=>{ $("#su-step1").hidden=n!==1; $("#su-step2").hidden=n!==2; const s=document.querySelector(n===1?"#su-step1":"#su-step2"); if(s) s.scrollIntoView({behavior:"smooth",block:"start"}); };
  const create=async(sa)=>{
    const err=n=>{ const e=$(sa?"#qerr":"#serr"); return e; };
    const e=err(), btn=$(sa?"#sgo":"#snext");
    btn.disabled=true; e.innerHTML=`<span class="spin"></span>`;
    const lv=sa?selfLevel(ans,D.age,D.grade,D.bagrut):{level:1};
    try{ await api("signup",{username:D.u,password:D.pw,name:D.name,age:D.age,gender:st.gender,level:lv.level,avatar:st.avatar,grade:D.grade,bagrut:D.bagrut}); }
    catch(x){ btn.disabled=false; e.textContent=apiErr(x); if(x&&["taken","bad_username","weak_password","bad_age","bad_name"].includes(x.code)&&sa){ show(1); $("#serr").textContent=apiErr(x); } return; }
    const {error}=await WEB.sb.auth.signInWithPassword({email:toEmail(D.u),password:D.pw});
    if(error){ btn.disabled=false; return e.textContent="החשבון נוצר, אבל הכניסה נכשלה. נסו להיכנס."; }
    const p=await loadMe(); if(!p) return renderLogin("החשבון נוצר. נסו להיכנס.");
    if(sa){ p.selfAssess={ans:[...ans],avg:lv.avg,at:Date.now()}; p.wl=lv.wl; save(); }
    logEvent(p,"login","הרשמה"); renderHome();
    if(sa) setTimeout(()=>flash(`התאמנו לך ${LEVELS[lv.level-1].name}. אפשר לשנות בהגדרות.`),600);
  };
  $("#sf").onsubmit=e=>{
    e.preventDefault(); const err=$("#serr");
    const name=$("#sn").value.trim(), age=parseInt($("#sa").value,10), u=normUser($("#su").value), pw=$("#sp").value;
    if(!name) return err.textContent="נא להזין שם";
    if(!(age>=2&&age<=120)) return err.textContent="נא להזין גיל בין 2 ל-120";
    if(!validUser(u)) return err.textContent=API_ERR.bad_username;
    if(pw.length<6) return err.textContent=API_ERR.weak_password;
    if(pw!==$("#sp2").value) return err.textContent="הסיסמאות לא תואמות";
    const g={}; readGradeFields(g); err.textContent="";
    D={name,age,u,pw,grade:g.grade||null,bagrut:g.bagrut||null};
    if(age<7) return create(false);   // little ones start at the beginning – no questionnaire
    show(2);
  };
  app.querySelectorAll(".sq").forEach(box=>box.querySelectorAll(".sq-b").forEach(b=>b.onclick=()=>{
    const i=+box.dataset.q; ans[i]=+b.dataset.v; box.querySelectorAll(".sq-b").forEach(x=>x.classList.toggle("sel",x===b)); box.classList.add("ok"); $("#qerr").textContent="";
  }));
  $("#sback").onclick=()=>show(1);
  $("#sgo").onclick=()=>{ const miss=ans.findIndex(v=>!v); if(miss>=0){ $("#qerr").textContent=`נא לענות על שאלה ${miss+1}`; app.querySelector(`.sq[data-q="${miss}"]`).scrollIntoView({behavior:"smooth",block:"center"}); return; } create(true); };
}
/* ---------- own settings ---------- */
function settingsModal(){
  const p=cur(); if(!p) return;
  const st={level:p.level,avatar:p.avatar,cat:AV[p.avatar]?AV[p.avatar].c:"anime",gender:p.gender||"f"}, canLv=ctrlOf(p).selfLevel!==false;
  const root=$("#modal-root");
  root.innerHTML=`<div class="modal"><div class="card pop">
    <div class="row" style="margin-top:0"><h2>הגדרות חשבון</h2><button class="x" id="sx" aria-label="סגירה">${icon("close",18)}</button></div>
    <div style="color:var(--muted);font-size:14px;margin-top:2px">שם משתמש: <b class="en">${esc(p.user||"")}</b>${p.role!=="user"?` · <span class="badge">${p.role==="admin"?"ADMIN":"מנהל"}</span>`:""}</div>
    <div class="two"><div><label class="lbl" for="en">שם</label><input class="field" id="en" maxlength="20" value="${esc(p.name)}"></div>
      <div><label class="lbl" for="ea">גיל</label><input class="field" id="ea" type="number" min="2" max="120" value="${p.age}" ${canLv?"":"disabled"}></div></div>
    <label class="lbl">מין</label><div id="egn">${genderChoices(st.gender)}</div>
    ${canLv?gradeFields(p.grade,p.bagrut):""}
    ${canLv?`<label class="lbl">רמת אנגלית</label><div id="elv">${levelChoices(p.level)}</div>`:`<div class="hint">את הרמה וגיל משנה המנהל.</div>`}
    <label class="lbl">דמות לפרופיל</label><div id="eav"></div>
    <div class="err" id="eerr"></div><div class="row"><span></span><button class="btn" id="esave">שמירת שינויים</button></div>
    <div class="divider"></div>
    <h3 style="font-size:16px;display:flex;align-items:center;gap:8px">${icon("key",18)} שינוי סיסמה</h3>
    <div class="two"><div><label class="lbl" for="po">סיסמה נוכחית</label>${pwField("po")}</div><div><label class="lbl" for="pn">סיסמה חדשה</label>${pwField("pn","","new-password")}</div></div>
    <div class="err" id="perr"></div><div class="row" style="margin-top:8px"><span></span><button class="btn ghost" id="pchg">עדכון סיסמה</button></div>
    ${p.role!=="admin"?`<div class="divider"></div><button class="link danger" id="edel">מחיקת החשבון</button><div id="edelbox"></div>`:""}
  </div></div>`;
  wireEyes(root); if(canLv){ wireLevels($("#elv"),st); wireGradeFields(); } avatarPicker($("#eav"),st); wireGender($("#egn"),st);
  $("#sx").onclick=()=>root.innerHTML="";
  $("#esave").onclick=()=>{
    const name=$("#en").value.trim(), age=parseInt($("#ea").value,10), e=$("#eerr");
    if(!name) return e.textContent="נא להזין שם"; if(canLv&&!(age>=2&&age<=120)) return e.textContent="גיל בין 2 ל-120";
    Object.assign(p,{name,gender:st.gender,avatar:st.avatar}); if(canLv){ Object.assign(p,{age,level:st.level}); readGradeFields(p); }
    save(); root.innerHTML=""; renderHome();
  };
  const verify=async pw=>{ const {error}=await WEB.sb.auth.signInWithPassword({email:toEmail(p.user),password:pw}); return !error; };
  $("#pchg").onclick=async()=>{
    const e=$("#perr"); e.className="err"; const n=$("#pn").value;
    if(n.length<6) return e.textContent=API_ERR.weak_password;
    if(!(await verify($("#po").value))) return e.textContent="הסיסמה הנוכחית לא נכונה";
    const {error}=await WEB.sb.auth.updateUser({password:n});
    if(error) return e.textContent="העדכון נכשל. נסו שוב.";
    e.className="okmsg"; e.textContent="הסיסמה עודכנה"; $("#po").value=$("#pn").value="";
  };
  const dl=$("#edel"); if(dl) dl.onclick=()=>{
    $("#edelbox").innerHTML=`<div style="margin-top:10px;font-size:14px">מחיקה תסיר את כל ההתקדמות והתוכניות. להמשך הקלידו את הסיסמה:</div>${pwField("dp")}<div class="err" id="derr"></div><button class="btn danger sm" id="dgo">מחיקה סופית</button>`;
    wireEyes($("#edelbox"));
    $("#dgo").onclick=async()=>{ if(!(await verify($("#dp").value))) return $("#derr").textContent="סיסמה לא נכונה";
      try{ await api("delete_user",{user_id:p.id}); }catch(x){ return $("#derr").textContent=apiErr(x); }
      root.innerHTML=""; signOutLocal("החשבון נמחק"); };
  };
}
function renderParent(){ if(cur()&&(CLOUD.owner||MGR)) return cloudEnter(); app.innerHTML=topBar()+lockedCard("ניהול זמין למנהלים","היכנסו עם חשבון מנהל כדי לנהל משתמשים."); $("#lkb").onclick=()=>cur()?renderHome():renderLogin(); }

/* ---------- admin console over Supabase ---------- */
let CL_SUB=null, CL_T=null;
async function refreshRows(){ const {data}=await WEB.sb.from("profiles").select("*").order("created_at",{ascending:true}); CLOUD.rows=data||[]; CLOUD.managed={}; }
async function cloudEnter(){
  if(!WEB.sb){ app.innerHTML=topBar()+setupCard(); return; }
  if(!(CLOUD.owner||MGR)){ app.innerHTML=topBar()+lockedCard("אין הרשאת ניהול","רק ADMIN ומנהלים רואים את ניהול האפליקציה."); $("#lkb").onclick=renderHome; return; }
  app.innerHTML=topBar()+`<div id="cloud-screen" class="card" style="text-align:center;padding:40px"><span class="spin"></span> טוען משתמשים…</div>`;
  await refreshRows();
  if(!CL_SUB) CL_SUB=WEB.sb.channel("staff-profiles").on("postgres_changes",{event:"*",schema:"public",table:"profiles"},()=>{ clearTimeout(CL_T); CL_T=setTimeout(async()=>{ await refreshRows(); if(cloudCanRefresh()) renderCloud(); },800); }).subscribe();
  renderCloud();
}
function cloudLeave(){ if(CL_SUB){ try{ WEB.sb.removeChannel(CL_SUB); }catch(e){} CL_SUB=null; } CL={tab:"users",uid:null,q:"",filter:"all",unsubs:[]}; }
function cloudUsers(){
  return (CLOUD.rows||[]).map(r=>{ const p=rowToProfile(r); p.lastSeen=r.last_seen?Date.parse(r.last_seen):0; const s=summary(p);
    return {...s,lastSeen:p.lastSeen,device:r.role==="admin"?"ADMIN":r.role==="manager"?"מנהל":"",syncedAt:p.lastSeen||Date.parse(r.created_at),managedAt:0,role:r.role,locked:!!r.locked,ctrl:r.ctrl||{},log:(p.log||[]).slice(-15)}; });
}
async function writeManaged(id,patch){
  if(patch.pwPlain) await api("reset_password",{user_id:id,password:patch.pwPlain});
  else if(patch.del) await api("delete_user",{user_id:id});
  else{ const {error}=await WEB.sb.rpc("admin_update",{target:id,patch}); if(error) throw error; }
  await refreshRows();
}
function cloudShell(inner){
  const tabs=[["users","users","משתמשים"],["settings","settings","הגדרות כלליות"],...(CLOUD.owner?[["managers","shield","מנהלים"],["create","userplus","משתמש חדש"]]:[])];
  app.innerHTML=topBar(`<span class="badge ${CLOUD.owner?"":"sun"}" style="font-size:12px">${CLOUD.owner?"ADMIN":"מנהל: "+esc(MGR.name)}</span>`)+`<div id="cloud-screen"></div>
    <div class="row" style="margin:0 0 12px"><h2 style="font-size:20px;display:flex;align-items:center;gap:8px">${icon("shield",20)} ניהול האפליקציה</h2>
      <div style="display:flex;gap:8px"><button class="btn ghost sm" id="clr">${icon("spark",15)} רענון</button><button class="btn ghost sm" id="clx">${icon("close",15)} סגירה</button></div></div>
    <div class="tabs" style="margin-bottom:14px">${tabs.map(([id,ic,n])=>`<button class="tab ${CL.tab===id&&!CL.uid?"on":""}" data-ctab="${id}" style="display:flex;align-items:center;justify-content:center;gap:6px">${icon(ic,15)} ${n}</button>`).join("")}</div>${inner}`;
  app.querySelectorAll("[data-ctab]").forEach(b=>b.onclick=()=>{ CL.tab=b.dataset.ctab; CL.uid=null; renderCloud(); });
  $("#clx").onclick=()=>{ cloudLeave(); renderHome(); };
  $("#clr").onclick=async()=>{ await refreshRows(); renderCloud(); };
}
function renderCloud(){
  if(!(CLOUD.owner||MGR)) return cloudEnter();
  if(!CL.uid&&CL.tab==="create"&&CLOUD.owner) return renderCloudCreate();
  if(!CL.uid&&CL.tab==="managers"&&CLOUD.owner) return renderCloudManagersWeb();
  return renderCloudBase();
}
function renderCloudManagersWeb(){
  const me=cur(), rows=(CLOUD.rows||[]).filter(r=>r.id!==me.id&&r.role!=="admin");
  cloudShell(`<div class="card"><h3 style="font-size:16px">מנהלים</h3><p style="color:var(--muted);font-size:14px;margin:6px 0 0">בוחרים משתמש קיים והופכים אותו למנהל. מנהל רואה את כל המשתמשים בניהול האפליקציה ופועל לפי ההרשאות שנבחרו כאן.</p>
    ${rows.map(r=>`<div class="divider" style="margin:14px 0"></div><div class="row" style="margin:0">${avatarHTML(r.avatar,36)}<div style="flex:1"><b>${esc(r.name)}</b> <span class="en" style="color:var(--muted);font-size:13px">${esc(r.username)}</span></div>
      <select class="field" data-role="${r.id}" style="width:auto"><option value="user" ${r.role==="user"?"selected":""}>משתמש</option><option value="manager" ${r.role==="manager"?"selected":""}>מנהל</option></select></div>
      ${r.role==="manager"?`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">${MGR_PERMS.map(([k,n])=>`<label class="check" style="margin-top:6px"><input type="checkbox" data-mp="${r.id}" data-k="${k}" ${r.mgr_perms&&r.mgr_perms[k]?"checked":""}> ${n}</label>`).join("")}</div>`:""}`).join("")||`<p class="hint">עוד אין משתמשים אחרים.</p>`}
    <div class="okmsg" id="mgmsg"></div></div>`);
  const setRole=async(id,role,perms)=>{ const {error}=await WEB.sb.rpc("admin_update",{target:id,patch:{role,mgr_perms:perms||{}}}); if(error){ $("#mgmsg").className="err"; $("#mgmsg").textContent="השמירה נכשלה"; return; } await refreshRows(); renderCloud(); };
  app.querySelectorAll("[data-role]").forEach(s=>s.onchange=()=>setRole(s.dataset.role,s.value,s.value==="manager"?{editPerms:true,notice:true}:{}));
  app.querySelectorAll("[data-mp]").forEach(c=>c.onchange=()=>{ const r=CLOUD.rows.find(x=>x.id===c.dataset.mp); const perms={...(r.mgr_perms||{}),[c.dataset.k]:c.checked}; setRole(r.id,"manager",perms); });
}
function renderCloudCreate(){
  const st={level:1,avatar:"a1",cat:"anime",gender:"f"};
  cloudShell(`<div class="card"><h2 style="font-size:20px">יצירת משתמש</h2><p style="color:var(--muted);font-size:14px;margin:6px 0 0">החשבון נשמר בענן. מוסרים למשתמש את שם המשתמש והסיסמה, והוא נכנס מכל מכשיר.</p>
    <div class="two"><div><label class="lbl">שם</label><input class="field" id="cn" maxlength="20"></div><div><label class="lbl">גיל</label><input class="field" id="ca" type="number" min="2" max="120"></div></div>
    <div class="two"><div><label class="lbl">שם משתמש</label><input class="field" id="cu" autocapitalize="off" spellcheck="false"></div><div><label class="lbl">סיסמה (לפחות 6 תווים)</label><input class="field" id="cp"></div></div>
    <label class="lbl">מין</label><div id="cgn">${genderChoices("f")}</div>${gradeFields("",null)}
    <label class="lbl">רמה</label><div id="clv">${levelChoices(1)}</div><label class="lbl">דמות</label><div id="cav"></div>
    <div class="row"><div class="err" id="cerr" style="margin:0"></div><button class="btn" id="cgo">${icon("plus",16)} יצירה</button></div></div>`);
  wireLevels($("#clv"),st); avatarPicker($("#cav"),st); wireGender($("#cgn"),st,genderAvatarSync(st,$("#cav"))); wireGradeFields();
  $("#cgo").onclick=async()=>{
    const e=$("#cerr"), g={}; readGradeFields(g);
    const b={username:normUser($("#cu").value),password:$("#cp").value,name:$("#cn").value.trim(),age:parseInt($("#ca").value,10),gender:st.gender,level:st.level,avatar:st.avatar,grade:g.grade||null,bagrut:g.bagrut||null};
    if(!b.name) return e.textContent="נא להזין שם"; if(!(b.age>=2&&b.age<=120)) return e.textContent="גיל בין 2 ל-120";
    if(!validUser(b.username)) return e.textContent=API_ERR.bad_username; if(b.password.length<6) return e.textContent=API_ERR.weak_password;
    $("#cgo").disabled=true; e.innerHTML=`<span class="spin"></span>`;
    try{ const r=await api("create_user",b); await refreshRows(); CL={...CL,tab:"users",uid:r.id}; renderCloud(); }
    catch(x){ $("#cgo").disabled=false; e.textContent=apiErr(x); }
  };
}
async function clearNotice(){ try{ await WEB.sb.rpc("clear_my_notice"); }catch(e){} }

/* ========================== BOOT (web) ========================== */
(async()=>{
  await window.__webReady; applyDir();
  if(!WEB.sb){ app.innerHTML=topBar(" ")+setupCard(); return; }
  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="hidden") syncMe(); else if(cur()) WEB.sb.from("profiles").select("*").eq("id",cur().id).maybeSingle().then(({data})=>{ if(data) applyRow(data); }); });
  const p=await loadMe();
  if(p){ if(p.locked){ mem.current=null; mem.profiles=[]; await WEB.sb.auth.signOut(); return renderLogin("החשבון נעול"+(p.lockMsg?": "+p.lockMsg:"")); } return renderHome(); }
  await loadCfg(); renderLogin();
})();
