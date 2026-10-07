<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# inscript-carte

Rebuild of a friend's app: a map and list of upcoming FFTA archery competitions in France, plus (later) registration
through **one club**. What the old app does and the product decisions are in [`CONCEPT.md`](CONCEPT.md): read it first.

All UI text is in **French**. Code, comments and docs are in English.

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
| `bun run dev` | server on `:3000` + client on `:5173` (Vite proxies `/api` to the server) |
| `bun run typecheck` / `test` / `build` / `lint` / `format` | through turbo, or oxlint/oxfmt at the root |
| `bun run --cwd apps/server db:import-legacy-events <events.json>` | import the old app's competitions (see Data) |
| `bun run --cwd apps/server db:import-archers <export.xlsx>` | sync the club member list (FFTA extranet export) |
| `bun run --cwd apps/server db:rollback` | roll back the last migration batch |

Migrations run **when the server starts** (`main.ts`), before it accepts requests.

## Server: clean architecture

Inner layers never import outer ones.

- `domain/`: `Competition` (+ the 15-day club deadline rule), `Archer`, `Registration` (+ `isClubRegistrationOpen`,
  `canWithdraw`), `CalendarDate` (`YYYY-MM-DD` strings), repository ports. The domain may import types from
  `@inscript-carte/shared` (shared kernel).
- `application/`: `ListUpcomingCompetitions` (drops finished and cancelled, adds the club registration count),
  `Authentication`, `ClubRegistrations`; ports `Clock` (Paris time zone), `SessionStore`, `LoginAttemptLimiter`.
  Use cases return result codes (`{ ok: false, reason }`), never throw for business errors.
- `infrastructure/`: `config.ts` (`PORT`, `DATABASE_PATH`, default `data/inscript-carte.sqlite`), database
  (connection, migrations, SQLite repositories and session store, scripts), geocoding, member export parser,
  in-memory login limiter, `SystemClock`.
- `presentation/http/`: routes and DTO presenters. `app.ts` wires everything (used by `main.ts` and `app.test.ts`).

API (types and error codes in `packages/shared/src/api.ts`; the client turns codes into French messages):

| Route | |
| --- | --- |
| `GET /api/competitions` | public, with `clubRegistrationCount` (active rows, one per départ) |
| `GET/POST/DELETE /api/session` | current archer / sign in (licence + birth date) / sign out |
| `GET/POST /api/competitions/:competitionId/registrations` | members only: who is registered / register |
| `GET /api/me/registrations`, `DELETE /api/me/registrations/:registrationId` | "Mon suivi" / withdraw a départ |

## Registration through the club

- **Sign-in** = licence number + birth date, checked against active `archers`. Unknown, departed and wrong-date
  sign-ins get the same error. Max 30 failures per licence and 200 per network address in 15 minutes (in memory):
  high on purpose (the user wants no lockout for members who mistype), but it still stops birth-date guessing scripts.
  Success gives a random token in an `HttpOnly`, `SameSite=Lax` cookie for 180 days; only its SHA-256 hash is stored
  (`sessions` table, migration `0002`). The browser keeps the licence number, never the birth date: `SignedInArcher`
  only has the birth year.
- **Category** is computed, never typed: `ageCategory(birthYear, competitionDate)` in `shared/src/ffta-category.ts`
  (FFTA table: season N runs 1 Sept N-1 to 31 Aug N, age reached in year N). Stored on each registration row.
- **Form**: départs 1 to 6 (buttons), bow, distances only for Extérieur (required there), trispot, optional contact.
  The request carries a bow **per départ** (`departures: [{ departure, bowType }]`). The usual case stays one bow
  choice; the link « Un arc différent selon le départ ? » (only with 2+ départs) shows one bow menu per départ.
  One row per départ; one payment reference per request (`R-0001`, club-wide counter). Taken départs are refused.
- Open until the club deadline **included**. Withdraw only while `received`/`awaiting_payment` and before the deadline:
  the row stays, `cancelled`, with "Retirée par l'archer le JJ/MM/AAAA" in `club_note`.
- Names of registrants are for signed-in members only; the count is public.

## Database (SQLite, Knex)

- Tables: `competitions` (PK `ffta_id`), `archers` (PK `licence_number`), `registrations` (PK auto `id`, one row per
  départ, FKs `competition_ffta_id` / `archer_licence_number`, `ON DELETE RESTRICT`). Value lists are `CHECK`
  constraints. One active registration per (competition, archer, départ): partial unique index ignoring `cancelled`.
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
- `db:import-archers` syncs the table in one transaction (`sync-archers.ts`): adds, updates, and **deactivates
  members missing from the export** (never deletes them: registrations point to them). Only active members may sign
  in. A bad row stops the whole import with its line number.

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
- Competitions without a place show in the list with "(lieu pas encore connu)". Open question: the user said the
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

- Statuses after "Reçue" are set by hand in the database until the admin page exists.
- Admin page for the club secretary (statuses, payments, member list import).
- FFTA scraper. Planned: competitions that cannot be located are stored but not displayed, their **count is shown in
  the admin panel**, and the admin can re-run a Google Maps lookup (results should then live in the DB instead of
  `known-places.ts`).

## Traps already hit

- Do not overwrite or delete the SQLite file (or its `-wal`/`-shm`) while the server runs: it keeps serving old data.
  Stop the server first.
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
