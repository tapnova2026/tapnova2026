# TapNova TON Connect setup

TapNova uses the official `@tonconnect/ui` vanilla-JS integration. The browser loads the pinned 3.0.2 bundle from UNPKG with a jsDelivr fallback.

## Required Render settings

Set `APP_URL` to the exact public HTTPS origin of this service, with no trailing slash:

`https://your-real-app.onrender.com`

Set:

- `PROJECT_TON_WALLET` = the public TON treasury address
- `TONAPI_BASE_URL` = `https://tonapi.io`
- `TONAPI_TOKEN` = your TONAPI token (for payment verification)

## Verify before testing a wallet

Open these URLs in a normal browser:

1. `https://your-real-app.onrender.com/tonconnect-manifest.json`
2. `https://your-real-app.onrender.com/icon.png`
3. `https://your-real-app.onrender.com/api/ton/config`

The manifest must return JSON containing the same HTTPS origin in `url` and `iconUrl`. The icon must be reachable without authentication.

## Wallet connect flow

1. Open TapNova over HTTPS.
2. Open the Wallet/Airdrop page.
3. Tap **Connect Wallet**.
4. Select a TON mainnet wallet.
5. Approve the connection.
6. TapNova links the connected wallet address to the authenticated Telegram user.

The app waits for TonConnect's `connectionRestored` promise on reload, so a previous session is not treated as disconnected just because the page has not restored yet.

## If connection still fails

- `MANIFEST_NOT_FOUND_ERROR`: `/tonconnect-manifest.json` is not publicly reachable.
- `MANIFEST_CONTENT_ERROR`: manifest JSON or its URL/icon is invalid.
- Empty wallet picker: check browser/network access to the TonConnect CDN and wallet registry.
- Wallet connects but server says link failed: inspect `/api/ton/config` and server logs; `PROJECT_TON_WALLET` is not needed just to connect, but `TELEGRAM_BOT_TOKEN` is needed for authenticated API calls in production.
- Transaction rejected: verify `PROJECT_TON_WALLET` is a valid user-friendly TON address and the wallet is on mainnet.

Do not put a seed phrase or private key in TapNova or Render environment variables.


## Telegram Mini App return handling

`/api/public/ton/config` exposes only non-secret TON configuration and the bot username. The frontend uses that public username to set TonConnect UI's `twaReturnUrl`, which is required for reliable return behavior when the dApp is running inside Telegram Mini Apps.

The bot token is never exposed to the frontend.
