# inscript-carte

Map and list of upcoming FFTA archery competitions in France, with registration through one club, « Les Archers de
l'Erdre ». A rebuild of a friend's app.

- UI text is **French**. Code, comments and docs are **English**, except `README.md` (French, for club members, no
  technical content) and the user guides in `docs/notice/`.
- "Decided" below marks a choice the user made on purpose: do not undo it without asking.

## UI text (French)

Every sentence must read as natural French, written by a person.

- Full, plain sentences. No stacked nouns, no telegram style ("Date limite du club dépassée"), no English words.
- Agreements: "concours" and "départ" are masculine, "inscription" is feminine; a badge agrees with what it describes.
  When a text names a member, use the pronoun of their sex (`sex` is in the DTOs): "Elle ne pourra plus se connecter".
- One wording per idea: "Inscription par le club jusqu'au …", "En attente de paiement", "Mon suivi", "fiche" for an
  FFTA competition page, "mise à jour" (never "scrape") for the calendar refresh.
- Buttons say what they do ("Oui, le retirer", "Non, ne rien changer"), never "OK". A cancel button is "Annuler".
- Errors say what is wrong and what to do next, in one or two sentences, without blaming the member. Server messages
  that reach the screen (scraper `report.aborted`, run errors) follow the same rules.
- Typography: space before `:` `?` `!`, « » with spaces inside, "…" as one character. Apostrophes are mixed (`'` and
  `’`); stay consistent inside one dialog.
- Plurals are built in code (`${n} ${n > 1 ? 'départs' : 'départ'}`); "(s)" only in short labels ("Départ(s)
  souhaité(s)").

## Stack and commands

- Turborepo + Bun 1.4 workspaces, TypeScript only (TS 7, strict, `erasableSyntaxOnly`).
- `apps/server`: `Bun.serve`, clean architecture, SQLite through Knex + `better-sqlite3`.
- `apps/client`: React 19, Vite 8, Tailwind 4, shadcn (radix-nova), Leaflet (`react-leaflet`, `react-leaflet-cluster`).
- `packages/shared`: API types (`api.ts`, error codes included), reference data and rules both sides use; TypeScript
  source, no build step.
- Lint `oxlint`, format `oxfmt` (width 120, single quotes). Use Tailwind's canonical class names (`size-4.5`, not
  `size-[1.125rem]`).

From the root: `bun run dev` (server `:3998`, client `:5173`, Vite proxies `/api`), `bun run format`, `lint`,
`typecheck`, `test`, `build`. Turbo hides environment variables from tasks: `dev` lets through only those in
`turbo.json` `passThroughEnv` (`CHROME_PATH`, `PORT`, `DATABASE_PATH`…). Scraper buttons in development:
`CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" bun run dev`. Server scripts, with
`bun run --cwd apps/server`:

| Script | |
| --- | --- |
| `db:import-archers <export.xlsx>` | sync the member list (FFTA extranet export) |
| `db:add-admin <licence>` / `db:remove-admin <licence>` | give admin rights (password typed hidden) / remove them |
| `db:import-legacy-events <events.json>` | import the old app's competitions |
| `db:relocate [--dry-run]` | locate every upcoming competition again |
| `db:seed-demo` | fill an **empty** development database with made-up members, competitions, mandate readings and registrations (dates follow today); does nothing when the database has data. Admin `0000001A`, birth date 01/01/1980, password `demo-password-2026` |
| `scrape [--dry-run] [--max-details N] [--max-mandates N]` | one FFTA run by hand (needs `CHROME_PATH`) |
| `mandate:read <url> <start> [end]` | read one mandate with the LLM and print it, writes nothing |
| `mandate:reread-all [--limit N] [--ids a,b]` | read every upcoming mandate again (or only those ids), same files included (after a prompt change); not during a calendar update |

Migrations run when the server starts. There is no rollback command; to start over, stop the server and delete the
`.sqlite`, `-wal` and `-shm` files.

## Production (Docker)

- One image, one port (3998): the server answers `/api/*` and serves the built client for every other path
  (`static-files.ts`, on when `CLIENT_DIST_PATH` is set; unknown paths get `index.html`, `/assets/*` cached a year).
- Built for `linux/amd64` and pushed by `npm run deploy` (registry `registry.jonas.bzh`). The user pushes and deploys.
  Behind Caddy, which must send `X-Forwarded-Proto: https` (session cookies get `Secure`) and flushes SSE by itself.
