# TapNova Production Test Checklist

## Authentication
- [ ] Valid Telegram Mini App `initData` authenticates.
- [ ] Invalid signature returns 401.
- [ ] Expired `auth_date` returns 401.
- [ ] Production never accepts the development user fallback.

## Economy
- [ ] Tap batches are accepted only through `/api/taps/batch`.
- [ ] Duplicate idempotency keys do not mint TNV twice.
- [ ] Server energy is authoritative.
- [ ] Daily reward cannot be claimed twice on the same UTC date.
- [ ] Card purchases and upgrades are server-side transactions.
- [ ] Client-side localStorage edits do not change server balance.

## Tasks
- [ ] Daily task requires at least one server-confirmed tap.
- [ ] Telegram task requires Telegram membership verification.
- [ ] Wallet task requires a linked wallet.
- [ ] Referral task requires an activated referral.

## Referrals
- [ ] Self-referral is rejected.
- [ ] A referred account can only have one referrer.
- [ ] Referral activates after the referred user records a real tap.
- [ ] Referrer reward is idempotent.

## TON payment
- [ ] Payment intent is created server-side.
- [ ] Client never sets `joined=true` directly.
- [ ] Treasury address and amount are server-controlled.
- [ ] Recent on-chain transfer is checked by the backend.
- [ ] Duplicate transaction hashes cannot be verified twice.
- [ ] Payment verification remains pending when TONAPI is unavailable.

## Abuse controls
- [ ] Tap endpoint is rate limited.
- [ ] Large tap batches create a risk event.
- [ ] Risk score affects airdrop eligibility.
- [ ] Suspicious accounts can be reviewed before airdrop allocation.

## Deployment
- [ ] `NODE_ENV=production`.
- [ ] `TELEGRAM_BOT_TOKEN` is configured only in the hosting secret store.
- [ ] `PROJECT_TON_WALLET` is correct.
- [ ] `TONAPI_TOKEN` is configured for production verification.
- [ ] `TELEGRAM_CHANNEL_ID` is configured and the bot can inspect membership.
- [ ] `APP_URL` is the exact HTTPS public URL.
- [ ] Database migrations/schema apply successfully.
