# TapNova — GitHub + Render Ready

यो package TapNova लाई GitHub मा राखेर Render मा deploy गर्न तयार गरिएको foundation हो।

## Included
- Telegram Mini App frontend
- Server-authoritative tap/balance/energy state
- Daily reward and task endpoints
- Card buy/upgrade endpoints
- PostgreSQL schema + automatic schema initialization
- Render Blueprint with PostgreSQL
- TON Connect manifest endpoint
- Local Docker test setup

## 1. GitHub
1. GitHub मा नयाँ repository बनाउनुहोस्, जस्तै `tapnova`।
2. ZIP extract गर्नुहोस्।
3. Extract भएको folder का सबै files repository को root मा upload गर्नुहोस्।
4. `render.yaml` root मै हुनुपर्छ।
5. Commit changes.

## 2. Render
Render Dashboard → New + → Blueprint → आफ्नो `tapnova` repository Connect → Apply/Deploy Blueprint.

Blueprint ले `tapnova` web service र `tapnova-db` PostgreSQL बनाउँछ। `DATABASE_URL` database बाट automatically जोडिन्छ।

Render ले मागेका secret values मा:
- `APP_URL`: Render ले दिएको `https://....onrender.com`
- `TELEGRAM_BOT_TOKEN`: BotFather बाट आएको token
- `TELEGRAM_BOT_USERNAME`: bot username, @ बिना
- `PROJECT_TON_WALLET`: तपाईंको project wallet address
- `TONAPI_TOKEN`: TON API key (यदि प्रयोग गर्ने हो)

## 3. Health test
Deploy भएपछि browser मा:
`https://YOUR-APP.onrender.com/api/health`

Database तयार छ भने JSON मा `ok: true` देखिन्छ।

## 4. Telegram test
Telegram Mini App लाई तपाईंको bot मा जोडेर app खोल्नुहोस्। API ले Telegram `initData` verify गर्छ। Development बाहेक fake user authentication प्रयोग नगर्नुहोस्।

## 5. Important
यो production foundation हो, final 100M+ scale economy होइन। Real launch अघि payment verification, referral verification, anti-bot/risk engine, Redis/rate limiting, migrations, monitoring, audit logs, and final airdrop accounting अझै harden गर्नुपर्छ।