- Database: `/data/inscript-carte.sqlite` in a volume. Runs as user `bun`. Env: `OPENROUTER_API_KEY` (never commit
  it; locally it lives in `apps/server/.env`, git-ignored).
- Bun runs the TypeScript sources, no server bundle. `bun install --ignore-scripts`: `better-sqlite3` loads its
  prebuilt binary (a rebuild would need Python and a compiler).
- `.dockerignore` is an **allow list**: a new file reaches the build only if it is listed.
- The server prints `Version: <commit>` at startup (`app-version.ts`): `/app/VERSION` written by the build from
  `.git/HEAD`, else `--build-arg GIT_COMMIT`; in development, git plus "+ uncommitted changes".
- Commands in the container: `docker exec -it <container> bun run --cwd apps/server db:add-admin <licence>` (first
  admin). The image has no `sqlite3`: use `bun -e` with `bun:sqlite`.
- Chrome for the scraper: `chrome-headless-shell` at `CHROME_VERSION` (tested with the stealth plugin; after a change,
  check a run still passes Cloudflare), plus `poppler-utils` for mandates. Decided: **no Chrome sandbox**
  (`CHROME_NO_SANDBOX=1`, image only; containers do not give the user namespaces it needs). In exchange Chrome may only
  reach `https` `ffta.fr` hosts and `challenges.cloudflare.com` (`isAllowedUrl`, exact host match, tested against
  look-alikes).

## Server architecture

Inner layers never import outer ones. The domain may import types and rules from `@inscript-carte/shared`.

- `domain/`: `Competition` (`clubRegistrationDeadline`, `isPublic`), `Registration` (`isClubRegistrationOpen`,
  `canWithdraw`), `Archer`, `member-list.ts`, `mandate.ts` (answer checks), `CalendarDate` (`YYYY-MM-DD`
  strings), repository ports.
- `application/`: use cases (`ClubRegistrations`, `AdminRegistrations`, `ClubMembers`, `AdminAccounts`, scraper
  runs, calendar sync, mandate reading…) and ports (`Clock` in Paris time…). Business errors are result codes
  (`{ ok: false, reason }`), never exceptions.
- `infrastructure/`: config, SQLite repositories and migrations, FFTA scraper, geocoding, member export parser, Excel
  export, password hashing (argon2id).
- `presentation/http/`: `routes.ts` (members), `admin-routes.ts`, presenters (DTOs). `app.ts` wires everything; it is
  used by `main.ts` and `app.test.ts`.
- Every `/api/admin/*` route except the sign-in answers `401 admin_sign_in_required` without an admin session, and
  `403 password_change_required` while the admin still has a generated password.

## Database

- Tables: `competitions` (PK `ffta_id`), `archers` (PK `licence_number`), `registrations` (one row per départ),
  `sessions`, `admins`, `admin_sessions`, `member_imports`, `scraper_runs`, `competition_mandates`,
  `competition_overrides`.
