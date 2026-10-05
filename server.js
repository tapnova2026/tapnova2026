import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Cell, beginCell, Address} from '@ton/core';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'../..');
const app=express();
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:false});
const PORT=Number(process.env.PORT||3000);
const BOT_TOKEN=process.env.TELEGRAM_BOT_TOKEN||'';
const BOT_USERNAME=process.env.TELEGRAM_BOT_USERNAME||'';
const isProd=process.env.NODE_ENV==='production';
const APP_URL=process.env.APP_URL||'';
const PROJECT_WALLET=process.env.PROJECT_TON_WALLET||'';
const JOIN_FEE_NANOTON=BigInt(process.env.JOIN_FEE_NANOTON||'100000000');
const TONAPI_BASE_URL=(process.env.TONAPI_BASE_URL||'https://tonapi.io').replace(/\/$/,'');
const TONAPI_TOKEN=process.env.TONAPI_TOKEN||'';
const ADMIN_SECRET=process.env.ADMIN_SECRET||'';
const AIRDROP_RISK_MAX=Number(process.env.AIRDROP_RISK_MAX||80);
const AIRDROP_MIN_SCORE=Number(process.env.AIRDROP_MIN_SCORE||1);
const AIRDROP_CLAIM_REQUIRE_JOINED=String(process.env.AIRDROP_CLAIM_REQUIRE_JOINED||'false').toLowerCase()==='true';
const AIRDROP_TOKEN_SYMBOL=process.env.AIRDROP_TOKEN_SYMBOL||'TNV';
const TON_MAINNET='-239';

const CARDS={
 starter:{price:1000,pph:5,max:5},
 pro:{price:5000,pph:30,max:7},
 elite:{price:15000,pph:100,max:10},
 nova:{price:50000,pph:400,max:12}
};
const TASKS={
 daily:{reward:100,daily:true},
 telegram:{reward:250,daily:true},
 share:{reward:200,daily:true},
 wallet:{reward:300,daily:true}
};

async function initDatabase(){
 const schema=await readFile(path.join(root,'backend','schema.sql'),'utf8');
 await pool.query(schema);
}

app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false}));
app.use(cors({origin:(origin,cb)=>{if(!origin||!isProd)return cb(null,true);return cb(null,origin===APP_URL);},credentials:false}));
app.use(express.json({limit:'100kb'}));
app.use('/api/health',rateLimit({windowMs:60_000,max:30,standardHeaders:true,legacyHeaders:false}));

const apiLimiter=rateLimit({windowMs:60_000,max:120,standardHeaders:true,legacyHeaders:false,message:{error:'rate_limited'}});
const tapLimiter=rateLimit({windowMs:10_000,max:20,standardHeaders:true,legacyHeaders:false,message:{error:'tap_rate_limited'}});
app.use('/api',apiLimiter);

function authUser(req){
 const initData=req.header('X-Telegram-Init-Data')||'';
 if(!initData){
   if(!isProd)return {id:'dev_user',username:'dev',first_name:'Developer'};
   throw new Error('Telegram authentication required');
 }
 if(!BOT_TOKEN)throw new Error('TELEGRAM_BOT_TOKEN is not configured');
 const p=new URLSearchParams(initData);const hash=p.get('hash');p.delete('hash');
 if(!hash)throw new Error('Invalid Telegram init data');
 const data=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
 const check=crypto.createHmac('sha256',secret).update(data).digest('hex');
 if(hash.length!==check.length||!crypto.timingSafeEqual(Buffer.from(check),Buffer.from(hash)))throw new Error('Invalid Telegram signature');
 const authDate=Number(p.get('auth_date')||0);if(!authDate||Date.now()/1000-authDate>86400)throw new Error('Telegram auth data expired');
 const user=JSON.parse(p.get('user')||'{}');if(!user.id)throw new Error('Telegram user missing');
 return {id:String(user.id),username:user.username||'',first_name:user.first_name||''};
}

