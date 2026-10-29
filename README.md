# NYS HQ Visitor Check-in

A web app for visitor check-in at the reception of the National Youth Service Headquarters. Visitors scan a QR code at reception, scan their Kenyan National ID or passport on their own phone, and get a digital visitor pass. Security staff get a live dashboard, visit history, a watchlist, manual check-in and exports.

- **Visitors:** mobile-first and nothing to install. The document is read **on the phone**, and the image is never uploaded.
- **Staff:** live "who's inside" view, watchlist alerts and approvals, history search, CSV/PDF export, and an audit log.

## Contents

- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Running locally](#running-locally)
- [Environment variables](#environment-variables)
- [Tests](#tests)
- [Deployment](#deployment)
- [Security and privacy](#security-and-privacy)
- [Document scanning notes](#document-scanning-notes)
- [Known limitations](#known-limitations)

## How it works

| Visitor | Staff |
|---|---|
| Scans the reception QR poster each time they arrive. The QR carries a secret reception code that unlocks check-in on that phone for 30 minutes; opening `/checkin` any other way asks them to scan it. Check-out works without scanning | Signs in at `/admin/login` |
| **First visit:** picks visitor or attachee, types their name, ID number and date of birth (or fills them in from a photo of the ID), chooses a department and taps **Check in**, which also accepts the privacy notice | **Live:** who's inside, plus watchlist alerts with Approve/Deny (auto-refreshes every 10 s) |
| **Returning:** the phone is recognised by a secure cookie. One tap to check in or out, with the last department remembered. On a new phone they just scan their ID again | **History:** search by date, name, document number (full or last 4) and department. Export to CSV or PDF |
| Gets a digital pass (name, host, time in, pass number, live clock, QR) | **Manual check-in** for visitors without a smartphone |
| Scans the QR again and taps **Check out** when leaving. A visit left open from an earlier day is closed (and flagged) automatically | **Watchlist:** a flagged document number blocks self check-in until security approves |
| | **Staff** and **Audit log** pages (admin only) |

Visits still open after `END_OF_DAY_TIME` (default 18:00 Nairobi time) are flagged automatically. Records older than `RETENTION_MONTHS` are deleted automatically.

## Project structure

```
nys-visitor-checkin/
├─ package.json              npm workspaces + root scripts
├─ render.yaml               Render blueprint (free web service, Neon Postgres)
├─ server/                   Express + TypeScript REST API
│  ├─ prisma/
│  │  ├─ schema.prisma       data model
│  │  ├─ migrations/         SQL migrations
│  │  └─ seed.ts             demo admin + sample data
│  ├─ prisma.config.ts
│  ├─ src/
│  │  ├─ app.ts              middleware stack (helmet, CORS, CSRF header, routes)
│  │  ├─ env.ts              validated configuration
│  │  ├─ schemas.ts          Zod request schemas
│  │  ├─ config/constants.ts departments, consent version, limits
│  │  ├─ lib/                hashing, phone normalisation, timezone, SMS, audit, export
│  │  ├─ middleware/         auth (JWT cookie + roles), rate limits, CSRF, errors
│  │  ├─ routes/             public (visitor), auth, admin/*
│  │  ├─ services/           check-in/out logic, visitor + device tokens
│  │  └─ jobs/               end-of-day flagging, retention purge
│  └─ test/                  API tests (Vitest + Supertest, real Postgres)
└─ client/                   React + Vite + TypeScript + Tailwind
   ├─ vercel.json / netlify.toml   SPA + /api proxy config
   └─ src/
      ├─ lib/mrz.ts          MRZ parser (TD1 ID cards, TD3 passports) + tests
      ├─ lib/ocr.ts          in-browser OCR with tesseract.js
      ├─ components/         pass card, scanner, consent notice, form fields
      └─ pages/              CheckIn, FirstVisit, OtpLogin, Pass, Poster, admin/*
```

## Running locally

**Prerequisites:** Node.js 20+ and PostgreSQL 14+.

```bash
# 1. Install
npm install

# 2. Create the database (any name works; it must match DATABASE_URL)
createdb nys_visitors

# 3. Configure
cp server/.env.example server/.env        # then edit DATABASE_URL and the two secrets
cp client/.env.example client/.env

# Generate secrets:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 4. Migrate and seed
npm run db:deploy -w server
npm run db:seed -w server

# 5. Start API (:4000) and web app (:5173)
npm run dev
```

Then open:

- Visitor check-in: http://localhost:5173/checkin
- Staff dashboard: http://localhost:5173/admin (log in as `admin@nys.local` / `ChangeMe2026!`, or `security@nys.local` / `Security2026!`)
- QR poster (staff only): http://localhost:5173/admin/poster

> **Testing on a phone:** the camera needs HTTPS (or localhost). Run `npx vite --host`, open the LAN address through an HTTPS tunnel (for example `cloudflared tunnel --url http://localhost:5173`), and set `CLIENT_ORIGIN` to the tunnel URL.

In development, SMS codes are printed to the API console (`SMS_PROVIDER=console`).

**Demo watchlist:** the seed puts national ID `99999999` on the watchlist. Check in with it to see the approval flow.

## Environment variables

### Server (`server/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | | ≥32 chars. Signs staff sessions and keys OTP hashes |
| `DOC_HASH_SECRET` | ✅ | | ≥32 chars. Keys document-number hashes. **Never change it after go-live**, or existing visitors and watchlist entries will stop matching |
| `CLIENT_ORIGIN` | ✅ (except on Render) | Render service URL | Allowed browser origin(s), comma-separated |
| `STATIC_DIR` | | | Path to the built client (`../client/dist`). When set, the API also serves the web app |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | | | Creates this admin on startup when no staff accounts exist (for hosts without a shell) |
| `NODE_ENV` | | `development` | `production` enables secure cookies |
| `PORT` | | `4000` | |
| `COOKIE_SECURE` | | `true` in production | |
| `TRUST_PROXY` | | `1` | Proxy hops in front of the API when not on Render. On Render it is ignored: the app trusts loopback, private networks and Cloudflare's ranges, so it sees each phone's real address. Rate limiting and the office Wi-Fi check depend on this |
| `ORG_NAME` | | National Youth Service Headquarters | Shown in the consent notice and on exports |
| `DPO_CONTACT` | | (reception desk) | Data Protection Officer contact in the consent notice |
| `TIMEZONE` | | `Africa/Nairobi` | |
| `END_OF_DAY_TIME` | | `18:00` | Open visits after this time get flagged |
| `RETENTION_MONTHS` | | `12` | Closed visits and inactive visitors older than this are deleted |
| `AUDIT_RETENTION_MONTHS` | | `24` | |
| `REQUIRE_RECEPTION_SCAN` | | `true` | Self check-in only after scanning the reception QR (the poster under **Reception QR** in the dashboard) |
| `ONSITE_CHECKIN` | | `attachee` | Who must be on the office Wi-Fi to self check-in: `attachee`, `all` or `off`. Applies once an office network is added under **Office Wi-Fi** in the dashboard |
| `ENABLE_JOBS` | | `true` | Run the hourly flagging and nightly purge jobs in-process |
| `SMS_PROVIDER` | | `console` | `console` or `africastalking` |
| `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` | with `africastalking` | | Africa's Talking credentials. Use `sandbox` as the username for testing |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | | | Override the seeded admin account |

### Client (`client/.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE` | `/api` | Keep it as `/api` and proxy it (see Deployment) |
| `VITE_PUBLIC_URL` | current origin | URL encoded in the poster and pass QR codes |

## Tests

```bash
npm test -w client     # MRZ parsing: Kenyan Maisha + old ID, Kenyan passport, ICAO specimens, OCR noise
npm test -w server     # check-in / check-out API against a real Postgres database
```

The server tests need a **separate** database because they truncate every table:

```bash
createdb nys_visitors_test
cp server/.env.test.example server/.env.test   # point DATABASE_URL at the test DB
npm test -w server                              # applies migrations automatically
```

They cover: first-time check-in for ID and passport, hashed storage, expired-passport rejection, consent, validation, the CSRF header, double check-in, check-out, returning check-in via cookie and via SMS OTP, the OTP not revealing which numbers are registered, watchlist hold → approve, role-based access, document search, CSV masking and end-of-day flagging.

## Deployment

The web app and the API are served from **one domain**, which keeps the session cookies first-party. Safari and other browsers block cross-site cookies, which would break returning-visitor recognition and staff login.

### Free hosting: Render + Neon

This is a single Render web service on the free plan: it builds the client and the Express server serves both `/api` and the web app. The database is a free [Neon](https://neon.tech) Postgres. Render's own free Postgres is deleted after 30 days.

1. **Database:** sign up at neon.tech and create a project (pick the region closest to your Render region, e.g. Frankfurt). Copy the connection string, using the **direct** connection (host without `-pooler`). It ends in `?sslmode=require`.
2. **Code:** push this repo to GitHub.
3. **Render:** sign up at render.com with GitHub, choose **New → Blueprint** and select the repo. `render.yaml` creates the service and generates `JWT_SECRET` and `DOC_HASH_SECRET`. When prompted, fill in:
   - `DATABASE_URL`: the Neon string from step 1
   - `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (12+ characters): the first admin account, created on first start if no staff exist
   - `DPO_CONTACT`: the Data Protection Officer contact shown in the consent notice
4. Wait for the deploy, then open `https://<service>.onrender.com/admin/login` and sign in. Add security staff accounts from the **Staff** page.
5. In the dashboard open **Reception QR** (`/admin/poster`), print it, and put it up at reception. If a photo of it gets shared, press **Make a new code** and reprint.

Each deploy runs `prisma migrate deploy` before starting. `CLIENT_ORIGIN` defaults to the service's own URL, so set it (and `VITE_PUBLIC_URL`) only if you add a custom domain.

**Free plan limits:**

- The service **sleeps after 15 minutes without traffic**, and the next visitor waits about a minute while it wakes. To avoid this, upgrade to a paid instance, or ping `/api/health` every 10 minutes with a free monitor such as UptimeRobot or cron-job.org. Render's 750 free hours a month cover one always-on service.
- Scheduled jobs only run while the service is awake. The end-of-day flagging also runs at every startup, so it catches up.
- `SMS_PROVIDER` is `console`, so SMS codes only appear in the Render log. Returning visitors are still recognised by their device cookie. To send real codes, set `SMS_PROVIDER=africastalking` plus `AT_USERNAME` and `AT_API_KEY`.
- Neon's free plan has 0.5 GB of storage, which is plenty for visitor records.

### Alternative: frontend on Vercel or Netlify

To serve the frontend from a CDN and keep the API separate (on Render or Railway):

1. Remove `STATIC_DIR` from the API service, and set `CLIENT_ORIGIN` to the frontend URL and `TRUST_PROXY=2`.
2. Edit `client/vercel.json` (or `client/netlify.toml`) and replace `YOUR-API.onrender.com` with your API host.
3. **Vercel:** import the repo, set the root directory to `client`, use the Vite framework preset, and set `VITE_PUBLIC_URL` to the final URL.
   **Netlify:** import the repo and set the base directory to `client`. `client/netlify.toml` provides the build, the `/api` proxy and the security headers.

On Railway, use build command `npm ci --include=dev && npm run build -w server` and start command `npm run start:prod -w server`.

### Production checklist

- [ ] Change both seeded passwords, or deactivate the security demo account
- [ ] Set `DPO_CONTACT` and review the consent wording with your Data Protection Officer
- [ ] Review the department list in `server/src/config/constants.ts`
- [ ] Register an Africa's Talking sender ID and test OTP delivery
- [ ] Use a custom domain with HTTPS. Set `CLIENT_ORIGIN` and `VITE_PUBLIC_URL` to it
- [ ] Turn on automated Postgres backups
- [ ] Test scanning with real Maisha cards, old IDs and passports (see below)

## On-site check-in (office Wi-Fi)

So nobody can check in from home, self check-in can be limited to the office Wi-Fi. Every phone on the office Wi-Fi reaches the internet through the office's public address (for IPv6, its /64 network), and the API refuses check-ins from any other address.

1. Connect a laptop or phone to the NYS office Wi-Fi (not mobile data or a hotspot).
2. Sign in to the dashboard as an admin, open **Office Wi-Fi** and press **Add the network I'm on now**. Repeat for each internet line the office uses.
3. From then on, attachees (or everyone, with `ONSITE_CHECKIN=all`) must be on one of those networks to check in. Check-out works from anywhere. Staff manual check-ins are not restricted.

Until a network is added nothing is restricted, and the Live page shows a reminder. Blocked attempts are recorded in the audit log as `OFFSITE_CHECKIN_BLOCKED` with the person's name. This depends on `TRUST_PROXY` being right, since the client address comes from the proxy headers.

## Security and privacy

- **No document images are stored.** Photos are processed in the browser (canvas + WebAssembly OCR). Only the confirmed text fields are sent.
- **Document numbers are never stored in plain text.** The app stores `HMAC-SHA256(DOC_HASH_SECRET, type:number)` for matching, plus the last 4 characters for display (`****5678`). The hash is keyed, so a leaked database alone can't be brute-forced back to ID numbers. Exports and the dashboard only show masked numbers.
- **Staff auth:** bcrypt (cost 12) password hashes. The JWT sits in an `httpOnly`, `Secure`, `SameSite=Lax` cookie with an 8-hour expiry. The account is re-checked on every request, so deactivation takes effect immediately. Login timing is equalised for unknown emails.
- **Visitor device token:** 256-bit random, stored as SHA-256, `httpOnly`, scoped to `/api/public`, valid for 180 days. "Use a different identity" revokes it.
- **OTP:** a 6-digit code that expires in 5 minutes. It allows 5 attempts and at most 3 codes per 15 minutes per number, and the response doesn't reveal whether a number is registered.
- **Every admin route** is behind `requireStaff`, and destructive or sensitive routes also need `requireRole('admin')`. All input is validated with Zod.
- **Rate limits** apply to check-in, OTP and login. Helmet sets security headers. CORS is locked to `CLIENT_ORIGIN`. State-changing requests need an `X-Requested-With` header as CSRF defence.
- **The audit log** records sign-ins (including failures), manual check-ins, approvals and denials, staff check-outs, watchlist changes, document-number searches, exports, staff changes and retention purges.
- **Retention:** closed visits older than `RETENTION_MONTHS` are deleted nightly, along with visitors who have no remaining visits. Expired OTPs and device tokens are cleaned up.
- CSV exports neutralise spreadsheet formula injection.

## Document scanning notes

Visitors type their details by default; filling them in from a photo is optional. For a photo, the **front** of the ID works best, and the back or a passport page also works. [`readIdFromPhoto()`](client/src/lib/ocr.ts) first reads the whole photo (turning it if needed) to see which side it is.

**Front of a Kenyan ID.** The parser ([client/src/lib/idfront.ts](client/src/lib/idfront.ts)) finds the values by their printed labels, so it handles both the older ID (`SERIAL NUMBER`, `ID NUMBER`, `FULL NAMES`, `DATE OF BIRTH`) and the Maisha card (`SURNAME`, `GIVEN NAMES`, `ID NUMBER`, `DATE OF BIRTH`). It never takes the serial number for the ID number. The front has no check digits, so the photo is read three times with different processing and combined field by field. Any field the reads don't all agree on is highlighted on the confirm screen for the visitor to check.

> ⚠️ The label layouts were built from the card designs, and the tests use synthetic card images. Before go-live, try several real Maisha cards and old IDs. If a label is printed differently, add it to the patterns at the top of `idfront.ts`.

**Back of an ID, or a passport.** The MRZ parser ([client/src/lib/mrz.ts](client/src/lib/mrz.ts)) implements ICAO 9303 TD1 (3×30, ID cards) and TD3 (2×44, passports), including check-digit verification, date-century handling, long-document-number overflow and OCR error correction (`O→0` in numeric fields, `0→O` in names, and so on).

It is hand-written rather than taken from a library because Kenyan IDs need special handling. The older Kenyan ID uses the non-standard country code `KYA`. On Kenyan cards, the **national ID number** sits in the optional-data field, separate from the card serial number. The parser picks the first run of 6–10 digits from the optional data, falling back to the document number.

> ⚠️ The test samples are **synthetic** strings built to the ICAO layout with valid check digits, alongside the official ICAO specimens. Before go-live, check the parser against several real Maisha cards and old IDs and confirm that the field picked as `idNumber` matches the number printed on the front. If it doesn't, adjust `kenyanIdNumber()` in `mrz.ts`. Visitors always see and can correct the parsed fields before submitting.

OCR uses tesseract.js with a character whitelist (`A–Z 0–9 <`) on a cropped, binarised image. It tries the bottom half first, then the full image, then the image rotated 180°. Check-digit failures don't block the visitor: they show a "please check carefully" warning. Expired passports are rejected both in the browser and on the server.

## Known limitations

- **tesseract.js downloads its WebAssembly core and English language data (about 5 MB) from the jsDelivr CDN** on first scan, and the browser caches them after that. To avoid the third-party CDN, self-host the files and pass `workerPath`, `corePath` and `langPath` to `createWorker` in `ocr.ts`.
- **Prisma 6 CLI advisory:** `npm audit` reports `deepmerge-ts` (stack exhaustion on recursive objects) inside the Prisma **CLI**'s config loader, which runs only during migrations. The runtime client (`@prisma/client`) is not affected. The fix is the Prisma 7 major upgrade, which can be done separately.
- Live updates use 10-second polling rather than WebSockets. This is simple and reliable, and fine for a single reception desk.
- One visitor record per document. If someone changes their phone number, they check in as a first-time visitor again, which updates the record.
