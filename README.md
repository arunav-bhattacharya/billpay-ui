# Billpay Market Onboarding

The Market Onboarding UI: the control plane that takes a market onto Billpay, American Express's platform for card
bill payments and refunds. Its only contract with [billpay-core](https://github.com/arunav-bhattacharya/billpay-core)
is billpay-offline's Market Onboarding API.

A market is one or more **profiles**, one per account type. A profile picks the Billpay APIs it takes, answers the
four behavior questions (`requiresArPosting`, `requiresRealtimeClearing`, `requiresMandateAuthorization`,
`requiresBankConfirmation`) and carries its **Operations settings** (time zone, execution time, cancellation window,
cutoff and floor, representment, Raven statuses, bank confirmation, card authentication, MR Points, instrument
statuses, pending sweep, test accounts, and the BOTH rules).

## From draft to live

1. **Release** freezes the draft as an immutable version, vN: the release JSON billpay-core's Router reads, a
   checksum, the author and the approver. Later edits become vN+1.
2. billpay-ui sends vN to **e1**'s Market Onboarding API, which starts `onboard-{market}-{accountType}-v{N}`: check
   against the build's capability manifest, save, test with the release's mock accounts, wait for the sign-off.
3. A **deployment row** per release and environment follows that workflow; the market page reads it.
4. **Sign off** in each environment. In **e3** (production) a ServiceNow change request is recorded first.
5. **Promote** sends the same vN to the next environment once it is active where it is.

Once live, a profile can be **rolled back** one level, to the version it replaced, and **paused** or **resumed**.

## Layout

| Path        | Description                                         |
|-------------|-----------------------------------------------------|
| `backend/`  | Kotlin + Quarkus REST API, H2 file database, :8090   |
| `frontend/` | React + Vite + TypeScript single-page app, :5173     |

## Run

Each part is one command. JDK 25 (or 21) and Node 22+.

**1. billpay-core** (for a real e1), from its checkout, as its README says:

```bash
./dev/up.sh && ./gradlew :apps:offline:quarkusDev
```

billpay-offline listens on http://localhost:8081. Without it, e1's releases wait and retry, and the rest of the app
works.

**2. Backend** (http://localhost:8090):

```bash
cd backend && ./gradlew quarkusDev
```

**3. Frontend** (http://localhost:5173, proxies `/api` to :8090):

```bash
cd frontend && npm install && npm run dev
```

### Environments

| Environment | Locally                                    | Setting                         |
|-------------|--------------------------------------------|---------------------------------|
| e1          | billpay-offline at http://localhost:8081   | `billpay.environments.e1.url`   |
| e2, e3      | Simulated                                  | `billpay.environments.e2.url`, `…e3.url` |

An environment with no URL is **simulated**, a marked placeholder: billpay-ui walks its releases through the same
steps itself (check, save, test, sign-off, activate) and labels every row it makes that way. One local billpay-offline
can't stand for three environments, since a release's workflow ID is the same in each. Point any environment at a
real billpay-offline with an environment variable, for example `BILLPAY_ENVIRONMENTS_E2_URL=http://host:8081`.

### Demo data and a clean start

An empty database is seeded with US and GB live in e3 and JP waiting for its e2 sign-off. Their rows are simulated,
since no real environment ran them. To start over, stop the backend and delete `backend/data/`. billpay-core keeps
its own copy of every release it took, so reset it too (`./dev/down.sh --clean` in billpay-core) or new releases
for the same market and account type will meet the old versions there.

## Test

```bash
cd backend && ./gradlew test
```

```bash
cd frontend && npm run build && npm run lint
```

The backend tests run the whole pipeline against a fake billpay-offline that follows billpay-core's documented
behavior: release, sign-off, a second version taking over, rollback, pause and resume, promotion through simulated
e2 and e3 with the RFC, an outage and a refused release.

## Domain reference

- billpay-book `docs/Wiki_Spec.md`: "Market Onboarding", "Operations settings", "The release JSON", "What changes in
  today's Market Onboarding UI code", and "Market Onboarding API".
- billpay-core: `apps/offline/.../MarketOnboarding.kt` (the API) and `docs/code-guide.md` section 11.
