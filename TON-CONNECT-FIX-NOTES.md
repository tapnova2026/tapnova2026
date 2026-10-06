# TapNova TON Connect — completed fix

This build hardens the TON Connect flow for the Telegram Mini App.

## What was fixed
1. Pinned `@tonconnect/ui@3.0.2` remains in use (current published 3.x release used by this build).
2. CDN loading is waited on before initialization, so opening the Wallet page before the script finishes no longer creates a false failure.
3. The frontend fetches public TON configuration from `/api/public/ton/config`.
4. Telegram Mini App return handling uses `twaReturnUrl=https://t.me/<BOT_USERNAME>` when `TELEGRAM_BOT_USERNAME` is configured.
5. Mainnet `-239` is enforced before wallet selection.
6. `connectionRestored` is awaited before treating the wallet as disconnected.
7. Retry no longer creates a second TON Connect instance while the previous instance is still alive.
8. Wallet address is normalized and linked server-side.
9. Payment amount and destination remain server-controlled and payment is verified server-side from the returned BOC.
10. Android back-handler is disabled for the TON Connect UI to avoid modal/history conflicts inside Telegram Mini Apps.
11. The UI reports an empty wallet registry and manifest/config failures instead of silently failing.

## Required production environment
- `APP_URL=https://<your-render-service>.onrender.com`
- `CORS_ORIGINS=https://tapnova2026.github.io`
- `TELEGRAM_BOT_USERNAME=<your bot username without @>`
- `PROJECT_TON_WALLET=<public mainnet wallet>`
- `TONAPI_BASE_URL=https://tonapi.io`
- `TONAPI_TOKEN=<TONAPI token>`

Never place a seed phrase or private key in this project.