async function getUser(c,id,profile={}){
 await c.query(`INSERT INTO users(telegram_id,username,first_name) VALUES($1,$2,$3)
 ON CONFLICT(telegram_id) DO UPDATE SET username=COALESCE(NULLIF($2,''),users.username),first_name=COALESCE(NULLIF($3,''),users.first_name),updated_at=NOW()`,[id,profile.username||'',profile.first_name||'']);
 const r=await c.query('SELECT * FROM users WHERE telegram_id=$1',[id]);return r.rows[0];
}
function regen(u){
 const now=Date.now(),last=new Date(u.last_energy_at).getTime();
 const gained=Math.floor((now-last)/3000);if(gained<=0)return u;
 u.energy=Math.min(u.max_energy,u.energy+gained);u.last_energy_at=new Date(Math.min(now,last+gained*3000));return u;
}
async function saveEnergy(c,u){await c.query('UPDATE users SET energy=$2,last_energy_at=$3,updated_at=NOW() WHERE telegram_id=$1',[u.telegram_id,u.energy,u.last_energy_at]);}
function cardsFor(rows){return rows.map(x=>({id:x.card_id,level:Number(x.level)}));}
function gameState(u,cards){
 return {user:{telegramId:u.telegram_id,username:u.username,firstName:u.first_name,balance:Number(u.balance),taps:Number(u.taps),energy:u.energy,maxEnergy:u.max_energy,taskBonus:Number(u.task_bonus),streak:u.streak,lastDaily:u.last_daily,walletAddress:u.wallet_address,joined:u.joined,riskScore:Number(u.risk_score||0)},cards:cardsFor(cards)};
}
async function credit(c,id,amount,reason,key,taskBonus=false){
 if(amount<=0)return;
 const r=await c.query('INSERT INTO ledger(telegram_id,amount,reason,idempotency_key) VALUES($1,$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id',[id,amount,reason,key]);
 if(r.rowCount)await c.query('UPDATE users SET balance=balance+$2,task_bonus=task_bonus+$3,updated_at=NOW() WHERE telegram_id=$1',[id,amount,taskBonus?amount:0]);
}
async function addRisk(c,id,points,event,metadata={}){
 await c.query('INSERT INTO risk_events(telegram_id,points,event,metadata) VALUES($1,$2,$3,$4)',[id,points,event,JSON.stringify(metadata)]);
 await c.query('UPDATE users SET risk_score=LEAST(1000,risk_score+$2),updated_at=NOW() WHERE telegram_id=$1',[id,points]);
}
function today(){return new Date().toISOString().slice(0,10);}

app.get('/api/health',async(req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true,service:'tapnova',time:new Date().toISOString()});}catch(e){res.status(503).json({ok:false,error:'database_unavailable'});}});
app.use('/api',(req,res,next)=>{if(req.path.startsWith('/admin/'))return next();try{req.tgUser=authUser(req);next();}catch(e){res.status(401).json({error:e.message});}});

app.get('/api/game/state',async(req,res)=>{
 const c=await pool.connect();
 try{const u=regen(await getUser(c,req.tgUser.id,req.tgUser));await saveEnergy(c,u);const cards=await c.query('SELECT card_id,level FROM user_cards WHERE telegram_id=$1',[u.telegram_id]);res.json(gameState(u,cards.rows));}
 finally{c.release();}
});

app.post('/api/taps/batch',tapLimiter,async(req,res)=>{
 const count=Math.max(1,Math.min(50,Number(req.body?.count||0)));const key=String(req.body?.idempotencyKey||'');
 if(!key||key.length>120)return res.status(400).json({error:'valid_idempotencyKey_required'});
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  let u=regen(await getUser(c,req.tgUser.id,req.tgUser));
  const locked=(await c.query('SELECT * FROM users WHERE telegram_id=$1 FOR UPDATE',[u.telegram_id])).rows[0];
  u=regen(locked);
  const exists=await c.query('SELECT count FROM tap_batches WHERE client_idempotency_key=$1',[key]);
  if(exists.rowCount){await c.query('COMMIT');return res.json({ok:true,duplicate:true,count:Number(exists.rows[0].count)});}
  const actual=Math.min(count,u.energy);
  if(actual<=0){await c.query('ROLLBACK');return res.status(409).json({error:'energy_empty'});}
  if(count>=40)await addRisk(c,u.telegram_id,1,'large_tap_batch',{count});
  await c.query('INSERT INTO tap_batches(telegram_id,count,client_idempotency_key) VALUES($1,$2,$3)',[u.telegram_id,actual,key]);
  await c.query('UPDATE users SET energy=$2,taps=taps+$3,balance=balance+$3,last_energy_at=$4,updated_at=NOW() WHERE telegram_id=$1',[u.telegram_id,u.energy-actual,actual,u.last_energy_at]);
  await c.query('INSERT INTO ledger(telegram_id,amount,reason,idempotency_key) VALUES($1,$2,$3,$4)',[u.telegram_id,actual,'tap:'+actual,key]);
  const rr=await c.query("SELECT id,referrer_id FROM referrals WHERE referred_id=$1 AND status='pending' FOR UPDATE",[u.telegram_id]);
  if(rr.rowCount && Number((await c.query('SELECT taps FROM users WHERE telegram_id=$1',[u.telegram_id])).rows[0].taps)>=1){
    await c.query("UPDATE referrals SET status='completed',activated_at=NOW() WHERE id=$1",[rr.rows[0].id]);
    await credit(c,rr.rows[0].referrer_id,500,'referral:'+u.telegram_id,'referral:'+rr.rows[0].id,false);
  }
  await c.query('COMMIT');res.json({ok:true,count:actual});
 }catch(e){await c.query('ROLLBACK');res.status(500).json({error:'tap_failed'});}finally{c.release();}
});

