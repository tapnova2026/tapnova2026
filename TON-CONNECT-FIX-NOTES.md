# TON Connect fix — final architecture

The previous failure was caused by mixing a static GitHub Pages frontend with same-origin API/manifest URLs.

Fixed:
1. Frontend API base points to Render via `frontend/config.js`.
2. TON manifest URL points to the Render backend.
3. Backend CORS allows the GitHub Pages origin.
4. Backend dynamically serves a production manifest with the real backend origin.
5. Wallet address is normalized to user-friendly mainnet form before linking.
6. Mainnet chain `-239` is enforced before wallet selection/transaction.
7. Payment remains server-verified; client never marks payment as verified.
8. `@tonconnect/ui` remains pinned to 3.0.2, which is the current published UI package version checked during this build.

Required live checks after deployment:
- Open backend `/tonconnect-manifest.json` directly.
- Open frontend from Telegram.
- Tap Connect Wallet.
- Confirm the wallet appears and returns a connected address.
- Confirm `/api/wallet/link` succeeds.
- Only then test the 0.1 TON payment flow.
