import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'../..');
const app=express();
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:false});
const PORT=Number(process.env.PORT||3000);
const BOT_TOKEN=process.env.TELEGRAM_BOT_TOKEN||'';
const isProd=process.env.NODE_ENV==='production';

async function initDatabase(){
  const schema=await readFile(path.join(root,'backend','schema.sql'),'utf8');
  await pool.query(schema);
}

app.use(helmet({contentSecurityPolicy:false}));
app.use(cors({origin:true,credentials:false}));
app.use(express.json({limit:'100kb'}));

const CARDS={
 starter:{price:1000,pph:5,max:5},
 pro:{price:5000,pph:30,max:7},
 elite:{price:15000,pph:100,max:10},
 nova:{price:50000,pph:400,max:12}
};
const TASKS={daily:{reward:100,daily:true},telegram:{reward:250,daily:true},share:{reward:200,daily:true},wallet:{reward:300,daily:true}};

function authUser(req){
 const initData=req.header('X-Telegram-Init-Data')||'';
 if(!initData){if(!isProd)return {id:'dev_user',username:'dev',first_name:'Developer'};throw new Error('Telegram authentication required');}
 if(!BOT_TOKEN)throw new Error('TELEGRAM_BOT_TOKEN is not configured');
 const p=new URLSearchParams(initData);const hash=p.get('hash');p.delete('hash');
 if(!hash)throw new Error('Invalid Telegram init data');
 const data=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
 const check=crypto.createHmac('sha256',secret).update(data).digest('hex');
 if(!crypto.timingSafeEqual(Buffer.from(check),Buffer.from(hash)))throw new Error('Invalid Telegram signature');
 const authDate=Number(p.get('auth_date')||0);if(!authDate||Date.now()/1000-authDate>86400)throw new Error('Telegram auth data expired');
 const user=JSON.parse(p.get('user')||'{}');if(!user.id)throw new Error('Telegram user missing');
 return {id:String(user.id),username:user.username||'',first_name:user.first_name||''};
}
async function getUser(c,id,profile={}){
 await c.query(`INSERT INTO users(telegram_id,username,first_name) VALUES($1,$2,$3) ON CONFLICT(telegram_id) DO UPDATE SET username=COALESCE(NULLIF($2,''),users.username),first_name=COALESCE(NULLIF($3,''),users.first_name),updated_at=NOW()`,[id,profile.username||'',profile.first_name||'']);
 const r=await c.query('SELECT * FROM users WHERE telegram_id=$1',[id]);return r.rows[0];
}
function regen(u){const now=Date.now();const last=new Date(u.last_energy_at).getTime();const gained=Math.floor((now-last)/3000);if(gained<=0)return u;u.energy=Math.min(u.max_energy,u.energy+gained);u.last_energy_at=new Date(Math.min(now,last+gained*3000));return u;}
async function saveEnergy(c,u){await c.query('UPDATE users SET energy=$2,last_energy_at=$3,updated_at=NOW() WHERE telegram_id=$1',[u.telegram_id,u.energy,u.last_energy_at]);}
async function credit(c,id,amount,reason,key){if(amount<=0)return;await c.query('INSERT INTO ledger(telegram_id,amount,reason,idempotency_key) VALUES($1,$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING',[id,amount,reason,key]);await c.query('UPDATE users SET balance=balance+$2,task_bonus=task_bonus+CASE WHEN $3 THEN $2 ELSE 0 END,updated_at=NOW() WHERE telegram_id=$1',[id,amount,reason.startsWith('task:')]);}
function cardsFor(uRows){return uRows.map(x=>({id:x.card_id,level:x.level}));}

app.get('/api/health',async(req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true,service:'tapnova',time:new Date().toISOString()});}catch(e){res.status(503).json({ok:false,error:'database_unavailable'});}});
app.use('/api',(req,res,next)=>{try{req.tgUser=authUser(req);next();}catch(e){res.status(401).json({error:e.message});}});

