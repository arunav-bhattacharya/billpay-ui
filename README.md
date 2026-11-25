# Billpay Market Onboarding

The Market Onboarding UI: the control plane that takes a market onto Billpay, American Express's platform for card
bill payments and refunds. Its only contract with [billpay-core](https://github.com/arunav-bhattacharya/billpay-core)
is billpay-offline's Market Onboarding API.

A market is one or more **profiles**, one per account type. A profile picks the Billpay APIs it takes, answers the
four behavior questions (`requiresArPosting`, `requiresRealtimeClearing`, `requiresMandateAuthorization`,
`requiresBankConfirmation`) and carries its **Operations settings** (time zone, execution time, cancellation window,
cutoff and floor, representment, Raven statuses, bank confirmation, card authentication, MR Points, instrument
statuses, pending sweep, test accounts, and the BOTH rules). Everything a profile holds becomes a key in the release
JSON billpay-core's Router reads; a market's own variation beyond that is code in a build, which the capability
manifest shows. "Live" everywhere means a version is active in that environment.

## From draft to live

1. **Release** freezes the draft as an immutable version, vN: the release JSON billpay-core's Router reads, a
   checksum, the author and the approver. Later edits become vN+1.
2. billpay-ui sends vN to **e1**'s Market Onboarding API, which starts `onboard-{market}-{accountType}-v{N}`: check
   against the build's capability manifest, save, test with the release's mock accounts, wait for the sign-off.
3. A **deployment row** per release and environment follows that workflow; the market page reads it.
4. **Sign off** in each environment. In **e3** (production) a ServiceNow change request is recorded first.
5. **Promote** sends the same vN to the next environment once it is active where it is.

Once live, a profile can be **rolled back** one level, to the version it replaced, and **paused** or **resumed**.

**Maker-checker.** Whoever last edited a profile can't release it: the release review names the author and the
approver, and the backend refuses an author's own release. With no SSO yet the two are the UI's roles, so the
demo path is to edit as **Operator** and release as **Approver** (the role menu is in the top bar).

## What's in the console

| Section | What it shows |
|---------|---------------|
| **Markets** | The ledger (grid, map, APIs), each market's page with its **rollout board**: a lane per environment, a card per version with its step and next action, and an activity rail of who did what and why |
| Release review | Opened from a profile's draft bar: the draft field by field against what e1 runs, the checks it passes (e1's capability manifest, time zone, cancellation window, bank confirmation's window), and the author and approver |
| Rollback and pause | Rollback checks the version it restores against e1's build; pause and resume list everything they hold in the market (a pause holds every account type, since the execution rate is the market's) and need a reason |
| **Versions** | Which version runs in each environment, for every market and account type, with drift and stopped releases flagged |
| **Runs** | Every live market's next scheduled run on one UTC axis, from the release it runs: the cancellation window, the run, a cutoff market's deadline, and paused markets |
| **Build** | The deployed build's capability manifest: every behavior setting per account type, the live profiles on each, and drafts the build can't run |

## Demo path

1. Onboard a market from **Markets → Onboard** (say Germany, Consumer) as **Operator**: APIs, behaviors (BOTH rules,
   the manifest pre-check), Operations settings; the review shows the release JSON e1 will receive. Saving creates
   the draft in e1.
2. Switch to **Approver**, open the market, **Review and release v1**: the review shows what will be frozen.
3. Watch e1's lane: check, save, test (billpay-core's 30 s test step), then **Sign off v1**: it activates.
4. Edit the profile as Operator (a later execution time), release v2 as Approver, sign off: v2 takes over, v1 is
   superseded. **Roll back to v1**: the pre-check runs, and v1 is live again.
5. **Pause runs** shows what the pause holds; resume it. **Promote** v1 to e2 and e3 (simulated); e3 asks for the
   change request before its sign-off.
6. **Versions**, **Runs** and **Build** show the same releases across every market.

**Recording at 1440p.** Capture a 1280×720 browser viewport at device scale 2, which gives 2560×1440 frames with text
large enough to read (the layout is tuned for it: lanes and the activity rail side by side). A 2560×1440 viewport at
scale 1 also works but renders the console small in a wide frame. With headless Chrome, for example:
`--window-size=1280,720 --force-device-scale-factor=2`.

## Layout

| Path        | Description                                         |
|-------------|-----------------------------------------------------|
| `backend/`  | Kotlin + Quarkus REST API, H2 file database, :8090   |
| `frontend/` | React + Vite + TypeScript single-page app, :5173     |

## Run

Each part is one command. JDK 25 (as billpay-core) and Node 22+.

**1. billpay-core** (for a real e1), from its checkout, as its README says:

```bash
./dev/up.sh && ./gradlew :apps:offline:quarkusDev
```

billpay-offline listens on http://localhost:8081. Without it, e1's releases wait and retry, and the rest of the app
works. If billpay-core's local Oracle volume predates its current DDL, activation fails on a missing column
(`MARKET_CONFIG_ACTIVE.IN_SERVICE_IN`); `./dev/down.sh --clean` then `./dev/up.sh` rebuilds it from the DDL.

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
cd frontend && npm test && npm run build && npm run lint
```

The backend tests run the whole pipeline against a fake billpay-offline that follows billpay-core's documented
behavior: maker-checker, release, sign-off, a second version taking over, rollback, pause and resume, promotion
through simulated e2 and e3 with the RFC, an outage and a refused release. The frontend tests cover the time-zone
maths behind the runs line (daylight saving included), the release diff and the manifest pre-check.

## Domain reference

- billpay-book `docs/Wiki_Spec.md`: "Market Onboarding", "Operations settings", "The release JSON", "What changes in
  today's Market Onboarding UI code", and "Market Onboarding API".
- billpay-core: `apps/offline/.../MarketOnboarding.kt` (the API) and `docs/code-guide.md` section 11.
