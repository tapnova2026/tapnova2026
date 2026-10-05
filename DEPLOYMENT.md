# TapNova deployment (GitHub Pages + Render)

## Architecture
- GitHub Pages: public frontend at `https://tapnova2026.github.io/tapnova2026/`
- Render: Node/Express backend + TON manifest + API
- PostgreSQL: Render database

## 1. Render
Deploy the repository using `render.yaml`. Set these values in Render Environment:
- `APP_URL=https://tapnova.onrender.com` (replace if Render assigns a different URL)
- `CORS_ORIGINS=https://tapnova2026.github.io`
- `PROJECT_TON_WALLET=UQAbrZTySlI0f0km5LJkGfSndWhCOchOJfa9PPAhiyQdb9lF`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_CHANNEL_ID`
- `TONAPI_TOKEN`, `ADMIN_SECRET`

After deploy, verify:
- `/api/health`
- `/tonconnect-manifest.json`
- `/icon.png`
- `/api/ton/config`

The manifest must be public HTTPS JSON and its icon must be PNG/ICO.

## 2. GitHub Pages
Copy the contents of `frontend/` into the Pages source. `config.js` points the static frontend at the Render backend. If your Render URL is not `https://tapnova.onrender.com`, edit only `frontend/config.js` and set the real URL.

## 3. Telegram
Set the Mini App URL to:
`https://tapnova2026.github.io/tapnova2026/`

## 4. TON Connect
The frontend uses the backend-hosted manifest, not the GitHub Pages manifest:
`https://tapnova.onrender.com/tonconnect-manifest.json`

The project wallet is the user-friendly mainnet address supplied for TapNova. Never put a seed phrase/private key in this project.