app.get('/api/stats/today',async(req,res)=>{
 const c=await pool.connect();try{const q=await c.query(`SELECT COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0)::bigint AS earned FROM ledger WHERE telegram_id=$1 AND created_at::date=CURRENT_DATE`,[req.tgUser.id]);res.json({todayEarned:Number(q.rows[0].earned||0)});}finally{c.release();}
});

app.get('/api/tasks/status',async(req,res)=>{
 const c=await pool.connect();try{const q=await c.query('SELECT task_id FROM task_completions WHERE telegram_id=$1 AND completed_on=CURRENT_DATE',[req.tgUser.id]);const completed={};q.rows.forEach(r=>completed[r.task_id]=true);res.json({completed});}finally{c.release();}
});

app.post('/api/daily/claim',async(req,res)=>{
 const c=await pool.connect();
 try{await c.query('BEGIN');const u=await getUser(c,req.tgUser.id,req.tgUser);const locked=(await c.query('SELECT * FROM users WHERE telegram_id=$1 FOR UPDATE',[u.telegram_id])).rows[0];
  const d=today();if(locked.last_daily&&String(locked.last_daily).slice(0,10)===d){await c.query('ROLLBACK');return res.status(409).json({error:'already_claimed'});}
  const y=new Date(Date.now()-86400000).toISOString().slice(0,10);const streak=String(locked.last_daily||'').slice(0,10)===y?Number(locked.streak)+1:1;
  await c.query('UPDATE users SET balance=balance+500,task_bonus=task_bonus+500,last_daily=$2,streak=$3,updated_at=NOW() WHERE telegram_id=$1',[locked.telegram_id,d,streak]);
  await c.query('INSERT INTO ledger(telegram_id,amount,reason,idempotency_key) VALUES($1,500,$2,$3)',[locked.telegram_id,'daily','daily:'+locked.telegram_id+':'+d]);
  await c.query('COMMIT');res.json({ok:true,reward:500,streak});
 }catch(e){await c.query('ROLLBACK');res.status(500).json({error:'daily_claim_failed'});}finally{c.release();}
});

