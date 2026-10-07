<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# inscript-carte

Rebuild of a friend's app: a map and list of upcoming FFTA archery competitions in France, plus (later) registration
through **one club**. What the old app does and the product decisions are in [`CONCEPT.md`](CONCEPT.md): read it first.

All UI text is in **French**. Code, comments and docs are in English, except `README.md`, which is in French for the
club members (why and for whom the project exists, no technical content).

## Stack

- Monorepo: **Turborepo** + **Bun 1.4** workspaces. **TypeScript only** (TS 7, strict, `erasableSyntaxOnly`).
- `apps/server`: Bun HTTP server (`Bun.serve`), **clean architecture**, SQLite through **Knex** + `better-sqlite3`.
- `apps/client`: React 19 + Vite 8 + Tailwind 4 + **shadcn** (radix-nova style) + Leaflet (`react-leaflet`,
  `react-leaflet-cluster`).
- `packages/shared`: API contract types and reference data, used as TypeScript source (no build step).
- Lint: `oxlint`. Format: `oxfmt` (print width 120, single quotes). No eslint, no prettier.

## Commands (from the root)

| Command | What it does |
| --- | --- |
| `bun run dev` | server on `:3998` + client on `:5173` (Vite proxies `/api` to the server) |
| `bun run typecheck` / `test` / `build` / `lint` / `format` | through turbo, or oxlint/oxfmt at the root |
| `bun run --cwd apps/server db:import-legacy-events <events.json>` | import the old app's competitions (see Data) |
| `bun run --cwd apps/server db:import-archers <export.xlsx>` | sync the club member list (FFTA extranet export) |
| `bun run --cwd apps/server db:add-admin <licence>` | make an active member an admin, or change their password (typed hidden) |
| `bun run --cwd apps/server db:remove-admin <licence>` | remove an admin (ends their admin sessions) |
| `bun run --cwd apps/server db:rollback` | roll back the last migration batch |

Migrations run **when the server starts** (`main.ts`), before it accepts requests.

## Docker (production)

- One image, **one port (3998)**: the Bun server answers `/api/*` and serves the built client for every other path
  (`presentation/http/static-files.ts`, enabled by `CLIENT_DIST_PATH`; unknown paths get `index.html`, `/assets/*`
  is cached for a year). In development `CLIENT_DIST_PATH` is unset and Vite serves the client.
- `docker build -t inscript-carte .` then `docker run -p 3998:3998 -v inscript-carte-data:/data inscript-carte`.
  The database is `/data/inscript-carte.sqlite` in the volume (personal data, never in the image). Runs as user `bun`.
- Imports inside the container: `docker exec <container> bun run --cwd apps/server db:import-archers <file>` (mount
  the file read-only first), or upload it from the admin page. First admin: `docker exec -it <container> bun run
  --cwd apps/server db:add-admin <licence>`; the next ones can be named from the members page.
- Bun runs the TypeScript sources directly (no server bundle). `bun install --ignore-scripts`: better-sqlite3 loads
  its binary from `prebuilds/`, and its automatic rebuild would need Python and a C++ compiler.
- `.dockerignore` is an **allow list**: a new file reaches the build only if it is listed there.
- The server prints `Version: <commit>` at startup (`infrastructure/app-version.ts`). The Docker build writes it to
  `/app/VERSION`, read from `.git/HEAD` and refs (allowed in `.dockerignore`, no history), else from
  `--build-arg GIT_COMMIT=...`, else `unknown`. In development it asks git and adds "+ uncommitted changes".
- Behind HTTPS, the reverse proxy must send `X-Forwarded-Proto: https` so the session cookie gets `Secure`.

## Server: clean architecture

Inner layers never import outer ones.

- `domain/`: `Competition` (+ the 15-day club deadline rule), `Archer`, `Registration` (+ `isClubRegistrationOpen`,
  `canWithdraw`), `member-list.ts` (`planMemberListSync`: what an FFTA export adds and updates),
  `CalendarDate` (`YYYY-MM-DD` strings), repository ports. The domain may import types from `@inscript-carte/shared`
  (shared kernel). The status rule `canChangeStatus` lives in `shared/src/registration.ts` so the client greys out the
  same options.
- `application/`: `ListUpcomingCompetitions` (drops finished and cancelled, adds the club registration count),
  `Authentication`, `ClubRegistrations`, `AdminAuthentication` (sign-in, password change), `AdminAccounts` (admin
  rights: command line and panel),
  `AdminRegistrations`, `ClubMembers` (import, status, list); ports `Clock` (Paris time zone), `SessionStore`, `LoginAttemptLimiter`,
  `PasswordHasher`. Use cases return result codes (`{ ok: false, reason }`), never throw for business errors.
