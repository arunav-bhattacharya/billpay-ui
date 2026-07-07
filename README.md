# Billpay Market Onboarding

Internal tool for onboarding new markets onto the Billpay platform — American Express's
unified payment system for credit-card bill payments and refunds.

A market joins Billpay by selecting the APIs it will use (Core, Composite, Event Handlers);
the selected APIs imply the market's processing **dimensions** (`accountType`,
`requiresArPosting`, `requiresRealtimeClearing`, `requiresMandateAuthorization`).
Each market is captured as one or more **profiles** — specific combinations of these
dimensions plus the API selection — persisted as a JSON document at market level.

## Layout

| Path        | Description                                        |
|-------------|----------------------------------------------------|
| `backend/`  | Kotlin + Quarkus REST API, H2 file database        |
| `frontend/` | React + Vite + TypeScript single-page app          |

## Run

```bash
# Backend (http://localhost:8080)
cd backend && ./gradlew quarkusDev

# Frontend (http://localhost:5173, proxies /api → :8080)
cd frontend && npm install && npm run dev
```

## Domain reference

- Product vision / Markets & Dimensions: https://arunav-bhattacharya.github.io/billpay-book/docs/vision/product#markets-and-dimensions
- API catalog (One-Data): https://arunav-bhattacharya.github.io/billpay-book/docs/build/api-spec/one-data