app.get('/api/game/state',async(req,res)=>{const c=await pool.connect();try{const u=regen(await getUser(c,req.tgUser.id,req.tgUser));await saveEnergy(c,u);const cards=await c.query('SELECT card_id,level FROM user_cards WHERE telegram_id=$1',[u.telegram_id]);res.json({user:{telegramId:u.telegram_id,username:u.username,firstName:u.first_name,balance:Number(u.balance),taps:Number(u.taps),energy:u.energy,maxEnergy:u.max_energy,taskBonus:Number(u.task_bonus),streak:u.streak,lastDaily:u.last_daily,walletAddress:u.wallet_address,joined:u.joined},cards:cardsFor(cards.rows)});}finally{c.release();}});

app.post('/api/taps/batch',async(req,res)=>{const count=Math.max(1,Math.min(50,Number(req.body?.count||0)));const key=String(req.body?.idempotencyKey||'');if(!key)return res.status(400).json({error:'idempotencyKey required'});const c=await pool.connect();try{await c.query('BEGIN');let u=regen(await getUser(c,req.tgUser.id,req.tgUser));const exists=await c.query('SELECT count FROM tap_batches WHERE client_idempotency_key=$1',[key]);if(exists.rowCount){await c.query('COMMIT');return res.json({ok:true,duplicate:true});}const actual=Math.min(count,u.energy);if(actual<=0){await c.query('ROLLBACK');return res.status(409).json({error:'energy_empty'});}await c.query('INSERT INTO tap_batches(telegram_id,count,client_idempotency_key) VALUES($1,$2,$3)',[u.telegram_id,actual,key]);await c.query('UPDATE users SET energy=$2,taps=taps+$3,balance=balance+$3,last_energy_at=$4,updated_at=NOW() WHERE telegram_id=$1',[u.telegram_id,u.energy-actual,actual,u.last_energy_at]);await c.query('INSERT INTO ledger(telegram_id,amount,reason,idempotency_key) VALUES($1,$2,$3,$4)',[u.telegram_id,actual,'tap:'+actual,key]);await c.query('COMMIT');res.json({ok:true,count:actual});}catch(e){await c.query('ROLLBACK');res.status(500).json({error:'tap_failed'});}finally{c.release();}});

app.post('/api/daily/claim',async(req,res)=>{const c=await pool.connect();try{await c.query('BEGIN');const u=await getUser(c,req.tgUser.id,req.tgUser);const today=new Date().toISOString().slice(0,10);if(u.last_daily&&String(u.last_daily).slice(0,10)===today){await c.query('ROLLBACK');return res.status(409).json({error:'already_claimed'});}const y=new Date(Date.now()-86400000).toISOString().slice(0,10);const streak=String(u.last_daily||'').slice(0,10)===y?u.streak+1:1;await c.query('UPDATE users SET balance=balance+500,task_bonus=task_bonus+500,last_daily=$2,streak=$3,updated_at=NOW() WHERE telegram_id=$1',[u.telegram_id,today,streak]);await c.query('INSERT INTO ledger(telegram_id,amount,reason,idempotency_key) VALUES($1,500,$2,$3)',[u.telegram_id,'daily','daily:'+u.telegram_id+':'+today]);await c.query('COMMIT');res.json({ok:true,reward:500,streak});}catch(e){await c.query('ROLLBACK');res.status(500).json({error:'daily_claim_failed'});}finally{c.release();}});

app.post('/api/tasks/:id/claim',async(req,res)=>{const id=req.params.id;if(!TASKS[id])return res.status(404).json({error:'task_not_found'});const c=await pool.connect();try{await c.query('BEGIN');const u=await getUser(c,req.tgUser.id,req.tgUser);const done=await c.query('SELECT 1 FROM task_completions WHERE telegram_id=$1 AND task_id=$2 AND completed_on=CURRENT_DATE',[u.telegram_id,id]);if(done.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'task_already_completed'});}if(id==='daily'&&Number(u.taps)<1){await c.query('ROLLBACK');return res.status(409).json({error:'tap_required'});}await c.query('INSERT INTO task_completions(telegram_id,task_id) VALUES($1,$2)',[u.telegram_id,id]);const reward=TASKS[id].reward;await c.query('UPDATE users SET balance=balance+$2,task_bonus=task_bonus+$2,updated_at=NOW() WHERE telegram_id=$1',[u.telegram_id,reward]);await c.query('INSERT INTO ledger(telegram_id,amount,reason,idempotency_key) VALUES($1,$2,$3,$4)',[u.telegram_id,reward,'task:'+id,'task:'+u.telegram_id+':'+id+':'+new Date().toISOString().slice(0,10)]);await c.query('COMMIT');res.json({ok:true,reward});}catch(e){await c.query('ROLLBACK');res.status(500).json({error:'task_claim_failed'});}finally{c.release();}});