- `infrastructure/`: `config.ts` (`PORT`, `DATABASE_PATH` default `data/inscript-carte.sqlite`, `CLIENT_DIST_PATH`),
  database (connection, migrations, SQLite repositories and session store, scripts), geocoding, member export
  parser, organizer Excel export (`exports/organizer-spreadsheet.ts`, `write-excel-file`), in-memory login limiter,
  `BunPasswordHasher` (argon2id), `SystemClock`.
- `presentation/http/`: routes (`routes.ts` members, `admin-routes.ts` admins, helpers in `http.ts`) and DTO
  presenters. `app.ts` wires everything (used by `main.ts` and `app.test.ts`).

API (types and error codes in `packages/shared/src/api.ts`; the client turns codes into French messages):

| Route | |
| --- | --- |
| `GET /api/competitions` | public, with `clubRegistrationCount` (active rows, one per départ) |
| `GET/POST/DELETE /api/session` | current archer / sign in (licence + birth date) / sign out |
| `GET/POST /api/competitions/:competitionId/registrations` | members only: who is registered / register |
| `GET /api/me/registrations`, `DELETE /api/me/registrations/:registrationId` | "Mon suivi" / withdraw a départ |
| `GET/POST/DELETE /api/admin/session` | admin: current admin (+ `mustChangePassword`) / password step (needs the member session) / sign out |
| `PUT /api/admin/session/password` | change own password (current one asked again); the only route open while a change is required |
| `GET /api/admin/competitions` | competitions with registrations, counts per status and "to pay" |
| `GET /api/admin/competitions/:competitionId/registrations` | every row, cancelled included, with names and contact |
| `GET /api/admin/competitions/:competitionId/export` | `.xlsx` for the organizer (Reçue, Transmise, Validée rows) |
| `PATCH /api/admin/registrations/:registrationId` | status, payment status, club note of one départ |
| `PATCH /api/admin/payment-references/:paymentReference` | status / payment of every non-cancelled row, all or none |
| `GET /api/admin/members` | every member, those who left included: licence, name, sex, current-season category, active, admin |
| `PATCH /api/admin/members/:licenceNumber` | `{ isActive }` by hand, never on oneself (the next import sets it from the file again) |
| `POST/DELETE /api/admin/members/:licenceNumber/admin` | give admin rights (returns the generated password once) / remove them (never one's own) |
| `GET/POST /api/admin/members/import` | last import + active count / upload the FFTA export (multipart `file`) |

Every `/api/admin/*` route except the sign-in answers `401 admin_sign_in_required` without a valid admin session, and
`403 password_change_required` while the admin still has a generated password.

## Registration through the club

- **Sign-in** = licence number + birth date, checked against active `archers`. Unknown, departed and wrong-date
  sign-ins get the same error. Max 30 failures per licence and 200 per network address in 15 minutes (in memory):
  high on purpose (the user wants no lockout for members who mistype), but it still stops birth-date guessing scripts.
  Success gives a random token in an `HttpOnly`, `SameSite=Lax` cookie for 180 days; only its SHA-256 hash is stored
  (`sessions` table, migration `0002`). The browser keeps the licence number, never the birth date: `SignedInArcher`
  only has the birth year.
- **Category** is computed, never typed: `ageCategory(birthYear, competitionDate)` in `shared/src/ffta-category.ts`
  (FFTA table: season N runs 1 Sept N-1 to 31 Aug N, age reached in year N). Stored on each registration row.
- **Form**: départs 1 to 6 (buttons), bow, distances only for Extérieur (required there), trispot, **payment method**
  (required: Espèces / Chèque / Virement, remembered on the device), optional contact. `payment_method` comes from
  migration `0003`; rows made before it have `NULL`.
  The request carries a bow **per départ** (`departures: [{ departure, bowType }]`). The usual case stays one bow
  choice; the link « Un arc différent selon le départ ? » (only with 2+ départs) shows one bow menu per départ.
  One row per départ; one payment reference per request (`R-0001`, club-wide counter). Taken départs are refused.
- Open until the club deadline **included**. Withdraw only while `received` and before the deadline: the row stays in
  the database, `cancelled`, with "Retirée par l'archer le JJ/MM/AAAA" in `club_note`, but it disappears from "Mon
  suivi" (`GET /api/me/registrations` only returns rows that are not cancelled).
- Names of registrants are for signed-in members only; the count is public.

## Admin panel (`/admin`, `apps/client/src/admin/`)

- **Sign-in in two steps**: the normal member sign-in, then a **personal password** (the user chose this: a birth
  date can be guessed, and the panel shows every member's contact). Admins are rows of `admins` (FK to `archers`,
  argon2id hash, `must_change_password` from migration `0005`). Max 10 wrong passwords per licence and 50 per address
  in 15 minutes (the password change shares this limit). Admin session: 12 hours, `admin_sessions` table, cookie
  `admin_session` with `Path=/api/admin`, `HttpOnly`, `SameSite=Strict`. An admin who leaves the club or is removed
  loses access at once.
- **Becoming an admin**: `db:add-admin` (the person types their own password), or "Nommer admin" on the members page.
  The panel way generates a password (`XXXX-XXXX-XXXX`, no 0/O/1/I/L) shown **once** to the admin who gave the
  rights; the new admin must replace it at first sign-in before anything else works (the user asked for this: the
  giver never knows the password in use). Nobody can remove their own rights or deactivate themselves.
- **Statuses**: Reçue → Transmise à l'organisateur → Validée, plus Plus de place and Annulée ("En attente de paiement"
  was dropped in `0004`: payment has its own field). `canChangeStatus`: a cancelled row stays cancelled (the archer
  registers again), and nothing goes back to Reçue. Cancelling adds "Annulée par le club le JJ/MM/AAAA" to the note
  and asks for a confirmation in the UI. Each admin change writes `updated_by`.
