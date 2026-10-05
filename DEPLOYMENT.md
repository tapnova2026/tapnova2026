# TapNova Deployment

## Required environment variables

```text
NODE_ENV=production
PORT=3000
APP_URL=https://YOUR-DOMAIN
DATABASE_URL=YOUR-POSTGRES-URL
TELEGRAM_BOT_TOKEN=YOUR-BOT-TOKEN
TELEGRAM_BOT_USERNAME=YOUR_BOT_USERNAME
TELEGRAM_CHANNEL_ID=@YOUR_CHANNEL
PROJECT_TON_WALLET=YOUR_TREASURY_WALLET
JOIN_FEE_NANOTON=100000000
TONAPI_BASE_URL=https://tonapi.io
TONAPI_TOKEN=YOUR_TONAPI_TOKEN
```

## Before public launch

1. Set the Telegram bot's Web App URL to the exact HTTPS `APP_URL`.
2. Make the bot an administrator of the official channel so membership verification works.
3. Set `PROJECT_TON_WALLET` to the real treasury wallet.
4. Configure a production TONAPI token.
5. Deploy with `NODE_ENV=production`.
6. Check `GET /api/health`.
7. Test taps, daily reward, cards, referrals and payment verification with a test account.
8. Never put a seed phrase or private key in this project or its environment variables.

## Payment verification note

The backend verifies the TonConnect BOC by deriving a normalized external-in message hash and resolving the transaction through TONAPI. For a large-value public launch, use a production TONAPI plan and monitor verification failures/rate limits.


## Final launch configuration

Configure `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `PROJECT_TON_WALLET`, `TONAPI_TOKEN`, `DATABASE_URL`, `APP_URL`, and a long random `ADMIN_SECRET`. The Telegram bot should be an administrator of the channel for reliable `getChatMember` verification.

TON verification expects the TonConnect result BOC and resolves its normalized external-in message through TONAPI.

Airdrop payout is treasury-controlled: no private key is stored in this repository. After a user creates a claim, the treasury/distributor pays the allocation to the recorded wallet and the admin records the payout transaction hash.
