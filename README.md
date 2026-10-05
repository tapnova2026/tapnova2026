# TapNova Frontend

This is the Telegram Mini App frontend. In production it is served by the Node backend.

Before production:
1. Set `APP_URL` to the final HTTPS domain.
2. Update `tonconnect-manifest.json` with the same domain and a real `/icon.png`.
3. Set the Telegram bot username in `index.html`.