- The page lists competitions with registrations (upcoming first), then one card per payment reference (= one
  archer's request) with its départs. Reference actions (status of all départs, "Tout marquer payé") only show when
  the reference has 2+ active départs. Filters: status, "À payer seulement".
- "Licenciés" page: a table of every member with a search (accents ignored) and an active / left filter, and a
  "⋯" menu per row (Désactiver / Réactiver, Nommer admin / Retirer les droits d'admin, each with a confirmation; the
  admin's own row shows "Vous"). The actions column is pinned to the right so phones see it. The upload is in the
  "Mettre à jour la liste" dialog, read in memory (`readMemberExport(Buffer)`), never written to disk, max 5 MB. A bad file is
  refused as a whole with `{ error: 'invalid_member_export', problem, line, detail }` (`MemberExportError`); the
  client turns `problem` into French. Each import is a `member_imports` row (date, admin or `NULL` for the command
  line, counts).
- Birth dates are never sent to the client, not even to admins: the member table shows the category computed by the
  server (`ageCategory(birthYear, today)`).

## Database (SQLite, Knex)

- Tables: `competitions` (PK `ffta_id`), `archers` (PK `licence_number`), `registrations` (PK auto `id`, one row per
  départ, FKs `competition_ffta_id` / `archer_licence_number` / `updated_by`, `ON DELETE RESTRICT`), `sessions`,
  `admins`, `admin_sessions`, `member_imports`. Value lists are `CHECK` constraints. One active registration per
  (competition, archer, départ): partial unique index ignoring `cancelled`. `0004` rebuilt `registrations` (SQLite
  cannot change a `CHECK`): the next schema change on that table needs the same copy, see `0004-admin-panel.ts`.
- Migrations are TS files listed explicitly in `migrations/index.ts` (so they survive `bun build`). The local database
  holds data now: **any schema change is a new migration**, never an edit of `0001`.
- The DB file holds **personal data** (club members: birth dates, minors): `*.sqlite` is git-ignored and must never
  be committed. Never print member names or birth dates in logs or tool output: counts only.
- `bun build` keeps `knex` and `better-sqlite3` external (Knex requires every SQL driver; `better-sqlite3` is native).
  The built server needs a `node_modules` with both.

## Club members (`archers`): the base of authentication

- Source: the member list exported from the FFTA extranet (`.xlsx`, one sheet, 108 members on 2026-10-06), kept
  outside the repo. Parsed by `infrastructure/members/ffta-member-export.ts`: licence number (7 digits + letter),
  name without civility ("M "/"Me "), sex, birth date, status ("Active"). Addresses are dropped on purpose.
  Columns are matched by the start of their title (the export adds a sort arrow: "Nom, Prénom↑").
- An import (command line or admin upload) goes through `ClubMembers.import` → `SqliteMemberListRepository.sync`, in
  one transaction: adds new members and updates the others, their state ("Etat" column) included. **Members missing
  from the export are not touched** (the user decided it, 2026-10-07; migration `0006` dropped the `deactivated`
  count): an admin deactivates them by hand from the members page. Members are never deleted (registrations point to
  them). Only active members may sign in. A bad row stops the whole import with its line number.

## Data and geocoding

- Competitions come from the old app's `events.json` today (`import-legacy-events.ts`, idempotent upsert on
  `ffta_id`, one transaction). The real FFTA scraper is **not built yet**.
- Rows without coordinates are geocoded during import (`infrastructure/geocoding/town-geocoder.ts`, Géoplateforme
  address service `data.geopf.fr`). Order: GPS text → commune in the département → free text in the département
  (kept only if the text names the result's commune/former commune or postal code) → commune elsewhere only if its
  name is unique in France. 971 also accepts 977/978.
- `known-places.ts`: places the service cannot find, looked up by hand on Google Maps (keyed by `département|FFTA
  text`), read first by the geocoder.
- Result on 2026-10-06: 1707 competitions, **8 without a place** (all placeholders: "A Définir", "Inconnu",
  "Occitanie").

## Client UI decisions (asked by the user, keep them)

- **Layout like SeLoger**: header, list panel on the left (500 px, own scroll), full-height map on the right. On phones
  the list **covers** the map (never hide the map: Leaflet must keep its real size) and a floating "Carte / Liste"
  button switches.
- Filters: Département (remembered in `localStorage`, default 44) and Discipline (+ "Para-tir"). The "Cibles" filter
  of the old site was dropped (no data behind it).
- Cards: date block in the discipline color, title, badges ("Para-tir" light blue, "Reportée" amber), town line with
  **"Voir sur la carte"**, discipline · club, club deadline, links "Mandat (PDF)" (red) and "Détail FFTA" (grey).
- **Bottom right of the card: "Voir les inscrits" and "S'inscrire"** (the latter only before the club deadline). Each
  action asks to sign in first when needed, then continues. "Mon suivi" is in the header.
- **Hovering a card does nothing on the map.** "Voir sur la carte" is the only link from list to map (zoom + popup).
- Map: OpenStreetMap standard tiles (the user rejected CARTO and Plan IGN), one dot per **position** (merges spelling
  variants of a town), red count bubbles for clusters, zoom buttons bottom right, "© OpenStreetMap" credit bottom left
  in 10 px without the Leaflet prefix (the OSM credit is required).
- Discipline colors (`competitions/disciplines.ts`) are data, kept from the old site. App accent: red.
- Labels: "Salle 18m" (no space). FFTA competition titles are shown as they come.
- Competitions without a place show in the list with "(lieu non précisé)". Open question: the user said the
  future scraper should store them but **not display** them; confirm before changing.

## Accessibility (club has older and disabled members)

Material Design baseline, do not exaggerate:

- Body text 16 px, nothing to read below 14 px (the map credit is the only exception).
- Buttons, selects, menu options and map controls are **40 px** tall; button/select text 14 px. These sizes live in the
  shadcn components themselves (`components/ui/*`), so new components follow them.
- Grey text `--muted-foreground` 0.45 (about 7:1); control borders `--input` 0.70 (3:1, WCAG 1.4.11).
- Hand cursor on every enabled button (global rule in `index.css`; Tailwind 4 removed it).
- Map dots have the town name as `title`.

## Not done yet

- FFTA scraper. Planned: competitions that cannot be located are stored but not displayed, their **count is shown in
  the admin panel**, and the admin can re-run a Google Maps lookup (results should then live in the DB instead of
  `known-places.ts`).

## Traps already hit

- Do not overwrite or delete the SQLite file (or its `-wal`/`-shm`) while the server runs: it keeps serving old data.
  Stop the server first.
- To move the database elsewhere (a server, a Docker volume), never copy `inscript-carte.sqlite` alone: recent writes
  may still be in its `-wal` file (the member import was lost that way). Make one self-contained copy with
  `sqlite3 apps/server/data/inscript-carte.sqlite "VACUUM INTO 'export.sqlite'"`, stop the target server, delete its
  `.sqlite`, `-wal` and `-shm`, then copy the export in, owned by `bun`.
- `@radix-ui/react-select` 2.3.8 drops `className`/`style` on `Select.Value`: style it from the trigger with
  `*:data-[slot=select-value]:…`.
- react-leaflet calls `popup.update()` when a popup's children change, and moves a marker when its `position` array
  changes by reference. Keep `shown` memoized, `Town.latLng` stable and `TownMarker` memoized, or open popups flicker.
- Custom `divIcon` markers need `popupAnchor`, or the popup covers the dot.
- Leaflet CSS is imported into Tailwind's `base` layer (`index.css`), so Tailwind utilities win over it. Popup spacing
  is padding on the wrapper (a margin on the content collapses).
- CARTO basemaps now need an API key.
- `shadcn add` asks to overwrite `button.tsx` when a new component depends on it: answer **no** (our sizes and the
  opaque hover live there). New components must be brought to the accessibility sizes (inputs, toggles, checkboxes).
- Toggle buttons are only grey when "on" by default: chosen départs use solid primary + a check icon.
- Avoid `Map.groupBy` and other 2024+ APIs in the client: members use older tablets.
- Menu dropdowns are `components/ui/dropdown-menu.tsx`, written by hand in the shadcn style with 40 px items. Radix
  opens them on `pointerdown`: browser automation must press the mouse, a synthetic `click()` does nothing.
