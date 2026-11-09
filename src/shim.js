/* ===== WEB EDITION bootstrap: Supabase client + adapters that stand in for Claude-hosted capabilities ===== */
(function(){
  let resolveReady; window.__webReady=new Promise(r=>resolveReady=r);
  window.WEB={sb:null,cfg:{},claude:false,peer:Math.random().toString(36).slice(2,12)};
  (async()=>{
    try{
      const r=await fetch("/api/config",{cache:"no-store"}); const c=await r.json(); WEB.cfg=c; WEB.claude=!!c.claude;
      if(c.supabaseUrl&&c.supabaseAnonKey&&window.supabase) WEB.sb=window.supabase.createClient(c.supabaseUrl,c.supabaseAnonKey,{auth:{persistSession:true,storageKey:"englishApp.sb",autoRefreshToken:true}});
    }catch(e){ console.warn("config",e); }
    resolveReady();
  })();

  /* ---- online room over Supabase Realtime presence (same shape the app already uses) ---- */
  function makeRoomNS(){
    const PEER=WEB.peer;
    return {
      join: async(name)=>{
        const sb=WEB.sb; if(!sb) throw {code:"not_permitted"};
        const ch=sb.channel("room:"+name,{config:{presence:{key:PEER}}});
        let me={}; const hs=new Set(); const seen={}; let last=[];
        const snap=()=>{
          const st=ch.presenceState(); const arr=[];
          for(const k in st){ const metas=st[k]; const m=metas[metas.length-1]||{}; const pres=m.p||{}; const js=JSON.stringify(pres);
            if(!seen[k]||seen[k].js!==js) seen[k]={js,at:Date.now()};
            arr.push(Object.freeze({peer:k,by:null,isMe:k===PEER,sameTab:k===PEER,kind:"viewer",guest:false,presence:pres,updatedAt:seen[k].at})); }
          if(!arr.some(x=>x.isMe)) arr.push(Object.freeze({peer:PEER,by:null,isMe:true,sameTab:true,kind:"viewer",guest:false,presence:me,updatedAt:Date.now()}));
          last=Object.freeze(arr); return last;
        };
        const fire=()=>{ const ps=snap(); hs.forEach(h=>{ try{ h({peers:ps,joined:[],left:[],updated:[]}); }catch(e){ console.error(e); } }); };
        ch.on("presence",{event:"sync"},fire).on("presence",{event:"join"},fire).on("presence",{event:"leave"},fire);
        await new Promise((res,rej)=>{ const t=setTimeout(()=>rej({code:"upstream_error"}),10000); ch.subscribe(s=>{ if(s==="SUBSCRIBED"){ clearTimeout(t); res(); } else if(s==="CHANNEL_ERROR"||s==="TIMED_OUT"){ clearTimeout(t); rej({code:"upstream_error"}); } }); });
        return {
          name,
          presence: async patch=>{ me={...me}; for(const k in patch){ if(patch[k]===null) delete me[k]; else me[k]=patch[k]; } try{ await ch.track({p:me}); }catch(e){} fire(); },
          onPeers: h=>{ hs.add(h); setTimeout(()=>{ const ps=snap(); h({peers:ps,joined:ps,left:[],updated:[]}); },0); return ()=>hs.delete(h); },
          peers: ()=>last.length?last:snap(),
          leave: async()=>{ hs.clear(); try{ await ch.untrack(); }catch(e){} try{ await sb.removeChannel(ch); }catch(e){} },
          connected: ()=>true, onConnection: h=>{ setTimeout(()=>h(true),0); return ()=>{}; },
          emit: async()=>{}, on: ()=>()=>{}
        };
      },
      peers:()=>[], onPeers:()=>()=>{}, presence:async()=>{}, connected:()=>true
    };
  }

  /* ---- Claude through /api/claude (only when the site owner configured an API key) ---- */
  async function shrink(blob){
    try{
      const url=URL.createObjectURL(blob); const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=url; });
      const s=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight)); const c=document.createElement("canvas"); c.width=Math.round(img.naturalWidth*s); c.height=Math.round(img.naturalHeight*s);
      const g=c.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url);
      const out=await new Promise(r=>c.toBlob(r,"image/jpeg",0.85));
      const data=await new Promise(r=>{ const fr=new FileReader(); fr.onload=()=>r(String(fr.result).split(",")[1]); fr.readAsDataURL(out); });
      return {type:"image/jpeg",data};
    }catch(e){ throw {code:"image_rejected"}; }
  }
  function parseLoose(t){
    try{ return JSON.parse(t); }catch(e){}
    const f=t.match(/```(?:json)?\s*([\s\S]*?)```/); if(f){ try{ return JSON.parse(f[1]); }catch(e){} }
    const a=t.search(/[\[{]/), b=Math.max(t.lastIndexOf("}"),t.lastIndexOf("]"));
    if(a>=0&&b>a){ try{ return JSON.parse(t.slice(a,b+1)); }catch(e){} }
    throw {code:"invalid_json",text:t};
  }
  function makeSample(){
    const call=async(input,opts={})=>{
      const list=opts.images?(opts.images instanceof Blob?[opts.images]:[...opts.images]):[];
      const images=[]; for(const b of list.slice(0,5)) images.push(await shrink(b));
      const {data}=await WEB.sb.auth.getSession(); const tok=data&&data.session&&data.session.access_token;
      if(!tok) throw {code:"not_granted"};
      let r; try{ r=await fetch("/api/claude",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+tok},body:JSON.stringify({input,images,tier:opts.modelTier||"default"}),signal:opts.signal}); }
      catch(e){ throw e&&e.name==="AbortError"?{code:"cancelled"}:{code:"upstream_error"}; }
      if(!r.ok) throw {code:r.status===429?"rate_limited":r.status===401?"session_expired":r.status===503?"sampling_disabled":"upstream_error"};
      const j=await r.json(); if(opts.onText) try{ opts.onText({text:j.text,delta:j.text}); }catch(e){}
      if(!j.text) throw {code:"empty_completion"};
      return {text:j.text,truncated:!!j.truncated};
    };
    const f=(i,o)=>call(i,o);
    f.json=async(i,o)=>{ const {text}=await call(typeof i==="string"?i+"\n\n(Reply with valid JSON only.)":i,o); return parseLoose(text); };
    f.limits=async()=>({maxPromptBytes:262144,images:{maxCount:5,maxInputBytes:25e6,mediaTypes:["image/jpeg","image/png","image/webp","image/gif"]}});
    return f;
  }

  window.claude={use: async name=>{
    await window.__webReady;
    if(name==="room") return WEB.sb?makeRoomNS():null;
    if(name==="sample") return WEB.sb&&WEB.claude?makeSample():null;
    return null; // db / user: replaced by Supabase tables in this edition
  }};
})();