async function verifyTelegramMembership(userId,chat){
 if(!BOT_TOKEN||!chat)return false;
 try{
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(chat)}&user_id=${encodeURIComponent(userId)}`,{signal:AbortSignal.timeout(8000)});
  if(!r.ok)return false;const data=await r.json();if(!data.ok)return false;const m=data.result||{};
  return ['creator','administrator','member'].includes(m.status)||(m.status==='restricted'&&m.is_member===true);
 }catch{return false;}
}

app.post('/api/tasks/:id/claim',async(req,res)=>{
 const id=req.params.id;if(!TASKS[id])return res.status(404).json({error:'task_not_found'});
 const c=await pool.connect();
 try{await c.query('BEGIN');const u=await getUser(c,req.tgUser.id,req.tgUser);const done=await c.query('SELECT 1 FROM task_completions WHERE telegram_id=$1 AND task_id=$2 AND completed_on=CURRENT_DATE',[u.telegram_id,id]);
  if(done.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'task_already_completed'});}
  if(id==='daily'&&Number(u.taps)<1){await c.query('ROLLBACK');return res.status(409).json({error:'tap_required'});}
  if(id==='wallet'&&!u.wallet_address){await c.query('ROLLBACK');return res.status(409).json({error:'wallet_required'});}
  if(id==='telegram'){
    const ok=await verifyTelegramMembership(u.telegram_id,process.env.TELEGRAM_CHANNEL_ID||'');
    if(!ok){await c.query('ROLLBACK');return res.status(409).json({error:'telegram_membership_not_verified'});}
  }
  if(id==='share'){const rr=await c.query("SELECT 1 FROM referrals WHERE referrer_id=$1 AND status='completed' LIMIT 1",[u.telegram_id]);if(!rr.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'complete_a_referral_first'});}}
  await c.query('INSERT INTO task_completions(telegram_id,task_id) VALUES($1,$2)',[u.telegram_id,id]);
  await credit(c,u.telegram_id,TASKS[id].reward,'task:'+id,'task:'+u.telegram_id+':'+id+':'+today(),true);
  await c.query('COMMIT');res.json({ok:true,reward:TASKS[id].reward});
 }catch(e){await c.query('ROLLBACK');res.status(500).json({error:'task_claim_failed'});}finally{c.release();}
});

app.post('/api/wallet/link',async(req,res)=>{
 const supplied=String(req.body?.address||'').trim();
 let address='';try{address=Address.parse(supplied).toString({bounceable:true,testOnly:false,urlSafe:true});}catch{return res.status(400).json({error:'invalid_wallet_address'});}
 const c=await pool.connect();try{const u=await getUser(c,req.tgUser.id,req.tgUser);await c.query('UPDATE users SET wallet_address=$2,updated_at=NOW() WHERE telegram_id=$1',[u.telegram_id,address]);res.json({ok:true,address,rawAddress:Address.parse(address).toRawString()});}finally{c.release();}
});

app.post('/api/cards/:id/buy',async(req,res)=>{
 const id=req.params.id,cfg=CARDS[id];if(!cfg)return res.status(404).json({error:'card_not_found'});const c=await pool.connect();
 try{await c.query('BEGIN');const u=await getUser(c,req.tgUser.id,req.tgUser);const exists=await c.query('SELECT 1 FROM user_cards WHERE telegram_id=$1 AND card_id=$2',[u.telegram_id,id]);if(exists.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'card_owned'});}if(Number(u.balance)<cfg.price){await c.query('ROLLBACK');return res.status(409).json({error:'insufficient_balance'});}
  await c.query('UPDATE users SET balance=balance-$2,updated_at=NOW() WHERE telegram_id=$1',[u.telegram_id,cfg.price]);await c.query('INSERT INTO user_cards(telegram_id,card_id,level) VALUES($1,$2,1)',[u.telegram_id,id]);await c.query('INSERT INTO ledger(telegram_id,amount,reason,idempotency_key) VALUES($1,$2,$3,$4)',[u.telegram_id,-cfg.price,'card_buy:'+id,'cardbuy:'+u.telegram_id+':'+id]);await c.query('COMMIT');res.json({ok:true});
 }catch(e){await c.query('ROLLBACK');res.status(500).json({error:'card_buy_failed'});}finally{c.release();}
});

app.post('/api/cards/:id/upgrade',async(req,res)=>{
 const id=req.params.id,cfg=CARDS[id];if(!cfg)return res.status(404).json({error:'card_not_found'});const c=await pool.connect();
 try{await c.query('BEGIN');const u=await getUser(c,req.tgUser.id,req.tgUser);const q=await c.query('SELECT level FROM user_cards WHERE telegram_id=$1 AND card_id=$2 FOR UPDATE',[u.telegram_id,id]);if(!q.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'card_not_owned'});}const level=Number(q.rows[0].level);if(level>=cfg.max){await c.query('ROLLBACK');return res.status(409).json({error:'card_max_level'});}const cost=Math.floor(cfg.price*level*0.65);if(Number(u.balance)<cost){await c.query('ROLLBACK');return res.status(409).json({error:'insufficient_balance'});
  }await c.query('UPDATE users SET balance=balance-$2,updated_at=NOW() WHERE telegram_id=$1',[u.telegram_id,cost]);await c.query('UPDATE user_cards SET level=level+1,upgraded_at=NOW() WHERE telegram_id=$1 AND card_id=$2',[u.telegram_id,id]);await c.query('INSERT INTO ledger(telegram_id,amount,reason,idempotency_key) VALUES($1,$2,$3,$4)',[u.telegram_id,-cost,'card_upgrade:'+id,'cardup:'+u.telegram_id+':'+id+':'+level]);await c.query('COMMIT');res.json({ok:true,level:level+1});
 }catch(e){await c.query('ROLLBACK');res.status(500).json({error:'card_upgrade_failed'});}finally{c.release();}
});

app.post('/api/referrals/activate',async(req,res)=>{
 const referrerId=String(req.body?.referrerId||'').trim();if(!referrerId)return res.status(400).json({error:'referrer_required'});
 const c=await pool.connect();
 try{await c.query('BEGIN');const u=await getUser(c,req.tgUser.id,req.tgUser);if(referrerId===u.telegram_id){await c.query('ROLLBACK');return res.status(409).json({error:'self_referral'});}
  const existing=await c.query('SELECT 1 FROM referrals WHERE referred_id=$1',[u.telegram_id]);if(existing.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'referral_already_set'});}
  const ref=await c.query('SELECT telegram_id FROM users WHERE telegram_id=$1',[referrerId]);if(!ref.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'referrer_not_found'});}
  await c.query('INSERT INTO referrals(referrer_id,referred_id,status) VALUES($1,$2,\'pending\')',[referrerId,u.telegram_id]);await c.query('UPDATE users SET referred_by=$2,updated_at=NOW() WHERE telegram_id=$1',[u.telegram_id,referrerId]);
  await c.query('COMMIT');res.json({ok:true,status:'pending'});
 }catch(e){await c.query('ROLLBACK');res.status(500).json({error:'referral_failed'});}finally{c.release();}
});

app.post('/api/referrals/complete',async(req,res)=>{
 const c=await pool.connect();
 try{await c.query('BEGIN');const u=await getUser(c,req.tgUser.id,req.tgUser);const r=await c.query('SELECT * FROM referrals WHERE referred_id=$1 FOR UPDATE',[u.telegram_id]);if(!r.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'referral_not_found'});}if(r.rows[0].status==='completed'){await c.query('ROLLBACK');return res.json({ok:true,status:'completed'});}
  if(Number(u.taps)<1){await c.query('ROLLBACK');return res.status(409).json({error:'tap_required'});}
  await c.query('UPDATE referrals SET status=\'completed\',activated_at=NOW() WHERE id=$1',[r.rows[0].id]);await c.query('UPDATE users SET updated_at=NOW() WHERE telegram_id=$1',[r.rows[0].referrer_id]);
  await credit(c,r.rows[0].referrer_id,500,'referral:'+u.telegram_id,'referral:'+r.rows[0].id,true);await c.query('COMMIT');res.json({ok:true,status:'completed'});
 }catch(e){await c.query('ROLLBACK');res.status(500).json({error:'referral_completion_failed'});}finally{c.release();}
});

app.get('/api/referrals',async(req,res)=>{const c=await pool.connect();try{const q=await c.query(`SELECT COUNT(*) FILTER (WHERE status='completed')::int AS completed,COUNT(*)::int AS total FROM referrals WHERE referrer_id=$1`,[req.tgUser.id]);res.json({completed:q.rows[0].completed,total:q.rows[0].total});}finally{c.release();}});

app.post('/api/payments/create',async(req,res)=>{
 if(!PROJECT_WALLET)return res.status(503).json({error:'project_wallet_not_configured'});
 const c=await pool.connect();try{const u=await getUser(c,req.tgUser.id,req.tgUser);const id=crypto.randomUUID();await c.query('INSERT INTO payment_intents(id,telegram_id,wallet_address,amount_nanoton,status) VALUES($1,$2,$3,$4,\'pending\')',[id,u.telegram_id,u.wallet_address||null,JOIN_FEE_NANOTON.toString()]);res.json({id,amountNanoton:JOIN_FEE_NANOTON.toString(),destination:PROJECT_WALLET});}finally{c.release();}
});

async function tonApiGet(url,options={}){
 const headers={'Accept':'application/json',...(options.headers||{})};if(TONAPI_TOKEN)headers.Authorization=`Bearer ${TONAPI_TOKEN}`;
 const r=await fetch(url,{...options,headers,signal:AbortSignal.timeout(10000)});if(!r.ok){const e=new Error(`TONAPI_${r.status}`);e.status=r.status;throw e;}return r.json();
}
function normalizedExternalMessageHash(boc){
 const cells=Cell.fromBoc(Buffer.from(String(boc),'base64'));if(!cells.length)throw new Error('invalid_boc');
 const slice=cells[0].beginParse();if(slice.loadUint(2)!==2)throw new Error('boc_is_not_external_in');
 slice.loadBit();const dest=slice.loadAddress();if(!dest)throw new Error('missing_destination');slice.loadCoins();
 if(slice.loadBit())throw new Error('state_init_not_supported');const bodyByRef=slice.loadBit();const body=bodyByRef?slice.loadRef():slice.asCell();
 const normalized=beginCell().storeUint(2,2).storeUint(0,2).storeAddress(dest).storeUint(0,4).storeBit(false).storeBit(true).storeRef(body).endCell();
 return {hash:normalized.hash().toString('hex'),destination:dest.toString({bounceable:true,testOnly:false})};
}
function normalizeAddress(value){try{return Address.parse(String(value)).toRawString();}catch{return String(value||'');}}
function txIncoming(tx){const msg=tx?.in_msg||{};return {source:normalizeAddress(msg?.source?.address||msg?.source||''),destination:normalizeAddress(msg?.destination?.address||msg?.destination||''),value:String(msg?.value??msg?.amount??'')};}
async function verifyPaymentBoc(intent,boc){
 if(!TONAPI_BASE_URL||!PROJECT_WALLET)return null;const parsed=normalizedExternalMessageHash(boc);
 const tx=await tonApiGet(`${TONAPI_BASE_URL}/v2/blockchain/messages/${encodeURIComponent(parsed.hash)}/transaction`);const incoming=txIncoming(tx);
 if(incoming.destination&&incoming.destination!==normalizeAddress(PROJECT_WALLET))return null;if(incoming.value!==String(intent.amount_nanoton))return null;
 if(intent.wallet_address&&incoming.source&&incoming.source!==normalizeAddress(intent.wallet_address))return null;
 const txHash=String(tx.hash||tx.transaction_id?.hash||'');if(!txHash)return null;return {hash:txHash,source:incoming.source,destination:incoming.destination,value:incoming.value,messageHash:parsed.hash};
}
app.post('/api/payments/verify',async(req,res)=>{
 const intentId=String(req.body?.intentId||'');const boc=String(req.body?.boc||req.body?.transaction?.boc||'');if(!intentId||!boc)return res.status(400).json({error:'intent_and_boc_required'});
 const c=await pool.connect();try{await c.query('BEGIN');const q=await c.query('SELECT * FROM payment_intents WHERE id=$1 AND telegram_id=$2 FOR UPDATE',[intentId,req.tgUser.id]);if(!q.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'payment_intent_not_found'});}const intent=q.rows[0];if(intent.status==='verified'){await c.query('COMMIT');return res.json({ok:true,verified:true,txHash:intent.tx_hash});}
  let found=null;try{found=await verifyPaymentBoc(intent,boc);}catch(e){if(e.status!==404)console.error('TON verification:',e.message);}
  if(!found){await c.query('UPDATE payment_intents SET verification_attempts=verification_attempts+1,last_checked_at=NOW() WHERE id=$1',[intentId]);await c.query('COMMIT');return res.status(202).json({ok:true,verified:false,status:'pending_verification'});}
  const duplicate=await c.query('SELECT id FROM payment_intents WHERE tx_hash=$1 AND id<>$2',[found.hash,intentId]);if(duplicate.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'transaction_already_used'});}
  await c.query("UPDATE payment_intents SET status='verified',tx_hash=$2,verified_at=NOW(),last_checked_at=NOW(),verification_attempts=verification_attempts+1 WHERE id=$1",[intentId,found.hash]);await c.query('UPDATE users SET joined=TRUE,updated_at=NOW() WHERE telegram_id=$1',[req.tgUser.id]);await c.query('COMMIT');res.json({ok:true,verified:true,txHash:found.hash,messageHash:found.messageHash});
 }catch(e){await c.query('ROLLBACK');console.error('payment verification error',e);res.status(503).json({error:'payment_verification_unavailable'});}finally{c.release();}
});

app.get('/api/payments/status/:id',async(req,res)=>{const c=await pool.connect();try{const q=await c.query('SELECT id,status,tx_hash,amount_nanoton,verified_at FROM payment_intents WHERE id=$1 AND telegram_id=$2',[req.params.id,req.tgUser.id]);if(!q.rowCount)return res.status(404).json({error:'payment_not_found'});res.json(q.rows[0]);}finally{c.release();}});

async function airdropScore(c,id){
 const u=(await c.query('SELECT * FROM users WHERE telegram_id=$1',[id])).rows[0];if(!u)return {score:0,eligible:false,riskScore:0,referrals:0};
 const referrals=await c.query("SELECT COUNT(*)::int AS n FROM referrals WHERE referrer_id=$1 AND status='completed'",[id]);
 const score=Number(u.taps)+Number(u.task_bonus)+Number(u.streak)*50+Number(referrals.rows[0].n||0)*100;
 return {score,eligible:score>=AIRDROP_MIN_SCORE&&Number(u.risk_score||0)<AIRDROP_RISK_MAX,riskScore:Number(u.risk_score||0),referrals:Number(referrals.rows[0].n||0)};
}
function adminGuard(req,res){
 if(!ADMIN_SECRET)return res.status(503).json({error:'admin_secret_not_configured'});
 const provided=req.header('X-Admin-Secret')||'';
 if(provided.length!==ADMIN_SECRET.length||!crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(ADMIN_SECRET)))return res.status(403).json({error:'admin_forbidden'});
 return null;
}
app.get('/api/airdrop/score',async(req,res)=>{const c=await pool.connect();try{res.json(await airdropScore(c,req.tgUser.id));}finally{c.release();}});
app.get('/api/airdrop/current',async(req,res)=>{const c=await pool.connect();try{const q=await c.query(`SELECT a.snapshot_id,a.score,a.allocation,a.wallet_address,a.risk_score,a.status,a.claim_id,a.claim_tx_hash,a.claimed_at,a.paid_at,s.pool_amount,s.status AS snapshot_status FROM airdrop_allocations a JOIN airdrop_snapshots s ON s.id=a.snapshot_id WHERE a.telegram_id=$1 ORDER BY s.created_at DESC LIMIT 1`,[req.tgUser.id]);if(!q.rowCount)return res.json({available:false});res.json({available:true,...q.rows[0],tokenSymbol:AIRDROP_TOKEN_SYMBOL});}finally{c.release();}});
app.post('/api/airdrop/claim',async(req,res)=>{const c=await pool.connect();try{await c.query('BEGIN');const u=(await c.query('SELECT * FROM users WHERE telegram_id=$1 FOR UPDATE',[req.tgUser.id])).rows[0];if(!u.wallet_address){await c.query('ROLLBACK');return res.status(409).json({error:'wallet_required'});}if(AIRDROP_CLAIM_REQUIRE_JOINED&&!u.joined){await c.query('ROLLBACK');return res.status(409).json({error:'join_required'});}const q=await c.query(`SELECT a.*,s.status AS snapshot_status FROM airdrop_allocations a JOIN airdrop_snapshots s ON s.id=a.snapshot_id WHERE a.telegram_id=$1 ORDER BY s.created_at DESC LIMIT 1 FOR UPDATE`,[u.telegram_id]);if(!q.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'airdrop_not_available'});}const a=q.rows[0];if(a.status==='paid'){await c.query('COMMIT');return res.json({ok:true,status:'paid',amount:String(a.allocation),txHash:a.claim_tx_hash});}if(a.status==='claimed'){await c.query('COMMIT');return res.json({ok:true,status:'claimed',claimId:a.claim_id,amount:String(a.allocation)});}if(a.status!=='available'||Number(a.risk_score)>=AIRDROP_RISK_MAX||Number(u.risk_score)>=AIRDROP_RISK_MAX||Number(a.allocation)<=0){await c.query('ROLLBACK');return res.status(409).json({error:'airdrop_not_eligible'});}const claimId=crypto.randomUUID();await c.query('INSERT INTO airdrop_claims(id,snapshot_id,telegram_id,wallet_address,amount) VALUES($1,$2,$3,$4,$5)',[claimId,a.snapshot_id,u.telegram_id,u.wallet_address,a.allocation]);await c.query("UPDATE airdrop_allocations SET status='claimed',claim_id=$3,claimed_at=NOW(),wallet_address=$2 WHERE snapshot_id=$1 AND telegram_id=$4",[a.snapshot_id,u.wallet_address,claimId,u.telegram_id]);await c.query('COMMIT');res.json({ok:true,status:'claimed',claimId,amount:String(a.allocation),walletAddress:u.wallet_address,tokenSymbol:AIRDROP_TOKEN_SYMBOL});}catch(e){await c.query('ROLLBACK');if(e.code==='23505')return res.status(409).json({error:'airdrop_claim_already_exists'});console.error(e);res.status(500).json({error:'airdrop_claim_failed'});}finally{c.release();}});
app.post('/api/admin/airdrop/snapshot',async(req,res)=>{const denied=adminGuard(req,res);if(denied)return;const poolAmount=String(req.body?.poolAmount||'').trim();if(!/^\d+(?:\.\d{1,6})?$/.test(poolAmount)||Number(poolAmount)<=0)return res.status(400).json({error:'positive_pool_amount_required'});const c=await pool.connect();try{await c.query('BEGIN');const id=crypto.randomUUID();const users=await c.query(`SELECT u.telegram_id,u.wallet_address,u.risk_score,u.taps,u.task_bonus,u.streak,COALESCE(r.n,0) AS referrals FROM users u LEFT JOIN (SELECT referrer_id,COUNT(*)::int n FROM referrals WHERE status='completed' GROUP BY referrer_id) r ON r.referrer_id=u.telegram_id`);const eligible=users.rows.map(u=>({...u,score:Number(u.taps)+Number(u.task_bonus)+Number(u.streak)*50+Number(u.referrals)*100})).filter(u=>u.score>=AIRDROP_MIN_SCORE&&Number(u.risk_score)<AIRDROP_RISK_MAX&&u.wallet_address);const total=eligible.reduce((n,u)=>n+u.score,0);if(total<=0){await c.query('ROLLBACK');return res.status(409).json({error:'no_eligible_users'});}await c.query('INSERT INTO airdrop_snapshots(id,pool_amount,total_score,eligible_users) VALUES($1,$2::numeric,$3::numeric,$4)',[id,poolAmount,total,eligible.length]);for(const u of eligible){await c.query('INSERT INTO airdrop_allocations(snapshot_id,telegram_id,score,allocation,wallet_address,risk_score) VALUES($1,$2,$3::numeric,($4::numeric*$3::numeric/$5::numeric),$6,$7)',[id,u.telegram_id,u.score,poolAmount,total,u.wallet_address,u.risk_score]);}await c.query('COMMIT');res.json({ok:true,snapshotId:id,poolAmount,totalScore:total,eligibleUsers:eligible.length});}catch(e){await c.query('ROLLBACK');console.error(e);res.status(500).json({error:'airdrop_snapshot_failed'});}finally{c.release();}});
app.get('/api/admin/airdrop/:id',async(req,res)=>{const denied=adminGuard(req,res);if(denied)return;const c=await pool.connect();try{const s=await c.query('SELECT * FROM airdrop_snapshots WHERE id=$1',[req.params.id]);if(!s.rowCount)return res.status(404).json({error:'snapshot_not_found'});const a=await c.query('SELECT telegram_id,score,allocation,wallet_address,risk_score,status,claim_id,claim_tx_hash,claimed_at,paid_at FROM airdrop_allocations WHERE snapshot_id=$1 ORDER BY allocation DESC',[req.params.id]);res.json({snapshot:s.rows[0],allocations:a.rows});}finally{c.release();}});
app.post('/api/admin/airdrop/:id/payout',async(req,res)=>{const denied=adminGuard(req,res);if(denied)return;const claimId=String(req.body?.claimId||'');const txHash=String(req.body?.txHash||'').trim();if(!claimId||txHash.length<20)return res.status(400).json({error:'claim_id_and_tx_hash_required'});const c=await pool.connect();try{await c.query('BEGIN');const q=await c.query('SELECT * FROM airdrop_claims WHERE id=$1 FOR UPDATE',[claimId]);if(!q.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'claim_not_found'});}if(q.rows[0].status==='paid'){await c.query('COMMIT');return res.json({ok:true,status:'paid',txHash:q.rows[0].payout_tx_hash});}await c.query("UPDATE airdrop_claims SET status='paid',payout_tx_hash=$2,paid_at=NOW() WHERE id=$1",[claimId,txHash]);await c.query("UPDATE airdrop_allocations SET status='paid',claim_tx_hash=$2,paid_at=NOW() WHERE claim_id=$1",[claimId,txHash]);await c.query('COMMIT');res.json({ok:true,status:'paid',txHash});}catch(e){await c.query('ROLLBACK');if(e.code==='23505')return res.status(409).json({error:'payout_tx_already_used'});res.status(500).json({error:'payout_record_failed'});}finally{c.release();}});

app.get('/api/ton/config',async(req,res)=>{
 const origin=(APP_URL||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');
 let projectWallet='';try{projectWallet=Address.parse(PROJECT_WALLET).toString({bounceable:true,testOnly:false,urlSafe:true});}catch{}
 res.json({ok:true,network:TON_MAINNET,manifestUrl:`${origin}/tonconnect-manifest.json`,iconUrl:`${origin}/icon.png`,projectWallet,configured:!!projectWallet});
});
app.get('/tonconnect-manifest.json',async(req,res)=>{
 const origin=(APP_URL||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');
 res.set('Cache-Control','no-store');
 res.type('application/json').send(JSON.stringify({url:origin,name:'TapNova',iconUrl:`${origin}/icon.png`}));
});
app.use(express.static(path.join(root,'frontend')));
app.get('*',(req,res)=>res.sendFile(path.join(root,'frontend','index.html')));

initDatabase().then(()=>app.listen(PORT,()=>console.log(`TapNova listening on ${PORT}`))).catch(err=>{console.error('Database initialization failed:',err);process.exit(1);});
