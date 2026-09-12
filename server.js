"use strict";
/*
 * ChattyLAN server — zero-dependency Node.js backend (no npm install needed).
 *
 * Serves index.html and adds multi-user support:
 *   - username + password login, passwords hashed with scrypt (per-user salt)
 *   - sliding session cookies (HttpOnly, SameSite=Lax, default 7 days idle,
 *     refreshed on every authenticated request, persisted to disk)
 *   - per-user data storage (settings + chats) under DATA_DIR/users/
 *   - self-service registration, capped at MAX_USERS (default 10)
 *   - simple per-IP lockout after 5 failed logins (15 minutes)
 *
 * Env vars:
 *   PORT          listen port            (default 80)
 *   HOST          bind address           (default 0.0.0.0)
 *   DATA_DIR      where users/sessions/chat data live (default ./data)
 *   MAX_USERS     registration cap       (default 10)
 *   SESSION_DAYS  session idle timeout   (default 7; sliding — activity extends it)
 *   DATA_KEY      if set, per-user chat data is encrypted at rest (AES-256-GCM);
 *                 without it the data files are plain JSON
 *   ALLOW_REGISTER  set to "0" to disable self-registration entirely
 *   FORCE_SECURE  set to "1" if TLS is terminated in front of this server
 *   INITIAL_USER / INITIAL_PASSWORD
 *                 if set and no users exist yet, this account is created on
 *                 first start (password must be >= 8 chars)
 */
const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const PORT=+(process.env.PORT||80);
const HOST=process.env.HOST||'0.0.0.0';
const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data');
const MAX_USERS=Math.max(1,+(process.env.MAX_USERS||10));
const SESSION_MS=Math.max(1,+(process.env.SESSION_DAYS||7))*86400e3;
const COOKIE='chatty_session';
const MAX_BODY=10*1024*1024; // 10 MB (matches the ~5-10 MB localStorage quota)

/* optional at-rest encryption for per-user chat data (AES-256-GCM) */
const DATA_KEY_BUF=process.env.DATA_KEY?crypto.scryptSync(process.env.DATA_KEY,'chattylan-data-key-v1',32):null;
const ENC_PREFIX=Buffer.from('enc:v1:'); // 7 bytes; file = prefix + iv(12) + tag(16) + ciphertext
function encBuf(buf){
  const iv=crypto.randomBytes(12);
  const c=crypto.createCipheriv('aes-256-gcm',DATA_KEY_BUF,iv);
  const ct=Buffer.concat([c.update(buf),c.final()]);
  return Buffer.concat([ENC_PREFIX,iv,c.getAuthTag(),ct]);
}
function decBuf(raw){
  const iv=raw.subarray(7,19),tag=raw.subarray(19,35),ct=raw.subarray(35);
  const d=crypto.createDecipheriv('aes-256-gcm',DATA_KEY_BUF,iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct),d.final()]);
}

fs.mkdirSync(DATA_DIR,{recursive:true});
const USER_DATA_DIR=path.join(DATA_DIR,'users');
fs.mkdirSync(USER_DATA_DIR,{recursive:true});
const USERS_FILE=path.join(DATA_DIR,'users.json');
const SESSIONS_FILE=path.join(DATA_DIR,'sessions.json');

/* ---------- persistence ---------- */
function loadJSON(file,d){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return d}}
let users=loadJSON(USERS_FILE,{});    // key(lowercase) -> {name, salt, hash}
let sessions=loadJSON(SESSIONS_FILE,{}); // token -> {user, exp}
{const n=Object.keys(sessions).length;
 for(const t of Object.keys(sessions))if(sessions[t].exp<Date.now())delete sessions[t];
 if(Object.keys(sessions).length!==n)saveSessions();} // persist the purge
function saveUsers(){fs.writeFileSync(USERS_FILE,JSON.stringify(users,null,2))}
function saveSessions(){fs.writeFileSync(SESSIONS_FILE,JSON.stringify(sessions,null,2))}

/* per-user chat data (encrypted at rest when DATA_KEY is set).
   Throws on key mismatch so a wrong key can never be masked as "empty data"
   and silently overwrite the file on the next save. */
function loadUserData(file){
  let raw;try{raw=fs.readFileSync(file)}catch{return null} // no file yet -> empty
  if(raw.subarray(0,ENC_PREFIX.length).equals(ENC_PREFIX)){
    if(!DATA_KEY_BUF)throw new Error('data file is encrypted but DATA_KEY is not set');
    try{return JSON.parse(decBuf(raw).toString('utf8'))}
    catch(e){throw new Error('cannot decrypt user data (wrong DATA_KEY?)')}
  }
  return JSON.parse(raw.toString('utf8'));
}
function saveUserData(file,obj){
  const buf=Buffer.from(JSON.stringify(obj));
  fs.writeFileSync(file,DATA_KEY_BUF?encBuf(buf):buf);
}