app.post('/api/cards/:id/buy',async(req,res)=>{const id=req.params.id,cfg=CARDS[id];if(!cfg)return res.status(404).json({error:'card_not_found'});const c=await pool.connect();try{await c.query('BEGIN');const u=await getUser(c,req.tgUser.id,req.tgUser);const exists=await c.query('SELECT 1 FROM user_cards WHERE telegram_id=$1 AND card_id=$2',[u.telegram_id,id]);if(exists.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'card_owned'});}if(Number(u.balance)<cfg.price){await c.query('ROLLBACK');return res.status(409).json({error:'insufficient_balance'});}await c.query('UPDATE users SET balance=balance-$2,updated_at=NOW() WHERE telegram_id=$1',[u.telegram_id,cfg.price]);await c.query('INSERT INTO user_cards(telegram_id,card_id,level) VALUES($1,$2,1)',[u.telegram_id,id]);await c.query('INSERT INTO ledger(telegram_id,amount,reason,idempotency_key) VALUES($1,$2,$3,$4)',[u.telegram_id,-cfg.price,'card_buy:'+id,'cardbuy:'+u.telegram_id+':'+id]);await c.query('COMMIT');res.json({ok:true});}catch(e){await c.query('ROLLBACK');res.status(500).json({error:'card_buy_failed'});}finally{c.release();}});

app.post('/api/cards/:id/upgrade',async(req,res)=>{const id=req.params.id,cfg=CARDS[id];if(!cfg)return res.status(404).json({error:'card_not_found'});const c=await pool.connect();try{await c.query('BEGIN');const u=await getUser(c,req.tgUser.id,req.tgUser);const q=await c.query('SELECT level FROM user_cards WHERE telegram_id=$1 AND card_id=$2 FOR UPDATE',[u.telegram_id,id]);if(!q.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'card_not_owned'});}const level=q.rows[0].level;if(level>=cfg.max){await c.query('ROLLBACK');return res.status(409).json({error:'card_max_level'});}const cost=Math.floor(cfg.price*level*0.65);if(Number(u.balance)<cost){await c.query('ROLLBACK');return res.status(409).json({error:'insufficient_balance'});}await c.query('UPDATE users SET balance=balance-$2,updated_at=NOW() WHERE telegram_id=$1',[u.telegram_id,cost]);await c.query('UPDATE user_cards SET level=level+1,upgraded_at=NOW() WHERE telegram_id=$1 AND card_id=$2',[u.telegram_id,id]);await c.query('INSERT INTO ledger(telegram_id,amount,reason,idempotency_key) VALUES($1,$2,$3,$4)',[u.telegram_id,-cost,'card_upgrade:'+id,'cardup:'+u.telegram_id+':'+id+':'+level]);await c.query('COMMIT');res.json({ok:true,level:level+1});}catch(e){await c.query('ROLLBACK');res.status(500).json({error:'card_upgrade_failed'});}finally{c.release();}});

app.get('/api/airdrop/score',async(req,res)=>{const c=await pool.connect();try{const u=await getUser(c,req.tgUser.id,req.tgUser);const score=Number(u.taps)+Number(u.task_bonus)+Number(u.streak)*50;res.json({score,eligible:true});}finally{c.release();}});

app.get('/tonconnect-manifest.json',async(req,res)=>{res.type('application/json').send(JSON.stringify({url:process.env.APP_URL||'',name:'TapNova',iconUrl:(process.env.APP_URL||'')+'/icon.png'}));});
app.use(express.static(path.join(root,'frontend')));
app.get('*',(req,res)=>res.sendFile(path.join(root,'frontend','index.html')));

initDatabase().then(()=>{
  app.listen(PORT,()=>console.log(`TapNova listening on ${PORT}`));
}).catch((err)=>{
  console.error('Database initialization failed:',err);
  process.exit(1);
});
