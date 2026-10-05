# TapNova Test गर्ने तरिका

## A. सबैभन्दा सजिलो: Render
1. GitHub मा files upload गर्नुहोस्।
2. Render Blueprint deploy गर्नुहोस्।
3. `/api/health` खोल्नुहोस्।
4. Telegram Mini App खोलेर tap/daily/card test गर्नुहोस्।

## B. आफ्नो computer मा Docker भए
Repository root मा terminal खोल्नुहोस्:

```bash
docker compose up --build
```

त्यसपछि खोल्नुहोस्:
`http://localhost:3000`

Health:
`http://localhost:3000/api/health`

Development mode मा API ले `dev_user` स्वीकार गर्छ, तर production मा Telegram `initData` अनिवार्य हुन्छ।

Stop:
```bash
docker compose down
```

## Basic checks
- page loads
- `/api/health` returns `ok: true`
- tap decreases energy and increases TNV
- refresh keeps server state
- daily reward cannot be claimed twice on the same day
- card buy/upgrade updates server state