/* ---------- passwords (scrypt) ---------- */
const SCRYPT={N:16384,r:8,p:1};
function hashPassword(pw,salt){return crypto.scryptSync(pw,Buffer.from(salt,'hex'),64,SCRYPT).toString('hex')}
function verifyPassword(pw,rec){
  const h=crypto.scryptSync(pw,Buffer.from(rec.salt,'hex'),64,SCRYPT);
  const stored=Buffer.from(rec.hash||'','hex');
  return stored.length===h.length&&crypto.timingSafeEqual(h,stored);
}

/* optional initial account (handy for NAS first boot) */
if(!Object.keys(users).length&&process.env.INITIAL_USER){
  const u=process.env.INITIAL_USER,p=process.env.INITIAL_PASSWORD||'';
  if(validUsername(u)&&p.length>=8){
    const salt=crypto.randomBytes(16).toString('hex');
    users[u.toLowerCase()]={name:u,salt,hash:hashPassword(p,salt)};
    saveUsers();
    console.log('Created initial user "'+u+'" from INITIAL_USER/INITIAL_PASSWORD.');
  }else{
    console.warn('INITIAL_USER is set but invalid (need valid username + password >= 8 chars).');
  }
}

/* ---------- login throttle (per IP) ---------- */
const fails=new Map(); // ip -> {n, until}
function throttled(ip){
  const f=fails.get(ip);
  if(!f)return false;
  if(f.until>Date.now())return true;
  fails.delete(ip);
  return false;
}
function noteFail(ip){
  const f=fails.get(ip)||{n:0,until:0};
  f.n++;
  if(f.n>=5)f.until=Date.now()+15*60e3; // 5 failures -> 15 min lockout
  fails.set(ip,f);
}

/* ---------- helpers ---------- */
function validUsername(u){return typeof u==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{1,31}$/.test(u)}
function regOpen(){return process.env.ALLOW_REGISTER!=='0'&&Object.keys(users).length<MAX_USERS}