- **Admin edits** (`competition_overrides`, migration `0010`): one row per edited competition, one column per editable
  field, `NULL` = the FFTA value. Decided: an edit **always wins**, even after a later FFTA change, until an admin puts
  the FFTA value back. The scraper never writes there. `SqliteCompetitionRepository` merges them
  (`coalesce(o.x, c.x)`), so every reader sees the edited competition; the mandate reader reads the edited link and
  dates. Edited départs / prices / rhythm replace the mandate reading. A mandate link the FFTA did not have gets its own
  `mandate_added_on` (the club deadline's late-mandate rule).
- Value lists are `CHECK` constraints. SQLite cannot change one: the migration copies the table (see `0008`). One
  active registration per (competition, archer, départ): a partial unique index that ignores `cancelled`.
- **Any schema change is a new migration**, listed in `migrations/index.ts` (explicit, so it survives `bun build`).
  Never edit an applied one.
- `archers.email` / `phone`: storage only, set by hand, used for the exporting admin in the Excel file; never shown,
  never touched by the member import.
- Two processes write (server and scraper): `busy_timeout = 5000`, short transactions.
- **Personal data** (members' birth dates, minors): `*.sqlite` is git-ignored. Never print names, birth dates,
  emails or phones in logs or tool output: counts only. Birth dates never reach the client, not even admins (the
  server sends the category).

## Members and sign-in

- Members come from the FFTA extranet export (`.xlsx`), parsed by `ffta-member-export.ts` (columns matched by the start
  of their title; addresses dropped). An import (script or admin upload, 5 MB max, read in memory) adds and updates
  in one transaction; a bad row refuses the whole file with its line number. Decided: members missing from the file are
  **not** touched; an admin deactivates them by hand. Members are never deleted.
- Member sign-in: licence + birth date of an **active** member; unknown, departed and wrong date get the same error.
  Limits: 30 failures per licence, 200 per address, per 15 min (high on purpose: no lockout for members who
  mistype). Cookie `HttpOnly`, `SameSite=Lax`; only the token's SHA-256 is stored. The browser never keeps the birth
  date. Decided (asked by Hervé, 2026-10-11): staying signed in is the member's choice, a box « Garder la connexion
  sur cet appareil », ticked by default (the user's choice), « À décocher sur un appareil partagé ou peu sécurisé. »: ticked, a
  180-day cookie and the licence number kept on the device; not ticked,
  a browser-session cookie and a 12-hour session on the server. The header shows « Se connecter », or « Mon suivi »
  with a green dot. Decided: no name in the header (the user found it useless).
- Admins: decided, **two steps**: member sign-in, then a personal password (`admins` table). 10 wrong passwords per
  licence, 50 per address, per 15 min. Session 1 year, cookie `admin_session` (`Path=/api/admin`, `SameSite=Strict`).
  "Nommer admin" generates a password (`XXXX-XXXX-XXXX`) shown once; the new admin must replace it before anything
  else (decided: the giver never knows the password in use); that forced change does not ask for the old one.
  Nobody can remove their own rights or deactivate themselves. Leaving the club ends admin access at once.

## Registration

- Category is computed, never typed: `ageCategory(birthYear, date)` (`shared/src/ffta-category.ts`, FFTA season runs
  1 Sept to 31 Aug); stored on each row.
- Form: the mandate's départs when a checked reading of the current mandate link has some (the server refuses a
  number beyond them), else départs 1 to 4 with a warning. Bow per départ (one menu by default, « Un arc différent
  selon le départ ? » with 2+ départs), distances for Extérieur only, trispot, covoiturage, payment method (required,
  remembered on the device; not asked when the club pays), optional contact.
- **Club pays** (`archers.club_pays_registrations`, asked by Loïc 2026-10-11; a flag per member, not a category, since
  a youth may shoot in an older one): set from the "⋯" menu, never touched by the import (`ExportedMember` has no such
  field). Decided: the form sends `paymentMethod: null`, new départs start as « Rien à payer », and un-ending a départ
  keeps « Rien à payer ». Existing départs do not change when the flag changes. Badge « Payé par le club ».
- Covoiturage is one answer per archer and competition: each request sets it on all their active départs there.
- **One payment reference per archer and competition** (`R-0001`, club-wide counter): later départs reuse it, even if
  the first ones were withdrawn.
- **Club deadline** (`clubRegistrationDeadline`), last day included. Decided:
  - no mandate: 7 days before the start (still used for withdrawals and payments when a link goes away);
  - with a mandate: the later of 14 days before the start and 2 days after the day the mandate appeared, but never
    after 7 days before the start;
  - a link stored before that day was tracked (`mandate_added_on` `NULL`) counts as early (14 days).

  `competitions.mandate_added_on` is set by the scraper's upsert when a link appears, kept while a link stays (even
  another file), cleared when it goes.
- Withdraw: only `received` départs, until the deadline. The row stays, `cancelled`, with "Retirée par l'archer le …"
  in the note, and leaves "Mon suivi".
- Names of registrants: signed-in members only; the count (`clubArcherCount`) is public. « Voir les inscrits » shows
  each archer's category for that competition (« Senior 2 Femme », stored with the registration; asked by members,
  2026-10-11), bow and départs. Grouped **by day** (user's choice): a heading « Mardi 3 novembre », then the archers
  shooting that day with only that day's départs and times (`departureDate`: the mandate's date, else the
  competition's on a one-day competition; « Jour non précisé » last).
- Postponed competitions (`status = 'postponed'`): a solid red « Reporté » badge and a red notice on the card; no
  « S'inscrire », and the server refuses registrations (`isClubRegistrationOpen` needs `scheduled`). Asked by Hervé.
- Decided (2026-10-25): **no registration before the mandate is out** (`isClubRegistrationOpen` needs a
  `mandateUrl`, the edited one included). The competition stays visible; its card says « Le club prendra les
  inscriptions dès que le mandat sera publié. » and has no « S'inscrire ».
- « Ajouter à mon agenda » (success screen and "Mon suivi", hidden once the competition is over): Google Agenda link
  or an `.ics` built in the browser (`registrations/calendar.ts`). Decided: one event **per day**, merging that day's
  départs, from the first greffe to the last estimated end (shooting + 3 h, else greffe + 4 h), floating local times;
  a whole-day event when the mandate gives no times.
- A départ shows as "Départ 2 · Après-midi" (`departureTitle`) when the mandate names it; the number always stays.

## Statuses and payments

Both lists live in `shared/src/registration.ts` with their rules, so the client greys out the same options.

- Status: Reçue → Transmise à l'organisateur → Validée, plus Plus de place and Annulée. A cancelled row never changes
  again (the archer registers again); any other change is allowed. Going back to Reçue and cancelling both ask for
  confirmation; cancelling adds "Annulée par le club le …" to the note. Each admin change writes `updated_by`.
- Payment, stored, a menu: En attente de paiement (`to_pay`), Payé, Rien à payer, À rembourser, Remboursé. A status
  change without a payment choice moves it (`paymentForStatus`): ending (full / cancelled) turns unpaid into « Rien à
  payer » and paid into « À rembourser »; un-ending reverses it (except « Rien à payer » when the club pays);
  « Remboursé » stays.
- Bulk actions on a reference only replace their source state (`REFERENCE_PAYMENT_FROM`): « Tout marquer comme payé »
  (En attente → Payé), « Tout remettre en attente » (Payé → En attente), « Tout marquer comme remboursé » (À
  rembourser → Remboursé, shown with 2+ to refund). Cancelled rows keep their status but their payment can change.
  Untouched rows get no `updated_by`.

## Admin panel (`apps/client/src/admin/`)

- Pages `/admin/inscriptions[/<ffta_id>]`, `/admin/concours`, `/admin/licencies`, `/admin/calendrier`. No router: the
  address is the only state (`pushState` + `popstate`), tabs are real links. `main.tsx` lazy-loads the member app or
  the admin app as separate chunks (also keeps chunks under Vite's 500 kB warning).
- Inscriptions: competitions with registrations (badges « à transmettre », « en attente de paiement », « à
  rembourser »), narrowed by a menu above the list (`LIST_FILTERS`, asked by Loïc 2026-10-11): by default « Avec des
  départs en cours » hides those whose départs are all cancelled (unless a refund is due); also « quelque chose à
  faire », one per status or payment state, and « Tous ». Then one card per payment reference, one line per départ
  (status menu, payment menu, note).
  Decided: a card starts closed only when nothing is left to do (every active départ full, or validated and paid or
  with nothing to pay, nothing to refund); it never closes by itself. Search (name, licence, reference; accents ignored)
  and filters (status, payment).
- **Excel file for the organizer** (`organizer-spreadsheet.ts`, layout of FFTA mandate grids): follows the panel's
  filters (the club usually sends only paid départs); never "Plus de place" or "Annulée". One line per archer and
  bow; Montant from the mandate prices (`registrationPrice`, `shared/src/pricing.ts`); empty when no price fits.
- **« À envoyer au club organisateur »** (`AmountToSend` in `registrations-summary.tsx`, asked 2026-10-25), a tile: the
  sum of each archer's price for their paid départs (not "Plus de place" or "Annulée"), computed in the browser with
  the same `registrationPrice` as the Excel file. Ignores the panel filters. Archers without a fitting price are
  counted apart with a warning, never guessed.
- **Prices by category** (asked 2026-10-11, migration `0012` converted the old `audience`): each `MandatePrice` names
  the FFTA categories it applies to (`categories`, U11 to S3). The LLM copies every price line as written ("Jeunes" =
  U11 to U21, "Adultes" = S1 to S3, "Tous" = all eight), even when a category is in two lines. The code picks, per
  category and number of départs, the price naming the fewest categories (`pricesFor`: "U11 6 €" beats "Jeunes
  8 €"); only two equally specific prices with different amounts are refused (`hasPriceConflict`, also in the edit
  modal). `categoriesLabel` names a list ("Tous", "Adultes", "Jeunes (U13 à U21)", "U11, U15").
- A competition's page (`competition-registrations.tsx`, max 6xl wide, roomy: 32 px between blocks, white cards with
  a shadow on the grey `bg-muted` page; the user found it cramped and low-contrast, 2026-10-25), top to bottom: title
  with "Mandat (PDF)"; one compact bar (`registrations-summary.tsx`; the user rejected a box per number): « À
  faire : » then a chip per task left (« 4 à transmettre », « 2 en attente de paiement », « 1 à rembourser », the
  colors of the list on the left), each a button that shows those départs alone (a second click shows all), and on
  the right « À envoyer au club organisateur » with the amount; « Lu dans le mandat », a `<details>` closed by default
  with a one-line summary
  (rhythm, départs, price range); then « Inscriptions · N départs en cours pour N archers », one toolbar (search, both
  filters, Excel button) and the archer cards: name, category and badges on one line, then the reference; départ
  rows on a light grey band.
- Concours (`competitions-page.tsx`, `AdminCompetitionOverview`): every upcoming competition, hidden ones included,
  rendered 100 rows at a time (a sentinel loads more on scroll; phones are slow with ~1 800 rows). Decided: problems
  show as short badges (plus « Modifié » when edited). Problems (`problemsOf`): no place, gone from the FFTA list,
  mandate not read / failed / refused (a reading of an older link does not count), read without départs or prices.
  Decided: **the same filters as the public page**, the very same `CompetitionFilterBar` / `matchesFilters` /
  `inArea` (area not remembered, Loire-Atlantique at start: user's choice), plus a problems filter.
- Clicking a row opens a large modal (`competition-edit-dialog.tsx`, `CompetitionEdits`, route
  `/api/admin/competitions/:id/overrides`): problems and actions, then title, dates, discipline, status, para-tir,
  cibles mousses, rhythm, mandate link, town, département, position (click on a lazy-loaded map), départs and prices,
  then the
  FFTA details read only. A field that differs from the FFTA shows « Modifié », the FFTA value and « Revenir à la
  valeur FFTA ». Saving replaces every edit with the fields that differ (`checkOverrides`). Closing with unsaved
  changes asks first.
- Licenciés: table with search, active/left filter and category filter (« Jeunes » U11–U21, « Adultes » S1–S3, or one
  category; asked by Loïc 2026-10-11), a "⋯" menu per row (deactivate, club pays, admin rights), import dialog.

## FFTA scraper (`infrastructure/ffta/`, `application/sync-ffta-calendar.ts`)

- A **separate process** (`scrape.ts --run <id>`, `nice`), started by the server at 03:00 Paris or by an admin (full
  run or one competition). One run at a time: a partial unique index on `running` rows. The process writes progress
  and a heartbeat to its row; silent for 2 min means dead (`interrupted`); an exit without finishing marks it
  `failed`. A run by hand takes the same lock.
- Live page over SSE (`scraper-events.ts`): the server reads the row every second while a page is open; keep-alive
  every 15 s; `server.timeout(request, 0)` because Bun closes idle connections after 10 s.
- Cloudflare blocks plain HTTP and plain headless Chrome: `puppeteer-core` + `puppeteer-extra` stealth passes. Chrome
  runs with `pipe: true` so it dies with the process. A blocked page throws `CloudflareBlockedError` and the run changes
  nothing. One tab, 1 s between pages, no images or fonts.
- Every run reads the **whole list** (one year ahead, ~75 pages); detail pages (`/epreuve/<id>`) only for new or
  changed cards (list fingerprint). Para-tir entries become a flag on the main entry (`mergeParaTir`).
- Département: the venue's postal code first, else the departmental committee (longest name wins: "HAUTE LOIRE"
  before "LOIRE"), else the regional committee overseas only. Abroad: skipped.
- Competitions not listed anymore get `missing_since` (only after a complete list), are hidden, never deleted.
- Safety: nothing is written when the list cannot be read or holds less than half the known upcoming competitions.
  Read everything first, then write in batches of 100.
- **Mandates** (`application/read-mandates.ts`, table `competition_mandates`): after the save, each upcoming listed
  competition whose link has no good reading (fewer than 3 tries per link) is read, 3 at a time. "Mettre à jour ce
  concours" re-reads its mandate; a failed forced reading keeps the previous good one.
  - PDF over plain HTTP (`https://*.ffta.fr` only, 10 MB max); same SHA-256 as the last good reading → not sent again.
    poppler gives the first 6 pages as JPEG + `pdftotext`.
  - LLM via `@openrouter/sdk`: `MANDATE_MODEL` (default `z-ai/glm-5.3-flash`), temperature 0, reasoning `low` (was
    `medium` until 2026-10-11: long reasonings hit the 120 s timeout), `dataCollection: 'deny'`, providers sorted by
    price among those at 75 tokens/s or more (`preferredMinThroughput`; OpenRouter has no price-per-speed sort), JSON
    schema from zod. Prompt in French in `openrouter-mandate-extractor.ts`. Decided (2026-10-11): when GLM times out
    (120 s), the same request goes to `MANDATE_FALLBACK_MODEL` (default `google/gemini-3.1-flash-lite`, reasoning
    `minimal`, 60 s), which reads documents almost as well, does not reason long, and costs about 4× more.
  - `checkMandateData` checks the answer (≤ 12 départs, 0–150 €). A mandate often covers two FFTA entries of one
    weekend: départs on other days are dropped. Undated départs on a competition over several days get their day from
    the times (`datedDepartures`, asked 2026-10-11): an earlier time than the départ before starts the next day, only
    when the day count matches; migration `0015` dated the readings stored before. Refused answers are kept as
    `invalid`, never used. Errors never fail the run. Without `OPENROUTER_API_KEY`, mandates are skipped.
  - **Rhythm** (asked 2026-10-11): one per competition, `AB` / `ABC` / `AB/CD`. Decided: the LLM only lists every
    rhythm the mandate writes (`rhythms`, migration `0013` turned the old single answer into a list); the user's rules
    are applied by the code (`rhythmOf`): **AB/CD as soon as it is named** ("AB/CD ou ABC selon le nombre
    d'archers"); **indoors an ABC is AB**; then the one rhythm the discipline allows (indoors AB or AB/CD, outdoors
    ABC or AB/CD, **none off targets**, `allowedRhythms`), else none. The edit modal and the filter offer only the
    allowed ones and hide the field off targets; `checkOverrides` refuses the others. Readings made before the rhythm
    was asked have none; edits in
    `competition_overrides.rhythm` (migration `0011`). Decided: shown **like « Cibles mousses »** (a badge « Rythme
    AB/CD » on the card, a line in « Lu dans le mandat »), and a « Rythme » filter that leaves out competitions whose
    rhythm is not known. Each badge has its own color (user's request): sky Para-tir, lime Cibles mousses, solid red
    Reporté, indigo AB, pink ABC, teal AB/CD (`competitions/rhythms.tsx`; the same dot in both « Rythme » menus).

## Places and geocoding

- Decided: no Google API anywhere. Positions come from the Géoplateforme address service (`data.geopf.fr`), map tiles
  from OpenStreetMap.
- The FFTA "Itinéraire" GPS point is **never read**: organizers type it, and some are hundreds of km off.
- Scraper: `geocodeCommune(postalCode, names)` (postal line's commune, then the title's town), never the service's
  fuzzy matches (it offers Fontaine-sur-Ay for « AY 51160 »); else `geocodeTown` in the département. Requests are
  60 ms apart, retried after 429/5xx.
- `known-places.ts`: places the service cannot find, looked up by hand.
- Competitions without a place, cancelled or missing are kept but **not shown** to the public
  (`CompetitionDto.position` is never `null`); registered members and admins still see them.

## Client UI (decided, keep it)

- Layout like SeLoger: list on the left (500 px, own scroll), full-height map on the right. On phones the list
  **covers** the map (never hide the map: Leaflet needs its real size); a floating "Carte / Liste" button switches;
  phones open on the map the first time (asked by Hervé, 2026-10-11), then on the last view used (`mobileView` in
  `localStorage`; the user's choice).
- Filters: a round button opening a dialog in sections (`FilterSection`, small uppercase titles, a line between):
  Disciplines (checkboxes, several at once, none = all), Dates, « Seulement les concours » (Para-tir and Cibles
  mousses with their card badges, `competitions/badges.ts`; avec un mandat publié, asked 2026-10-25; avec des
  inscrits du club), Rythme (« Salle 18m et
  Extérieur seulement », disabled with a hint when the ticked disciplines have no rhythm). The user liked this
  layout (2026-10-11). And a "where" pill: place menu (départements grouped by region,
  `region:<id>`, remembered, default 44)
  plus a town search (our own ARIA combobox, not `<datalist>`). Chosen filters show as removable chips on a second
  line, never inside the search field. All filtering happens in the browser: `GET /api/competitions` sends everything.
- Cards (reworked 2026-10-25: easier to scan): date block in the discipline color, title, badges always on their own
  line under it, discipline · club, town with « Voir sur la carte » (icon only on phones), the club deadline as one
  line with an icon (green open, amber waiting for the mandate, grey closed; a red box when postponed), links
  "Mandat (PDF)" and "Détail FFTA", then « Voir les N inscrits » (the count lives in the button; « Aucun inscrit »,
  disabled, when nobody) and "S'inscrire" (before the deadline only). Actions ask to sign in first, then continue.
- Hovering a card does nothing on the map; « Voir sur la carte » is the only link from list to map.
- Map: OSM standard tiles (CARTO and Plan IGN rejected), one dot per position, red cluster bubbles, zoom bottom right,
  "© OpenStreetMap" bottom left in 10 px (required credit).
- FFTA titles are shown as they come (often in capitals). Labels: "Salle 18m" (no space). App accent: red.

## Accessibility (older and disabled members)

Material Design baseline, without overdoing it:

- Body text 16 px, nothing to read below 14 px (except the map credit).
- Buttons, selects, menu items and map controls are **40 px** tall, text 14 px. These sizes live in
  `components/ui/*`; new components must follow them.
- `--muted-foreground` about 7:1, control borders `--input` 3:1. Hand cursor on every enabled button. Map dots have
  the town name as `title`.
- No 2024+ browser APIs in the client (`Map.groupBy`…): members use older tablets.

## New contributors

Club members new to development build what they want with the skill `/build`, file `.agents/skills/build/SKILL.md`
(tools, fork, made-up demo data, launching the app, checks, pull request; the agent runs every command). It speaks
French to them; code stays English. Update it when the setup, scripts or ports change. `.claude/skills/build` is a
symlink to it (Claude Code only reads `.claude/skills/`): edit the file in `.agents/`.

## User guides (`docs/notice/`)

`notice-membre.html` (members, must stay **2 A4 pages**) and `notice-admin.html` (admins, in detail), shared
`notice.css`, formal French, captures on made-up data. To rebuild a PDF: `bunx --bun serve -l 3995 docs/notice`,
print the page to A4 PDF with backgrounds, check the page count. Update them when a screen they describe changes.

## Decided not to do

- Backups: handled outside the repo.
- Privacy page, data retention: the club's job; only its own members are stored, and the club owns that data.
- Registering a member on their behalf from the panel: the secretary signs in as the member when needed.
- Email or other notifications: a secondary app must not bother people.
- Reloading after a stale chunk (`vite:preloadError`) following a deploy: too little traffic to matter.

## Traps already hit

- Never remove a migration production has applied: Knex then refuses to start. Undo it there first with the image
  that has it (`createDatabase(DATABASE_PATH).migrate.down()` through `docker exec -i <container> bun run -`), then
  deploy without it.
- Never overwrite or delete the SQLite file (or `-wal`/`-shm`) while the server runs. To copy a database, never copy
  the `.sqlite` alone (recent writes sit in `-wal`): `sqlite3 <db> "VACUUM INTO 'export.sqlite'"`.
- An OpenRouter key was once committed and the history had to be rewritten: before committing, check the diff for
  `sk-or-`.
- `shadcn add` asks to overwrite `button.tsx`: answer **no** (our sizes live there). Bring new components to the 40 px
  sizes.
- `@radix-ui/react-select` drops `className` on `Select.Value`: style it from the trigger
  (`*:data-[slot=select-value]:…`).
- Radix menus open on `pointerdown`: browser automation must press the mouse; `click()` does nothing.
- react-leaflet updates popups when children change and moves markers when `position` changes by reference: keep
  `shown`, `Town.latLng` and `TownMarker` memoized, or open popups flicker. `divIcon` markers need `popupAnchor`.
- Leaflet CSS sits in Tailwind's `base` layer, so utilities win over it.
- Toggle buttons are grey when "on" by default: chosen départs use solid primary + a check icon.
