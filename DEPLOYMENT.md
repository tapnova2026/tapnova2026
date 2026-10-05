# TapNova Deployment — Nepali Quick Guide

### GitHub
- New repository → `tapnova`
- Upload all extracted files
- Confirm `render.yaml` is at repository root
- Commit changes

### Render
- Dashboard → **New +** → **Blueprint**
- Select GitHub repository → **Connect**
- Review `tapnova` web service + `tapnova-db` PostgreSQL
- Enter secret values when prompted
- **Apply / Deploy Blueprint**

### After deploy
Open:
- `/api/health` — database/server health
- `/` — TapNova app
- `/tonconnect-manifest.json` — TON Connect manifest

### Telegram
Set your Mini App URL to the Render URL. The Telegram bot token stays only on the server.

### TON Connect
The server exposes a manifest endpoint, so the app can use the deployed origin. Keep the project wallet and API secrets out of frontend code.