function readBody(req){
  return new Promise((resolve,reject)=>{
    let size=0;const chunks=[];
    req.on('data',c=>{size+=c.length;if(size>MAX_BODY){reject(new Error('body too large'));req.destroy()}else chunks.push(c)});
    req.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error',reject);
  });
}
async function readJSON(req){
  const body=await readBody(req);
  if(!body)return{};
  return JSON.parse(body);
}
function json(res,code,obj,headers={}){
  const body=JSON.stringify(obj);
  res.writeHead(code,{...headers,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)});
  res.end(body);
}
function parseCookies(req){
  const out={};
  for(const part of (req.headers.cookie||'').split(';')){
    const i=part.indexOf('=');
    if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function isSecure(req){return process.env.FORCE_SECURE==='1'||req.headers['x-forwarded-proto']==='https'}
function sessionCookie(token,secure){
  return COOKIE+'='+token+'; Path=/; HttpOnly; SameSite=Lax'+(secure?'; Secure':'')+'; Max-Age='+Math.floor(SESSION_MS/1000);
}
function currentUser(req,res){
  const t=parseCookies(req)[COOKIE];
  if(!t||!sessions[t])return null;
  if(sessions[t].exp<Date.now()){delete sessions[t];saveSessions();return null}
  // sliding: extend the session and re-issue the cookie so the browser's
  // Max-Age slides with it (otherwise the client would drop out after one
  // fixed SESSION_DAYS window even while actively used)
  sessions[t].exp=Date.now()+SESSION_MS;
  saveSessions();
  res.setHeader('Set-Cookie',sessionCookie(t,isSecure(req)));
  return sessions[t].user;
}
function newSession(res,req,key){
  const token=crypto.randomBytes(32).toString('hex');
  sessions[token]={user:key,exp:Date.now()+SESSION_MS};
  saveSessions();
  res.setHeader('Set-Cookie',sessionCookie(token,isSecure(req)));
}

/* ---------- server ---------- */
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const ip=req.socket.remoteAddress||'?';
  try{
    if(url.pathname==='/api/status'){
      return json(res,200,{canRegister:regOpen(),maxUsers:MAX_USERS});
    }

    if(url.pathname==='/api/register'&&req.method==='POST'){
      if(!regOpen())return json(res,403,{error:'Registration is closed (user limit reached or disabled).'});
      const j=await readJSON(req);
      const u=(j.username||'').trim(),p=j.password;
      if(!validUsername(u))return json(res,400,{error:'Username must be 2\u201332 chars: letters, digits, _ . -'});
      if(typeof p!=='string'||p.length<8||p.length>128)return json(res,400,{error:'Password must be 8\u2013128 characters.'});
      const key=u.toLowerCase();
      if(users[key])return json(res,409,{error:'Username already taken.'});
      const salt=crypto.randomBytes(16).toString('hex');
      users[key]={name:u,salt,hash:hashPassword(p,salt)};
      saveUsers();
      newSession(res,req,key);
      return json(res,200,{user:u});
    }

    if(url.pathname==='/api/login'&&req.method==='POST'){
      if(throttled(ip))return json(res,429,{error:'Too many failed attempts \u2014 try again in 15 minutes.'});
      const j=await readJSON(req);
      const u=(j.username||'').trim().toLowerCase(),p=j.password;
      const rec=users[u];
      if(!rec||typeof p!=='string'||!verifyPassword(p,rec)){
        noteFail(ip);
        return json(res,401,{error:'Invalid username or password.'});
      }
      fails.delete(ip);
      newSession(res,req,u);
      return json(res,200,{user:rec.name});
    }

    if(url.pathname==='/api/logout'&&req.method==='POST'){
      const t=parseCookies(req)[COOKIE];
      if(t&&sessions[t]){delete sessions[t];saveSessions()}
      res.setHeader('Set-Cookie',COOKIE+'=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
      return json(res,200,{ok:true});
    }

    if(url.pathname==='/api/me'){
      const u=currentUser(req,res);
      if(!u)return json(res,401,{error:'not logged in'});
      return json(res,200,{user:users[u]?users[u].name:u});
    }

    if(url.pathname==='/api/data'&&(req.method==='GET'||req.method==='PUT'||req.method==='POST')){
      const u=currentUser(req,res);
      if(!u)return json(res,401,{error:'not logged in'});
      const file=path.join(USER_DATA_DIR,u+'.json'); // u is validated -> no path traversal
      if(req.method==='GET'){
        let data;try{data=loadUserData(file)}catch(e){return json(res,500,{error:e.message})}
        return json(res,200,data||{settings:{},chats:[],activeId:null});
      }
      let j;try{j=await readJSON(req)}catch{return json(res,400,{error:'invalid JSON'})}
      // keep only the known shape (defense in depth)
      const out={
        settings:{
          baseUrl:typeof j.settings?.baseUrl==='string'?j.settings.baseUrl.slice(0,512):'',
          apiKey:typeof j.settings?.apiKey==='string'?j.settings.apiKey.slice(0,512):'',
          model:typeof j.settings?.model==='string'?j.settings.model.slice(0,256):'',
          systemPrompt:typeof j.settings?.systemPrompt==='string'?j.settings.systemPrompt.slice(0,8192):''
        },
        chats:Array.isArray(j.chats)?j.chats.slice(0,500).map(c=>({
          id:String(c&&c.id||'').slice(0,64),
          title:String((c&&c.title)||'Chat').slice(0,200),
          messages:Array.isArray(c&&c.messages)?c.messages.slice(0,2000).map(m=>({
            role:m&&m.role==='user'?'user':'assistant',
            content:m&&typeof m.content==='string'?m.content:'',
            reasoning:m&&typeof m.reasoning==='string'?m.reasoning:''
          })):[],
        })):[],
        activeId:typeof j.activeId==='string'?j.activeId:null
      };
      // refuse to overwrite data we cannot decrypt (wrong/missing DATA_KEY)
      try{loadUserData(file)}catch(e){return json(res,500,{error:e.message})}
      saveUserData(file,out);
      return json(res,200,{ok:true});
    }

    if(url.pathname==='/'||url.pathname==='/index.html'){
      const html=fs.readFileSync(path.join(__dirname,'index.html'));
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'});
      return res.end(html);
    }

    json(res,404,{error:'not found'});
  }catch(e){
    json(res,500,{error:'internal error'});
  }
});

server.listen(PORT,HOST,()=>{
  console.log('ChattyLAN listening on http://'+HOST+':'+PORT+' (data: '+DATA_DIR+', max users: '+MAX_USERS+', chat data '+(DATA_KEY_BUF?'encrypted':'unencrypted')+')');
});
