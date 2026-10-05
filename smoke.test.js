import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

const root=process.cwd();

test('server.js has valid Node syntax',()=>{
  execFileSync(process.execPath,['--check',path.join(root,'src','server.js')],{stdio:'pipe'});
});

test('frontend embedded script has valid JavaScript syntax',async()=>{
  const html=await readFile(path.join(root,'..','frontend','index.html'),'utf8');
  const scripts=[...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
  assert.ok(scripts.length>0);
  const js=scripts[scripts.length-1];
  execFileSync(process.execPath,['--check','-'],{input:js,stdio:['pipe','pipe','pipe']});
});

test('production auth fallback is disabled when NODE_ENV=production',async()=>{
  const server=await readFile(path.join(root,'src','server.js'),'utf8');
  assert.match(server,/if\(!isProd\)return \{id:'dev_user'/);
  assert.match(server,/const isProd=process\.env\.NODE_ENV==='production'/);
});


test('final launch features are present',async()=>{
 const server=await readFile(path.join(root,'src','server.js'),'utf8');
 assert.match(server,/getChatMember/);assert.match(server,/normalizedExternalMessageHash/);assert.match(server,/\/api\/airdrop\/claim/);assert.match(server,/\/api\/admin\/airdrop\/snapshot/);assert.match(server,/\/api\/admin\/airdrop\/.*\/payout/);
});

test('schema contains final airdrop tables',async()=>{
 const schema=await readFile(path.join(root,'schema.sql'),'utf8');assert.match(schema,/CREATE TABLE IF NOT EXISTS airdrop_snapshots/);assert.match(schema,/CREATE TABLE IF NOT EXISTS airdrop_allocations/);assert.match(schema,/CREATE TABLE IF NOT EXISTS airdrop_claims/);
});
