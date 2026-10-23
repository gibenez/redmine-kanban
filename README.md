# Redmine Sprint Board

A frontend-only sprint planner for one team. [jKanban](https://github.com/riktar/jkanban) supplies the drag-and-drop board; Redmine owns issues, sprints, workflow, and permissions. The Docker image serves static assets and reverse-proxies a small allowlist of Redmine JSON endpoints. **No application server or database.**

## Requirements

- Redmine **5.0+**, with REST API enabled under Administration → Settings → API.
- Each user supplies their own API key from their Redmine account page. Existing Redmine sessions are not reused.
- At least one visible project. Create target versions for standard planning, or enable Build-issue mode for Category-scoped sprints.
- Docker Compose. The board can run anywhere that can reach your Redmine URL; no shared Docker network or access to Redmine's Docker setup is required.
- HTTPS for the board and public Redmine URLs outside local development. Terminate board TLS at your existing ingress/reverse proxy.

## Docker deployment

```sh
cp .env.example .env
# Edit .env: REDMINE_URL=https://your-redmine.example.com and actual status IDs.
docker compose up --build -d
```

Compose builds the production image directly from the GitHub repository's `main` branch; no container registry or local source checkout is needed (only `compose.yaml` and `.env`). Docker needs network access to GitHub. Set `BOARD_BUILD_CONTEXT=.` to build your local checkout instead, or use a Git URL ending in `#<tag-or-commit>` to pin the source. To deploy upstream changes, rerun `docker compose up --build -d`. The `dev` service always builds local source.

Open `http://localhost:8080` locally. For production, route your HTTPS ingress to port 8080 and avoid exposing the plain HTTP port publicly (bind `ports` to loopback or use only the ingress network).

| Variable | Meaning |
| --- | --- |
| `REDMINE_URL` | Your existing Redmine URL, e.g. `https://redmine.example.com/redmine`. Used for both API requests and issue links. Must be reachable from the board container and users' browsers. No trailing slash. |
| `BACKLOG_STATUS_ID` | Actual ID of your **New** status. |
| `COLUMN_STATUS_IDS` | Comma-separated status IDs in board order, e.g. `1,2,3,5`. These examples are not universal Redmine defaults. |
| `REFRESH_SECONDS` | Active-tab refresh interval; default 60, minimum 15. |
| `SPRINT_SOURCE` | `version` (default) or `build` for Category-scoped Build-issue sprints. |
| `BUILD_TRACKER_ID` | Optional enabled Build tracker ID. When blank, Build mode resolves the exact tracker name `Build` for the selected project; missing trackers produce an error. |
| `BOARD_PORT` | Published local port; default 8080. |
| `BOARD_BUILD_CONTEXT` | Production Docker build context; defaults to `https://github.com/gibenez/redmine-kanban.git#main`. Set `.` for local source, or pin a Git tag/commit. |

### Serving under a URL prefix

The image supports an optional `BASE_PATH` **build arg** (default `/`) for deployments that serve the board under a path prefix instead of a domain root:

```sh
docker build --build-arg BASE_PATH=/redmine-kanban -t redmine-kanban .
```

With `BASE_PATH=/redmine-kanban`, all asset, `config.json`, and API URLs are emitted under that prefix (API calls go to `/redmine-kanban/redmine/...`). The ingress must strip the prefix before forwarding to port 8080 so the container keeps serving from its own root; for example, nginx-proxy `VIRTUAL_HOST_MULTIPORTS` route `{"/redmine-kanban": {"port": 8080, "dest": "/"}}`. The Vite dev server reads the same `BASE_PATH` from the environment.

Discover status IDs from **your** Redmine installation:

```sh
read -r -s -p 'Personal Redmine API key: ' REDMINE_API_KEY; echo
curl --fail --silent --show-error \
  -H "X-Redmine-API-Key: $REDMINE_API_KEY" \
  https://redmine.example.com/issue_statuses.json
unset REDMINE_API_KEY
```

Do not paste keys into URLs, configuration files, tickets, or logs. The frontend validates the configured IDs against this API at connection time. Column definitions are shared deployment configuration, not per-user browser state. Runtime environment changes require recreating the container, not rebuilding the image.

The browser calls the board's same-origin `/redmine` path; nginx forwards those requests to `REDMINE_URL`. This avoids requiring CORS changes on Redmine. The board and Redmine may run on completely different hosts or networks, provided the URL is reachable (including any necessary VPN/firewall access).

`REDMINE_URL` supports conventional DNS names/IPv4 hosts, optional ports and path prefixes. IPv6 literals and URL-embedded credentials are not supported. For HTTPS with a private CA, extend the image's CA trust store; do not disable certificate verification. `localhost` inside a container means that container, not your host: use a reachable hostname instead.

## Troubleshooting: authenticated, but versions return 403

Successful login verifies the API key, not access to every project. In stock Redmine, `GET /projects/:id/versions.json` requires **View issues** under the **Issue tracking** module; it does not require **Manage versions**.

- Check the selected project is the intended one. The initial selection is the first project returned by Redmine, which may not be your team's project.
- In that project's **Settings → Modules**, ensure **Issue tracking** is enabled.
- Have a Redmine administrator check the API-key owner's project membership and effective role under **Administration → Roles and permissions → Issue tracking → View issues**.
- If the same user can open the project's Issues/Roadmap pages but its JSON API still returns 403, investigate Redmine plugins or an upstream gateway's API restrictions. A browser login as a different user is not a valid comparison.

The board identifies the denied project, clears unavailable data, and pauses automatic refresh after a 403 rather than repeatedly requesting forbidden data. Choose another project, or click **Refresh** after access is corrected. It cannot grant permissions or bypass a Redmine denial. A forbidden membership-list request is handled separately by limiting assignee choices; it does not block the whole board.

## Build-issue planning

For a project whose modules use Category and whose sprints are Build issues, set:

```dotenv
SPRINT_SOURCE=build
BUILD_TRACKER_ID=9 # Replace with your actual Build tracker ID, or leave blank to resolve Build by name.
```

Recreate the container or restart the development server after changing `.env`. Equivalent browser configuration fields are `sprintSource: "build"` and `buildTrackerId: 9` (or `null` for name lookup).

- Categories are read through `GET /projects/:id.json?include=issue_categories`, which needs ordinary project-view access. The standalone `/projects/:id/issue_categories.json` endpoint requires **Manage categories**, even for reads, and is deliberately not used. Contributors do not need category-management rights.
- Select **Project → Category → Sprint**. Uncategorized is supported. Sprint labels are `subject (#ID)`, newest issue first. The last category is remembered per project and sprint per category; otherwise the first alphabetical category and newest open Build are selected. Empty categories show “No open sprints”; use the **New sprint** icon beside the Sprint selector to create one.
- Icon-only buttons with tooltips offer **New sprint** and either **Close sprint** or **Reopen sprint**, depending on the selected Sprint's state. Creation requires a name and accepts an optional due date; Project, Category and Build tracker follow the current selection. Uncategorized creation warns before confirmation. Redmine supplies other defaults and reports missing required fields or permission errors.
- A sprint is closed when its Build issue has a closed Redmine status. **Include closed sprints** exposes read-only planning history; its Build Sprint can still be reopened. Close/reopen use only Redmine's permitted transitions, asking for a status when several match. Closing requires confirmation and retains the selected Sprint in view. Member statuses and relationships never change: open members with no other open Build Sprint may return to Backlog, subject to its scope. A single permitted reopening transition runs directly.
- Creation and status changes are verified before reporting success. If a write's outcome is uncertain, inspect Redmine and refresh before retrying, especially to avoid duplicate creation.
- Only **relates to** links define membership, in either direction. Multiple Build memberships are allowed. Adding membership creates a link; removing it deletes only the selected Build's relates link. Other links and all target versions are untouched. Build issues never appear as work cards.
- Backlog means open work with **no open Build membership**, retaining the New/all-open eye toggle. Existing target versions and links to closed Builds do not prevent backlog eligibility. Removing one membership may leave an issue out of backlog if another open Build still relates to it.
- The **C** toggle in the Backlog header filters backlog to the selected category, defaults on, and remembers your choice per project. Its tooltip is “Show backlog issues only in the selected category.” This is independent of the eye toggle and search filters. Sprint columns include members from any category in the selected project; cross-category planning never changes Category. Other projects and subprojects remain excluded.
- All visible open Builds in the project are inspected to determine membership, including Builds in other categories. If that lookup fails, the board fails rather than presenting planned work as backlog. Redmine still applies search/status/category filters before candidate pagination; the board filters candidate pages against membership, buffering at most one server page. Sparse backlog can require scanning several candidate pages. Its total is `?` until the candidate stream is exhausted; it does not scan the whole backlog solely to count it.
- Relation changes and issue field updates are separate operations. The board rechecks sprint state and workflow before writing, verifies both results, reports observed partial state, and refreshes after errors without attempting rollback. Redmine permissions must allow viewing related issues and managing issue relations, as well as the requested field/status edits. Hidden issues and relations cannot be inferred or bypassed.

See [ADR 0002](docs/adr/0002-build-issue-sprint-membership.md). The following version-specific membership rules apply only to the default `version` mode; status columns, filters, estimates and workflow rules also apply in Build mode.

## How version-based planning works

- Select a project and a sprint (Redmine target version). The board excludes subprojects.
- **Backlog = no target version.** By default it is narrowed to the configured New status; use the **Show all unplanned** eye toggle at the right of the Backlog column header (crossed out while narrowed) to widen it to every open status with no target version. Closed issues never appear in the backlog, and issues assigned to any version are never backlog. The setting is a personal view preference: it is remembered per browser, is not a filter, and **Show all unplanned** survives clearing the search and filters.
- The backlog requests **one page sized to its visible column**, measured from the rendered card height plus two spare rows, so a tall screen fills in a single request and a short one stays small. Scrolling near the bottom requests another page of the same size. Its header shows loaded / total matching issues; it never downloads the whole backlog just to filter or count it. Each page is re-measured, so a page may differ in size from the one before it when the layout changes.
- Sprint columns represent configured Redmine statuses. Completed issues remain visible. Issues with unconfigured statuses appear in an **Other statuses** column rather than silently disappearing; it is not a drop target.
- Drag from backlog to a sprint column to set the target version and, if different, status. Drag between sprint columns to change status.
- Moving to backlog **only clears the target version**. It does not reset status. The issue consequently leaves this board when its status is outside the current backlog scope, with an explicit explanation; with **Show all unplanned** on, only closed issues leave.
- The Backlog header's chevron collapses it into a narrow rail, freeing space for Sprint Columns. Expand it with the rail's chevron. This is a browser-local preference shared across projects; it does not change issues, membership or filters. Hidden Backlog Cards and controls are inaccessible, extra backlog pages are not automatically loaded while collapsed, and dragging into Backlog requires expanding it first. The Card planner can still remove Sprint membership.
- Use **Plan** on a card for keyboard-accessible sprint/status changes, assignee editing, and estimated hours. Blank hours mean unestimated; zero is a real estimate.
- **Search and filters run on Redmine**, before pagination, for both backlog and sprint results. Text searches the subject; a number or `#123` searches that exact issue ID. Tracker and assignee (including Unassigned) predicates are combined with the search. Search is debounced by 300 ms; superseded requests are aborted and late responses ignored. Filter changes restart the backlog at its first page of matching issues. The last confirmed cards remain visible while searching; results update in place without rebuilding the board or unchanged cards. A failed search keeps those results with an explicit message.
- Effort totals count all sprint issues, independently of filters. The board loads the selected sprint's complete issue set for those totals and reuses it while filtering; only the backlog is lazy-paginated. Filtered sprint issues are queried separately and show a labeled visible-sprint total only while search, Tracker or Assignee filters are active, avoiding duplicate totals in the unfiltered view. Parent and child estimates are summed as returned by Redmine; no hierarchy deduplication or capacity model is applied.
- Redmine sorts issues by priority order, highest first, then ascending issue ID, before paging. Vertical drag order is not persisted. Tracker filter choices come from project metadata rather than only the loaded page; assignees come from visible memberships and known issue assignees.
- Open versions are selectable by default. Opt in to closed sprints for read-only viewing. Locked versions are excluded.
- Create issues and versions, edit detailed fields, and manage workflow in Redmine.

Redmine's per-issue `allowed_statuses` restricts status changes. Field edits and assignment candidates are still subject to Redmine validation. If membership listing is forbidden, assignee options are limited to people already present on loaded issues. Both users and groups from visible project memberships are offered; Redmine decides whether the requested assignment is permitted.

## Board layout

Appearance defaults to **System**, following your OS light/dark theme, including changes while the page is open. The icon-only **Appearance** button in the header cycles **System** (monitor) → **Light** (sun) → **Dark** (moon). Its tooltip and accessible label identify the current mode and the next action; your preference is remembered on this browser. Login, board, notices and dialogs share the selected appearance.

The interface reproduces the visual language of JetBrains YouTrack's agile board: neutral chrome with colour reserved for data, hairline-separated columns, and compact cards carrying a priority stripe and a clearly coloured priority label. Low / Bassa is green, Medium / Media (also Normal / Normale) yellow, High / Alta red, Urgent orange, and Immediate red/rose, with readable label colours in both themes. English and Italian stock names are recognized (for example High / Alta); unrecognized custom names stay neutral rather than guessing severity from IDs. See [docs/adr/0001-jetbrains-ring-ui-visual-language.md](docs/adr/0001-jetbrains-ring-ui-visual-language.md).

At **1280 × 720 CSS pixels** and above, the authenticated board fills the viewport without page or horizontal board scrolling. Backlog and all status columns share the available width; their card lists scroll independently, while column headers and backlog loading controls stay visible. Card summaries are clamped to three lines; the full subject stays available as a tooltip and to assistive technology. Columns can be focused for keyboard scrolling.

Project/sprint controls, totals, filters, identity and operational notices remain visible. Refresh is an icon-only topbar button; the last successful update time sits in a thin bottom status bar, separate from the planning controls. The **?** button in the top bar opens a compact guide to planning, search, Backlog scope and permissions, with Category and Build Sprint guidance in Build mode. Close it with **×** or **Esc**; it does not take space away from the board. Long notices use the available row width and offer **Full message** without pushing the board off-screen.

Below either minimum dimension (including after browser zoom), the compact layout is best-effort: **Filters** becomes an expandable panel and the board may scroll horizontally to preserve readable columns. Opening filters reduces the space available for cards; the guide opens above the board without resizing it. The page itself does not scroll. Login and planning-dialog layout are unchanged.

## Writes, refresh, and concurrency

Cards return to their original location immediately after a drop and move only after a successful write **and read-back verification**. Redmine can silently ignore fields a role cannot edit; the board checks the returned issue and reports discrepancies instead of claiming success. No-op changes do not generate writes.

Refresh runs while the tab is visible and pauses during dragging, editing, saves, searches, page loads, or while the backlog is scrolled away from the top, so it does not disrupt reading the list. Manual **Refresh** resets the backlog to its first page of matches. A confirmed write also reloads that first page so changed membership/order cannot leave an invalid pagination cursor. Failed lazy-page requests keep their offset; because a column already scrolled to its bottom cannot raise another scroll event, a **Retry loading issues** button appears in the backlog footer until the page succeeds.

Project/sprint selection is locked during metadata loads and saves, but remains available while a search is pending; changing scope discards the old search/page response. The server's current sprint state (version or Build issue status) is checked before writes, so a newly closed sprint cannot be knowingly edited from a stale view. Redmine uses offset pagination, not a snapshot: concurrent changes elsewhere can still shift page boundaries; duplicate IDs are suppressed, and Refresh starts a fresh result set.

This is **not transactional conflict detection**: another editor can race a read or update. No force-write/retry loop is used. If a write response or confirmation is lost, it may already have succeeded; the board says "Save not confirmed" and asks you to refresh before retrying. Redmine journals remain the authoritative history.

## Credential and browser security

- API keys stay in memory unless the user explicitly selects **Remember API key on this browser**. Remembered keys use origin-scoped `localStorage`; they are not encrypted. An XSS vulnerability on that origin, a malicious browser extension, or someone with browser-profile access can steal them.
- Click your initials avatar in the top bar, then **Sign out** in the account popover to clear this app's stored key and abort outstanding requests. It does not revoke the key at Redmine; revoke it there if compromised. A saved key can also be forgotten from the login screen if it stops working.
- Serve the board on a **dedicated trusted origin**. Do not host unrelated/untrusted scripts on it. Don't share one board origin between different Redmine deployments: its remembered key would be reused.
- Dependencies are bundled locally; there are no CDN scripts, remote fonts, analytics, or raw Redmine HTML rendering. All issue/status/member strings passed to jKanban's HTML interface are escaped.
- Production nginx supplies a restrictive CSP (inline **style attributes** are allowed for jKanban/Dragula layout; inline scripts are not), no-store responses, no-referrer, frame restrictions and nosniff.
- API credentials go only in `X-Redmine-API-Key`; browser cookies, Basic auth, and Redmine user-impersonation headers are not forwarded. Responses cannot set browser cookies. API responses are sandboxed and API access logs are disabled in this container. Check logging policies on your ingress and Redmine as well.
- The proxy only permits required GET JSON endpoints, PUT `/issues/:id.json`, POST `/issues.json` (Build Sprint creation), POST `/issues/:id/relations.json`, and DELETE `/relations/:id.json`; it is not a general Redmine proxy or an authentication layer. Exposing it also exposes that part of your Redmine API. Use your normal network perimeter and rate limiting.

## Local development

### Docker with live reload

With Docker Desktop (or Docker Engine with Compose v2) running:

```sh
./dev.sh
```

On first run, the script creates `.env` if missing and asks you to configure `REDMINE_URL` and the actual status IDs. It preserves an existing `.env`. Rerun the script after configuring it, then open **http://localhost:5173** once Vite is ready (set `DEV_PORT` to use another port).

The script runs `docker compose --profile dev watch dev`, which builds the `dev` target of the same `Dockerfile` and runs Vite inside it. Compose copies your edits under `src/`, `public/` and `index.html` into the running container, and Vite refreshes the browser. Editing `vite.config.js` restarts the server; changing `package-lock.json` rebuilds the image. No host Node installation is needed, and `npm install` is not required on the host.

Press **Ctrl+C** to stop watching, then remove the container:

```sh
docker compose --profile dev down
```

The `dev` service sits behind the `dev` profile, so ordinary `docker compose up` still starts only the production nginx service. The development port is bound to loopback. Restart after changing `.env`. If Redmine runs on your Mac, use `host.docker.internal` instead of `localhost` in `REDMINE_URL`; that URL also supplies browser issue links, so it must be reachable from both the container and your browser. On Linux, use a hostname or address reachable from both.

Tests still run on the host (`npm test`, `npm run test:e2e`), as does the production image check in `tests/docker-smoke.sh`.

### Without Docker

Node **22.12+** (or Node 24 LTS recommended):

```sh
npm ci
cp .env.example .env
# Set REDMINE_URL and actual status IDs in .env, as for Docker.
npm run dev
```

Open the Vite URL. The development server reads the same `.env` settings (shell environment takes precedence), serves browser configuration at `/config.json`, and proxies API requests to `REDMINE_URL`. Without environment settings, it uses `http://localhost:3000` and the status defaults in `public/config.json`. Docker generates configuration from its environment at startup. The Vite server is for trusted local development, not production, and does not implement nginx's security boundary.

```sh
npm test                         # API boundary and planning rules
npm run build                    # Production assets
npx playwright install chromium  # One-time browser installation
npm run test:e2e                  # Browser tests against production assets + mocked API
bash tests/docker-smoke.sh        # Real nginx proxy/headers/config + same browser suite
npm audit
```

The Docker smoke suite requires Docker, curl, jq and the installed Chromium browser. It creates and cleans up isolated test containers/network. Browser tests use synthetic data and no real API keys. They do not replace acceptance testing against your Redmine roles, plugins and workflows.

## Layout and upstream

- `src/api.js`: authenticated, paginated Redmine REST boundary.
- `src/domain.js`: backlog, movement, totals and validation rules.
- `src/planning-feed.js`: server-side queries, bounded backlog pages, sprint totals, cancellation and cursor lifecycle.
- `src/build-sprints.js`: Build tracker identity, symmetric membership and verified relation/field writes.
- `src/build-planning-feed.js`: project-wide open-Build membership index and category-scoped candidate paging.
- `src/main.js`: connection lifecycle, incremental rendering, editor and verified mutations.
- `docker/`: runtime config and restricted nginx proxy.
- `public/vendor/`: pinned jKanban browser distribution and license notices; see [THIRD_PARTY.md](THIRD_PARTY.md).

Redmine API references: [issues / allowed statuses](https://www.redmine.org/projects/redmine/wiki/Rest_Issues), [statuses](https://www.redmine.org/projects/redmine/wiki/Rest_IssueStatuses), [versions](https://www.redmine.org/projects/redmine/wiki/Rest_Versions), [memberships](https://www.redmine.org/projects/redmine/wiki/Rest_Memberships), [categories](https://www.redmine.org/projects/redmine/wiki/Rest_IssueCategories), [relations](https://www.redmine.org/projects/redmine/wiki/Rest_IssueRelations).
