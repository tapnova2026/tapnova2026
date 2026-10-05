# TON Connect focused fix

This archive is focused only on TON Connect reliability.

Changes:
- Pin official `@tonconnect/ui` to 3.0.2 instead of `latest`.
- Add jsDelivr CDN fallback if UNPKG fails.
- Build manifest URL from the production origin instead of a relative path.
- Validate the manifest before initializing TonConnect UI.
- Set TON mainnet (`-239`) before opening the wallet picker.
- Use `connectionRestored` for session restoration.
- Normalize connected wallet addresses server-side with `@ton/core`.
- Normalize the project treasury address to user-friendly TON format before returning it to the frontend.
- Add `/api/ton/config` diagnostic endpoint.
- Add a focused TON Connect setup/troubleshooting document.
- Keep transaction verification server-side; the client never marks a payment as verified by itself.
