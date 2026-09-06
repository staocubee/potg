# PropertyOnTheGo — technical scaffold

All six of the blueprint's [Engineering Implementation
Priorities](#) are scaffolded here: the multi-account foundation, the
property portfolio and document vault, the AI Copilot Layer, the vendor
marketplace and project tracking, payments and escrow, the property and
materials marketplaces, and real multi-turn AI chat with tool-calling — as
a working NestJS + Prisma API, plus a Next.js web app whose foundation
(auth, account switching, nav) and one reusable component — the Ask AI
panel — are now real screens wired to that API, not a mock: portfolio,
projects + vendor marketplace, payments + escrow, the property + materials
marketplaces, and the document vault all have working UI. The AI Copilot
Layer's design
point still holds: every module adds a **skill** to one existing
`AiService` instead of building AI support from scratch, and every one of
those skills is reachable from a web screen via `AskAiPanel` without that
screen knowing anything about AI plumbing itself.

## What's here

```
apps/api/            NestJS backend
  prisma/schema.prisma   Data model — Modules 1-4, 7 & 9, + the AI request/output/approval log
  prisma/seed.ts         Seeds permissions, roles, a demo owner + property + project, and a demo vendor
  src/auth/              Register, login, list-my-accounts
  src/accounts/          Create an account, add a member (Module 1)
  src/properties/        Property portfolio CRUD (Module 2) + inspections (Module 8) + leases (Module 13) + maintenance requests (Module 12)
  src/documents/         Document vault CRUD (Module 4)
  src/vendors/            Vendor marketplace profiles & quoting (Module 7)
  src/projects/           Project tracking — stages, milestones, updates, quotes (Module 9)
  src/payments/           Escrow, deposits, milestone release, payouts, receipts, disputes (Module 11)
  src/listings/           Property marketplace — listings, inquiries, offers, favorites (Module 5)
  src/materials/          Materials marketplace — suppliers, product catalog, orders, delivery (Module 10)
  src/ai/                The AI Copilot Layer (Section 5), now including real chat — see below
  src/common/            JWT auth guard, account-context guard, RBAC/ABAC permissions guard
apps/web/             Next.js web app — see "Web app" below
  lib/api.ts              Typed client for every endpoint above (one file, one contract)
  lib/auth.tsx             AuthProvider — token + account-switching, localStorage-backed
  components/AppShell.tsx  Sidebar nav, top bar, account switcher, Ask AI drawer
  components/AskAiPanel.tsx  THE reusable Ask AI panel — quick actions + chat, one per moduleContext
  components/AiDraftCard.tsx Accept/Edit/Discard for one AiOutput
  pages/properties/        Portfolio list + property detail
  pages/projects/          Project list/detail — stages, milestones, quotes, and now payments/escrow
  pages/vendors/           Vendor marketplace browse/detail/"me" dashboard
  pages/marketplace/       Property listings + (nested) materials marketplace — see "Web app" below
  pages/documents/         Account-wide document vault list + upload form
packages/shared/      Empty — shared types go here as the web app grows
docker-compose.yml    Local Postgres + Redis
```

## Running it locally

```bash
npm install
cp apps/api/.env.example apps/api/.env   # edit DATABASE_URL if needed
npm run db:up                            # starts Postgres + Redis via Docker
npm run prisma:migrate --workspace=apps/api -- --name init
npm run seed
npm run dev:api                          # http://localhost:3001
```

The seed script prints a demo login (email/password) plus the demo owner
account, property, and project IDs, and a second demo *vendor* account ID —
the same login belongs to both, so you can switch `X-Account-Id` between
them to try both sides of Module 7/9's marketplace flow without a second
signup.

To also run the web app:

```bash
cp apps/web/.env.local.example apps/web/.env.local   # only needed if the API isn't on :3001
npm run dev:web                          # http://localhost:3000
```

Sign in with the seeded demo login (or register a fresh one — a brand-new
user is routed straight to account creation, since every API call needs an
`X-Account-Id`).

## Web app (`apps/web`) — Foundation + Ask AI panel

This pass builds the web app's foundation and the one component every
future screen will reuse, matching the published Ask AI panel wireframe's
`Main.dc.html` artboard: the app shell (auth, account switcher, sidebar
nav), the property portfolio screens, and a real `AskAiPanel` wired to the
live API — not a mock.

- **`lib/auth.tsx`** — `AuthProvider` holds the JWT and the currently
  selected account (both in `localStorage`, read back on load so a refresh
  doesn't bounce a signed-in user to `/login`), and hands every screen one
  `ApiClient` instance (`lib/api.ts`) already carrying the right
  `Authorization` and `X-Account-Id` headers — the same account-switching
  model `AccountContextGuard` enforces server-side.
- **`components/AppShell.tsx`** — sidebar (Portfolio, Projects, Vendors,
  Marketplace, and Documents are all live; only Payments is shown but
  marked "soon" rather than hidden, so the shell doesn't misrepresent how
  much of the platform this pass covers — see the Payments & escrow
  section for why), top bar with the account switcher, and the Ask AI
  drawer toggle every screen that passes an `aiPanel` prop gets for free.
- **`components/AskAiPanel.tsx`** — the reusable piece. Takes one prop,
  `moduleContext` (e.g. `"property:<id>"`, `"account:<accountId>"`), and:
  1. Fetches `GET /ai/skills` and renders a quick-action button for every
     skill whose `moduleContextPrefix` matches — clicking one calls
     `POST /ai/actions` exactly like the wireframe's quick-action buttons.
  2. Renders a chat thread wired to `POST /ai/chat`, resuming the most
     recent conversation already scoped to this `moduleContext` if one
     exists (`GET /ai/conversations`).
  3. Renders every resulting `AiOutput` — from a quick action or from a
     chat tool call — as the same `AiDraftCard`, with Accept/Edit/Discard
     calling `POST /ai/outputs/:id/decision`. Nothing the AI produces here
     looks like it already happened; the visual language (indigo accent,
     "draft" framing, the disclaimer line) is deliberately consistent and
     used nowhere else in the UI.
  The dashboard (`pages/properties/index.tsx`) embeds it scoped to
  `"account:<id>"` — putting the Priority 6 `generate_portfolio_report`
  skill one click away — and the property detail screen embeds it scoped
  to `"property:<id>"`.
- **`pages/properties/`** — the portfolio list (cards + an inline "add
  property" form) and the property detail screen (info, timeline,
  documents, valuation history + an "add valuation" form hitting the
  Priority 6 `PropertyValuation` endpoints, and — added in the Projects
  pass below — a Projects section for that property).

### Projects & vendor marketplace screens (this pass)

Built from the same foundation, covering Priority 3 (Modules 7 & 9):

- **`pages/projects/`** — the projects list (cards with a `ProjectStageBar`
  mini-progress bar + an inline "new project" form scoped to one of the
  account's properties) and the project detail screen: the full 5-stage
  stepper (`Scope → Quote → Materials → Work → Handover`, matching
  `ProjectsService.DEFAULT_STAGES`), milestones (list + add form),
  updates (list + post form), vendor quotes (list, Accept on a `submitted`
  quote, and a "Request quote" widget that lists marketplace vendors and
  calls `POST /projects/:id/quotes/request`), and assigned vendor badges.
  Embeds `AskAiPanel` scoped to `"project:<id>"` — six of the twelve AI
  skills are `project`-prefixed (`estimate_project_budget`,
  `draft_project_status_update`, `compare_vendor_quotes`, `explain_fees`,
  `flag_payment_anomaly`, `boq_to_order`), so this is the panel's densest
  quick-action screen.
- **`pages/vendors/`** — `index.tsx` is the public marketplace browse
  (category filter, cards linking to a profile); `[id].tsx` is a vendor's
  profile + reviews, plus (for a non-vendor account) a "request a quote for
  one of your projects" widget — the same `POST /projects/:id/quotes/request`
  call, entered from the vendor's side instead of the project's;
  `me.tsx` is the vendor side of the marketplace — create your `Vendor`
  profile (`POST /vendors`), see quote requests owners sent you and submit
  a real amount against them (`POST /vendors/me/quotes`, upserts by
  project+vendor), and a read-only payout history (`GET /vendors/me/payouts`).
- No AI skill is `vendor`-prefixed today, so vendor screens don't embed
  `AskAiPanel` — only project- and property/account-scoped screens do.

### Payments & escrow screens (this pass)

Every payments/escrow route in `src/payments` is nested under one project
(`/projects/:projectId/...` — there's no account-wide payments aggregate
endpoint), so this pass builds the money side directly into the project
detail screen (`pages/projects/[id].tsx`) rather than as a separate page:

- **Escrow card** — current balance/currency/status, a "+ Deposit" form
  (`POST /projects/:id/payments`, simulated per the `Payment` schema
  comment — no real gateway call), and the escrow ledger (`EscrowLedgerEntry`
  rows) showing every deposit and release with the running balance after
  each, so the money trail is auditable without cross-referencing anything
  else.
- **Milestones** gained Approve/Release actions: "Approve" calls
  `POST .../milestones/:id/approve` (available whenever `approvalStatus`
  isn't already `"approved"`); once approved, "Release funds" calls
  `POST .../milestones/:id/release`, which pays the assigned vendor out of
  escrow — shown only for milestones with a `paymentAmount` set and not yet
  released (`status !== "completed"`, which `releaseMilestone` sets).
- **Payouts & Receipts cards** — read-only history from
  `GET /projects/:id/payouts` and `/receipts` (a receipt is issued for
  every deposit and every release automatically by the API; nothing in the
  UI creates one directly).
- **Disputes card** — list + a "Raise dispute" form (optionally tied to a
  milestone), and a "Resolve" action on any `open`/`under_review` dispute
  (mark `resolved` or `rejected`, with notes) via
  `POST .../disputes/:id/resolve`.
- At the time of this pass, the sidebar's "Payments" nav item still said
  "soon" — there was no `GET /payments` across all of an account's projects
  to back a standalone screen, only the complete money lifecycle for one
  project on that project's own page. A later pass ("Real end-to-end
  smoke test" section below, then the payments-rollup pass after it) added
  `GET /payments/overview` and a standalone `pages/payments/index.tsx` — see
  that pass's own README section for the rollup screen itself.

### Property & materials marketplace screens (this pass)

Priority 5's two marketplaces (`src/listings`, `src/materials`) each get
their own screens under `pages/marketplace`, kept as separate sub-trees
since they share nothing structurally beyond the nav item:

- **Property listings** (`/marketplace`) — browse active listings with
  type/city filters; `/marketplace/new` lists a property from the account's
  own portfolio as a `draft`; `/marketplace/[id]` is the listing detail —
  its Ask AI panel (`moduleContext: "listing:<id>"`) reaches the
  `generate_listing_description` and `assess_listing_risk` skills. Owners
  see Publish, plus Offers (Accept/Reject) and Inquiries; everyone else
  sees Make an offer / Ask a question, and a Favorite toggle. `/marketplace/me`
  rolls up an account's own listings (with Publish) and the offers it has
  made elsewhere.
- **Materials & tools** (`/marketplace/materials`) — browse the product
  catalog by category; `/marketplace/materials/[id]` is a supplier's
  storefront (product list + quantity picker → `POST /orders`, which
  decrements stock and computes the order total server-side).
  `/marketplace/materials/me` is the supplier dashboard: create a
  `SUPPLIER`-account profile if none exists yet, add/edit products
  (price, stock, status), and see incoming orders. `/marketplace/materials/orders`
  and `/orders/[id]` cover the buyer side — order detail shows line items
  and delivery status; on the supplier's own orders, the same detail page
  gains status transitions and a delivery-tracking form
  (`PATCH /orders/:id/status` and `/delivery`).
- The sidebar's Marketplace item is now fully enabled. Payments stays
  "soon" for the reason above; Documents got its screen in the next pass
  below.

### Documents screen (this pass)

`src/documents` (Module 4) had a working API since early in this scaffold
but only a read-only summary embedded in the property detail page.
`pages/documents/index.tsx` is now a real screen:

- **`GET /documents`** (account-wide) backs the main list — every document
  across every property, plus any not tied to a property at all
  (`propertyId` is optional on `Document`). A `?propertyId=` query param
  filters it to one property; the property detail page's Documents card
  now links here with that filter set ("Manage documents") instead of only
  showing its own read-only summary.
- **Upload form** — `POST /documents`: document type (a dropdown of the
  same checklist `verify_property_documents` checks against, plus a
  freeform "Other" since `Document.documentType` is just a string),
  a file URL, an optional property, and an optional expiry date. There's
  no file storage wired up yet, so this is a link to wherever the document
  already lives rather than a real upload — the form says so.
- The list flags anything expiring within 30 days and shows each
  document's `verificationStatus` badge, but there's still no way to
  *change* that status from the UI or the API — verification stays a
  human/admin workflow that Module 6 hasn't been built yet (the
  `verify_property_documents` AI skill only drafts a checklist gap report,
  it never sets the field itself; see that skill's own comment).
- The sidebar's Documents item is now fully enabled — Payments is the only
  item left disabled, and deliberately so (see above).

### Vendor & supplier reviews (this pass)

`VendorReview` had a schema and a spot on the vendor profile page since an
early pass, but no endpoint — "needs a 'mark project complete' step first"
per that pass's own note. This pass adds that step, the review endpoints
for both marketplaces, and a new `SupplierReview` model that didn't exist
before (suppliers/products had no review model at all):

- **`POST /projects/:projectId/complete`** (`project:write`) — the missing
  step: flips a project to `status: "completed"` (refuses if it's already
  `completed` or `cancelled`). The project detail page now shows a "Mark
  complete" button whenever a project is still open.
- **`POST /projects/:projectId/reviews`** (`review:write`, new permission)
  — leaves a `VendorReview` on one of the project's assigned vendors.
  Lives on `ProjectsController` rather than `VendorsController` so it
  inherits `PermissionsGuard`'s `:projectId` ABAC check for free; from
  there `VendorsService.createReview` enforces the two review-specific
  gates — the project must be `completed`, and the vendor must actually
  have a `ProjectVendorAssignment` on it — then recomputes
  `Vendor.ratingAverage` from all of that vendor's reviews.
  `VendorReview` also gained a `@@unique([projectId, vendorId])`
  constraint: one review per vendor per project. The project detail page
  shows a review form for each assigned vendor once the project is
  completed, one per vendor, hidden once submitted.
- **`POST /orders/:orderId/reviews`** (`review:write`) — the materials
  marketplace counterpart, gated on the *order* being `delivered` instead
  of a project being completed (an order doesn't always belong to a
  project — `Order.projectId` is optional). `SupplierReview.orderId` is
  `@unique`, so it's one review per order; `MaterialsService` recomputes
  `Supplier.ratingAverage` the same way. The order detail page shows the
  form once an order is delivered, and the submitted review afterward; the
  supplier's storefront page (`/marketplace/materials/[id]`) now has a
  Reviews section alongside the product catalog, matching the vendor
  profile page's layout.
- Reading a review needs no permission of its own — it rides along with
  `vendor:read`/`supplier:read` since the existing `findOne`/`findSupplier`
  queries just got `reviews` added to their `include`.
- Seed data got one of each review (a 5-star vendor review on the
  demolition milestone project, a 4-star supplier review on the tile
  order) so both profile pages have something real to show on first
  login — added by writing straight to Prisma, since the demo project is
  deliberately left `in_progress` and the demo order `in_transit` so
  there's live money/delivery activity to demo elsewhere; the review
  *gates* themselves are only exercised for real once a user completes
  their own project or order through the UI.

### Web app auth hardening (this pass)

The gap flagged since the Foundation pass — a single 7-day JWT in
`localStorage`, no refresh, no password reset — gets addressed, with one
piece explicitly left as a documented tradeoff rather than built:

- **Access + refresh tokens.** `POST /auth/register` and `/login` now
  return `{ accessToken, refreshToken }` instead of one long-lived token —
  a 1-hour access token (`type: 'access'` in its payload) and a 30-day
  refresh token (`type: 'refresh'`). `JwtAuthGuard` now checks that `type`
  claim, so a refresh token can never be used directly against a protected
  route, only against the new `POST /auth/refresh`. This is **stateless**
  on purpose — no persisted session/refresh-token table — which means a
  refresh token can't be revoked early (on logout, or a password change);
  it's simply valid until it expires. A real production auth system would
  want that revocation; this scaffold calls out the gap instead of
  building a session store for it.
- **Transparent refresh on the client.** `apps/web/lib/api.ts`'s `request()`
  now catches a 401 from an authenticated call, swaps the refresh token
  for a new pair via `POST /auth/refresh`, and retries the original call
  once — invisibly to whichever screen made it. Concurrent requests that
  401 around the same time share a single in-flight refresh instead of
  each racing their own. `lib/auth.tsx`'s `AuthProvider` wires this up via
  `configureAuthSession()` (persisting the new pair, or forcing a real
  logout if the refresh token is no good either) and, on hydrate, decodes
  the refresh token's `exp` client-side to tell "just need a silent
  refresh" apart from "genuinely logged out" without an extra round trip.
- **Password reset.** `POST /auth/forgot-password` / `/reset-password`,
  backed by a new `PasswordResetToken` model (hashed token, 1-hour expiry,
  one-time use — the `passwordHash` treatment applied to a reset token
  instead of a chosen password) and two new pages,
  `pages/forgot-password.tsx` and `pages/reset-password.tsx`. No email
  provider is wired up anywhere in this scaffold (payments are simulated
  the same way — see `src/payments`), so the reset link is logged
  server-side (where a real implementation would hand it to an email
  service instead) **and** returned directly in the API response so a
  demo/dev user has any way to receive it at all — `AuthService
  .forgotPassword`'s own comment flags that the `resetToken` field must be
  deleted before this ships for real, since returning it defeats the
  point of the flow.
- **What was still open as of this pass**: the JWT (now the short-lived
  access token) still lived in `localStorage`, not an httpOnly cookie —
  moving to cookies would mean the API setting them itself (CORS +
  `credentials: 'include'` + CSRF protection, none of which existed yet)
  and losing the clean bearer-header story for non-browser callers (curl,
  the eventual mobile app). That tradeoff was deliberate for this pass,
  not an oversight — see "Moving auth off localStorage: httpOnly cookies
  + CSRF" further down for where a later pass this session actually did
  it, CSRF protection and all, and what the bearer-header loss above
  turned into a real, explicitly accepted tradeoff rather than a deferred
  one.

### Per-skill AI input schemas (this pass)

Closes a gap the Chat & deeper AI pass had already flagged in its own code
comment (`AnthropicLlmProvider.chat`, before this pass): every tool handed
to the model got the same permissive `{ type: 'object', properties: {},
additionalProperties: true }` schema regardless of what the skill actually
read, so a real model had no way to know, say, that `model_roi_scenario`
takes a `scenario` field — and nothing validated `input` server-side either.

- **`AiSkillInputSchema`** (`src/ai/skills/ai-skill-input-schema.ts`) is a
  small, hand-rolled JSON-Schema-shaped type — `string`/`number`/`boolean`
  fields, with `enum` (string), `minimum`/`maximum` (number), and `default`
  — deliberately not a dependency on `zod`/`ajv`, since three primitive
  types cover every skill in this registry. `AiSkill.inputSchema` is now a
  **required** field, so every skill states its shape explicitly — 11 of
  the 12 use the shared `NO_INPUT_SCHEMA` constant (they don't read `input`
  at all); `model_roi_scenario` — the one skill that already read `input` —
  gets a real schema (`scenario` enum plus the four scenario-specific
  numbers), with defaults matching what the skill already fell back to, so
  a bare `{}` still behaves exactly as it did before this pass.
- **`AiService.coerceInput`** runs before every skill call (both
  `POST /ai/actions` and chat's tool-calling path funnel through the same
  `runAction`): declared fields are coerced to their declared type and
  checked against `enum`/`minimum`/`maximum` (a bad value throws a 400
  instead of silently becoming `NaN` deep inside a skill), missing fields
  get their schema `default`, and **undeclared keys are dropped** rather
  than passed through — a skill only ever sees a shape that matches its own
  schema. The coerced input (not the raw request body) is what gets
  persisted on `AiRequest.input`, too.
- **`AnthropicLlmProvider.chat()`** now sends each tool's real
  `inputSchema` as Anthropic's `input_schema` instead of the placeholder
  open object — a real model can now see `model_roi_scenario` wants a
  `scenario` string and act on it. `StubLlmProvider` is unchanged in
  behavior (it's a keyword router over tool *names*, not an argument
  extractor) but its code comment now says so explicitly, since it's the
  one place a schema exists but isn't used yet.
- **`AskAiPanel`** (`apps/web`) — a quick-action button for a skill with an
  empty schema still runs immediately on click, same as every pass before
  this one. A skill with declared fields (today, just "Model an ROI or rent
  scenario") opens a small inline form instead — a `<select>` for an enum
  field, a bounded number input for a number field — so the ROI scenario
  skill can actually be run with a chosen scenario and numbers from the UI,
  not always with `{}` defaulting to `"current"`.

## How multi-account auth works

A user can belong to several accounts at once (personal, family, company,
vendor — Module 1's whole point). So a request needs two things:

1. `Authorization: Bearer <accessToken>` from `POST /auth/login` — who you
   are. `/login` and `/register` actually return an `{ accessToken,
   refreshToken }` pair (1h / 30d) — see "Web app auth hardening" above
   for the refresh flow; this section only covers the access token, which
   is what every other route actually checks.
2. `X-Account-Id: <accountId>` — which account you're acting as right now.
   `GET /auth/accounts` lists the accounts a token can act as.

`AccountContextGuard` resolves the membership (role + permissions) for that
pair once per request; `PermissionsGuard` then checks the route's
`@RequirePermissions(...)` against that role, and — if the route has a
`:propertyId` param — checks the property actually belongs to that account
(the ABAC half of Section 8: "RBAC as the baseline, ABAC for
property/project/transaction-level restrictions").

## Vendor marketplace & project tracking (`src/vendors`, `src/projects`)

Priority 3 of the Engineering Implementation Priorities — Modules 7 and 9.

- **`src/vendors`** — a `Vendor` is a 1:1 marketplace profile on top of a
  `VENDOR`-type account (`POST /vendors` to create it, `GET /vendors` to
  browse/filter the marketplace by `serviceCategory`). A vendor submits or
  revises a quote via `POST /vendors/me/quotes` — deliberately keyed off the
  vendor's own account rather than `/projects/:projectId/...`, since the
  project being quoted on isn't the vendor's own tenant and shouldn't have
  to pass the property-owner ABAC check in `PermissionsGuard`.
- **`src/projects`** — `POST /projects` creates a project under one of the
  account's own properties and seeds its five stages (`Scope → Quote →
  Materials → Work → Handover`, matching the Ask AI panel wireframe
  exactly). From there: `POST /projects/:projectId/milestones` and
  `.../updates` for progress tracking, `.../quotes/request` for the owner
  to invite a specific vendor to quote, and `.../quotes/:quoteId/accept` to
  hire one — which assigns the vendor, declines the project's other live
  quotes, and moves the project out of `planning`.
- **Three new AI skills** plug into the same registry as Modules 2/4's:
  `estimate_project_budget` (a deterministic keyword match against the
  scope description and a placeholder cost table — `src/ai/skills/cost-
  estimates.ts` — not a real pricing catalog yet), `draft_project_status_
  update` (facts from stage/update state, LLM only phrases the paragraph),
  and `compare_vendor_quotes` (sorts submitted quotes, flags a >50% price
  spread as `warn`).
- **Reviews** (`POST /projects/:projectId/complete`, `.../reviews`) were
  added in a later pass — see "Vendor & supplier reviews" under "Web app"
  above for the full gating logic.

## Payments & escrow (`src/payments`)

Priority 4 — Module 11. At the time this was written, no real payment
gateway was wired up (Section 16 lists Paystack/Flutterwave/Stripe/PayPal
as day-one integrations); every deposit and payout was simulated and
completed instantly, the same way `StubLlmProvider` simulates a model. A
much later pass this same session made deposits real via Paystack — see
"A real payment gateway — Paystack" further down; payouts are still
exactly what this paragraph describes. What's real from the start is the
ledger — every balance change is an `EscrowLedgerEntry`, so a project's
escrow balance is always derivable from its history rather than just a
number someone could edit directly.

- `POST /projects/:projectId/payments` — deposit funds into the project's
  escrow account (creates it on first deposit).
- `GET /projects/:projectId/escrow` — current balance plus the full ledger.
- `POST /projects/:projectId/milestones/:milestoneId/approve` — owner signs
  off on a milestone's submitted evidence (Section 22's "review evidence,
  approve" step) — a prerequisite for releasing its funds, not the release
  itself.
- `POST /projects/:projectId/milestones/:milestoneId/release` — pays the
  project's assigned vendor from escrow. Gated by its own `payment:approve`
  permission rather than `project:write`, since moving money deserves a
  narrower grant than editing a project — see `prisma/seed.ts`'s role list
  for why the `vendor` role never has it. Creates a `Payout` and a
  `Receipt`, and marks the milestone `completed`.
- `GET /vendors/me/payouts` — a vendor checking what it's actually been
  paid, on `VendorsController` alongside `me/quotes`.
- `POST /projects/:projectId/disputes` and `.../disputes/:disputeId/resolve`
  — deliberately simple: any account member with `dispute:write` can both
  raise and resolve one in this scaffold. A real dispute-resolution
  workflow (a neutral reviewer, evidence requests, holds) is out of scope
  here.
- **Two new AI skills**: `explain_fees` (deposited/released/balance from
  the real ledger, plus an *illustrative* platform fee — nothing is
  actually deducted anywhere yet, the skill says so rather than implying
  otherwise) and `flag_payment_anomaly` (invariant checks: a payout that
  doesn't match its milestone's amount, more than one live payout on the
  same milestone, a single payout that dwarfs the project's budget, a
  negative escrow balance).
- **`GET /payments/overview`** (this pass) — the account-wide rollup that
  finally backs a standalone Payments screen. Every route above is
  deliberately nested under one project so `PermissionsGuard`'s `:projectId`
  ABAC check applies for free; this one isn't project-scoped at all, so
  `PaymentsService.getAccountOverview` filters by the caller's `accountId`
  directly instead. Returns escrow balance / total deposited / total
  released **grouped by currency** rather than summed across currencies
  (the same caution `generate_portfolio_report`'s own comment already
  takes for cross-property pricing), an open-dispute count, and a
  per-project breakdown. `apps/web`'s `pages/payments/index.tsx` — stat
  tiles for the four rollup numbers, then one card per project linking into
  its existing full payments/escrow view on `pages/projects/[id].tsx` (that
  page is still where deposits, approvals, and releases actually happen —
  this screen is a read-only portfolio-wide summary, not a second place to
  take those actions). The sidebar's "Payments" item is enabled now that it
  has somewhere to point.

## Two marketplaces (`src/listings`, `src/materials`)

Priority 5 — Modules 5 and 10. Same shared pattern both times: a seller-side
profile, a public browse/search surface with **no** tenant isolation
(`PermissionsGuard`'s ABAC check never triggers here — neither controller
has a `:propertyId`/`:projectId` route param, so ownership of a specific
listing/product/order is checked in the service layer instead, the same
way `VendorsController`'s `me` routes work), and a buyer-side action kept
as its own deliberate step.

- **`src/listings`** — `POST /listings` creates a listing from one of the
  account's own properties (still `draft`); `POST /listings/:id/publish`
  makes it `active` and visible to `GET /listings` (`?listingType`,
  `?city`, `?propertyType`, `?minPrice`, `?maxPrice` — Priority 5's
  "search" requirement). Any account can inquire or submit an offer;
  `.../offers/:offerId/respond` is the owner accepting, rejecting, or
  countering. `GET /listings/me/offers` and `.../me/favorites` mirror
  `VendorsController`'s `me` routes for the buyer side.
  `PropertyListing.verificationStatus` is a plain field with no dedicated
  review endpoint — the same simplification `Vendor.verificationStatus`
  took in Priority 3; Module 6's full verification workflow (a separate
  reviewer, risk flags, trust scores) isn't built.
- **`src/materials`** — `POST /suppliers` creates a 1:1 marketplace profile
  on a `SUPPLIER`-type account (same shape as `Vendor`); `POST /suppliers/
  me/products` and `PATCH .../products/:id` manage its own catalog;
  `GET /products` is the public cross-supplier catalog browse/search.
  `POST /orders` computes the total from real product prices and
  decrements stock; `PATCH /orders/:id/status` and `.../delivery` are the
  supplier's own fulfillment actions, checked against `req.accountId`
  owning the supplier record rather than the order. No cart model — an
  order is created directly from a line-item list; a real cart is
  session/UI state, not really a backend entity worth modeling here.
- **Two new AI skills**: `generate_listing_description` (the first skill
  with a `moduleContextPrefix` other than `property`/`project` —
  `moduleContext` is `"listing:<uuid>"`; deterministic facts, LLM writes
  the marketing paragraph) and `boq_to_order` (reuses
  `estimate_project_budget`'s keyword matcher against the project's scope
  description, but looks each match up against the *real* product catalog
  instead of the placeholder cost table — drafts a suggestion, never
  places the order itself).
- **`SupplierReview`** (`POST /orders/:orderId/reviews`) — added in a later
  pass alongside `VendorReview`'s own endpoint; see "Vendor & supplier
  reviews" under "Web app" above.

## Chat & deeper AI (Priority 6)

Every AI entry point before this pass was a quick-action button: one skill,
one call, one draft. Section 5.1's actual requirement was "every feature
should let the user **chat**", which needed a different shape — a real
back-and-forth where the model decides whether to call a tool, using
Section 16's "LLM provider with tool-calling/function-calling support."
That's `ChatService` (`src/ai/chat.service.ts`):

- `POST /ai/chat` — `{ conversationId?, moduleContext?, message }`. Starts a
  new `AiConversation` if `conversationId` is omitted. `moduleContext` is
  set once, on the first message ("property:<id>", "listing:<id>",
  "account:<id>" for a portfolio-wide skill) and carried by the
  conversation from then on.
- `GET /ai/conversations` and `GET /ai/conversations/:id` — conversation
  history, scoped to the caller's account.
- `LlmProvider` gained a `chat()` method alongside `complete()` —
  `StubLlmProvider` routes on keywords in the last user message (no API key
  needed, same philosophy as its templated `complete()` replies);
  `AnthropicLlmProvider` calls Claude's real Messages API `tools` parameter
  and reads back a `tool_use` block when the model calls one.
- **Every tool call still goes through `AiService.runAction`** — the exact
  same permission check, `AiRequest`/`AiOutput` persistence, and
  Accept/Edit/Discard requirement as a quick-action button. Chat is a
  second way to reach the same audited, human-in-the-loop skills, not a
  bypass around them. A chat turn can now chain more than one tool call
  before replying — see "Multi-turn tool use in chat" below for how and
  why that was originally scoped out, then added.

Three new skills round out the blueprint's Priority 6 list:

- **`model_roi_scenario`** (property) — the "do financials" skill (Module
  15): current value (from the latest `PropertyValuation`, or
  `Property.estimatedValue`) against what's actually been invested
  (acquisition value + everything released from escrow on the property's
  projects), plus `rent_increase` and `sell_now_vs_hold` scenarios. Every
  output ends with a disclaimer line — Section 5.4's guardrail that
  AI-generated valuations are "assistive estimates, not professional
  advice" is enforced in the skill itself, not left to a UI label.
- **`assess_listing_risk`** (listing) — the one listing skill that's
  deliberately *not* ownership-gated, the same way `GET /listings/:id`
  isn't: any account with `listing:read` can ask why a listing looks risky.
  Reuses `DEFAULT_DOCUMENT_CHECKLIST` against the underlying property's
  documents, plus price-deviation and listing-status checks.
- **`generate_portfolio_report`** (account) — the first skill scoped to a
  whole account rather than one record (`moduleContext` is
  `"account:<id>"`); aggregates properties, projects, listings, and open
  disputes into one plain-language report, Module 23's "natural-language
  report generation on top of every report type."

`PropertyValuation` (`POST`/`GET /properties/:propertyId/valuations`, on
the existing `PropertiesController` — no new permission keys, gated by the
same `property:read`/`property:write` pair as the property itself) is a
thin slice of Module 15: an appreciation history a human (or an
`ai_estimate`-sourced entry) can append to. `Property.estimatedValue`
itself is never recomputed from it.

## The AI Copilot Layer (`src/ai`)

This is the part worth reading closely, since it's what the rest of the
blueprint's 24 modules will plug into:

- **`skills/ai-skill.interface.ts`** defines an `AiSkill` — the "skill/tool
  registry" from Section 5.4. Twelve are wired up: `verify_property_documents`
  and `summarize_property` (Module 2); `estimate_project_budget`,
  `draft_project_status_update`, and `compare_vendor_quotes` (Modules 7/9);
  `explain_fees` and `flag_payment_anomaly` (Module 11);
  `generate_listing_description` and `boq_to_order` (Modules 5/10);
  `model_roi_scenario`, `assess_listing_risk`, and
  `generate_portfolio_report` (Priority 6 — see above). Every one of them
  is now reachable two ways: a direct `POST /ai/actions` quick-action call,
  or the model choosing to call it mid-chat via `POST /ai/chat`. Every skill
  also declares an `inputSchema` (`ai-skill-input-schema.ts` — see "Per-skill
  AI input schemas" above) describing the shape of the `input` object its
  `run()` expects; 11 of the 12 don't read `input` at all and use the shared
  `NO_INPUT_SCHEMA`.
- **`ai.service.ts`** is the one entry point every module's Ask AI panel
  calls into. It resolves the skill, checks the caller's account membership
  actually holds that skill's required permission (the AI layer never sees
  more than the human already could — Section 8), validates/coerces `input`
  against the skill's `inputSchema`, and persists an `AiRequest` → `AiOutput`
  pair so every draft is auditable.
- **`POST /ai/outputs/:outputId/decision`** is the server side of the Ask AI
  panel's Accept / Edit / Discard buttons. An `AiOutput` is a draft until
  exactly one `AiActionApproval` exists for it — nothing should ever treat
  an `AiOutput` as final by itself. (For an action that also moves money or
  publishes something, Accept here should additionally call that module's
  own approval endpoint once it exists — this endpoint records the
  decision, it doesn't yet chain into e.g. a milestone release.)
- **`llm/`** is a provider-agnostic interface. `StubLlmProvider` is the
  default (no API key needed — the whole permission/persistence pipeline is
  testable without one); set `ANTHROPIC_API_KEY` to switch to
  `AnthropicLlmProvider` automatically. Skills that only need structured
  facts (`verify_property_documents`) don't call the LLM provider at all;
  `summarize_property` shows the pattern for the ones that do — deterministic
  facts assembled from the database, LLM used only to phrase the intro line.

Try it once seeded:

```bash
# Ask AI to verify documents on the demo property
curl -X POST localhost:3001/ai/actions \
  -H "Authorization: Bearer <token from /auth/login>" \
  -H "X-Account-Id: <demo account id>" \
  -H "Content-Type: application/json" \
  -d '{"moduleContext":"property:<demo property id>","actionType":"verify_property_documents"}'

# Accept the draft it returns
curl -X POST localhost:3001/ai/outputs/<outputId>/decision \
  -H "Authorization: Bearer <token>" -H "X-Account-Id: <demo account id>" \
  -H "Content-Type: application/json" -d '{"decision":"accepted"}'
```

## Real end-to-end smoke test (this pass)

Every pass so far has repeated the same caveat: no cloud-sandbox session
building this scaffold has network access to `binaries.prisma.sh`
(confirmed once for `prisma generate`; this pass confirmed it again,
separately, for `prisma format` and `prisma validate` — **all three fail
identically**, since even `format` needs the query-engine binary in Prisma
5.19 and `validate` needs the schema-engine binary). One more thing this
pass confirmed that earlier passes hadn't stated this precisely: the
`@prisma/client` package installed here is the *un-generated* stub
(`export declare const PrismaClient: any`, and its runtime constructor
literally throws `"@prisma/client did not initialize yet. Please run
'prisma generate'..."`) — so `PrismaService extends PrismaClient` cannot
even be instantiated, meaning **no cloud-sandbox session has ever been able
to boot this app at all**, independent of whether a real Postgres was
reachable. The user's own machine (with real network access) is the only
place any of this has ever been confirmed to actually work.

Since neither "spin up Postgres" nor "run `prisma generate`" alone gets
past that, this pass did the part that's actually possible here and was
explicit about the part that isn't:

- **A real PostgreSQL 16 server, actually running in this sandbox**
  (`apt-get install postgresql` — genuinely reachable, unlike
  `binaries.prisma.sh`).
- **`prisma/tools/prisma_to_sql.py`** — a small, purpose-built (not
  general-purpose) translator from `schema.prisma` straight to PostgreSQL
  DDL: parses all 43 models, both enums, and every `@relation` into real
  `CREATE TYPE` / `CREATE TABLE` / `ALTER TABLE ... ADD CONSTRAINT FOREIGN
  KEY` statements, using the schema's own `@@map`/`@db.Decimal`/`@default`/
  `onDelete` annotations. This is **not** a Prisma-equivalence claim — it's
  a direct reading of one specific, consistently-formatted schema file, and
  its own header comment says so.
- Ran the generated DDL against the real Postgres server: **all 43 tables
  and 64 foreign keys created with zero errors.**
- **`prisma/tools/smoke-test.sql`** — one representative row inserted into
  every one of the 43 tables, in FK dependency order, mirroring the actual
  relationship chain the app writes (account → user → role/permission →
  member → property → document → project → escrow → payments →
  disputes → listings → suppliers → orders → reviews → AI conversation),
  plus explicit assertions that: `account_members`'s
  `[accountId, userId]` unique constraint rejects a duplicate,
  `vendor_reviews`'s `[projectId, vendorId]` unique constraint rejects a
  duplicate, `documents.propertyId`'s foreign key rejects a bad reference,
  and — the most useful check, since it exercises real cascade behavior,
  not just a syntax check — **deleting a `Property` really does `SET NULL`
  on `documents.propertyId` instead of deleting the document**, confirmed
  by an actual `DELETE` against the running database, not just read back
  from the schema text. All of it passed; the script ends with a literal
  `SMOKE TEST PASSED` row.
- **What this does and doesn't prove**: it's real, independent evidence
  that the schema's 43 models are internally consistent — every relation
  resolves to a real table and column, no duplicate constraint names, no
  reserved-word collisions — and that the *design* of the FK/unique/cascade
  rules (not just their Prisma DSL syntax) behaves as intended under an
  actual PostgreSQL engine. It is **not** the same as `prisma migrate dev`
  or `prisma generate` succeeding — a hand-rolled translator can diverge
  from Prisma's own DDL output in ways this pass wouldn't catch (exact
  index strategy, `@updatedAt` trigger semantics, edge-case type mapping),
  and it says nothing about whether the *application code* (NestJS
  services, the AI skills, the web app) actually works against a real
  database, since the app still can't boot here at all. Re-run it any time
  with the two commands in `prisma/tools/smoke-test.sql`'s own header
  comment.

## Payments rollup (this pass)

Closes the gap the "Payments & escrow screens" pass flagged explicitly:
every payments/escrow route lived under one project, so the sidebar's
"Payments" item had nowhere of its own to point.

- **`GET /payments/overview`** (`AccountPaymentsController`, a second
  controller in `src/payments/payments.controller.ts` alongside the
  existing project-scoped one) — not nested under `:projectId`, so it can't
  lean on `PermissionsGuard`'s ABAC convention the way every other route in
  this module does; `PaymentsService.getAccountOverview` filters by the
  caller's `accountId` directly instead. Still gated by the same
  `payment:read` permission as everything else here — no new permission
  key needed.
- Returns escrow balance, total deposited, and total released **grouped by
  currency** (`{ currency, balance|total }[]`, not one summed number) —
  the same caution `generate_portfolio_report`'s own comment already takes
  for cross-property pricing, since nothing here guarantees every project
  shares a currency — plus an open-dispute count across the account's
  projects and a per-project breakdown (title, property name, status,
  escrow balance/status, open dispute count).
- **`pages/payments/index.tsx`** — four stat tiles for the rollup numbers
  (the open-disputes tile picks up the warning color tokens when the count
  is above zero), then one card per project linking into that project's
  existing full payments/escrow view on `pages/projects/[id].tsx`. This
  screen is deliberately read-only: deposits, milestone approvals, and
  releases still only happen from inside a project, same as before — this
  is a portfolio-wide summary layered on top, not a second place to take
  those actions.
- The sidebar's "Payments" nav item is enabled now that it has a real
  screen to point to.

## AI skills read reviews (this pass)

The original plan for this pass, as offered to the user, was "wire vendor/
supplier reviews into `compare_vendor_quotes` and `assess_listing_risk`."
Once `assess-listing-risk.skill.ts` was actually re-read, that second half
turned out not to fit: `assess_listing_risk` looks at a property *listing*
(verification status, price deviation from comparable listings, missing
documents) and listings have no relationship to a `Vendor` or `Supplier` in
the schema at all — there's nothing for it to read. `boq_to_order` was
substituted instead: it's the materials-marketplace skill that already
looks up products by supplier, and reviews live on suppliers, so it's the
real counterpart to what `compare_vendor_quotes` does for vendors.

- **`compare_vendor_quotes`** (`src/ai/skills/compare-vendor-quotes.skill.ts`)
  used to show a vendor's pre-computed `ratingAverage` with no sense of how
  many reviews it rests on. It now `include`s `Vendor.reviews` (most recent,
  for its comment) and `_count.reviews` alongside the quote query, so every
  line reads e.g. "rated 4.6 across 3 reviews" instead of a bare number — a
  5.0 from one review and a 4.6 from twenty are not the same claim. The
  lowest-priced quote (the one this skill has always sorted to the top) now
  gets an explicit caution when its vendor has zero reviews or a rating
  under 3, since "cheapest" and "needs a second look" can both be true of
  the same quote; otherwise, if that vendor's most recent review has a
  comment, the skill surfaces it directly.
- **`boq_to_order`** (`src/ai/skills/boq-to-order.skill.ts`) similarly
  `include`s `Product.supplier`'s `ratingAverage` and `_count.reviews`, and
  appends the supplier's reputation to each matched scope item's "cheapest
  product" line. If any cheapest pick comes from a supplier with zero
  reviews, the skill adds a caution that price alone isn't enough signal to
  order on.
- Both skills use Prisma's `_count: { select: { reviews: true } }`
  relation-count feature rather than a second query, so the added read is
  one `include`, not an extra round trip.
- Demo data lines up with this: the seed vendor (`Lekki Renovations Co.`,
  `ratingAverage: 4.6`) has a real 5-star review with a comment on the demo
  project, and the seed supplier (`Lagos BuildMart`, `ratingAverage: 4.4`)
  has a real 4-star review — so running these skills against the demo
  project exercises the new reputation text and comment-surfacing with real
  rows, not just the empty-state branches.

## Auth hardening: rate limiting, refresh-token revocation, refunds (this pass)

Three of the gaps the "Auth hardening that's still open" and "Refunds"
bullets below used to flag — picked as the highest-value, lowest-risk slice
of the backlog to close first, ahead of any new module.

- **Rate limiting.** `@nestjs/throttler` is wired up globally in
  `AppModule` (100 req/min/IP baseline for every route) with a much
  tighter `@Throttle({ default: { limit: 5, ttl: 60_000 } })` on
  `POST /auth/login`, `/auth/forgot-password`, and `/auth/reset-password`
  specifically — the three endpoints the "not built yet" list called out
  by name as unlimited-attempt. `/auth/register` and `/auth/refresh` still
  only get the module-wide default, which is already a real change from
  "no limit anywhere."
- **Refresh-token revocation.** Refresh tokens were stateless — valid
  until their own 30-day expiry no matter what, per the comment that used
  to sit at the top of `auth.service.ts`. They're now tracked one row per
  token in a new `RefreshToken` model (`userId`, `jti`, `expiresAt`,
  `revokedAt`), keyed by a `jti` claim embedded in the JWT itself; the JWT
  signature still proves possession, the row is only what makes early
  revocation possible.
  - `POST /auth/refresh` now **rotates**: it revokes the row for the token
    just redeemed before issuing a new pair, so replaying an
    already-refreshed token is rejected even though it hasn't expired.
  - **`POST /auth/logout`** (new) revokes one refresh token on demand —
    unauthenticated, same reasoning as `/refresh`: the refresh token itself
    is the credential being acted on. Same "don't confirm anything to the
    caller" shape as `forgotPassword` — an already-invalid or unrecognized
    token still returns a plain success.
  - `resetPassword` now revokes every outstanding refresh token for that
    user in the same transaction as the password change, so a session
    started before whatever prompted the reset doesn't just keep working
    for up to 30 more days.
  - Still open: this closes early revocation, not the `localStorage`
    access-token-storage tradeoff — see "Web app auth hardening" above and
    the remaining bullet below.
- **Refunds.** `EscrowLedgerEntry.entryType` and `Payment.status` already
  had a `"refund"` state in the schema; there was just no endpoint. New:
  **`POST /projects/:projectId/payments/:paymentId/refund`**
  (`PaymentsService.refundPayment`), gated by `payment:approve` — the same
  permission `releaseMilestone` uses, for the same reason: moving money
  out of escrow deserves more than the plain `payment:write` a deposit
  needs. Only refundable while that deposit's own amount is still sitting
  in the escrow balance; if enough of it has already gone out via a
  milestone release, it fails with the same "insufficient balance" shape
  `releaseMilestone` already uses rather than taking the balance negative.
  Optional `reason` in the request body becomes the ledger entry's note.
  No receipt is issued for a refund (`Receipt` only models paying in or
  paying out, not giving back) — the updated `Payment.status` and the new
  `EscrowLedgerEntry` row are the record of it.

## Document verification (this pass)

Closes the specific gap the "Not built yet" list used to name: "no way for
the web app (or the API) to change a document's `verificationStatus`."
`verify_property_documents` (`src/ai/skills`) already checked a property's
documents against a checklist, but its own comment was explicit that it
never sets `verificationStatus` itself — that was always meant to be a
separate human/admin action, which simply didn't exist yet.

- **New permission `document:verify`**, distinct from `document:write` —
  uploading your own document and approving someone's document are
  different actions, same reasoning `payment:approve` is split from
  `payment:write`. Granted to the `property_owner`, `family_admin`, and
  `company_admin` roles; withheld from `vendor`, `supplier`, and `viewer`
  the same as the rest of the account-admin permission set.
- **`PATCH /documents/:documentId/verify`** (`DocumentsService.verify`) —
  body is `{ status: "verified" | "rejected", notes?: string }`. Not
  nested under `:propertyId`, so it can't lean on `PermissionsGuard`'s
  ABAC convention; filters by the caller's `accountId` directly instead,
  same shape as `PaymentsService.getAccountOverview`. Writes a
  `document_verified`/`document_rejected` `PropertyTimelineEvent` when the
  document is tied to a property, mirroring the existing
  `document_uploaded` event.
- **New `Document.verificationNotes`** column — a reviewer's reason for a
  rejection (or any caveat on a verification), shown back on the document
  row.
- **`pages/documents/index.tsx`** — a document still sitting at
  `not_verified` (or, if something ever sets it, `submitted`) gets
  inline Verify/Reject buttons; Reject expands a small optional-reason
  field first. Once a document is `verified` or `rejected` the controls
  disappear — this endpoint decides once, it doesn't support re-review.
  No client-side permission check: a member without `document:verify`
  sees the buttons and gets the API's 403, same pattern the project
  page's approve/release buttons already use.
- **Still not a neutral reviewer, at the time this was written.** This
  scaffold's RBAC had no reviewer identity outside the account itself —
  an account's own owner/admin could verify a document its own member
  uploaded, which isn't what Module 6's "neutral reviewer" ultimately
  calls for. A much later pass this same session added exactly that
  identity and gave it this exact action — see "Extending the neutral
  reviewer to document verification" further down.

## Two-party dispute resolution (this pass)

Closes the specific gap the "Not built yet" list used to name: "any
account member with `dispute:write` can both raise and resolve a
dispute — no neutral reviewer... or payment hold tied to an open
dispute." Still no independent third-party reviewer (same limitation as
document verification), but the two real, checkable pieces of that gap
are closed.

- **Can't resolve your own dispute.** `PaymentsService` now has a private
  `applyDisputeResolution` that both the owner-side and vendor-side
  resolve routes share: if `dispute.raisedByAccountId` matches the
  account trying to resolve it, that's a 403, not a resolution. On a
  project there are exactly two parties — the owning account and its
  assigned vendor's account — so this is a real check, not a
  self-certification with extra steps. Resolving an already-resolved or
  -rejected dispute is now a 409, not a silent overwrite.
- **Payment hold.** `releaseMilestone` and the new `refundPayment` (see
  "Auth hardening" above) both now check for an `open`/`under_review`
  dispute tied to that milestone/payment before moving money, and refuse
  with a 400 if one exists. Resolving the dispute clears the hold.
- **The vendor side of this didn't actually exist before.** The `vendor`
  role has always had `dispute:read`/`dispute:write`, but every dispute
  route lived under `/projects/:projectId/...`, and `PermissionsGuard`'s
  ABAC check 404s that whole path for any account that isn't the
  project's *owner* — a vendor could never reach it. New
  **`GET/POST /vendors/me/disputes`** and
  **`POST /vendors/me/disputes/:disputeId/resolve`** (`VendorsController`,
  delegating into `PaymentsService` — `VendorsModule` now imports
  `PaymentsModule`) give the vendor side the same access the owner side
  already had, keyed off `ProjectVendorAssignment` instead of the
  `:projectId` ABAC convention, same shape as `submitQuote`/`myQuotes`.
  Without this, the "can't resolve your own dispute" rule above would
  have made every dispute the owner raises permanently unresolvable —
  there'd be no other party who could ever reach the route.
- **`pages/projects/[id].tsx`** — the Resolve button disappears (replaced
  with "You raised this dispute — the other party needs to resolve it")
  when the signed-in account is the one that raised it.
  **`pages/vendors/me.tsx`** gets a new Disputes card: list, raise (with a
  project picker built from the vendor's own quotes/payouts), and resolve,
  all wired to the new vendor-side routes.

## Cart persistence & favorite accuracy (this pass)

Two small, unrelated fixes bundled together since both were the same
"Not built yet" bullet:

- **`GET /listings/:listingId` now reports `isFavorited`.** Before this,
  the listing detail page's Favorite button was optimistic-only — it
  fired the favorite/unfavorite call and toggled local state, but a
  reload always came back to an unfavorited-looking button regardless of
  the real `ListingFavorite` row, because `findOne` had no `accountId` to
  check one against. It does now (`ListingsController.findOne` passes
  `member.accountId` through), and `pages/marketplace/[id].tsx`
  initializes its `favorited` state from the response instead of always
  starting `false`. This was a real correctness bug, not just a missing
  feature — fixed outright, not flagged as a tradeoff.
- **The materials cart survives a refresh, at the time this was written.**
  `pages/marketplace/materials/[id].tsx`'s cart (`productId -> quantity`)
  round-tripped through `localStorage`, keyed per supplier
  (`potg:materials-cart:<supplierId>`), deliberately *not* a server-side
  `Cart` model — a real synced-across-devices cart was judged a
  materially bigger feature than "stop losing it on refresh" at the time.
  A later pass this same session built that bigger feature anyway and
  replaced this `localStorage` version outright, since a real account-
  scoped cart strictly subsumes what `localStorage` did — see "A real
  server-side cart" further down.

## Review editing, replies, and the "me" dashboards (this pass)

Closes two of the three "Reviews are one-shot and unmoderated" gaps —
editing/deleting a review and a reply from the reviewed party. The third
(a real admin/moderator) stays open, same "no neutral third party in this
scaffold's RBAC" limitation as document verification and dispute
resolution.

- **The reviewer can edit or delete their own review.**
  `PATCH`/`DELETE /projects/:projectId/reviews/:reviewId` (vendor
  reviews) and `PATCH`/`DELETE /orders/:orderId/reviews/:reviewId`
  (supplier reviews), gated by the existing `review:write` permission and
  an explicit check that `review.accountId` matches the caller — not just
  "this account owns the project/order," since those aren't quite the
  same claim. Editing the rating recomputes the vendor's/supplier's
  `ratingAverage`; deleting does too.
- **The reviewed vendor/supplier can reply.** New permission
  `review:respond` (separate from `review:write` — replying is the other
  party to the review, not a variant of leaving one), granted to the
  `vendor` and `supplier` roles only. New
  **`POST /vendors/me/reviews/:reviewId/reply`** and
  **`POST /suppliers/me/reviews/:reviewId/reply`** — vendor/supplier-
  initiated, so (same reasoning as `submitQuote`/`raiseDisputeAsVendor`)
  they check `Vendor.accountId`/`Supplier.accountId` themselves rather
  than leaning on `PermissionsGuard`'s ABAC. One reply per review —
  replying again overwrites the last one rather than threading. New
  `VendorReview.response`/`respondedAt` and
  `SupplierReview.response`/`respondedAt` columns; the reply shows
  wherever the review already did (the project page, the order page, and
  both public profile pages).
- **The "me" dashboards now show received reviews.** `GET /vendors/me`
  and `GET /suppliers/me` already `include`d `reviews` — the gap was
  purely that `pages/vendors/me.tsx` and
  `pages/marketplace/materials/me.tsx` never rendered them. Both now have
  a Reviews section with the reply control described above.
- **Unrelated fix found along the way:** `AppShell`/`AuthLayout` built
  `<title>` as `<title>{title} · PropertyOnTheGo</title>` — two JSX
  children (`{title}` and the literal `" · PropertyOnTheGo"`), which
  React warns is invalid (`<title>` can only take a single text node) and
  falls back to client-only rendering to recover. Every page hit this.
  Fixed to a single interpolated string.

## Accepting a status-update draft now posts it (this pass)

Closes the gap the "Not built yet" list called "chaining an AI Accept
into the action it drafted for" — for one skill. The original example
given (a payment-anomaly flag's Accept placing a payment hold) turned out
not to fit once re-examined: `flag_payment_anomaly` reports anomalies
already present in the ledger (a mismatched payout, a duplicate release)
— there's no pending action for an Accept to trigger, nothing to "hold."
`draft_project_status_update` was substituted: its draft is exactly one
paragraph of text with one obvious destination
(`POST /projects/:projectId/updates`), which is exactly the shape "Accept
should perform the real action" needs to mean something.

- **`AiService.decide`** now runs a new private `applyChainedAction`
  before recording the `AiActionApproval` — not after, so if the chained
  action fails, nothing gets marked "decided" and the caller can retry,
  rather than being stuck with a recorded Accept that never took effect.
  Only `decision === "accepted"` chains; `"edited"` deliberately never
  does, since an edit's `notes` describe what the human changed, not the
  corrected text itself — there's nothing safe to write automatically.
- **`draft_project_status_update`'s Accept** calls
  `ProjectsService.addUpdate` with the draft's own text. Its own
  `run()` only ever needed `project:read`, but posting a real update
  needs `project:write` — so accepting the draft checks `project:write`
  again rather than assuming the permission that let someone *see* the
  draft is enough to let them *post* it.
- **Fixed a real gap found while wiring this up:** `AiService.decide` had
  no tenant-isolation check at all — any account with `ai:act` could
  decide on any `AiOutput` by id, regardless of which account's
  `AiRequest` it belonged to. Now 404s (not 403) for a draft that isn't
  the caller's account's own, same "don't confirm it exists" shape as
  every other cross-tenant check in this codebase.
- Every other skill's Accept is unchanged — still records the decision
  only. See "Not built yet" below for which ones and why.

## Real invite/accept flow (this pass)

Closes the gap `AddMemberDto`'s own comment used to flag: `POST
/accounts/:accountId/members` only ever worked for an email that already
had a User on the platform. Building this surfaced a critical,
independently-fixed IDOR in the same endpoint — see below.

- **`AccountInvite`** — same `tokenHash` pattern as `PasswordResetToken`
  (only the hash is stored; the raw token is a one-time bearer
  credential). `AccountsService.addMember` now branches on whether
  `email` already has a `User`: existing → added immediately, exactly as
  before; new → creates (or, on a re-invite, refreshes) a pending invite
  instead of failing. `WEB_APP_URL` isn't set in this scaffold, so the
  link is only ever logged server-side and returned raw in the
  response — same no-real-email-provider tradeoff as
  `forgotPassword`'s `resetToken`.
- **Two ways to accept**, because the recipient might already be
  registered or might not be:
  - **`GET /invites/:token`** (public — no guard at all, since the
    recipient may not be signed in yet) previews what the invite leads
    to, including whether the email already has a `User`, so the client
    knows whether to route to login or register.
  - **`POST /invites/:token/accept`** (`JwtAuthGuard` only, no account
    context — accepting is how you *get* account context for that
    account) — for someone already signed in. Rejects an invite/user
    email mismatch with 403, and an already-accepted/expired one with
    400.
  - **`RegisterDto.inviteToken`** — for someone brand new. Validated
    *before* the `User` is created (a bad token fails registration
    cleanly rather than leaving a signed-up user whose invite silently
    didn't take), then the membership is created in the same call.
    Deliberately not implemented by calling `AccountsService.acceptInvite`
    — that path already has a signed-in user; this one is still creating
    one, so it keeps its own copy of the same validate-then-consume
    logic rather than manufacturing a cross-module dependency for it.
- **New `GET /accounts/:accountId/members`** and **`pages/accounts/
  members.tsx`** — there was no way to even see who was already in an
  account before this pass, let alone invite someone; the page lists
  current members, pending invites, and the invite form (which surfaces
  the raw link for the "no email provider" reason above).
  **`pages/accept-invite.tsx`** is the recipient's landing page; `/login`
  gained a `redirect` query param (validated to an in-app path only) so
  it can send an already-registered recipient there after signing in.
- **Found and fixed separately: a critical IDOR in this same endpoint.**
  `PermissionsGuard` checked that the caller had `account:manage_members`
  *somewhere*, never that it applied to the `:accountId` in the URL —
  since `addMember` used that URL param directly, any account owner
  could add themselves (or anyone, with any role) to *any other account
  on the platform* by putting a different id in the URL. Confirmed
  exploitable against live seed data, then fixed by extending
  `PermissionsGuard`'s existing `:propertyId`/`:projectId` ABAC pattern
  to `:accountId` — see that guard's own comment. Shipped as its own
  commit, independent of the invite work that surfaced it.
- **Revoking or resending a pending invite is no longer missing** — see
  "Revoking and resending pending invites" below. Still not built: any
  invite listing beyond one account's own Members page.

## Revoking and resending pending invites (this pass)

Closes the gap the invite/accept pass above left open: re-inviting the
same email worked as an implicit revoke + resend, but there was no way to
kill a pending invite without replacing it, or resend one without
re-entering its role.

- **`AccountsService.revokeInvite`** sets `AccountInvite.status` to
  `"revoked"` — a value the schema's own `status` comment already
  anticipated (`pending | accepted | revoked`) but nothing wrote until
  now. A revoked invite's token stops resolving immediately: `GET
  /invites/:token` (the same lookup `acceptInvite` and registration use)
  only ever treats `status === "pending"` as live, so a revoked token
  behaves exactly like an expired one — confirmed live, not assumed.
- **`AccountsService.resendInvite`** reuses `addMember`'s token-rotation
  (new raw token, new hash, refreshed 7-day expiry) but keyed off the
  invite's own id instead of its email, so the caller doesn't have to
  remember or re-pick a role. Same "no email provider" tradeoff as every
  other invite/reset flow here — the new raw token is logged server-side
  and returned in the response for the web UI to show directly.
- Both share a new `requirePendingInvite` guard: 404 if the invite id
  doesn't belong to `:accountId` (same cross-tenant shape as everywhere
  else), 400 if it's already accepted or revoked — so a stale double-click
  fails cleanly instead of silently reviving a dead invite.
- **`POST /accounts/:accountId/invites/:inviteId/revoke`** and **`POST
  /accounts/:accountId/invites/:inviteId/resend`**, both gated on
  `account:manage_members` exactly like adding a member — revoking or
  resending someone else's pending invite needs the same permission as
  sending it in the first place, not a new one.
- **`pages/accounts/members.tsx`** gets Resend/Revoke buttons on each
  pending-invite row; Resend shows the fresh link the same way the invite
  form does on first send.
- **Verified live:** invited a fresh email, resend rotated the token (the
  old link started 404ing, the new one resolved via `GET
  /invites/:token`), then revoke removed it from the pending list and its
  latest token also started 404ing — all confirmed by calling the API
  directly, not just reading the UI state.

## Property inspections — Module 8 (this pass)

The first genuinely new module added since the original scaffold, rather
than a gap closed in one already built — chosen because it's fully
self-contained (no external credentials or infrastructure, unlike a real
payment gateway or a search/vector layer) and fits the existing data
model directly: a property already has documents, valuations, and a
timeline; this adds the physical-condition-check most of Module 8's
blueprint description is actually about. Distinct from Module 4's
document verification (this pass's earlier work) — that checks paperwork,
this checks the property itself.

- **`PropertyInspection`** (scheduled → completed or cancelled) and
  **`InspectionFinding`** — same `accountId`-free, `:propertyId`-ABAC
  shape as `PropertyValuation`: nothing here duplicates an ownership
  check, since any route nested under `/properties/:propertyId/...`
  already gets one from `PermissionsGuard`. An inspection can optionally
  reference a `Project` (e.g. a post-renovation inspection) — validated
  to actually belong to the same property, the same cross-reference
  sanity check `VendorsService.createReview` and
  `PaymentsService.raiseDispute` already make for their own optional
  links.
- **`POST /properties/:propertyId/inspections`** schedules one;
  **`.../inspections/:inspectionId/complete`** sets the result, an
  optional summary, and any findings (area/description/severity) in one
  call — findings are never added one at a time, so an inspection's
  findings can't drift out of sync with whether it's still "scheduled".
  **`.../cancel`** is the other terminal state. New `inspection:read`/
  `inspection:write` permission pair, granted like `property:read`/
  `property:write` to the three account-admin roles (`inspection:read`
  only for `viewer`) — kept separate from the property permissions
  themselves since "who can see a property" and "who can schedule an
  inspection on it" are reasonable to grant independently.
- **No separate Inspector identity — but the inspector can now be a
  platform vendor.** `inspectorVendorId` optionally links to `Vendor`
  (see "Linking inspectors and maintenance assignees to real vendor
  accounts" below); `inspectorName` stays freeform text for a
  non-platform inspector or a licensed-inspector role this scaffold
  still doesn't have (Modules 1-24 stop at what's actually implemented
  here; see the "Not built yet" list below).
- **`summarize_inspection_history`** (new AI skill, `property` context)
  — reads a property's full inspection history and drafts what it
  actually says about the property's condition (how many came back
  needs-attention/fail, common major-finding areas), not just a list of
  past visits. Zero extra wiring needed for `AskAiPanel` to pick it up —
  confirmed live: the skill appeared in the panel and ran correctly the
  moment it was registered in `AiModule`, exactly the "write one AiSkill,
  list it once" design Section 5.4 calls for.
- **`pages/properties/[id].tsx`** gets a new Inspections card — schedule
  form, list with status badges, and an inline Complete form (result +
  summary + add findings one at a time before submitting). The existing
  `TIMELINE_ICON` map already had `inspection_completed: "🔍"` defined
  from the original scaffold with nothing that ever produced that event
  — first real confirmation this module was anticipated, not bolted on.
- Verified against the live dev API (schedule, cross-property project
  rejected, list, complete with findings, double-complete rejected,
  cancel, permission-403 for a role without `inspection:write`) and in
  the browser (schedule → complete → timeline event, all through the
  actual form UI) — see "Not built yet" for the two gaps left in it.

## Leases — Module 13 (this pass)

The second genuinely new module added this session. Module 5's property
marketplace (`PropertyListing` with `listingType: "rent"`/`"short_let"`,
plus `ListingInquiry`/`ListingOffer`) gets a property rented out; nothing
tracked what happens *after* that — the ongoing tenancy, its rent
schedule, or payments against it. Deliberately not wired to
Listing/Offer at all: a lease can just as well start from an owner
recording a tenancy that predates this software, same "record what's
true, don't force a specific prior workflow" reasoning
`PropertyValuation.source: "manual"` already uses.

- **`Lease`** (active → ended or terminated) and **`LeaseRentPayment`**
  — same `accountId`-free, `:propertyId`-ABAC shape as `PropertyValuation`
  and `PropertyInspection`. A rent payment here is a plain record that
  rent was paid, same "simulated, not a real payment rail" depth Module
  11's own `Payment` model already has — it doesn't move money or touch
  escrow. A real deployment collecting rent through the platform would
  tie this to `Payment`/`EscrowAccount` instead of standing alone.
- **`POST /properties/:propertyId/leases`** creates one; **`.../leases/
  :leaseId/rent-payments`** records a payment (blocked once the lease
  isn't `"active"` — no rent to record against an ended one);
  **`.../end`** is the other terminal state (`"ended"` or
  `"terminated"`). New `lease:read`/`lease:write` permission pair,
  granted like `inspection:read`/`write` — its own pair rather than
  folded into `property:read`/`write`, same reasoning Module 8 gives.
- **No separate Tenant identity.** `tenantName`/`tenantEmail`/
  `tenantPhone` are freeform fields, not a relation — same scaffold-depth
  tradeoff `PropertyInspection.inspectorName` already documents, for the
  same reason (no licensed-tenant/renter account type exists here).
- **`summarize_lease_status`** (new AI skill, `property` context) —
  reads a property's full lease history and drafts what it actually
  says: active vs. ended leases, total rent collected, and a call-out
  when a lease is ending within 60 days (worth a renewal conversation),
  not just a list of tenancies. Zero extra wiring for `AskAiPanel` to
  pick it up, same as `summarize_inspection_history` before it.
- **`pages/properties/[id].tsx`** gets a new Leases card: create-lease
  form, per-lease status, an inline "record rent payment" form, and an
  "end lease" action. New `lease_started`/`lease_ended` timeline events
  (🔑/📤) — unlike `inspection_completed`, the original `TIMELINE_ICON`
  map had no entry waiting for these, so this module genuinely wasn't
  anticipated the way inspections turned out to be.
- Verified against the live dev API (create, list, record two rent
  payments, run the AI skill, end the lease, rent-after-ended rejected,
  timeline events) and in the browser (create → record payment → end,
  all through the actual form UI, plus the AI skill running from the
  panel).

## Maintenance requests — Module 12 (this pass)

The third genuinely new module added this session, same self-contained
pattern as Property inspections and Leases: no external credentials or
infrastructure, fits directly alongside the property's existing timeline
and (optionally) an active lease. A maintenance request is what a tenant
or owner reports going wrong with a property, tracked from report through
resolution — distinct from Module 8's inspections (a scheduled, proactive
condition check) and from Module 13's leases (the tenancy a request can
optionally be reported against).

- **`MaintenanceRequest`** (open → in_progress → resolved, or cancelled
  from either open state) — same `accountId`-free, `:propertyId`-ABAC
  shape as `PropertyInspection` and `Lease`. Optionally references a
  `Lease`, validated to actually belong to the same property, the same
  cross-reference check `PropertyInspection.projectId` already makes for
  its own optional link.
- **`POST /properties/:propertyId/maintenance-requests`** reports one
  (title, description, `priority`: low/normal/high/urgent, defaulting to
  normal); **`.../start`** moves it to `in_progress` and can set
  `assignedTo`; **`.../resolve`** is a terminal state with optional
  resolution notes and logs a `maintenance_resolved` timeline event
  (🧰); **`.../cancel`** is the other terminal state, allowed from either
  `open` or `in_progress`. New `maintenance:read`/`maintenance:write`
  permission pair, granted like `inspection:read`/`write` and
  `lease:read`/`write` — its own pair, same reasoning Module 8 and Module
  13 both give.
- **No separate Contractor identity — but the assignee can now be a
  platform vendor.** `assignedVendorId` optionally links to `Vendor`,
  reusing Module 9's marketplace directory (see "Linking inspectors and
  maintenance assignees to real vendor accounts" below); `assignedTo`
  stays freeform text for the owner doing it themselves or a contractor
  off-platform, the same "record what's true, no forced workflow"
  tradeoff `Lease.tenantName` still documents.
- **`summarize_maintenance_backlog`** (new AI skill, `property` context)
  — reads a property's full maintenance history and drafts what it
  actually says: how many requests are open/in-progress out of the
  total, how many are urgent, and a call-out for anything open 7+ days
  (worth following up), not just a list of tickets. Zero extra wiring
  for `AskAiPanel` to pick it up, same as `summarize_inspection_history`
  and `summarize_lease_status` before it.
- **`pages/properties/[id].tsx`** gets a new Maintenance card: report
  form (with an optional lease dropdown), per-request status, and
  inline Start/Resolve/Cancel actions. New `maintenance_resolved`
  timeline icon (🧰) — like Leases and unlike Inspections, the original
  `TIMELINE_ICON` map had no entry waiting for this one.
- Verified against the live dev API (report, cross-property lease
  rejected, list, get one, start, double-start rejected, resolve,
  cancel-after-resolve rejected, cancel from open, tenant isolation via
  a nonexistent property returning 404, the AI skill) and in the browser
  (report → start → resolve, all through the actual form UI). Browser
  testing caught a real bug in the first pass: `onStart`/`onCancel` only
  reset their `busy` flag in the `catch` branch, so after successfully
  starting a request the Resolve/Cancel buttons stayed silently disabled
  forever (the API call had already succeeded — only the UI was stuck).
  Fixed by resetting `busy` in a `finally` block, matching the pattern
  `onResolve` already used correctly.

## Vendor trust score — Module 6 slice (this pass)

Not a new module data-wise — reuses `Vendor.verificationStatus`,
`Vendor.ratingAverage`/`VendorReview`, `ProjectVendorAssignment`, and
`Dispute`, all of which already existed — but the first thing in this
scaffold that actually computes and surfaces a *trust score*, the piece
of Module 6 ("a neutral reviewer, risk flags, trust scores") that was
still completely missing. `assess_listing_risk` already covered risk
flags for listings; this is its counterpart for the vendor marketplace.

- **`apps/api/src/vendors/trust-score.ts`** — a new shared module (not a
  new model or migration) exporting the deterministic formula: start at
  50, `+20` verified / `+5` pending, `+(ratingAverage - 3) * 10`, `+3` per
  completed project (capped at `+15`), `-8` per dispute on a project this
  vendor was assigned to (capped at `-30`), clamped to `[0, 100]`. Banded
  into excellent/good/fair/caution for display. Computed on read, not
  stored — too many separate flows touch its inputs (review CRUD,
  verification status, project completion, dispute resolution) to keep a
  denormalized column in sync the way `Vendor.ratingAverage`'s narrower
  recompute hook can.
- **`GET /vendors/:vendorId` and `GET /vendors/me`** now attach a
  `trustScore` object (`{ score, band, factors }`) to the response — not
  `GET /vendors` (the marketplace browse list), where computing it for
  every row would mean per-vendor extra queries on a list that's already
  sorted by `ratingAverage` for exactly this purpose.
- **`explain_vendor_trust_score`** (new AI skill, `vendor` context,
  public/buyer-facing like `assess_listing_risk` — not filtered by
  `ctx.accountId`) — imports the same `trust-score.ts` formula so it
  never drifts from what the REST endpoint returns, and has the LLM
  phrase one neutral paragraph over the real factor breakdown. Needed
  its own `AskAiPanel` wiring on the vendor detail page — unlike Modules
  8/12/13's property-context skills, no `AskAiPanel` existed there yet at
  all.
- **`pages/vendors/[id].tsx`** gets a trust score badge (score/100, band,
  and the factor summary) on the vendor header card, plus the new AI
  panel. Verified against the live dev API (`GET /vendors/:id` and
  `/vendors/me` both return the same score, the AI skill draft matches
  the REST numbers exactly) and in the browser (badge renders, "Explain
  vendor trust score" appears in the panel with zero extra wiring and
  its draft matches the page).
- **Still not what Module 6's "neutral reviewer" calls for at the time
  this was written.** This is the platform's own arithmetic over data
  the vendor's own marketplace activity already produced — reviews come
  from the accounts that hired it, not an independent auditor — and at
  this point in the session `verificationStatus` still had no endpoint
  at all. A later pass this same session added one, gated to a real
  separate role — see "A real neutral reviewer for vendor/supplier
  verification" further down.

## Supplier trust score (this pass)

The materials-marketplace counterpart to the vendor trust score above,
added right after it in the same pass once the vendor version proved out
— same formula shape, same "computed on read, shared with an AI skill"
structure, just swapped for the signals a `Supplier` actually has.

- **`apps/api/src/materials/trust-score.ts`** — same shared-module
  pattern as `vendors/trust-score.ts`: start at 50, `+20` verified / `+5`
  pending, `+(ratingAverage - 3) * 10`, then the two signals that differ
  from the vendor version — suppliers have no `Dispute` model, so
  delivered orders (`+2` each, capped at `+15`) stand in for completed
  projects as the positive track-record signal, and cancelled orders
  (`-8` each, capped at `-30`) stand in for disputes as the negative one
  (the closest supplier-side analogue to "something went wrong with this
  transaction"). Same `[0, 100]` clamp and excellent/good/fair/caution
  bands.
- **`GET /suppliers/:supplierId` and `GET /suppliers/me`** now attach the
  same `trustScore` shape the vendor endpoints do.
- **`explain_supplier_trust_score`** (new AI skill, `supplier` context) —
  same public/buyer-facing shape as `explain_vendor_trust_score`, reusing
  `materials/trust-score.ts` so it can't drift from the REST response.
- **`pages/marketplace/materials/[id].tsx`** (the supplier detail page —
  despite the URL, this is a `Supplier` profile, the materials-market
  counterpart to `pages/vendors/[id].tsx`) gets the same trust score
  badge and its first `AskAiPanel`.
- Verified the same way as the vendor version: live API (`GET /suppliers/
  :id` and the AI skill return matching numbers — 90/100 "excellent" for
  the seeded supplier, hand-checked against the formula) and in the
  browser (badge renders, "Explain supplier trust score" appears with
  zero extra wiring, draft matches the page).
- **Same limitations as the vendor score at the time this was written**
  — the score itself still isn't an independent audit, and at this point
  `Supplier.verificationStatus` still had no endpoint either. See "A real
  neutral reviewer for vendor/supplier verification" further down for
  what a later pass this session added.

## Edit endpoints for Inspections, Leases, and Maintenance requests (this pass)

After the two marketplace trust scores, back to closing self-flagged
gaps: each of this session's three property-nested modules could be
created and moved through its own lifecycle, but never edited — a typo
in an inspection's inspector name, a lease's rent changing mid-tenancy,
or a maintenance request's priority needing to go up, all meant deleting
the record and starting over (which none of these modules even support —
there's no delete endpoint either). One `PATCH` route per module, each
gated to the same lifecycle stage its own create/action endpoints
already assume:

- **`PATCH /properties/:propertyId/inspections/:inspectionId`**
  (`inspection:write`) — only while still `"scheduled"`, the same gate
  `completeInspection`/`cancelInspection` already use. Can change type,
  date, inspector name, or the linked project (re-validated to belong to
  the same property, same check `scheduleInspection` makes); an empty
  `projectId` clears an existing link.
- **`PATCH /properties/:propertyId/leases/:leaseId`** (`lease:write`) —
  only while still `"active"`. Can change tenant contact fields, rent
  amount/frequency, deposit, start date, or end date; an empty `endDate`
  clears one. Notably does *not* touch existing `LeaseRentPayment`
  records if the currency or amount changes — those stay historical.
- **`PATCH /properties/:propertyId/maintenance-requests/:requestId`**
  (`maintenance:write`) — only while `"open"` or `"in_progress"`, the
  same `isOpen` gate `resolveMaintenanceRequest`/`cancelMaintenanceRequest`
  share. Title, description, and priority only — not `leaseId` or
  `assignedTo`, since re-pointing which lease a report is against after
  the fact felt like a different action than fixing a typo, not an edit.
- **Web UI**: each of the three list rows (`InspectionRow`, `LeaseRow`,
  `MaintenanceRequestRow` in `pages/properties/[id].tsx`) gets an inline
  "Edit" button next to its existing actions, opening a form pre-filled
  from the current record — same inline-toggle pattern the existing
  Complete/Resolve/Record-payment forms already use.
- Verified against the live dev API (edit while eligible, rejected with
  a clear message once the record leaves that stage — cancelled
  inspection, ended lease, resolved maintenance request all correctly
  refused) and in the browser for all three (pre-filled edit form saves
  and the row reflects the new values immediately).

## Overdue-rent detection for Leases (this pass)

The last piece of the Leases gap this session had already named:
`summarize_lease_status` could say a lease was ending soon, but never
whether rent itself had gone unpaid — there's no real payment/reminder
system behind `LeaseRentPayment` (it's a manual record, same as it was
when the module was first built), so this is a deterministic read of
what's already on file, not a payment tracker.

- **Definition**: a lease "looks overdue" when more than one rent period
  (7/30/365 days for weekly/monthly/annually — `monthly` is a 30-day
  approximation, same order-of-magnitude simplification `Document`'s
  30-day "expiring soon" window already uses) has passed since the
  latest recorded payment's `periodEnd`, or since the lease's own
  `startDate` if no payment has ever been recorded.
- **`summarize_lease_status`** now computes this per active lease,
  mentions the count in its opening line, tags each overdue lease inline
  (`— rent looks ~N day(s) overdue`), and sets `warn: true` whenever any
  lease is overdue or ending soon (previously only the latter).
- **`pages/properties/[id].tsx`**: `isRentOverdue()` runs the identical
  check client-side so a "Rent Overdue" badge shows on the lease row
  directly, without opening the AI panel — the same pairing `isExpiring()`
  gives Documents' "expiring soon" badge. Two independent
  implementations of the same simple formula, not a shared import, since
  one runs in the AI skill's Prisma context and the other in the browser
  against already-fetched JSON.
- Verified against the live dev API (a lease with old `startDate` and no
  payments correctly flagged with the right day count and `warn: true`;
  a lease that started today correctly not flagged) and in the browser
  (the overdue lease shows the red badge, the current one doesn't).

## A real neutral reviewer for vendor/supplier verification (Module 6)

Every earlier mention of Module 6 in this README carried the same
caveat: verification and trust scores are the platform's own arithmetic,
or an account's own admin verifying its own content — never an
independent party. This pass closes that gap for exactly two fields,
`Vendor.verificationStatus` and `Supplier.verificationStatus`, which
until now had no endpoint at all (not even a self-serve one). The design
question was whether a "reviewer" role granted to the vendor/supplier's
own account would even count as neutral — it wouldn't, a business
verifying itself defeats the point — so this had to be a genuinely
separate account with a role no vendor or supplier account ever holds.

- **New `vendor:verify`/`supplier:verify` permissions** and a new
  **`platform_reviewer` role** (`seed.ts`) — deliberately minimal
  (`vendor:read`, `vendor:verify`, `supplier:read`, `supplier:verify`
  only, not even `ai:act`), and deliberately *never* added to the
  `vendor`/`supplier`/owner roles above it, the same way `RolePermission`
  already keeps `payment:approve` off the `vendor` role so a vendor can't
  release its own escrow. That omission — not an account-type flag — is
  what actually makes this neutral.
- **`PATCH /vendors/:vendorId/verification`** and **`PATCH /suppliers/
  :supplierId/verification`** — no `:accountId`/`:propertyId` param for
  `PermissionsGuard`'s ABAC to key on, so (like the existing `GET .../:id`
  routes) these reach any vendor/supplier on the platform once the
  caller's role has the permission; there's nothing to reach if it
  doesn't. Status is one of `not_verified`/`pending`/`verified`, same set
  the field's own default comment already listed.
- **Demo data**: `seed.ts` gives the same demo owner a *third* account
  membership — `PropertyOnTheGo Trust & Safety` (`COMPANY` accountType,
  chosen only to avoid an `AccountType` enum migration for what's really
  a role distinction; the account has no properties, projects, or
  anything else) — with the `platform_reviewer` role. Same "one user,
  several accounts" pattern the demo vendor/supplier accounts already
  established.
- **Web UI**: a `PlatformReviewPanel` on both `pages/vendors/[id].tsx` and
  `pages/marketplace/materials/[id].tsx`, rendered only when
  `auth.currentAccount?.role === "platform_reviewer"` — unlike the
  Documents page's Verify/Reject controls (which skip the client-side
  check on purpose, see "Document verification" above), here the panel's
  *visibility* doing the gating is deliberate: showing self-verification
  controls to every vendor/supplier visiting their own page would be
  actively misleading about what the feature is for, not just redundant.
- Verified against the live dev API: the platform account can move a
  vendor/supplier through all three statuses; the vendor's own account
  gets 403 `Missing permission(s): vendor:verify` attempting the same
  call on itself; an unrelated property-owner account gets the identical
  403; an invalid status value gets a 400. In the browser: switching to
  the seeded platform account surfaces the panel and live-updates the
  trust score underneath it as status changes (verified → pending
  visibly dropped the same vendor's score from 53 to 38, "Fair" to
  "Caution"), and switching back to the demo owner's own account hides
  the panel entirely — the "Request a quote" panel takes its place.
- **Still not the full Module 6 neutral-reviewer workflow.** This closes
  it for exactly the two fields that had no verification path at all.
  Document verification (any account's own admin) and dispute resolution
  (the project's owner or its assigned vendor) remain what they were —
  seeded data, not moved onto the new role, since a document/dispute
  reviewer would need to review specific content, not just flip a status,
  which is a larger workflow than this pass's scope.

## Tool/equipment rental booking (Module 10)

Closes the other named gap in Module 10's "Not built yet" bullet: `src/
materials` went straight from browsing to a line-item `Order`, with no
rental calendar for tools/equipment at all. A rental is a different
lifecycle from a purchase — requested → confirmed → returned, over a
date range, against shared stock — not another `OrderItem`.

- **`Product.isRentable`/`rentalPricePerDay`** (new columns) — a product
  is either sold, rentable, or both; the flag and its price only mean
  something together, same "flag plus a field that's only meaningful
  when the flag is set" shape `EscrowAccount`/`Payment` pairs already
  use elsewhere. `CreateProductDto`/`UpdateProductDto` both take them.
- **`RentalBooking`** (new model: `requested → confirmed → returned`, or
  `cancelled` from either open state) — shares a product's regular
  `stockQuantity`, there's no separate rental-only count. Availability is
  a standard interval-overlap check: the sum of `quantity` on
  `requested`/`confirmed` bookings whose date range overlaps the new
  request must leave enough stock for it.
- **`POST /products/:productId/rental-bookings`** (`rental:write`) — 400s
  if the product isn't rentable, if `endDate` isn't after `startDate`, or
  if the overlap check leaves too little stock (the error names exactly
  how many units *are* available for those dates). `totalPrice` is
  computed server-side (`rentalPricePerDay × days × quantity`), never
  trusted from the client. **`GET /rental-bookings/me`** (renter) and
  **`GET /suppliers/me/rental-bookings`** (supplier) are the only list
  routes — deliberately no `GET /products/:id/rental-bookings`, which
  would leak other renters' booking details to anyone browsing the
  catalog. **`.../confirm`**, **`.../return`**, **`.../cancel`**
  (`rental:write`) — confirm/return are supplier-only (via the same
  `requireOwnSupplier` check `createProduct` uses); cancel accepts either
  the renter or the supplier, the same "either party" shape
  `RentalBooking.status` needed since a supplier might need to back out
  of a request too.
- **New `rental:read`/`rental:write` permission pair** — its own pair,
  same reasoning `inspection:read`/`write` and `lease:read`/`write` both
  give (a distinct action, not folded into `order:*`). Granted to the
  three owner-side roles and `vendor` (the renter side — a contractor
  renting equipment for a job) and `supplier` (the fulfillment side);
  `viewer` gets `rental:read` only.
- **`summarize_rental_bookings`** (new AI skill, `supplier` context) —
  counts awaiting confirmation and overdue-for-return (confirmed, past
  `endDate`, never marked returned) bookings, same deterministic-compute-
  plus-LLM-phrasing split every other skill this session uses.
- **Web UI**: a "Rent this" toggle next to any rentable product's cart
  quantity field (`pages/marketplace/materials/[id].tsx`) opens an inline
  date-range request form; a new `pages/marketplace/materials/rentals.tsx`
  ("My rentals", linked from the marketplace header) lists a renter's own
  bookings with a cancel action; the supplier dashboard
  (`pages/marketplace/materials/me.tsx`) gets a rental toggle on
  create/edit product forms and a new "Rental bookings" card with
  confirm/return/cancel actions.
- Verified against the live dev API: a rentable product's booking
  succeeds with the right computed price; a second overlapping booking
  that would exceed stock is rejected naming the real remaining count; a
  non-overlapping booking on the same product succeeds; booking a
  non-rentable product and an inverted date range both 400; the renter
  attempting to confirm their own booking fails (no supplier profile);
  double-confirm, return-before-confirm, and double-cancel are all
  rejected; the AI skill's overdue count matches a booking confirmed with
  a past `endDate`. In the browser: requesting a rental from the catalog,
  cancelling it from "My rentals", and confirming/marking-returned from
  the supplier dashboard all worked end to end, with badges and card
  contents matching the API state at every step.

## A real server-side cart (this pass)

The last named half of the materials-marketplace gap this session
inherited: "there's still no `Cart`/`CartItem` model, so it doesn't
follow the account across devices or reconcile against a product's
price/stock changing while it sits in the cart." Rental booking closed
the other half. This replaces the supplier detail page's `localStorage`
cart outright — a real account-scoped cart strictly subsumes what
`localStorage` did (survive a refresh) plus what it never could (follow
the account across devices), so there was no reason to keep both.

- **`CartItem`** (new model) — one row per `(accountId, productId)`,
  `@@unique` enforced so `upsertCartItem` is a straight upsert, not a
  find-then-branch. Quantity `0` deletes the row rather than storing a
  meaningless zero line.
- **`GET /cart`** (`order:read`) lists every item across every supplier
  for the caller's account. **`POST /cart/items`** and **`DELETE /cart/
  items/:productId`** (`order:write`) upsert or remove one line.
  **`POST /cart/checkout`** (`order:write`, body `{ supplierId,
  projectId?, deliveryAddress? }`) reads the account's cart items for
  *that* supplier, builds the same `{ productId, quantity }[]` shape
  `CreateOrderDto` already takes, and calls `createOrder` directly —
  price computation, stock decrement, and the "does every product belong
  to this supplier" check all stay in the one place that already had
  them, never duplicated. Only the checked-out supplier's items are
  cleared from the cart afterward; items from other suppliers are
  untouched, matching how an `Order` has always been per-supplier.
  Deliberately reuses the existing `order:read`/`order:write`
  permissions rather than adding a `cart:*` pair — a cart is a staging
  area for an order, not a distinct action worth its own permission the
  way inspections/leases/maintenance/rentals each got.
- **`pages/marketplace/materials/[id].tsx`**: the `localStorage`
  read/write `useEffect` pair is gone. The quantity inputs now call
  `GET /cart` on load (filtered client-side to this supplier's items —
  the account's cart can span suppliers, this page only shows one) and
  `POST /cart/items` on every change; `OrderWidget`'s submit calls
  `POST /cart/checkout` instead of building an `items` array from local
  state and posting straight to `/orders`.
- Verified against the live dev API (add/update/zero-clears a line,
  checkout with no matching items 400s, checkout computes the right
  total and decrements stock, the cart is empty afterward) and in the
  browser: added a quantity, reloaded the page — the "4" survived the
  reload from the server, not `localStorage` — then placed the order and
  landed on its detail page showing the correct line and total.

## Extending the neutral reviewer to dispute arbitration (Module 6)

The last of this session's Module 6 passes: "dispute resolution is still
not a neutral-reviewer workflow" was the other gap the vendor/supplier
verification work had left open. Same shape as that pass — a new
permission granted only to `platform_reviewer`, never to a role that can
raise a dispute in the first place, so the reviewer is neutral by
construction, not by an extra runtime check.

- **New `dispute:arbitrate` permission**, granted only to
  `platform_reviewer`. Because that role never gets `dispute:write` (see
  `seed.ts`), it structurally can never be the account that raised the
  dispute it's arbitrating — `arbitrateDispute` skips
  `applyDisputeResolution`'s `raisedByAccountId` check entirely rather
  than reusing it, since that check exists to stop the *other* party
  (owner or vendor) from self-resolving, a different risk than the one
  here.
- **`GET /payments/disputes/open`** lists every `open`/`under_review`
  dispute platform-wide with its project's title, regardless of which
  account raised it or owns the project — no `:projectId` param for
  `PermissionsGuard`'s ABAC to key on, same reasoning the vendor/supplier
  verification routes already use. **`PATCH /payments/disputes/
  :disputeId/arbitrate`** records the decision (`resolved`/`rejected`,
  optional notes), 409s if the dispute is already resolved.
  Both live on `AccountPaymentsController` (the already-unscoped
  `/payments` controller the account-wide overview uses), not the
  `:projectId`-nested one.
- **Web UI**: `pages/payments/index.tsx` branches on
  `auth.currentAccount?.role === "platform_reviewer"` — that account has
  no `payment:read` and owns no projects, so the normal overview would
  just 403 or show "no projects yet". Instead it renders a
  `DisputeArbitrationQueue`: every open dispute with a resolve/reject
  action and an optional notes field.
- Verified against the live dev API (a fresh dispute appears in the
  open queue with its project's title; the raising account still gets
  403 attempting the normal resolve route; the reviewer's arbitration
  succeeds; arbitrating twice 409s; the queue is empty again after) and
  in the browser: switching to the seeded platform account turns
  `/payments` into the arbitration queue, resolving a dispute there
  empties the queue, and switching back to the demo owner's own account
  shows `Open disputes: 0` on the normal overview — the decision
  propagated to the exact page a real dispute lives on.

## An evidence-request step for dispute arbitration (Module 6)

Closes the gap every Module 6 pass above kept flagging as still open:
"the reviewer can't request more evidence before deciding." `Dispute.
status`'s own comment already anticipated `under_review` (`open |
under_review | resolved | rejected`) and every query that treats a
dispute as still-holding-its-milestone already filtered `{ in: ['open',
'under_review'] }` — nothing ever actually *wrote* that value. It turned
out to be one status this scaffold had already built the read side of
and never finished the write side.

- **New `ArbitrateDisputeDto`**, a superset of `ResolveDisputeDto`
  (`resolved | rejected`) adding `under_review` — deliberately its own
  class rather than widening `ResolveDisputeDto` itself, so the two-party
  `resolveDispute`/`resolveDisputeAsVendor` paths still can't set it; only
  `arbitrateDispute` (`dispute:arbitrate`, `platform_reviewer` only) can.
  Requesting evidence isn't a decision either party should be able to
  hand itself.
- **`PaymentsService.arbitrateDispute`** only sets `resolvedAt` for the
  two terminal statuses — `under_review` leaves it `null`, so the dispute
  stays out of "resolved" anywhere that matters and the same method can
  be called again later to make the actual call, no separate "resume"
  endpoint needed. The existing status guard (`already resolved/rejected
  → 409`) already let `under_review` pass through unchanged, since it was
  never resolved/rejected to begin with — the whole write path needed no
  other change once the value could actually reach it.
- **`resolutionNotes` doubles as the evidence request's own text** — no
  new field. What the arbitrator writes when setting `under_review`
  ("what's needed") is stored the same place, and shown the same way, as
  what they'd write when finally resolving it.
- **Web UI**: `ArbitrationRow` (`pages/payments/index.tsx`) gets a third
  button, "Request more evidence", next to Resolve/Reject — and, found by
  actually clicking through this live: `onDecide` never reset `busy` to
  `null` on success, which was invisible before (a resolved/rejected
  dispute drops out of the reloaded queue, so the button unmounts with
  it) but left a dispute set `under_review` — which deliberately stays in
  the queue — stuck showing "…" forever. Fixed by resetting `busy` in a
  `finally` block.
- **Verified live end-to-end**: raised a fresh dispute, set it
  `under_review` with a note as the platform reviewer, confirmed the note
  rendered back as "What's needed: …" and the status badge read "under
  review", reloaded the page and confirmed the row wasn't stuck busy
  (the fix above), then resolved it from that same `under_review` state
  and watched it drop out of the queue.
- **Scoped to disputes only, for now.** Vendor/supplier verification and
  document verification still only ever decide immediately, same
  one-shot shape as before — extending this same `under_review`-style
  step to `Vendor`/`Supplier.verificationStatus` and `Document.
  verificationStatus` (both already have a spare state in their own
  status comments: `pending` and `submitted` respectively, never
  currently set by any reviewer action either) is the natural next slice
  if this gets picked up again, not something this pass touched.

## Extending the neutral reviewer to document verification (Module 6)

The last of the three gaps "A real neutral reviewer for vendor/supplier
verification" originally left open: document verification was still an
account's own admin, the same "not actually neutral" limitation
vendor/supplier verification and dispute resolution both used to carry.
Same shape as those two passes, applied to `Document`.

- **New `document:arbitrate` permission**, granted only to
  `platform_reviewer` — that role never gets `document:write` (see
  `seed.ts`), so it never uploads, let alone owns, a document it might
  later verify. Structural neutrality again, not a runtime check.
- **`DocumentsService.verify`** (the existing account-scoped path) and
  the new **`arbitrateVerify`** now share one private `applyVerification`
  helper for the actual status update and timeline-event write —
  `verify` still filters `{ id, accountId }` before calling it,
  `arbitrateVerify` looks the document up by `id` alone. Same
  extract-the-shared-part-not-the-check shape
  `PaymentsService.applyDisputeResolution` already established.
- **`GET /documents/pending`** lists every document platform-wide whose
  `verificationStatus` isn't `verified`/`rejected` yet (so `not_verified`
  and the never-actually-used `submitted` value both surface), with the
  uploading account's name and the property's name for context — a
  reviewer arbitrating blind wouldn't be reviewing anything. **`PATCH
  /documents/:documentId/arbitrate`** records the decision. No
  `:propertyId`/`:accountId` param for `PermissionsGuard`'s ABAC to key
  on, same reasoning every other neutral-reviewer route this session
  added already uses.
- **Web UI**: `pages/documents/index.tsx` branches on
  `auth.currentAccount?.role === "platform_reviewer"` — that account has
  no `document:read`, so the normal per-account list would just 403.
  Instead it renders a `DocumentArbitrationQueue`, structurally the same
  Verify/Reject-with-optional-notes shape the existing
  `VerifyDocumentControls` already used, just reading from and posting to
  the arbitration routes instead.
- Verified against the live dev API (a freshly uploaded document appears
  in the pending queue with the uploading account's and property's
  names; an unrelated account still gets 403 on the normal `/verify`
  route; the reviewer's arbitration succeeds and writes the same
  `document_verified` timeline event `verify` itself would have; the
  decision is visible on the uploading account's own document list
  immediately after) and in the browser: switching to the platform
  account turns `/documents` into the arbitration queue, verifying the
  pending document there empties the queue.
- **Closed Module 6's neutral-reviewer scope as it stood at the time** —
  see "Review moderation — flagging and the neutral reviewer (Module 6)"
  further down for a fourth field (review `moderationStatus`) this same
  role picked up later in this session, and "An evidence-request step for
  document verification" just below for the evidence-request gap this
  bullet used to describe as fully open. All four fields that had either
  no verification path (`Vendor`/`Supplier.verificationStatus`) or only a
  self-service one (`Document.verificationStatus`, `Dispute.status`,
  review `moderationStatus`) now have a genuinely separate reviewer path;
  the score/self-serve paths still exist alongside the neutral ones
  rather than being replaced by them — see the "Not built yet" bullets
  below for exactly what that leaves on the table.

## An evidence-request step for document verification (Module 6)

The other half of the evidence-request gap "An evidence-request step for
dispute arbitration" above closed for disputes — same reasoning applies
here almost verbatim: `Document.verificationStatus`'s own comment already
anticipated `submitted` (`not_verified | submitted | verified |
rejected`), and `findPendingForArbitration` already filtered `notIn:
['verified', 'rejected']`, so `submitted` was already going to show up in
the queue the moment anything ever wrote it. Nothing did, until now.

- **New `ArbitrateDocumentVerificationDto`**, a superset of
  `UpdateDocumentVerificationDto` (`verified | rejected`) adding
  `submitted` — its own class, not a widened one, for the same reason
  `ArbitrateDisputeDto` is separate from `ResolveDisputeDto`: only
  `arbitrateVerify` (`document:arbitrate`, `platform_reviewer` only)
  accepts it, so neither the uploading account nor its own admin's
  self-service `verify` can send a document back to itself.
  `applyVerification` (shared by both paths) picks the right
  `PropertyTimelineEvent` type for all three outcomes now instead of a
  `verified`-or-`rejected` ternary that would have mislabeled a
  `submitted` update as a rejection.
- **`verificationNotes` doubles as the evidence request's own text**, the
  same reuse `resolutionNotes` got for disputes — what the reviewer
  writes when sending a document back is stored and shown the same place
  as the eventual verified/rejected reason.
- **No document-revision model exists**, so "more evidence" today means
  whatever the account does outside this specific flow (re-upload as a
  new `Document`, update the file at the same `fileUrl`) — there's no
  structured way to attach a resubmission to the original request, unlike
  the dispute version of this same gap — see "Submitting evidence on a
  dispute" further down for the `DisputeEvidence` channel that closed it
  there; nothing analogous exists for documents yet.
- **Web UI**: `DocumentArbitrationRow` (`pages/documents/index.tsx`)
  replaces its old `rejecting: boolean` with a `pendingAction: "reject" |
  "evidence" | null`, so "Reject" and the new "Request more evidence"
  button share one notes-input-then-confirm flow ("Verify" stays the
  one-click action it always was) — plus the same `finally`-block busy-
  reset fix the dispute row needed, applied here pre-emptively since the
  identical bug (never resetting `busy` on success, invisible for a
  terminal decision that drops its own row, not invisible for one that
  deliberately stays) would have hit this row too the first time anyone
  used the new button.
- **Verified live end-to-end**: uploaded a fresh document, switched to
  the platform reviewer, sent it back with a note ("Please upload a
  clearer scan…"), confirmed the status read `submitted` and the note
  rendered as "What's needed: …" both in the reviewer's queue and — via
  the account's own `GET /documents` — on the uploading account's own
  view, reloaded to confirm the row wasn't stuck busy, then verified it
  from that `submitted` state and watched it clear the queue.

## Giving vendor/supplier "pending" verification actual meaning (Module 6)

The narrower gap "The neutral reviewer's decisions are one-shot" kept
flagging: `Vendor`/`Supplier.verificationStatus`'s `pending` was already
freely settable by `platform_reviewer` (unlike `Dispute.under_review` and
`Document.submitted`, which had no write path at all before the two
passes above) — but nothing gave it "awaiting evidence" semantics or a
paper trail, so setting it was indistinguishable from any other one-shot
decision. Unlike disputes and documents, `Vendor`/`Supplier` had no spare
notes field to reuse.

- **New `verificationNotes String?` on both `Vendor` and `Supplier`**
  (migration `20260903000000_add_verification_notes`) — the one piece
  this pass actually needed a schema change for, since (unlike
  `Dispute.resolutionNotes` and `Document.verificationNotes`) there was
  nothing to repurpose.
- **`SetVendorVerificationDto`/`SetSupplierVerificationDto`** gain an
  optional `notes` field alongside `status` — deliberately not a
  separate arbitrator-only DTO like `ArbitrateDisputeDto`/
  `ArbitrateDocumentVerificationDto`, because `pending` was already
  reachable by the same one action every other status is; there was no
  narrower write-path gap to close here, only a missing field.
  `VendorsService.setVerificationStatus`/`MaterialsService.
  setSupplierVerificationStatus` write it alongside `verificationStatus`
  on every call (`null` when omitted, clearing a stale note once a final
  decision is made).
- **Web UI**: `PlatformReviewPanel` (on both the vendor and supplier
  detail pages) gains a notes textarea seeded from the profile's current
  note, and its status buttons are no longer disabled for the
  already-active status — clicking "pending" again now works, which
  matters once notes carry meaning: a reviewer can update what's needed
  without changing the status at all. The vendor/supplier's own `/me`
  dashboard shows the note under the status badge ("Platform reviewer's
  note: …") the same way `vendors/me.tsx` already shows a review's
  moderator note.
- **Verified live**: set a vendor to `pending` with a note as the
  platform reviewer, confirmed both the status and note via a direct API
  call, confirmed the vendor's own `/vendors/me` view (a different
  account) showed the identical note, then repeated the same check for a
  supplier before restoring both back to `verified` with the note
  cleared.
- **Closes Module 6's evidence-request gap as far as this scaffold's
  schema allows.** Three of four `platform_reviewer` actions (dispute
  arbitration, document verification, vendor/supplier verification) now
  carry real reviewer context instead of a bare status flip; only review
  `moderationStatus` doesn't fit the same pattern — "flagged" already
  plays a similar role there, raised by the reviewed party rather than
  the reviewer, so there's no analogous gap to close.

## Review moderation — flagging and the neutral reviewer (Module 6)

Closes the "no report/flag mechanism" half of the "Reviews still have no
moderation" gap, and extends `platform_reviewer` to a fourth field —
same structural-neutrality shape as vendor/supplier verification, dispute
arbitration, and document verification above, applied to `VendorReview`/
`SupplierReview`.

- **`VendorReview`/`SupplierReview` both gain `moderationStatus`**
  (`published | flagged | hidden`, mirroring `Document.
  verificationStatus`'s shape) plus `flagReason`/`flaggedAt` (set by the
  reviewed party) and `moderationNotes`/`moderatedAt` (set by the
  moderator). Migration `20260902100000_add_review_moderation`.
- **New `review:flag` permission**, granted to the `vendor`/`supplier`
  roles alongside their existing `review:respond` — flagging is still
  just the other party to the review acting on their own profile, the
  same ownership check `replyToReview` already used.
  **`POST /vendors/me/reviews/:reviewId/flag`** and **`POST /suppliers/
  me/reviews/:reviewId/flag`** (`VendorsService.flagReview`,
  `MaterialsService.flagOrderReview`) mark a review `"flagged"` with a
  reason — flagging doesn't hide anything by itself, it only surfaces the
  review to the moderation queue.
- **New `review:moderate` permission, granted only to
  `platform_reviewer`** — that role never gets `review:write`/`respond`/
  `flag` (see `seed.ts`), so it can never be the reviewer, the reviewed
  party, or whoever flagged a review it goes on to moderate. **`GET
  /vendors/reviews/flagged`** and **`GET /suppliers/reviews/flagged`**
  (`findFlaggedReviews`/`findFlaggedOrderReviews`) list every flagged
  review platform-wide, no `:vendorId`/`:supplierId`/`:accountId` param
  for `PermissionsGuard`'s ABAC to key on — same shape every other
  neutral-reviewer route already uses. **`PATCH /vendors/reviews/
  :reviewId/moderate`** / **`.../suppliers/reviews/:reviewId/moderate`**
  record the decision: `"hidden"` (excluded from the public profile and
  no longer counted in `ratingAverage`) or `"published"` (dismiss the
  flag, or — found and fixed during live testing below — restore an
  earlier `"hidden"` decision; only a review that's never been flagged at
  all is rejected as "nothing to moderate").
- **A hidden review stays visible to the account it's about.** The
  public `findOne`/`findSupplier` filter `moderationStatus: { not:
  "hidden" }`; the owner's own `findForAccount`/`findMySupplier` don't, so
  a vendor/supplier can see why a review disappeared (and the moderator's
  own note) rather than it just vanishing unexplained.
  `recomputeRating` — and, since they read reviews directly rather than
  the pre-computed `ratingAverage`, `compare_vendor_quotes` and
  `boq_to_order`'s own review reads — all apply the same exclusion, so a
  hidden review stops counting anywhere its rating would otherwise show
  up, immediately and consistently.
- **Web UI**: `pages/vendors/me.tsx` and `pages/marketplace/materials/
  me.tsx` get a "Flag" button next to "Reply" on each own-profile review
  (hidden once a review is already flagged or hidden), plus a moderation-
  notes readout when hidden. `pages/vendors/index.tsx` — the one page
  `platform_reviewer` can actually reach, since `product:read` (not
  `vendor:read`) gates the materials marketplace and this role has
  neither a supplier list page nor that permission — gains a combined
  "Flagged reviews" queue for both marketplaces shown *alongside* (not
  replacing) the vendor grid this role already browses to verify vendors,
  each row offering "Hide review" / "Dismiss flag".
- **Verified live end-to-end**, including a real gap the first pass
  missed: flagged the seeded vendor review as the vendor account,
  confirmed it appeared in the platform reviewer's queue with its reason,
  dismissed it (queue emptied, rating unchanged), re-flagged it, hid it
  (queue emptied again; confirmed via direct API calls that `ratingAverage`
  recomputed to `null`, the public `GET /vendors/:id` response dropped the
  review entirely, and the vendor's own `GET /vendors/me` still showed it
  marked `"hidden"` with the moderator's note) — then discovered
  `moderateReview` had no way to reverse a `"hidden"` decision at all (it
  only accepted a review currently `"flagged"`), fixed it to accept
  either `"flagged"` or `"hidden"` as a starting point, and confirmed live
  that restoring the hidden review brought the `4.0` rating back.
- **Known gap, honestly left open**: restoring a hidden review works via
  the API (confirmed above) but has no UI — there's no "previously
  moderated" list to find one from, only the still-flagged queue. A real
  deployment doing enough of this to need it would want that list; this
  scaffold's slice doesn't build it.

## A real payment gateway — Paystack (Section 16)

Closes the specific gap this README named for a whole session: "`src/
payments` simulates every deposit and payout instantly." Deposits into
escrow now go through Paystack's real Checkout — an actual hosted
payment page, a real transaction reference, and a server-side
verification call before a naira ever counts as "in escrow." Payouts
(releasing a milestone to a vendor) are still simulated — see the gap
below for why that's a materially bigger integration than deposits
turned out to be.

- **`PaystackService`** (`src/payments/paystack.service.ts`) — the same
  "plain `fetch`, no SDK" shape `AnthropicLlmProvider` already
  established, wrapping exactly two Paystack endpoints:
  `/transaction/initialize` and `/transaction/verify/:reference`.
  That's Section 16's actual minimum ("process real transactions"), not
  the full Paystack API surface — no webhook receiver, since this
  scaffold runs on localhost with no public URL for Paystack to call
  back to. Verification is caller-initiated instead: the buyer clicks
  "I've paid — verify" and the backend asks Paystack directly, the same
  pull-based pattern a production deployment would keep as the fallback
  for a buyer who closes the tab before a webhook could fire.
- **`PaymentsService.deposit`** now branches on `provider`. `"manual"`
  (the default, and everything demo/seed data uses) is the original
  instant simulation, unchanged. `"paystack"` creates a **`pending`**
  `Payment` — no escrow credit yet — calls Paystack's initialize
  endpoint, and returns an `authorizationUrl` instead of a receipt.
  Escrow is only credited once **`verifyDeposit`** (new: `POST /
  projects/:projectId/payments/:paymentId/verify`) confirms the charge
  actually succeeded, so a buyer abandoning checkout never phantom-funds
  the project. Both paths share one `creditEscrowForDeposit` helper for
  the actual balance/ledger/receipt write, so there's only one place
  that can credit escrow at all. Amount *and* currency are checked
  against what Paystack itself confirms before crediting anything — a
  reference alone isn't trusted.
- **Paystack's own transaction statuses aren't binary.** A first version
  of this treated any non-`"success"` verify result as a terminal
  `"failed"` — caught live when verifying a truly untouched checkout
  session returned Paystack's own `"abandoned"` status and permanently
  failed a payment that hadn't even been attempted yet. Fixed: only
  Paystack's own `"failed"` (an actually declined/errored charge) marks
  the local `Payment` `"failed"`; anything else (`"abandoned"`, still
  pending) leaves it `"pending"` so the same checkout session can still
  be completed and re-verified later.
- **Paystack rejects RFC 2606 reserved-TLD emails outright** — confirmed
  directly against their API: `demo-owner@propertyonthego.test` (this
  scaffold's own seeded login, deliberately fake so it's never mistaken
  for a real mailbox) gets `"email" must be a valid email` back from
  `/transaction/initialize`. A `payableEmail()` helper swaps a reserved
  test TLD (`.test`/`.example`/`.invalid`/`.localhost`) for `.com` only
  in what's sent to Paystack — Paystack never actually emails this
  address in test mode, it's only a label on the transaction, so this
  changes nothing about the account's real login email anywhere else.
- **Web UI**: `DepositForm` (`pages/projects/[id].tsx`) labels the
  provider dropdown honestly now — "Paystack (real test payment)" next
  to "Manual/Flutterwave/Stripe/PayPal (simulated)", since only Paystack
  does anything real. Choosing it opens Paystack's checkout in a new tab
  and swaps the form for an "I've paid — verify" button.
- **New env vars** (`apps/api/.env.example`): `PAYSTACK_SECRET_KEY`
  (omit to keep every deposit on the manual simulated path — nothing
  breaks without it) and `WEB_APP_URL` (where Paystack redirects the
  browser after checkout).
- **Verified for real, not mocked** — this pass actually ran against
  Paystack's live test API using a real test secret key: initializing a
  transaction, completing checkout on Paystack's real hosted page with
  their public test cards (`Success` → escrow credited exactly once,
  confirmed via the ledger and a direct balance check; `Declined` →
  `Payment` marked `"failed"`, escrow untouched, re-verifying a failed
  payment correctly refused), and — separately — verifying an
  **un-touched** checkout session to catch the `"abandoned"` bug above.
  Every step was also driven through the actual browser: the deposit
  form, Paystack's real checkout UI, the callback redirect back to the
  project page (carrying Paystack's `reference` as a query param — see
  "The redirect back from checkout now verifies itself" below for what
  reading it now does), and the escrow card updating live after "I've
  paid — verify". There's still no webhook receiver, by design (see
  above) — every verification is caller-initiated, the redirect included.
  Payouts were still fully simulated at the time this was written — see
  "A real payout gateway — Paystack Transfers" further down for what a
  later pass this same session built.

## The redirect back from checkout now verifies itself (this pass)

Closes the gap the Paystack deposit pass above flagged: Paystack's
checkout redirects the buyer back to `/projects/:id?paystackReference=
<reference>` (see `PaymentsService.deposit`'s `callbackUrl`), but nothing
ever read that query param — verification only ever happened through the
"I've paid — verify" button in the *original* tab, so a buyer who closed
that tab and only ever landed on the redirect had no UI path back to
verifying at all.

- **`ProjectDetailPage`** gets a new effect keyed on
  `router.query.paystackReference`: it calls the now-exposed
  `AuthApiClient.findPayments`, finds the `pending` `Payment` whose
  `providerReference` matches, and verifies it the exact same way the
  "I've paid — verify" button already does (`verifyDeposit`) — no new
  backend logic, just a second caller of the endpoint that pass already
  built. The query param is stripped via `router.replace` afterward
  (shallow, no reload) so refreshing the page doesn't re-trigger it.
- **Still no webhook** — this is still a caller-initiated confirmation,
  same as the button. What changed is *which* caller: the redirect itself
  now does it automatically instead of requiring the buyer to have kept
  the original tab open.
- **Verified live**, working around the current test key's activation
  state (see "A real payout gateway" below — this session's Paystack
  account is still activating, so a real end-to-end checkout couldn't be
  driven right now): inserted a `pending` `Payment` row directly, then
  loaded `/projects/:id?paystackReference=<its reference>` the same way
  Paystack's redirect would. Confirmed the page called `verifyDeposit`
  (visible in the network log), surfaced Paystack's real response as a
  banner (`"Transaction reference not found"` — correct, since the test
  reference was never a real Paystack transaction), and stripped the
  query param from the URL afterward. The test row was deleted once
  confirmed; nothing about this needed a code change to `PaymentsService`
  or `PaystackService`, only a second consumer on the web side.

## A real payout gateway — Paystack Transfers (Section 16)

The other half of Section 16, closing the "payouts are still fully
simulated" gap the deposit pass above left open. Releasing a milestone
to a vendor now goes through Paystack's real Transfer API when the
vendor has bank details on file — the same "verify first, never trust
the client" discipline as the deposit side, adapted for a flow that also
has to survive a real bank's own OTP confirmation step.

- **`Vendor.bankAccountNumber`/`bankCode`/`bankAccountName`/
  `paystackRecipientCode`** (new columns) — all four or none, same
  "record what's true" shape other optional-together fields already use
  in this schema. `bankAccountName` is never client-supplied: **`PATCH
  /vendors/me/bank-details`** (`VendorsService.setBankDetails`) resolves
  the account number against Paystack's own `/bank/resolve` first and
  stores whatever name Paystack itself returns — a vendor can't put a
  fake name on their own payout account. **`GET /vendors/banks`** backs
  the web form's bank picker with Paystack's real bank list (not a
  hardcoded one this scaffold would have to keep in sync).
- **`PaymentsService.releaseMilestone`** now branches the same way
  `deposit` does: no bank details, or no Paystack key configured, falls
  through to the original instant simulation unchanged. With both, it
  creates (or reuses a cached) Transfer Recipient, calls Paystack's
  `/transfer` endpoint, and creates the `Payout` as `"processing"` —
  escrow is **not** debited and the milestone does **not** flip to
  `"completed"` yet, mirroring the deposit side's "pessimistic until
  confirmed" shape exactly. **`POST /projects/:projectId/payouts/
  :payoutId/verify`** asks Paystack directly whether the transfer
  actually succeeded before any of that happens, via a shared
  `finalizePayout` helper (`PaymentsService`) that's now the one place
  that can debit escrow for a payout, used by both the instant-manual
  path and the confirmed-real one.
- **A newly created Paystack integration has transfer OTP on by
  default** — confirmed live, not assumed: `initiateTransfer` against
  this scaffold's own test key came back `"otp"`, not `"success"`.
  Paystack sends that code to whoever owns the *Paystack account*
  itself, not to this app or the vendor being paid — there's no way for
  this integration to intercept or redirect it. **`POST /projects/
  :projectId/payouts/:payoutId/finalize`** (`PaymentsService.
  finalizePayoutOtp`, `PaystackService.finalizeTransferOtp`) relays
  whatever code a human types in; the web UI's `PayoutRow` gets both a
  "Check status" button (polls `/verify`, for OTP-less integrations or
  once OTP is already handled) and an "Enter OTP" form next to any
  `"processing"` payout.
- **Verified as far as an external account allows, and documented
  exactly where that stops.** Live against Paystack's real API: bank
  list, account-number resolution (Paystack's own documented test
  account resolved to a real name), Transfer Recipient creation, and
  Transfer initiation all succeeded and were confirmed by querying
  Paystack directly — a real `TRF_…` transfer code exists, correctly
  sitting in Paystack's own `"otp"` state, with escrow correctly left
  untouched and the milestone correctly left incomplete pending that
  confirmation. What's *not* verified end-to-end: actually receiving and
  submitting the OTP, and the "success" branch of `finalizePayout` for a
  real (not manual) payout — both blocked by external account state, not
  by this integration's own code:
  1. The OTP itself wasn't confirmed delivered — Paystack's own
     `resend_otp` returned `"OTP has been resent"` on request, twice,
     which places the delivery gap outside this scaffold's control
     (registered contact info on the Paystack account).
  2. A second test key created specifically to try disabling OTP turned
     out to belong to a Paystack business Paystack itself has disabled
     (`"code":"disabled_merchant"`, confirmed by calling Paystack
     directly, independent of this codebase) — an account-activation
     step only Paystack support can resolve, not something to route
     around in code.
  The integration code itself — recipient creation, transfer
  initiation, the pessimistic-until-confirmed escrow/milestone gating,
  the OTP relay endpoint — is written, typechecked, and has run
  successfully against Paystack's live test API up to the exact point an
  external human confirmation step takes over. Picking this back up once
  an activated key is available needs no further code changes, only a
  live OTP (or a dashboard "disable OTP for transfers" toggle) to watch
  the `"success"` branch actually fire.
- **Rechecked later the same session: the `disabled_merchant` block is
  gone, replaced by a narrower one.** Calling Paystack directly again
  with the project-specific key — `/transaction/initialize`, `/balance`,
  `/bank/resolve`, `/transferrecipient` — all now succeed where
  `/transaction/initialize` previously came back `"Integration has been
  deactivated"`, so the account-activation step the user was waiting on
  has completed. Initiating a fresh transfer now gets past that and fails
  one step later instead: Paystack's own `/balance` reports `₦0`, and
  `/transfer` refuses with `"code":"insufficient_balance"` — a test-mode
  transfer normally doesn't require real funds, but this particular test
  account currently does, which is Paystack's own account-level setting,
  not this integration's. The stale `TRF_…` reference from the earlier
  (differently-keyed) attempt is also gone —
  `GET /transfer/:code` now 400s `"Transfer ID/code specified is
  invalid"` for it, confirming it belonged to the account under the old
  key, not this one. Next step is funding this Paystack account's test
  balance (Paystack dashboard, test mode) — once that's done, a fresh
  `POST /projects/:projectId/milestones/:milestoneId/release` should
  reach the `"otp"` state this section already handles, with nothing
  left to change in this codebase.

## Flutterwave and PayPal: a second and third real gateway (this pass)

Section 16 named four gateways ("Paystack, Flutterwave, Stripe, PayPal");
every deposit and payout route stayed hardcoded to Paystack's own
`PaystackService` — a concrete class, not an interface, injected directly
into `PaymentsService`/`VendorsService` — until now. This closes that:
Flutterwave and PayPal both process real deposits and real payouts,
Stripe gets a correctly-shaped deposit gateway that's deliberately left
inactive (see its own section below), and `Payout` gained the `provider`
column `Payment` already had, fixing a real bug the redesign surfaced —
see "The bug this surfaced" below.

- **`FlutterwaveService`** (`src/payments/flutterwave.service.ts`) — same
  "plain fetch, no SDK, `isConfigured` gate" shape `PaystackService`
  already established. One real structural difference: Flutterwave's
  Transfer API takes the destination bank account directly on every
  transfer call, no separate "create a recipient, cache its id" step the
  way Paystack's does — so there's no Flutterwave equivalent of
  `Vendor.paystackRecipientCode`. Another: Flutterwave amounts are
  already in the currency's major unit (5000 means 5000 NGN), not kobo
  like Paystack's — every method here reflects that directly.
- **`PaypalService`** (`src/payments/paypal.service.ts`) — structurally
  the most different of the three: OAuth2 client-credentials (cached,
  refreshed near expiry) instead of a static bearer key; deposits go
  through the Orders API, where `verifyTransaction` doesn't just *read*
  a status, it *captures* the order — a capture only succeeds once the
  buyer has approved it via the returned link, so an unapproved order
  correctly reports "pending" rather than erroring, and an
  already-captured order is looked up read-only on a second call instead
  of erroring on it; payouts go through the Payouts API, targeting an
  email address directly — there's no bank code/account number involved
  at all, hence `Vendor.paypalPayoutEmail` existing as its own field.
- **`Vendor` gained `payoutProvider`** (`"paystack" | "flutterwave" |
  "paypal" | null`) **and `paypalPayoutEmail`** — `bankAccountNumber`/
  `bankCode`/`bankAccountName` are now shared between Paystack and
  Flutterwave rather than Paystack-only, disambiguated by
  `payoutProvider`, since **Paystack's and Flutterwave's bank code lists
  are not interchangeable for the same physical bank** — confirmed live:
  Flutterwave's own bank list (`GET /vendors/banks?provider=flutterwave`)
  came back a materially different, differently-coded list than
  Paystack's. `VendorsService.setBankDetails` now takes an optional
  `provider` (defaults to `"paystack"` for existing callers) and resolves
  against whichever gateway that names; `setPaypalPayoutEmail` is the
  email-based counterpart with no resolve step to make first — PayPal
  itself validates the receiver when a payout is actually sent.
- **The bug this surfaced**: `Payout` had no equivalent of
  `Payment.provider` at all — only `payoutMethod` (`manual |
  bank_transfer | mobile_money`), which `PaymentsService.verifyPayout`/
  `finalizePayoutOtp` used to mean "call Paystack," unconditionally,
  because Paystack was the only gateway that could ever produce a
  `"bank_transfer"` payout. The moment a second one could, that
  assumption would have made every Flutterwave/PayPal payout's "check
  status" silently call Paystack's API against a reference Paystack never
  issued. Fixed by adding `Payout.provider` (mirroring `Payment.provider`,
  backfilled `"paystack"` for every existing `bank_transfer` row in the
  migration) and switching the verification gate from `payoutMethod ===
  'bank_transfer'` to `provider !== 'manual'`, with a small
  `getPayoutGateway(provider)` lookup replacing the old unconditional
  `this.paystack.*` calls. `finalizePayoutOtp` now explicitly refuses any
  payout that isn't Paystack's rather than silently doing nothing useful
  with an OTP no other gateway asked for.
- **Web UI**: `DepositForm`'s provider dropdown
  (`pages/projects/[id].tsx`) now offers Flutterwave and PayPal as real
  options alongside Paystack, with Stripe labeled "real once configured";
  the Paystack-specific `?paystackReference=` checkout-return query param
  is now the gateway-agnostic `?depositReference=`, read the same way for
  all four. `PayoutRow` only shows "Enter OTP" when the payout's own
  `provider` is `"paystack"` — Flutterwave/PayPal payouts in this
  integration only ever need "Check status" to move past "processing".
  `BankDetailsForm` (`pages/vendors/me.tsx`) gained a Paystack/
  Flutterwave/PayPal toggle that swaps between the bank-account form
  (re-fetching that gateway's own bank list) and a plain email field for
  PayPal.
- **Verified live end-to-end against both gateways' real sandbox APIs** —
  not simulated, not mocked:
  - **Flutterwave**: a real deposit returned a genuine
    `checkout-v2.dev-flutterwave.com` hosted-payment URL; verifying it
    before completing checkout correctly stayed "pending"; resolving
    Flutterwave's own sandbox "Test bank" account number against its real
    `/accounts/resolve` endpoint correctly returned a real account name
    ("Forrest Green"); releasing a milestone to that account correctly
    dispatched to Flutterwave (not Paystack) and returned a real transfer
    reference in `"processing"`; checking its status called Flutterwave's
    real `/transfers` endpoint and correctly marked the payout `"failed"`
    once Flutterwave's own settlement rejected the test destination — and
    confirmed escrow's balance was untouched by the failed payout, same
    "nothing moves until success is confirmed" guarantee the Paystack
    path already had.
  - **PayPal**: a real deposit against this demo project's own NGN
    project currency failed with PayPal's own real validation error
    (NGN isn't a currency PayPal supports) — switching to USD via a
    direct API call (bypassing the UI, which always uses the project's
    own currency) confirmed the integration itself is correct: PayPal
    returned a real Order id and a genuine `sandbox.paypal.com`
    checkout-now URL, and verifying it before approval correctly stayed
    "pending". A real payout attempt hit the identical NGN constraint on
    the Payouts API side (`items[0].amount.currency`, confirmed via a
    detailed PayPal error response), the same real external limitation
    as the deposit side, not a bug — this scaffold's demo data just
    happens to be NGN-denominated and PayPal's supported-currency list
    doesn't include it, the same category of constraint the Paystack
    section above already documents for reserved test-TLD emails.

## Stripe: the fourth gateway, now live too (this pass)

The fourth gateway Section 16 named. Written first as a correctly-shaped
but deliberately inactive deposit gateway (no credentials were ready for
it yet), then activated and verified live in the same pass once they
were: `StripeService` (`src/payments/stripe.service.ts`) is gated by the
exact `isConfigured` pattern `PaystackService` already established, so it
needed zero code changes between "inactive" and "live" — only
`STRIPE_SECRET_KEY` going from unset to set.

- **Deposit-only, on purpose.** Paystack/Flutterwave/PayPal all pay a
  vendor directly from this platform's own gateway balance (a bank
  account or an email address); Stripe's equivalent is Stripe Connect, a
  materially different product requiring each vendor to onboard their own
  connected account through a separate flow before this platform could
  ever pay one through it. That's not something one service class can
  "complete in advance" the way a checkout integration can — building a
  payout path against the wrong API shape would be worse than not
  building one at all, so this scaffold doesn't pretend to. If Stripe
  payouts are ever wanted, that's Connect onboarding as its own real
  workstream, not a gap in this file.
- **One real API-shape difference from the other three**: Stripe's REST
  API takes `application/x-www-form-urlencoded` bodies with
  bracket-notation keys for nested objects/arrays (e.g.
  `line_items[0][price_data][unit_amount]`), not JSON. `toFormBody`
  exists only to build that encoding correctly for the one request shape
  this file actually sends (a Checkout Session).
- **Verified live, further than any of the other three gateways this
  pass**: this is the only one of the four where completing the actual
  buyer-side checkout was possible without an external sandbox account —
  Stripe's own well-known test card (`4242 4242 4242 4242`) needs
  nothing else. First confirmed the real minimum-charge constraint
  Stripe enforces (a session has to convert to at least ~$0.50 — a ₦10
  deposit correctly 400'd on that, not a bug), then ran the whole flow
  for real at ₦50,000: a genuine `checkout.stripe.com` session showing
  the right product name, the right amount, and `payableEmail`'s
  reserved-test-TLD rewrite already applied to the prefilled email (the
  same helper `deposit()` uses for every gateway); paid with the test
  card through Stripe's actual hosted checkout; landed back on
  `?depositReference=<id>` exactly like the other three gateways now do;
  and confirmed server-side that `verifyDeposit` correctly captured it,
  credited escrow by exactly ₦50,000, and issued a real receipt — the
  full path, not just session creation.

## Accepting a listing-description draft now saves it (this pass)

Closes the "Not built yet" list's own pointer — "`generate_listing_description`
is the next-clearest candidate... if this gets picked up again" — the same
way "Accepting a status-update draft now posts it" closed it for projects.

- **`AiService.applyChainedAction`** gets a second arm: accepting a
  `generate_listing_description` draft now calls the new
  `ListingsService.updateDescription`, which re-checks the listing still
  belongs to the caller's account (same `requireOwnListing` guard every
  other listing-owner action uses) before writing `Listing.description`.
- **No permission re-check needed here**, unlike `draft_project_status_
  update`'s — that skill only ever needed `project:read` to *run*, so
  accepting it had to check `project:write` separately before it could
  *post*. `generate_listing_description` already requires `listing:write`
  just to run, so the permission that let someone request the draft
  already matches the one now needed to save it.
- **`AiModule` now imports `ListingsModule`** so `AiService` can inject
  `ListingsService` alongside the `ProjectsService` it already had — the
  same shape as the first chained action, extended to a second module.
- Same caveat as the status-update case: the listing detail page
  (`apps/web/pages/marketplace/[id].tsx`) doesn't live-refresh after
  Accept — the new description is saved immediately, but the page shows
  it after a reload, not optimistically. Not fixed here, for the same
  reason it wasn't fixed there: `AskAiPanel` is one component shared by
  every module's screen with no per-page refresh callback, and adding one
  is a bigger change than this slice.

## A real email provider — Resend (password reset + invites)

Closes the last "logged + returned raw" scaffold-depth tradeoff this
codebase carried: password-reset and invite links now get actually
emailed, via [Resend](https://resend.com)'s API — same "plain fetch, no
SDK" shape `AnthropicLlmProvider`/`PaystackService` already use, and the
same "falls back cleanly with no key configured" shape `PaystackService`
uses too.

- **New `EmailService`** (`src/notifications`) — one `send()` method,
  `isConfigured` gated on `RESEND_API_KEY`. Returns whether the send was
  actually accepted rather than throwing: an email provider being down is
  never a reason to fail the request that triggered the email.
- **`AuthService.forgotPassword`** and **`AccountsService.addMember`/
  `resendInvite`** now call it. The raw token/link is only ever included
  in the response when `send()` comes back `false` — that's the one case
  still needing a manual fallback (no key configured, or a send that
  failed for some other reason), and it's what closes the actual security
  gap those three endpoints' comments used to flag: returning a
  password-reset or invite token in an API response is fine for a
  scaffold with no email provider and genuinely wrong once one exists,
  since anyone who could call the endpoint could then also read the token
  meant to prove receipt of the email.
- **Web UI**: `pages/forgot-password.tsx`, `pages/accounts/members.tsx`'s
  `InviteForm`, and its `PendingInviteRow`'s resend action all branch on
  whether a token came back — "emailed to X" when one didn't, the old
  copy-this-link box when one did. No page needed new API calls, only to
  stop assuming the token field is always present.
- **Verified live end-to-end, including the exact limitation this
  approach carries**: with `RESEND_API_KEY` set, a real
  `forgotPassword('staocube@gmail.com')` call correctly omitted
  `resetToken` from the response, the server log read `(emailed)`, and
  the user confirmed the email actually arrived and the reset link
  worked. Inviting a fresh, non-account email
  (`new-invitee-realtest@example.com`) hit Resend's own sandbox
  restriction instead — `422 Invalid \`to\` field... Please use our
  testing email address` — confirming live what the code comments already
  said: without a verified sending domain, Resend's sandbox sender
  (`onboarding@resend.dev`, the default `EMAIL_FROM`) only actually
  delivers to the email address the API key's own Resend account is
  registered with, nobody else. The endpoint correctly treated that as a
  failed send and fell back to returning the raw `inviteToken` — caught
  and fixed a real bug while confirming this: the fallback log line
  originally said "no provider configured" even when a key *was*
  configured and the send failed for an unrelated reason (this exact
  sandbox case); `AccountsService.describeSendStatus`/the equivalent
  inline check in `AuthService` now distinguish "not configured" from "a
  configured send failed" instead of blaming the wrong cause.
- **What a real deployment needs beyond this**: a verified sending domain
  on Resend (lifts the sandbox recipient restriction — see
  `RESEND_API_KEY`'s comment in `.env.example`), and probably a proper
  HTML email template rather than the inline strings this pass uses.

## Finding out you've been invited (this pass)

Closes "no invite listing beyond the account's own Members page" — until
now the *only* place any invite was visible at all was the inviting
account's own Members page. A recipient with no access to that page, or
who lost the email, had no way to discover an invite existed.

- **`AccountsService.findMyInvites(email)`** lists every still-pending,
  unexpired `AccountInvite` sent to the signed-in user's own email,
  across every account — not just one. **`acceptMyInvite`** accepts one,
  deliberately keyed by the invite's own id rather than its bearer token:
  a signed-in session already proves the caller's email, so there's
  nothing a token adds that the query's own email filter doesn't already
  guarantee. 404s (not 403) on an email mismatch, this scaffold's usual
  "don't confirm a cross-tenant resource exists" shape. Both share the
  actual membership-grant transaction with the token-based `acceptInvite`
  via a new private `applyAcceptInvite` helper — same extract-the-shared-
  part pattern every other neutral-decision pass this session used.
- **`GET /invites/mine` and `POST /invites/mine/:inviteId/accept`** —
  registered before the existing `GET /invites/:token` catch-all on the
  same controller, so `"mine"` isn't swallowed as a literal token value.
- **Web UI, in the two places that actually matter**: `AccountSwitcher`
  (rendered in `AppShell`'s header on every page once a user has at least
  one account) gets a red count badge and an "Accept" row per invite in
  its dropdown. But the *more* important case turned out to be the one a
  first pass would have missed: a brand-new user who registers
  independently of any invite link — the realistic way someone with a
  waiting invite actually discovers this scaffold — lands on
  `/accounts/new` with **zero** accounts, and `AccountSwitcher` can't
  render at all without one. `pages/accounts/new.tsx` now fetches
  `findMyInvites` itself and shows an "You've been invited" card above
  the "create your own account" form, so that dead end doesn't happen.
- **Verified live end-to-end**, including finding that second gap by
  actually walking through the flow rather than assuming the first fix
  was enough: invited a brand-new email, registered a User for that same
  email independently (not via the invite link — the scenario that
  matters), confirmed `GET /invites/mine` returned the pending invite,
  confirmed a mismatched-email accept attempt correctly 404'd, then
  drove it through the real browser — a fresh registration landing on
  `/accounts/new` showed the invite card, clicking Accept joined the
  account, switched into it, and redirected straight to the portfolio
  showing that account's own property.

## Real client-side validation: catching a mistyped password (this pass)

Closes the one concrete, checkable gap "no client-side validation beyond
native `required`/`minLength`/`type=\"email\"`" actually named: a
mistyped password on Register or Reset Password went completely
uncaught client-side before this — the account (or the new password)
would silently be set to whatever was typed, and the *first* sign a
typo happened at all was the next sign-in failing with no way to tell
"wrong password" from "the account never got the password I meant to
set."

- **`pages/register.tsx` and `pages/reset-password.tsx`** both gain a
  "Confirm password" field. A live, styled inline message ("Passwords
  don't match.") appears the moment the two differ — but only once the
  confirm field actually has something in it, so it doesn't flash red
  before the user has finished typing — and the submit button is
  disabled for the same condition, on top of the check `onSubmit` itself
  still does as a defense against a disabled button being bypassed
  somehow. A live "At least 8 characters" hint sits under the password
  field itself, replacing reliance on the browser's own (inconsistently
  styled, easy to miss) `minLength` validation popup.
- **Deliberately narrow**: email-format and required-field checks
  already have real enforcement via native `type="email"`/`required`
  *and* the backend's own `class-validator` decorators
  (`@IsEmail()`/`@MinLength(8)` — see the DTOs in `src/auth/dto`) — this
  pass didn't reimplement those client-side, since a mismatched
  client/server regex would be a worse bug than no client-side copy at
  all. The one thing native HTML genuinely can't check at all —
  "did these two fields actually match" — is what needed real code.
- **Verified live in the browser**: typed two different passwords into
  Register, confirmed the inline message appeared and the submit button
  was disabled; corrected the second field and confirmed both cleared
  immediately.

## Moving auth off localStorage: httpOnly cookies + CSRF (this pass)

Closes the tradeoff "Web app auth hardening" above flagged as deliberate
but open: the access token moves out of `localStorage` (XSS-exposed —
any script that runs on the page, including one smuggled in through a
dependency or a stored-XSS bug, could read it and exfiltrate the whole
session) into an httpOnly cookie neither this app's own JS nor an
attacker's ever gets to read. Doing that without also adding CSRF
protection would trade one vulnerability for another — a cookie the
browser attaches automatically is exactly what a forged cross-site
request rides on — so this pass is the two together, not just the first
half.

- **`src/auth/cookie.util.ts`** — one place both halves of the session
  get set (`access_token`, `refresh_token`, both httpOnly) and cleared,
  plus a third, deliberately non-httpOnly `csrf_token` cookie for the
  double-submit pattern below. `sameSite: "lax"` with no `secure` flag in
  dev works for this scaffold's own topology — the web app and API run on
  `localhost` at different *ports*, which `SameSite` treats as the same
  *site* (site is scoped by registrable domain, not port, unlike the
  CORS/fetch *origin* check that still needs `credentials: true` to send
  the cookie cross-port at all) — a genuinely cross-*site* production
  deployment (different registrable domains) would need `sameSite: "none"`
  + `secure: true` instead, which only works over HTTPS.
- **`CsrfGuard`** (`src/common/guards/csrf.guard.ts`), wired in globally
  via `APP_GUARD` in `AppModule` rather than added to every controller's
  own `@UseGuards(...)` list — the risk it closes applies uniformly to
  every mutating endpoint, so one central guard is far less likely to
  miss a spot than repeating it across 15+ controllers. Double-submit
  cookie pattern: `cookie.util.ts` sets a random `csrf_token` cookie
  alongside the auth ones; every mutating request (anything but
  GET/HEAD/OPTIONS) must echo that exact value back as an `X-CSRF-Token`
  header. A cross-site attacker's page can trigger the cookie-carrying
  request but can't *read* this origin's cookies to know what to put in
  the header, so the two only ever match for a request this app's own JS
  actually made. Skips four unauthenticated routes
  (`/auth/login`/`register`/`forgot-password`/`reset-password`) that act
  on an explicit credential already in the request body, not a cookie's
  ambient authority — there's nothing CSRF-shaped to exploit there.
  `/auth/refresh` and `/auth/logout` *are* checked, even though both are
  otherwise unauthenticated too, since both act on the `refresh_token`
  cookie's ambient authority the same way any other mutating route acts
  on `access_token`'s.
- **`JwtAuthGuard`** now reads `req.cookies.access_token` instead of an
  `Authorization` header — the whole point of httpOnly is that this app's
  own JS never sees the token to attach it manually, the browser does
  that on its own.
- **`AuthController`** sets/clears cookies via `@Res({ passthrough: true
  })` on register/login/refresh/logout, and none of the four hand back a
  token string in the response body anymore — putting it there would
  undo the XSS protection just as completely as `localStorage` did, since
  any script that can read a fetch response can read a JSON body as
  easily as `localStorage`. Login/register/refresh responses are
  correspondingly thin; a new **`GET /auth/me`** (`{ id, email }`) is how
  the client now finds out who's actually signed in, since it can no
  longer decode its own JWT.
- **`lib/auth.tsx`/`lib/api.ts`** lost every line that touched a real
  token value — no more `decodeExpiryMs`/`decodeEmail` JWT-decoding, no
  more `getRefreshToken`/`onRefreshed` in `configureAuthSession` (nothing
  left to persist, cookies just update themselves via `Set-Cookie`).
  `AuthContextValue.token` stays in the interface — every existing
  `if (!auth.token)` truthiness check across the app (`AppShell`,
  `AccountSwitcher`, `accept-invite.tsx`, `accounts/new.tsx`,
  `index.tsx`) keeps working completely unchanged — but it's now a
  non-secret "is a session active" marker (the signed-in user's own id)
  rather than the token itself, set from `GET /auth/me`'s response
  instead of decoded from a stored string. `request()`'s existing
  401-triggers-a-silent-refresh-then-retry logic (built in the
  `localStorage` pass) needed almost no change — it never actually cared
  what the token *was*, only whether the call was meant to be
  authenticated — plus one small addition: it now skips even attempting
  a refresh when the readable `csrf_token` cookie is absent, a reliable
  "there was never a session to refresh" signal that avoids a doomed
  round trip (and a misleading CSRF-guard 403 in the console) on every
  page load for a visitor who was never signed in.
- **What this costs, honestly**: the bearer-header story for non-browser
  callers is gone. A `curl` request or a future mobile app can no longer
  authenticate by attaching an `Authorization: Bearer <token>` header —
  everything now goes through a browser holding the httpOnly cookies.
  That's the real half of the "Web app auth hardening" tradeoff this pass
  didn't undo, just relocated: a production system serving both a web app
  and non-browser clients would need a second auth mechanism (API keys,
  most likely) alongside this one, not a replacement for it.
- **Verified live end-to-end** against the real dev servers, not just
  typechecked: logged in and confirmed `document.cookie` only ever
  exposed `csrf_token` (never the two httpOnly ones) and `localStorage`
  held nothing but the non-secret account selection; created a document
  through the real UI and confirmed the request carried a matching
  `X-CSRF-Token`; sent the identical mutating request manually with
  cookies but *no* CSRF header and confirmed a real `403`, then again
  with the correct header read straight from `document.cookie` and
  confirmed it succeeded — proving the guard actually blocks a forged
  request rather than being a no-op; called `POST /auth/refresh` directly
  and confirmed it rotated the cookies (a fresh `csrf_token` value) and
  the new `access_token` worked on the very next call; signed out through
  the real UI and confirmed the cookies were cleared server-side (`GET
  /auth/me` correctly 401'd immediately after, not just "the client
  forgot its copy"); confirmed a protected page redirects to `/login`
  when genuinely logged out; and ran a full fresh registration →
  create-account → portfolio flow through the browser to confirm the
  ordinary path still works end to end, not just the security-specific
  edge cases.

## Submitting evidence on a dispute (this pass)

Closes a gap flagged twice — in "An evidence-request step for dispute
arbitration" and again under "Not built yet" — once the arbitrator could
say `under_review`, there was still no dedicated way for either party to
*submit* more evidence in response, only whatever general tool they
happened to reach for (a project update, a reply somewhere else entirely)
that had nothing to do with the dispute itself and wasn't visible to the
arbitrator in one place.

- **New `DisputeEvidence` model** (migration
  `20260903100000_add_dispute_evidence`) — `note` plus an optional
  `fileUrl` (same "URL you provide yourself" shape as `Document.fileUrl`,
  no object storage in this scaffold), who submitted it and when.
- **`PaymentsService.requireDisputeParty`** — new shared check: either
  the account owns the dispute's project, or it's a vendor assigned to
  it. Deliberately *not* `applyDisputeResolution`'s
  `raisedByAccountId`-excludes-itself check — submitting evidence isn't a
  decision either side could tilt in its own favor the way resolving one
  could, so the account that raised a dispute can still add to its own
  record, unlike resolving it.
- **`POST`/`GET .../disputes/:disputeId/evidence`** on both
  `PaymentsController` (nested under `/projects/:projectId`, matching
  every other owner-side dispute route) and `VendorsController`
  (`/vendors/me/disputes/:disputeId/evidence`, matching its vendor-side
  counterpart) — both funnel into the same service methods.
  `submitDisputeEvidence` 400s once a dispute is `resolved`/`rejected`,
  same "nothing more to decide" shape `arbitrateDispute` already uses.
- **The neutral reviewer never has to ask for it separately** —
  `findOpenDisputesForArbitration` now `include`s the evidence thread
  directly, the same "arbitrating blind wouldn't be arbitrating
  anything" reasoning `DocumentsService.findPendingForArbitration`
  already uses for uploader/property context.
- **Web UI**: `DisputeRow` (`pages/projects/[id].tsx`) and
  `VendorDisputeRow` (`pages/vendors/me.tsx`) both get a lazily-loaded
  "View/add evidence" toggle — not fetched for every dispute on page
  load, only once expanded — with a submit form shown while the dispute
  is still open. `ArbitrationRow` (`pages/payments/index.tsx`) renders
  the thread read-only, straight from the queue response it already had.
- **Verified live end-to-end**: raised a fresh dispute as the project
  owner, submitted evidence with a note and a supporting link, confirmed
  it rendered correctly (clickable link, timestamp) and the form reset
  for a second submission; switched to the platform reviewer and
  confirmed the exact same evidence appeared in the arbitration queue
  with no extra fetch, resolved the dispute from there; confirmed via a
  direct API call that submitting evidence to that now-resolved dispute
  correctly 400s instead of silently succeeding.

## Linking inspectors and maintenance assignees to real vendor accounts (this pass)

Closes half of a gap flagged three times when Modules 8, 12, and 13 were
first built: "no separate Inspector, Contractor, or Tenant identity."
Tenant stays out of scope — there's no Tenant account type or
tenant-facing login anywhere in this scaffold, so `Lease.tenantName`
would need a genuinely new role to become a relation, not just a field
bolted onto an account type that already exists. Inspector and
Contractor are different: `Vendor` already *is* a real, marketplace-wide
professional-identity account type (Module 9), so an inspection's
inspector or a maintenance request's assignee can now optionally *be*
one, the same way a project's vendor assignment already works.

- **`PropertyInspection.inspectorVendorId`** and
  **`MaintenanceRequest.assignedVendorId`** (migration
  `20260903120000_add_inspector_and_assignee_vendor_links`) — both
  optional, both `onDelete: SetNull`, both reachable from the full
  marketplace directory (`GET /vendors`, same reach picking a vendor for
  a project quote already has — not scoped to vendors this property has
  worked with before). Set instead of `inspectorName`/`assignedTo`,
  never alongside it — `PropertiesService` clears whichever of the pair
  isn't given, so a row is never left with both a vendor and stale
  freeform text disagreeing about who's responsible.
- **`PropertiesService.requireVendor`** — the referential-integrity
  check every route accepting `inspectorVendorId`/`assignedVendorId`
  runs first (400s if the id doesn't resolve to a real `Vendor`), same
  spirit as the existing `projectId`/`leaseId` cross-reference checks
  just against the marketplace-wide `Vendor` table instead of a
  property-scoped one.
- **`scheduleInspection`/`updateInspection`/`reportMaintenanceRequest`/
  `startMaintenanceRequest`** all accept the new field alongside the old
  one; every inspection/maintenance-request read (`find*`, and now the
  `create` responses themselves) `include`s the linked vendor's
  `id`/`businessName`/`serviceCategory`/`verificationStatus` so the web
  UI never has to make a second round-trip to show who's assigned.
- **Web UI**: a shared `VendorOrNameField` (vendor `<select>` sourced
  from `GET /vendors`, with a freeform-text fallback that disables
  itself once a vendor is picked) appears on the inspection schedule/edit
  forms and the maintenance report/start forms in
  `pages/properties/[id].tsx`. A vendor-assigned row now reads "vendor"
  next to the business name so it's visually distinct from a freeform
  name.
- **Verified live end-to-end**: scheduled an inspection and reported a
  maintenance request each with a real seeded vendor picked from the
  dropdown, confirmed both showed the vendor's name immediately on
  creation (not just after a reload — this caught a real bug, below);
  opened the maintenance "Start" form on an already vendor-assigned
  request and confirmed it pre-filled the existing vendor rather than
  showing it unassigned; confirmed the freeform-text path (an existing
  seeded "Plumber Joe" assignment) still renders correctly alongside the
  new vendor-linked rows.
- **Bug caught and fixed during testing**: `scheduleInspection` and
  `reportMaintenanceRequest`'s `prisma.create()` calls didn't `include`
  the new vendor relation, so a freshly created row's own API response
  came back with `inspectorVendorId`/`assignedVendorId` set but no
  joined `inspectorVendor`/`assignedVendor` object — the UI's "Assigned
  to: ..." line silently didn't render until the next full list reload.
  Fixed by adding the same `include` the `find*` methods already used
  (factored into one shared `vendorSummarySelect` field so the two can't
  drift apart again) to both `create()` calls.

## Multi-turn tool use in chat (this pass)

Closes the gap the "Chat & deeper AI" pass drew on purpose and then named
under "Not built yet": `ChatService` ran at most one tool per message and
reported the result straight to the user, even if the request genuinely
needed two ("verify the documents and summarize this property" could only
ever get one of the two done). Since `AiService.runAction` never mutates
real state by itself — it only ever creates an `AiRequest`/`AiOutput`
draft; a real action only happens later, if a human separately calls
`POST /ai/outputs/:id/decision` with `accepted` (see `AiService.decide`
and `applyChainedAction`) — chaining several tool calls automatically
inside one chat turn costs nothing safety-wise beyond the calls
themselves: it just means more drafts get created before the human sees
any of them, each one still requiring its own separate Accept.

- **`ChatService.sendMessage` is now a bounded loop**, not a single call:
  after a tool runs, its result is fed back to the model as a
  `tool_result` (Anthropic's own tool-use protocol — the assistant turn
  that made the call is replayed alongside it, not just the result on its
  own) so the model can decide whether another tool call would round out
  the answer, or reply in text. Capped at `MAX_CHAINED_TOOL_CALLS = 4` — a
  cost/latency guard against a model that keeps finding "one more thing to
  check," not a safety boundary (see above for why chaining is safe to
  begin with). A tool already called this turn is dropped from what's
  offered on the next loop turn, so nothing can be run twice in one turn.
- **`LlmProvider.chat()`'s types grew a `ChatContentBlock`** (`text` /
  `tool_use` / `tool_result`) so a `ChatMessage`'s content can carry that
  exchange — but only in the in-memory scratch history `ChatService`
  builds up mid-loop. Nothing about what's persisted to `AiMessage`
  changed: each loop step still writes one plain-string `content` row
  (the same human-readable draft summary as before), so a resumed
  conversation's history reconstruction needed no changes at all.
- **`POST /ai/chat` now returns `messages: AiMessage[]`**, not a single
  `message` — one entry per chained tool call plus the final reply, oldest
  first. `AskAiPanel` (`components/AskAiPanel.tsx`) appends all of them;
  since each one is its own `AiMessage` with its own `aiOutputId`, the
  existing per-message `MiniDecision` control already rendered one
  Accept/Discard per step with no changes needed there.
- **`StubLlmProvider` needed two real fixes to chain correctly**, both
  caught live rather than by inspection: its `chat()` crashed on the new
  block-array content form until content was read through a `textOf()`
  helper; and its "last user message" lookup, unchanged, would find the
  `tool_result` block ChatService had just appended (role `user`, no
  matchable text) instead of the human's actual sentence, so a second
  keyword in the same sentence could never be found on the next loop turn
  — every chat turn silently capped at one tool call regardless of intent.
  Fixed by skipping user-role entries with no extractable text when
  looking for "the" last user message, letting the keyword search re-scan
  the original sentence on every turn, the same sentence a real model
  reasons over the whole time.
- **Verified live end-to-end** in the browser (stub provider, no
  `ANTHROPIC_API_KEY` set): asked "verify the documents, give me a summary
  of this property, and also its ROI" in a property-scoped chat and got
  three separate draft cards back in one turn — `verify_property_documents`,
  then `summarize_property`, then `model_roi_scenario` — each with its own
  `AiOutput` id and independent Accept/Discard, followed by a final text
  reply once nothing else matched. Reloaded the page and confirmed all
  three drafts and their decision controls survived the round trip through
  `GET /ai/conversations/:id`. Accepted one of the drafts from the
  reloaded thread and confirmed the decision recorded correctly, same as
  before this pass.

## An ROI & valuation dashboard (this pass)

Closes the "valuation/ROI dashboards" half of the "Deeper AI" gap under
"Not built yet" — `model_roi_scenario`'s "current" scenario already
computed a property's simple ROI, but only ever as AI-narrated text
buried in a chat reply or a quick-action draft, one snapshot at a time
with no history alongside it. This is that same computation surfaced as
an actual dashboard: real numbers in stat tiles, plus a chart of the
property's valuation history, both live on the property page rather than
something you have to ask the AI for.

- **`PropertiesService.getRoiSummary`** (`GET
  /properties/:propertyId/roi-summary`, gated by the same `property:read`
  the valuations it's built from already use) — deliberately mirrors
  `model_roi_scenario`'s "current" scenario's current-value/invested
  computation exactly (latest `PropertyValuation`, or
  `Property.estimatedValue` as a fallback; `Property.estimatedValue`
  doubles as an acquisition-cost stand-in the same way that skill treats
  it), so the dashboard and the AI skill can never quietly disagree about
  what a property's ROI is. Adds one figure the skill doesn't compute at
  all: gross rental yield, summed across every currently active lease
  (annualized by `rentFrequency`) against the current value — "no active
  lease" rather than a misleading 0% when there's nothing to divide.
- **`ValuationTrendChart`** (`pages/properties/[id].tsx`) — a hand-rolled
  inline SVG line chart, not a new dependency: this app has no charting
  library (see `apps/web/package.json`), the same lean-footprint choice
  `AnthropicLlmProvider` makes calling the Messages API with `fetch`
  instead of pulling in the Anthropic SDK. Only renders once there are
  two or more valuations to draw a trend between; with zero or one, the
  card says so instead of drawing a flat or empty chart.
- **Self-fetching, like `AskAiPanel`** — this is the one card on the
  property page whose data no other card already has loaded, so it fetches
  its own `roi-summary` independently rather than folding a fourth
  `Promise.all` entry into `PropertyDetailPage.load()`. Takes a
  `refreshToken` prop (the parent's `valuations.length`) so adding a
  valuation elsewhere on the page invalidates its fetch — caught live
  during testing: without it, a freshly added valuation left the card
  showing the old current value and the stale "add another valuation to
  see a chart" message until a full page reload, since nothing told this
  independently-fetching card that the data it depends on had changed.
- **Verified live end-to-end**: loaded the dashboard against the demo
  property's existing single valuation and confirmed the stat tiles
  matched `model_roi_scenario`'s own numbers exactly (current value,
  invested, simple ROI all identical) and gross yield matched a manual
  calculation from its two active leases; added a second valuation
  through the existing "+ Add valuation" form and confirmed the card
  updated without a reload — current value, ROI, and a genuine
  two-point trend line all changed correctly, labeled with both
  valuation dates.

## A project summary skill, and a real Reports dashboard (this pass)

Two small, genuinely different gaps closed together — one AI-side, one
deterministic — both under the "Deeper AI"/"the full fixed-dashboard
side of reports" bullets that were still open.

- **`summarize_project`** (new AI skill, `project` context) — every other
  module already had a real "give me the whole picture" summary skill
  (`summarize_property`, `summarize_inspection_history`,
  `summarize_lease_status`, `summarize_maintenance_backlog`); Module 9
  never did. Deliberately not a duplicate of `draft_project_status_update`
  (which already covers stage progress and recent narrative updates) —
  this one covers what that skill doesn't: vendor assignment, a
  milestone/approval breakdown including overdue ones, budget vs. what's
  actually been released so far, and any open disputes, with `warn: true`
  set whenever either of the last two is non-zero.
- **Fixed a real ambiguity this surfaced in `ChatService`**: the
  keyword-matching stub LLM provider has no way to tell
  `summarize_property` and `summarize_project` apart when both are
  offered and the message just says "summarize" — a real model reasons
  about which one fits the conversation, the stub can't. `ChatService`
  now filters the tools it offers down to the current conversation's own
  `moduleContext` prefix once one is set (an unscoped conversation still
  sees everything, so the existing "this conversation isn't scoped to
  anything yet" guidance still fires the same way it always did) — a
  skill whose `moduleContextPrefix` doesn't match couldn't have run in
  this conversation anyway, so this is also just less dead weight for a
  real model to consider, not only a stub workaround.
- **`GET /reports/portfolio-overview`** (`ReportsService`, new module) —
  the deterministic counterpart to `generate_portfolio_report` (the
  AI-narrated account-wide skill): real counts and totals across every
  property an account owns — properties/projects by status, open vs.
  resolved maintenance, inspection pass/fail/needs-attention breakdown,
  and top vendors by amount paid. Vendor spend is grouped by (vendor,
  currency), never summed across currencies — same caution
  `PaymentsService.getAccountOverview` already applies to deposits/
  releases, since one account can run projects in more than one currency
  even though `Property.estimatedValue` itself is implicitly the
  account's own single currency (no currency field of its own). Gated on
  `property:read`, the same permission every owner-side role already
  carries and vendor/supplier accounts don't — an owner-side report, not
  a marketplace one, same reasoning `AccountPaymentsController.
  getOverview` already uses for `payment:read`.
- **Web**: a new `/reports` page and sidebar nav item — stat tiles, a
  plain labeled-bar status breakdown (not another SVG chart: a handful of
  counts against a total doesn't need an axis or points the way the ROI
  dashboard's real time series did), and a top-vendors list.
  Self-fetching, same pattern the ROI dashboard and `AskAiPanel` already
  use.
- **Verified live end-to-end**: ran `summarize_project` against the demo
  Kitchen Renovation project and confirmed every figure (vendor name,
  2/4 milestones completed, budget 2,500,000 NGN with 901,000 released —
  36%) against the underlying data by hand; loaded `/reports` and
  confirmed its numbers independently — including landing on the exact
  same 901,000 NGN top-vendor total the AI skill had just computed
  separately, a real cross-check that the two features can't quietly
  disagree about the same underlying payouts.

## Real identity (KYC) verification — Sumsub (Module 6, originally Dojah/NIN, swapped this pass)

Module 6's actual remaining gap: `Vendor`/`Supplier.verificationStatus`
verify a *business*, `Document.verificationStatus` verifies *paperwork*
— nothing in this scaffold ever verified the *person* behind an account
at all. This was originally built against Dojah (Nigeria's National
Identification Number, a single lookup call) but swapped for Sumsub
once real Dojah credentials turned out to be placeholder text
(`"your_app_id"`/`"your_secret_key"`, not real values) while a genuine
Sumsub account was available instead. The swap changed more than the
provider name: Sumsub is document+selfie review, not a single-field
lookup, so the shape of the whole flow is different, not just which
service a `Bearer` header points at.

- **`User` gained `sumsubApplicantId`, replacing `ninLast4`** —
  `identityVerificationStatus`/`identityVerificationNotes`/
  `identityVerifiedAt` stayed (provider-agnostic), but there's no NIN
  digits to keep a trailing trace of anymore. `sumsubApplicantId` is
  what a later status check polls against, since Sumsub's review happens
  asynchronously on their own side — genuinely different from Dojah's
  NIN lookup, which returned a definitive match/no-match in the same
  request that made it. Still deliberately *not* modeled on `Vendor`/
  `Supplier.verificationStatus`'s human-`platform_reviewer` pattern —
  Sumsub's own reviewers are the human step, just not one of this
  platform's own roles, so `IdentityService` sets the status directly
  from Sumsub's result, no `platform_reviewer` queue involved.
- **`SumsubService`** (`src/identity/sumsub.service.ts`, replacing
  `dojah.service.ts`) — same "plain fetch, no SDK, `isConfigured` gate"
  shape every gateway service in this scaffold already uses. The one
  real auth difference from every other integration here: Sumsub signs
  *every* request with an HMAC-SHA256 over `timestamp + method + path +
  body` (`X-App-Token`/`X-App-Access-Sig`/`X-App-Access-Ts` headers), not
  a static bearer token or header pair — `sign()` does that once, shared
  by all three calls (`createApplicant`, `getAccessToken`,
  `getApplicantStatus`). No sandbox-vs-production host split the way
  Dojah had — sandbox vs. live is just which app-token/secret pair you
  use, both against the same `api.sumsub.com`. Deliberately pull-based,
  same reasoning `PaystackService`'s and the old `DojahService`'s own
  comments already gave for avoiding webhook receivers: Sumsub's normal
  integration expects a webhook URL for review-complete callbacks, but
  there's no stable public URL for local dev to receive one, so
  `IdentityService.refreshStatus` polls `GET /resources/applicants/:id/
  status` on demand instead.
- **Two actions, not one** — `POST /identity/start` creates (or reuses)
  a Sumsub applicant and mints a fresh short-lived WebSDK access token;
  `POST /identity/refresh` re-reads Sumsub's current review answer and
  updates `identityVerificationStatus` accordingly (`GREEN` → `verified`,
  `RED` → `failed` with `rejectLabels` as the note, anything else stays
  `pending`). Splitting these out (rather than Dojah's single call) is
  the direct consequence of review being asynchronous: nothing here can
  return a final answer synchronously the way a NIN lookup could.
- **No ID document or selfie image ever touches this backend.** Sumsub's
  own WebSDK (loaded from their CDN in the browser) talks to Sumsub
  directly using the short-lived access token `POST /identity/start`
  returns — this server only ever sees Sumsub's own applicant id and
  final review answer, never the underlying photos.
- **`IdentityController`** (`GET /identity/me`, `POST /identity/start`,
  `POST /identity/refresh`) — still deliberately user-scoped, not
  account-scoped: no `AccountContextGuard`/`PermissionsGuard` the way
  every other controller in this codebase has, since identity
  verification is about the person signed in, independent of which
  account they currently have selected. Same reasoning `AuthController`'s
  own `GET /auth/me` needs nothing more than `JwtAuthGuard` for.
- **Web**: the "Identity verification" card on the Members page
  (`pages/accounts/members.tsx`) — there's no dedicated profile screen
  yet, and this is the closest thing to account-level settings that
  exists — now loads Sumsub's WebSDK script on demand and launches it
  into a container div once `POST /identity/start` returns a token,
  plus a "Check status" button for the pull-based re-check `POST
  /identity/refresh` needs (nothing pushes a result to the browser the
  way a webhook would).
- **Verified live, fully — real credentials arrived shortly after this
  was first written.** First confirmed the "unconfigured" path behaves
  correctly (clicking "Start verification" through the real web form
  surfaced the exact clear error, `"...set SUMSUB_APP_TOKEN/
  SUMSUB_SECRET_KEY/SUMSUB_LEVEL_NAME to enable it"`), same bar Dojah
  was held to before it. Once real sandbox credentials and a configured
  `SUMSUB_LEVEL_NAME` arrived, ran the actual flow end to end through
  the real app: `POST /identity/start` created a genuine Sumsub
  applicant (confirmed via a direct signed API call first — a status
  lookup on a fake applicant id came back `404 "not found"` rather than
  a `401` auth error, proving the HMAC signing and credentials were both
  correct before ever touching this app's own code) and returned a real
  WebSDK access token; the web card loaded Sumsub's actual CDN script
  and launched their real onboarding widget (consent screen, real
  Privacy Notice/data-processing links) in the browser — not a mock.
  Stopped short of submitting an actual ID document (nothing legitimate
  to test with, and not necessary to confirm the integration), but
  confirmed the rest of the chain: `GET /identity/me` showed the new
  `sumsubApplicantId` correctly persisted, and `POST /identity/refresh`
  correctly read back `pending` (Sumsub's own review hadn't completed,
  since no document was ever submitted) and cleared the old Dojah-era
  failure note — reflected correctly in the web UI ("Pending" badge,
  "Continue verification"/"Check status" buttons) after a reload.
- **What changed from the Dojah pass that's now stale**: the exact-token
  name-matching caveat (`namesMatch`, Dojah-specific code that no longer
  exists) no longer applies — Sumsub does its own identity matching as
  part of its document review, opaque to this codebase, so there's
  nothing analogous to audit here. Whether Sumsub's own matching is
  fuzzy or exact isn't something this integration controls or needs to.

## A seller-facing listing summary skill (this pass)

Closes the other half of "Deeper AI — listing/risk summaries beyond
`assess_listing_risk`". `assess_listing_risk` is deliberately
buyer-facing and public (no `accountId` filter, same reach `GET
/listings/:id` itself has — its own comment explains why). This is the
opposite on purpose: `summarize_listing` filters by `ctx.accountId` the
same way `summarize_property`/`summarize_project` do, because market
performance (inquiry/offer counts, a competing offer's amount) is
exactly the kind of thing a seller wouldn't want a random buyer's chatbot
session surfacing.

- **`summarize_listing`** (new AI skill, `listing` context,
  `listing:read`) — views, saves, days on market, inquiry count (and how
  many are still unanswered), offer count (with the highest amount and
  how many are awaiting a response), and whether an offer's already been
  accepted. `warn: true` when there's an open, unanswered offer — the
  one state that actually calls for the seller to act.
- **Verified live**: ran it against the demo account's real "14 Ocean
  Drive" listing and confirmed every figure against the underlying data
  — 9 views (incremented by loading the listing page itself, a real
  side effect, not a stub artifact), 4 days on market (matches its
  `createdAt`), zero inquiries/offers (matches the seed data). Confirmed
  the owner-only scoping is actually enforced, not just intended: a
  different account without `listing:read` at all got a 403 attempting
  the same action — the `accountId` filter itself reuses the exact
  pattern already proven correct by every other `summarize_*` skill this
  pass, so a same-permission-different-owner cross-tenant check wasn't
  repeated here.

## Vendor and supplier trust audits — an independent judgment call (Module 6, this pass)

Every earlier trust-score pass in this README carried the same caveat:
the score is the platform's own arithmetic over data the vendor's/
supplier's own marketplace activity produced — never a real judgment
call from an independent party. "A real neutral reviewer for vendor/
supplier verification" (above) closed that for `verificationStatus`, a
binary/tri-state gate with no history — each call overwrites the last,
and it was never meant to carry reasoning. This pass adds something
different: a real audit record, with mandatory reasoning, that's kept
forever rather than overwritten, blended into the trust score alongside
the identity verification (see "Real identity (KYC) verification —
Sumsub" above) already built for the account operator.

- **`VendorTrustAudit`/`SupplierTrustAudit`** (new models, one migration,
  parallel to every other Vendor/Supplier pair in this schema rather
  than a shared polymorphic table) — `rating` (`clean` /
  `minor_concerns` / `major_concerns`), a **required, non-empty** `notes`
  field (an audit with no recorded reasoning isn't an audit — the
  existing `verificationNotes` field on `Vendor`/`Supplier` stayed
  optional on purpose; this one didn't), `reviewedByUserId`, and
  `createdAt`. Every audit is kept — filing a new one never deletes or
  overwrites an old one — only the most recent feeds the live score, the
  same way only the current `verificationStatus` value does, but the
  full history stays visible.
- **`vendors/trust-score.ts` and `materials/trust-score.ts`** — extended,
  not replaced. Two new factors: `latestAudit` (`clean: +15`,
  `minor_concerns: -10`, `major_concerns: -35` — deliberately the
  widest swing of any factor in the formula, since a reviewer's own
  judgment call is meant to be the most authoritative signal it has) and
  `identityVerifiedOperator` (`+10` when any member of the vendor's/
  supplier's account has `User.identityVerificationStatus === "verified"`
  — checked with a `count`/`some` over `AccountMember`, not "the first
  member," since an account can in principle have more than one). Same
  `[0, 100]` clamp as before, so no rebalancing of the existing factors
  was needed.
- **`POST`/`GET /vendors/:vendorId/trust-audits`** and the same pair
  under `/suppliers/:supplierId/trust-audits` — reuse the exact
  `vendor:verify`/`supplier:verify` (file an audit) and `vendor:read`/
  `supplier:read` (read the history) permissions `setVerificationStatus`
  already used. No new permission keys, no `seed.ts` changes — the same
  `platform_reviewer` role that can flip verification status is the one
  that can file an audit, deliberately: this is one more action for the
  same neutral party, not a second reviewer role.
- **`explain_vendor_trust_score`/`explain_supplier_trust_score`** — the
  factor list and system prompt both updated to say plainly that part of
  the score now comes from a reviewer's own audit and identity
  verification, not only recomputed activity, while still cautioning
  it's one input a buyer should weigh themselves, not proof either way.
- **Web UI**: `PlatformReviewPanel` on both `pages/vendors/[id].tsx` and
  `pages/marketplace/materials/[id].tsx` gained a "File a trust audit"
  sub-form (rating buttons + a required notes textarea) beneath the
  existing verification-status controls, visible only to the same
  `platform_reviewer`-only panel. A new self-fetching audit-history card
  (`TrustAuditHistory` / `SupplierTrustAuditHistory`, same
  `refreshToken`-prop pattern `RoiSummaryCard` established) shows every
  audit ever filed — visible to anyone who can see the vendor/supplier at
  all, the same transparency reviews already get, not just the reviewer
  who filed them.
- **Verified against the live dev API and in the browser**, switched
  into the seeded `PropertyOnTheGo Trust & Safety` platform-reviewer
  account: filed a `minor_concerns` audit on the seeded vendor (score
  dropped 53 → 43, the exact −10) and a `major_concerns` audit on the
  seeded supplier (score dropped 90 → 55, the exact −35); both audits
  appeared immediately in their history card with no page reload, and
  the "Latest platform audit" line on the trust-score factors updated to
  match. Switching back to the demo owner's own account hid the "File a
  trust audit" form (and the rest of `PlatformReviewPanel`) while the
  audit-history card stayed visible, confirming the write path is gated
  and the read path isn't. `explain_supplier_trust_score` via Ask AI
  picked up both new factors correctly in its stub-mode draft ("Most
  recent platform audit: major concerns", "This supplier's own identity
  has not been verified").
- **What this still isn't.** A reviewer's audit only covers what that
  reviewer actually checked — there's no mandated checklist, no site
  visit requirement, no external records lookup (business registration,
  insurance, licensing) built into the flow itself; `notes` being
  required means an audit records *that* reasoning was given, not that
  the reasoning meets any particular bar. Filing an audit is also still
  entirely manual — nothing prompts a reviewer to re-audit a vendor/
  supplier on any cadence, so a score can carry a stale audit indefinitely
  once one exists (and no audit at all, same as before this pass, if one
  never gets filed). The design intent is that these gaps stay judgment
  calls made *by a human reviewer*, not something to automate away — but
  it does mean the platform still can't promise every trust score reflects
  a recent, thorough look at the business behind it.

## A self-reported professional license for vendors — licensed-Inspector/Contractor (this pass)

Closes half of the gap "Property inspections" and "Maintenance requests"
both flagged: "no separate licensed-Inspector/licensed-Contractor
account type." Building a full licensing *credential* system (a
reviewer-issued license record, backed by an external registry lookup)
would be a much larger undertaking than this pass's scope — what's
built instead is the same tier this scaffold already gives
`Lease.tenantName` or `MaintenanceRequest.assignedTo`: record what the
vendor itself claims, don't pretend the platform verified it. Tenant
identity (the other half of that same flagged gap, on `Lease`) stays
fully out of scope — see "What this doesn't do" below for why it's a
different order of work.

- **`Vendor.licenseNumber`/`licenseIssuingBody`/`licenseExpiresAt`**
  (new columns, one migration) — all three set together or not at all,
  same shape the bank-detail fields already use. Not gated to any
  particular `serviceCategory`: nothing in this scaffold's category list
  (`electrical`, `security_installation`, `general_contracting`, …)
  distinguishes which ones are really licensed trades in a given
  jurisdiction, so — same "record what's true, no forced workflow"
  reasoning `Lease.tenantName` already documents — any vendor can add
  one if it applies to them.
- **`PATCH /vendors/me/license`** — `vendor:write`, the vendor's own
  account only, same gate `create()`/`setBankDetails()` already use. No
  external registry lookup backs this (none is wired up in this
  scaffold) — unlike `setBankDetails`, which resolves the account number
  against a real payment gateway before saving, this just records
  whatever the vendor typed in, the same trust level `PropertyInspection.
  inspectorName`/`MaintenanceRequest.assignedTo` already had.
- **`computeVendorTrustScore` gains a `licenseExpired` factor — and a
  deliberate asymmetry.** A license on file and *not* expired adds
  nothing to the score; one that's expired costs `-10`, the same weight
  class as a dispute. The reasoning is in the schema comment on
  `Vendor.licenseNumber`: since this field is self-reported and nothing
  here verifies it, letting it add points would let a vendor raise its
  own trust score just by typing a license number in — the same integrity
  problem `identityVerifiedOperator`/`latestAudit` (a real KYC check, a
  human reviewer's judgment) don't have, because neither one is
  something the vendor's own account can set for itself.
- **`explain_vendor_trust_score`** — the factor list now calls out an
  expired license explicitly ("This vendor lists a professional license
  that has expired") when one applies.
- **Web UI**: a `LicenseForm` on `pages/vendors/me.tsx` (same
  edit-in-place shape `BankDetailsForm` already established — view, "+
  Add"/"Update", a form, save/cancel), and the public vendor profile
  (`pages/vendors/[id].tsx`) shows the license inline under the business
  name, styled red once expired, plus a "listed license has expired" note
  alongside the other trust-score factors.
- **Verified against the live dev API and in the browser**: added a
  license with a past expiry date to the seeded vendor account, confirmed
  `PATCH /vendors/me/license` saved it and the public `GET /vendors/:id`
  response carried `licenseExpired: true` with the expected `-10` (trust
  score dropped from 43 to 33, band moved from "fair" to "caution");
  edited the expiry to a future date and confirmed the same request
  carried `licenseExpired: false` with the score back at 43 — the *lack*
  of a positive swing confirming the "only ever costs, never earns"
  design actually held. In the browser: the license form saved and
  re-rendered correctly without a page reload, the public profile page
  showed the red "expired" styling, and `explain_vendor_trust_score`'s
  Ask AI draft picked up the new factor correctly.
- **What this doesn't do.** No external license-registry lookup exists
  anywhere in this scaffold, so "licensed" here means "claims to be
  licensed," not "the platform confirmed it" — closing that gap for real
  would mean integrating a real state/national licensing-board API the
  way `SumsubService` integrates identity verification, which no such
  API was available to wire up here. A `platform_reviewer`'s trust audit (see
  "Vendor and supplier trust audits" above) is the closest thing to an
  actual check today: nothing stops a reviewer from calling the issuing
  body and recording what they found in an audit's own `notes`, but
  nothing prompts them to, either. **Tenant identity is not part of this
  pass and is a meaningfully bigger lift than the vendor-license piece
  above**, for a reason specific to it: Inspector/Contractor could
  attach to `Vendor` because `Vendor` already *is* a real, marketplace-
  wide account type with its own login (Module 9) — this pass only had
  to add fields to something that already existed. Tenant has no
  equivalent anywhere in this scaffold: no account type, no role, no
  registration/login flow a renter could use, so `Lease.tenantName`
  staying freeform text isn't a smaller version of the same gap, it's a
  different, larger one — a real Tenant identity needs a new account
  type and a tenant-facing signup path built from nothing, not three new
  columns on a model that already had somewhere to attach them.

## A real Tenant identity (Module 13, this pass)

Closes the gap the pass above deliberately left open: a genuinely new
`AccountType.TENANT`, its own `tenant` role, and a tenant-facing view
onto its own lease — the "bigger lift" flagged in every earlier mention
of this gap. The key realization that kept this from being as large as
it sounds: `pages/accounts/new.tsx` already *is* a self-serve
account-type-picker-plus-login for every account type this scaffold
has (INDIVIDUAL/FAMILY/COMPANY/VENDOR/SUPPLIER all reach it the same
way) — adding TENANT to that list is most of "a tenant-facing signup
path," not a new screen built from nothing.

- **`AccountType.TENANT`** (new enum value) and a **`tenant` role**
  (`seed.ts`) — deliberately minimal, same "only what its own screen
  needs" reasoning `platform_reviewer` already documents: `lease:read`,
  `maintenance:read`, `maintenance:write`. No new permission keys — this
  reuses the exact same keys the landlord-facing lease/maintenance
  routes already check, since a tenant's own routes never take a
  `:propertyId`/`:projectId` param for `PermissionsGuard`'s ABAC to key
  on, so plain RBAC is the entire access check (same reasoning the
  vendor/supplier trust-audit routes gave for reusing `vendor:verify`/
  `supplier:verify` instead of inventing new permissions).
- **`Lease.tenantAccountId`** (new column) — optional, `onDelete:
  SetNull`, same "landlord picks a real account, nothing auto-links"
  shape `inspectorVendorId`/`assignedVendorId` already established for
  Inspector/Contractor. The one real difference: there's no marketplace
  directory to pick a tenant from the way `GET /vendors` lets a landlord
  browse vendors (a browsable directory of every tenant on the platform
  would be a real privacy problem `Vendor`'s public directory never had
  to consider) — so linking resolves by the lease's own `tenantEmail`
  instead of a client-supplied id.
- **`POST /properties/:propertyId/leases/:leaseId/link-tenant`**
  (`PropertiesService.linkTenantAccount`, `lease:write`, same ABAC as
  every other lease mutation) — looks up the `User` registered under
  `lease.tenantEmail`, then that user's own `AccountType.TENANT`
  membership, and links it. Clear 400s at each step it can fail: no
  `tenantEmail` on file, no registered user with that email yet, or a
  registered user who hasn't set up a Tenant account yet — this never
  creates an account on the tenant's behalf, only links one that
  already exists.
- **A new `TenantModule`** (`apps/api/src/tenant`) — its own
  controller/service rather than more routes on `PropertiesController`,
  because every route here is scoped to "whichever lease this account
  is linked to," which is fundamentally incompatible with
  `PermissionsGuard`'s `:propertyId` ABAC (a tenant doesn't own the
  property, so that check would 404 it out of every landlord-facing
  route — the same reason vendor's own actions live under `/vendors/
  me/...` rather than `/projects/:projectId/...`). `GET /tenant/lease`
  (the linked lease, its property, and rent history — 404 until a
  landlord links one), `GET /tenant/maintenance-requests`, and `POST
  /tenant/maintenance-requests` (fills in `propertyId`/`leaseId`/
  `reportedBy` from the caller's own linked lease — a tenant never
  supplies or sees another lease's id).
- **Web UI**: `pages/tenant/index.tsx` — read-only lease/property/rent-
  history display (rent/dates/deposit stay landlord-controlled, same as
  the landlord's own lease card), plus a maintenance-report form mirrored
  from `pages/properties/[id].tsx`'s own. `AppShell`'s nav shows a "My
  Lease" item only for a TENANT-type account — the one account type
  with no existing nav item that leads anywhere useful (unlike
  `platform_reviewer`, which reaches its own screens through the
  Vendors/Marketplace items that already exist for other reasons). The
  landlord's own Leases card (`pages/properties/[id].tsx`) gained a
  "Link tenant account" action (shown once `tenantEmail` is set and
  no account is linked yet) and a "Tenant account linked (...)" /
  "No tenant account linked yet" line.
- **Demo data**: a fifth membership on the same demo login (`Demo
  Tenant`, `AccountType.TENANT`) plus a seeded lease on the demo
  property whose `tenantEmail` matches that same login — left
  deliberately *unlinked* in seed data so `link-tenant` is something to
  actually call and verify, not a fact baked in ahead of time.
- **Verified live end-to-end**: as the owner account, linked the seeded
  lease to the seeded tenant account (confirmed via the API response
  that `tenantAccountId` was set, and via a page reload that the
  landlord's own Leases card now reads "Tenant account linked (Demo
  Tenant)"); switched to the tenant account and confirmed `GET /tenant/
  lease` returned the real property/rent/deposit details; reported a
  maintenance issue as the tenant and confirmed it appeared immediately
  in the tenant's own list *and* on the landlord's own property page
  with `reportedBy: "Demo Tenant"`. Confirmed isolation two ways: the
  owner account's own `GET /tenant/lease` returns `null` (empty 200, the
  same shape `GET /vendors/me` already returns for "no profile yet" —
  `lease:read` is shared with the landlord roles, so the isolation comes
  from filtering by the *caller's own* `accountId`, not from a
  permission boundary), and the vendor account's own `GET /tenant/lease`
  correctly 403s (`vendor` role doesn't carry `lease:read` at all).
- **What this doesn't do.** A tenant still can't edit their own lease —
  by design, rent/dates/deposit stay landlord-controlled. See "Closing
  the three Tenant identity gaps" below for the auto-link notification,
  lease-scoped documents, and `summarize_my_tenancy` this pass added
  right after this one — all three were still open when this section was
  first written.

## Closing the three Tenant identity gaps: auto-link, lease-scoped documents, a tenant AI skill (this pass)

The Tenant identity pass above shipped with three named gaps. This pass
closes all three in one sitting, since none of them touch each other's
code and all three are natural, bounded follow-ons rather than new
design questions.

**1. A tenant signing up no longer needs the landlord to click anything.**
`AccountsService.create` — the same method every account type's own
self-serve signup already runs through (`pages/accounts/new.tsx`, see
"A real Tenant identity" above) — now auto-links a brand-new
`AccountType.TENANT` account to every still-unlinked `Lease` whose
`tenantEmail` matches the new user, then emails every member of each
lease's landlord account via the same `EmailService` the invite flow
already uses. `PropertiesService.linkTenantAccount` (the manual "Link
tenant account" button) stays — it's what still handles a lease created
*after* the tenant already has an account, or a manual correction — but
the common case (tenant signs up after the lease exists) no longer
needs it. **Real gap found while verifying this**: `pages/properties/
[id].tsx`'s lease form had no `tenantEmail` input at all — the field
existed on `CreateLeaseDto` server-side (and was reachable via `PATCH`)
but nothing in the UI could ever set it, which meant "Link tenant
account" could only ever work on the one lease the seed script wrote by
hand. Fixed by adding the field to both the create and edit lease
forms.

- Verified live end-to-end: created a lease with a fresh `tenantEmail`
  as the landlord, registered a genuinely new user under that same
  email, created a `TENANT` account for them — no "Link tenant account"
  click anywhere — and confirmed both sides: the new tenant's own `GET
  /tenant/lease` immediately returned the real lease, and the landlord's
  own Leases card read "Tenant account linked (New Auto Tenant)" on
  reload. Confirmed the notification actually fires (server log:
  `Auto-linked tenant account ... — notified demo-owner@propertyonthego.test
  (email send failed — see the EmailService error above)`) — "failed"
  here is Resend's own sandbox-key restriction (delivers only to the
  key's own registered address, see `EmailService`'s comment), not a bug
  in this pass; the attempt and its outcome are both logged correctly
  either way.

**2. Documents can now be tagged to a specific tenancy.** `Document.
leaseId` (new column, optional, `onDelete: SetNull`) — same "optional
cross-reference must actually belong to this property" cross-check
`ReportMaintenanceRequestDto.leaseId` already gets
(`DocumentsService.create` derives/validates `propertyId` from the
lease when only `leaseId` is given). The landlord's upload form
(`pages/documents/index.tsx`) grows a "Tenancy (optional)" picker once
a property with active leases is selected; `GET /tenant/documents`
(new route, `document:read` — now granted to the `tenant` role) shows a
tenant only documents tagged to their own lease, never the landlord's
full vault. **Bug caught and fixed during testing** — the same class of
bug this session already found once before on `PropertyInspection`/
`MaintenanceRequest`'s own vendor links: `DocumentsService.create()`
didn't `include` the `lease` relation on its own return value, so the
web UI's optimistic update (which renders the `POST` response directly,
not a re-fetch) showed no tenancy tag until the next full reload. Fixed
by adding the same `include` `findForProperty`/`findForAccount` already
use.
- Verified live: uploaded a document as the landlord with "Demo Tenant"
  picked from the new tenancy dropdown, confirmed it read "Demo Tenant's
  tenancy (visible to them)" immediately (no reload needed, post-fix),
  and confirmed it appeared in that tenant's own `/tenant` page under
  Documents.

**3. `summarize_my_tenancy`** (new AI skill, `tenant` context,
`lease:read`) — the tenant-facing counterpart to `summarize_lease_status`:
rent status, whether it looks overdue (same `FREQUENCY_DAYS`
approximation), whether the lease is ending within 60 days, and how
many maintenance requests are still open, all computed from the one
lease `Lease.tenantAccountId` links to the caller's own account — no id
in `moduleContext` needed, unlike every other skill in this registry,
since a tenant's own account already names the only lease it could ever
ask about. `ai:act` is now granted to the `tenant` role for exactly
this. Verified live: ran it from the `/tenant` page's Ask AI panel and
confirmed the draft matched the page (open maintenance count included).

## CSV export and scheduled email digests for Reports (this pass)

Closes "the rest of the Reports module" the blueprint review named
separately from Module 14's own dashboard: `GET /reports/
portfolio-overview` (see "A project summary skill, and a real Reports
dashboard" above) gave a landlord real numbers on screen, but nothing
to take away from it and nothing that reached them without opening the
app. Two genuinely different things closed together because both are
small, don't touch each other's code, and are natural follow-ons to the
same dashboard.

- **`GET /reports/portfolio-overview/export`** (`property:read`, same
  gate as the dashboard itself) — a real CSV file (`Content-Type: text/
  csv`, RFC 4180 escaping — a property name or address with a comma in
  it doesn't silently corrupt the columns after it), not the same JSON
  restated with commas. Two tables in one file since plain CSV has no
  concept of sheets: the actual property list first (the atomic data
  worth opening in a spreadsheet and filtering yourself), the dashboard's
  own summary totals beneath it, so the file stands alone without the
  dashboard open alongside it. The web `Reports` page's new "Export CSV"
  button fetches it and hands the browser a `Blob` to download — a plain
  `<a href>` can't carry the httpOnly auth cookie or `X-Account-Id`
  header this route needs, so the file has to be fetched in JS first.
- **Real scheduled email digests** — `Account.reportDigestFrequency`
  (`off` | `weekly` | `monthly`, new column, off by default) plus a
  genuine `@nestjs/schedule` cron (`ReportsSchedulerService`, added as a
  real dependency — pinned to `6.1.3` since the latest major needs Nest
  v11/v12 and this scaffold is still on v10), not a settings field
  nothing reads. The daily job (`findAccountsDueForDigest`) checks every
  opted-in account's `reportDigestLastSentAt` against a plain day-count
  threshold (7 or 30 days — same order-of-magnitude approximation
  `summarize_lease_status`'s own `FREQUENCY_DAYS` already uses, not a
  real calendar) and sends whoever's due. `ReportsService.sendDigest` —
  the exact method both the cron and a manual "Send me one now" button
  call — emails every member of the account (same "notify whoever's
  actually behind this account" reasoning the tenant-signup
  notification above already uses) via the same `EmailService` the
  invite flow and tenant notifications use, and always stamps
  `reportDigestLastSentAt` so a manual send counts toward the schedule
  too.
- **New `PATCH /reports/digest-subscription`** (`property:write` — a
  standing config change, not a read) and **`POST /reports/
  digest-subscription/send-now`** (`property:read` — sending a copy of a
  report the caller can already see doesn't need a higher bar). The web
  `Reports` page's new "Email digest" card is both the opt-in control
  and, since "send now" runs the identical code the cron would run,
  the way this job's own correctness is actually verifiable without
  waiting a real day for it to fire.
- **Verified live**: exported the CSV and confirmed both tables' numbers
  matched the dashboard exactly (including correct RFC 4180 handling);
  set the digest to "Weekly," confirmed it read back correctly after a
  full page reload; clicked "Send me one now" and confirmed the server
  log shows a real send attempt per account member (`Portfolio digest
  for account ... — ... (email send failed — see the EmailService error
  above)` — "failed" here is Resend's sandbox-key restriction, the same
  one every other notification in this scaffold hits in this dev
  environment, not a bug); confirmed the new routes carry the same
  permission gate as the existing dashboard route (a role without
  `property:read` gets the identical 403).
- **What this doesn't do.** The daily cron itself was never observed
  actually firing on its own schedule — that would take a real 24-hour
  wait — so what's verified is that `sendDigest` (the method it calls)
  works correctly and that the job registers without error at startup;
  its own timer firing is unverified, structurally identical code to
  what was verified, but still unverified. No PDF export, and no digest
  content beyond the same numbers the dashboard already shows. A real
  report builder was out of scope for this pass specifically — see "A
  real report builder" further below, which closed that gap in a later
  pass.

## AI-generated renovation visualizations — the 2D half only (this pass)

"AI-generated renovation visualizations" was Priority 6's own last
open item, explicitly gated on Module 22 (AR/VR) existing at all. It
doesn't, and this pass doesn't build it — real AR needs either a native
mobile app (ARKit/ARCore; this scaffold has no mobile app) or WebXR
(which doesn't work in iOS Safari, ruling out a large share of real
users), real VR needs a full 3D content pipeline (three.js or
equivalent, actual 3D assets), and turning room photos into a 3D space
at all needs photogrammetry or NeRF-based reconstruction — no library or
service for any of that is wired up here, and picking/integrating one
is a multi-week research problem in its own right, not a bounded slice.
Attempting even a stub felt like it would cost far more than it's worth
for a scaffold, so it's documented here as a real, large, deliberately
out-of-scope undertaking rather than faked.

What *is* buildable, and what this pass builds instead: a bounded 2D
slice — point at a room photo, describe a renovation, get back an
AI-edited "after" image. Not a render of the user's actual space, a
draft to get a feel for an idea.

- **`RenovationVisualization`** (new model) — `beforeImageUrl` (same
  "URL you provide yourself" convention `Document.fileUrl` already
  uses — no upload pipeline exists in this scaffold), `prompt`,
  `afterImageUrl` (set once generation succeeds), `status` (`pending` |
  `completed` | `failed`) and `errorMessage` — same "record what
  actually happened, then re-throw" shape `IdentityService.verifyNin`
  already uses for a third-party call that might fail or might not be
  configured. Optionally linked to a `Project`, always to a `Property`.
  Deliberately *not* routed through the `AiRequest`/`AiOutput`/
  `AiActionApproval` pipeline every `AiSkill` uses (`AiSkillResult` is
  `{ draftLabel, items: string[], warn }` — text only, no image output
  shape exists there at all) — there's no "draft to accept/discard"
  here the way a generated description has; the image itself is the
  delivered result, closer in shape to `PropertyValuation` than to an
  AI skill's draft text.
- **`OpenAiImageService`** (`src/visualizations/openai-image.service.ts`)
  — same "plain fetch, no SDK, `isConfigured` gate" shape
  `SumsubService`/`PaystackService` already use. Calls OpenAI's Images
  *edit* endpoint (an existing photo plus a prompt → a genuinely edited
  version — the actual fit for "renovate this room," not a from-scratch
  text-to-image call). **Real money per call, no sandbox/test mode** —
  flagged plainly in `.env.example`, unlike every other optional
  integration in this scaffold, which all have a free sandbox tier.
- **`StorageService`** (`src/visualizations/storage.service.ts`) — the
  other new piece "Search, media, and vector layers" (below) already
  flagged as entirely missing: real object storage (Cloudflare R2,
  S3-compatible), not a fake "just keep the provider's own URL"
  shortcut — OpenAI's own result is `b64_json` (no hosted URL to even
  borrow), and R2 is where the *decoded* image actually ends up living
  permanently. The one deliberate exception to this scaffold's own
  "plain fetch, no SDK" convention: uses the official
  `@aws-sdk/client-s3` package rather than hand-rolling one, because
  what makes every other integration here simple enough to hand-roll is
  that they're plain bearer-token REST calls — S3's protocol is
  SigV4-signed requests (canonical request construction plus an
  HMAC-SHA256 signing chain), real cryptographic protocol work a
  well-audited SDK already does correctly, not a shortcut worth
  avoiding a dependency for.
- **New `VisualizationsModule`** — `POST`/`GET /visualizations/
  property/:propertyId` (same "`/documents/property/:propertyId` rather
  than `/properties/:propertyId/documents`" independence
  `DocumentsController`'s own comment already explains, so this module
  and `PropertiesModule` stay decoupled; `PermissionsGuard`'s `:propertyId`
  ABAC keys on the param name regardless of which controller it's on).
  `property:write` to generate (a new record, same tier `addValuation`
  sits at), `property:read` to list — no new permission keys.
- **Web UI**: a "Renovation visualizer" card on `pages/properties/
  [id].tsx`, next to Valuations — a form (before-photo URL, prompt,
  optional project link) and a history list showing before/after images
  side by side once complete, or a red "Failed" badge with the real
  error message when generation didn't work. A disclaimer line makes
  the "not a real render of your space" caveat impossible to miss.
- **Verified live**: with no `OPENAI_API_KEY` configured (no real key
  was available while this was first written — same bar `SumsubService`/
  `StripeService` were both held to before their own credentials
  arrived), submitted a real request through the actual form and
  confirmed the exact clear error surfaced ("Image generation is not
  configured on this server — set OPENAI_API_KEY to enable it"), that
  the attempt was still persisted as a `failed` row with that same
  message (visible in the history list, red badge, after a reload — not
  silently dropped), and that the new routes carry the same permission
  gate as the rest of this scaffold (a role without `property:read` gets
  the identical 403).
- **Update: a real `OPENAI_API_KEY` arrived shortly after.** Confirmed
  it's genuinely valid (a direct model lookup call authenticated and
  returned `gpt-image-1`'s own metadata), then ran
  `OpenAiImageService.generateEdit`'s exact request logic standalone
  against the real API — fetched a real photo, built the same multipart
  request this service builds, sent it to OpenAI's edit endpoint.
  Authentication and request-shaping are both confirmed correct: OpenAI
  responded with a real, specific error rather than a connection or
  validation failure — `"insufficient_quota" / "credit_balance_exhausted"
  — You have no credits remaining"` — a billing issue on the account
  the key belongs to, not a bug in this integration. Real end-to-end
  generation (and `StorageService`'s R2 upload step, which also isn't
  configured yet — see the schema comment on why it needs five separate
  values, not the two `.env` had at this point) both remain unverified
  until credits are added and R2 is fully configured.
- **Update: real R2 credentials arrived (all five, correctly named)
  shortly after that.** Ran `StorageService.uploadImage`'s exact logic
  standalone against the real bucket — a real `PutObjectCommand` through
  `@aws-sdk/client-s3` succeeded, and the resulting public URL
  (`R2_PUBLIC_BASE_URL` plus the generated key) was independently
  fetchable and returned the uploaded image with the correct
  `Content-Type` — full confirmation of the one deliberate "real SDK,
  not plain fetch" exception this file's own comment explains. OpenAI
  generation itself is still blocked on the same billing issue above
  (unrelated to R2, and unchanged) — so a full generate-then-store
  request through the actual web form still isn't possible yet, but
  every piece of the chain except OpenAI's own account balance is now
  independently confirmed working with real credentials.
- **What this doesn't do.** No real AR/VR, per the design decision
  above. Generation is synchronous (the request stays open until OpenAI
  and R2 both finish, no polling) since no job queue exists in this
  scaffold and OpenAI's edit call is itself a single request/response —
  fine at this scale, but a real deployment doing many of these
  concurrently would want a queue instead of holding an HTTP connection
  open per generation. See the two "Update" bullets above for what's
  since been live-verified with real credentials (R2 fully; OpenAI's
  own request logic, blocked only on account billing) — real end-to-end
  generation itself is still the one piece not yet confirmed.

## Requiring a license for a regulated trade before a vendor can be assigned (this pass)

Closes "no way to require a vendor actually have a license before it
can be picked" — flagged for both Property inspections and Maintenance
requests once `Vendor.licenseNumber` existed to check in the first
place (see "A self-reported professional license for vendors" above).

- **`PropertiesService.requireVendor`** — the one referential-integrity
  check both `inspectorVendorId` (inspections) and `assignedVendorId`
  (maintenance requests) already pass through, so extending it once
  closes the gap for both at the same choke point. Now rejects the
  assignment with a clear `BadRequestException` if the picked vendor's
  own `serviceCategory` is one of `LICENSE_REQUIRED_CATEGORIES`
  (`electrical`, `security_installation`, `general_contracting` — the
  same trio `Vendor.licenseNumber`'s own schema comment already names as
  where a license actually means something) and that vendor has no
  license on file, or has one that's expired. Every other category —
  including a vendor picked as a general inspector — is unaffected, and
  the freeform `inspectorName`/`assignedTo` path next to this one still
  records nothing about licensing at all, same as before: there's no
  vendor record for a freeform name to check against.
- **Verified live**: created a fresh `VENDOR`-type account
  (`serviceCategory: "electrical"`) with no license on file, and
  confirmed scheduling an inspection with it as `inspectorVendorId`
  through the real form failed with the exact expected message
  (`"Test Electrical Co has no professional license on file — required
  for a electrical vendor to be assigned here"`); added a real license
  through `pages/vendors/me.tsx`'s own license form, retried the
  identical action, and confirmed it succeeded. Confirmed no regression
  for the existing `renovation`-category seeded vendor (whose license
  happens to be expired, from an earlier pass's own testing) — still
  assignable, since `renovation` isn't in the gated list.
- **A real bug found and fixed while verifying this** — unrelated to the
  license check itself, but it blocked testing it: creating the fresh
  test vendor account above hit `pages/vendors/me.tsx` stuck
  permanently on "Loading…" instead of showing the "Create your vendor
  profile" form. Root cause was in the shared `request()` helper
  (`lib/api.ts`), not this page: `GET /vendors/me` for an account with
  no vendor profile yet returns `null` (Nest sends an empty body with no
  `Content-Type` header for that, not the literal JSON string `"null"`,
  the exact same shape `GET /tenant/lease` and several other "not found
  yet" endpoints already use) — but `request()` only ever called
  `res.json()` when the response actually declared an
  `application/json` content-type, and returned `undefined` otherwise.
  Several pages (`VendorDashboardPage` among them) use `undefined` as
  their own "still loading" sentinel for exactly this kind of state, so
  a real, successful "no profile yet" result was indistinguishable from
  "hasn't resolved yet" and left those pages stuck forever — a
  pre-existing bug affecting every such endpoint app-wide, not something
  this pass introduced, just never triggered before because no earlier
  pass happened to live-test a truly fresh, zero-profile account through
  this exact page. Fixed by having the non-JSON branch drain the body
  and resolve to `null` instead of `undefined` — the same sentinel every
  affected page's own "no profile yet" check already expects, and it
  also stopped the browser reporting these responses as aborted/
  unconsumed streams (`net::ERR_ABORTED` was showing in the network
  tab for every affected call, despite the server itself always
  returning a clean `200`).

## Fuzzy free-text search for all three marketplaces (this pass)

Closes half of "Search and vector layers still entirely missing" below —
the search half. Property listings, vendors, and materials/products could
previously only be filtered by exact-match fields (category, city,
listing type); there was no way to type a name or phrase and find
approximate matches.

- **Postgres `pg_trgm`, not a real Elasticsearch/OpenSearch cluster** —
  a deliberate choice (see the options laid out and the decision made
  when this pass started) to reuse the existing Postgres instance rather
  than stand up a new external service. `CREATE EXTENSION pg_trgm` plus
  five `gin_trgm_ops` indexes (`property_listings.title`/`.description`,
  `vendors.businessName`, `products.name`/`.description`) is the entire
  new infrastructure footprint. This is honestly not Elasticsearch — no
  relevance tuning, no fielded queries, no distributed index — but it
  does close the actual user-facing gap ("let me search by name/keyword
  and tolerate typos") without a new service to run, pay for, or operate.
- **The pattern, used identically in `ListingsService.findAll`,
  `VendorsService.findAll`, and `MaterialsService.findProducts`**: a raw
  `$queryRaw` (Prisma's own tagged-template parameterization — never
  string-concatenated) picks matching ids and ranks them by
  `word_similarity()`, then a normal Prisma `findMany({ where: { id: {
  in: ids } } })` hydrates the full typed rows with their usual
  `include`s, then a JS `.sort()` restores relevance order (SQL's `id IN
  (...)` doesn't preserve one). This is the first use of `$queryRaw`
  anywhere in this codebase — everywhere else, Prisma's query builder was
  enough.
- **`word_similarity()` compared to an explicit `0.3`, not the `%`
  operator and not the `<%` operator either — both were tried and both
  were wrong, caught by live-testing, not by reasoning about it up
  front.** Plain `similarity()`/`%` scores the *entire* two strings
  against each other; a search phrase shorter than the field it's
  matching against loses even to an exact substring match once the field
  is long enough (`"Ocean Drive"` against a full listing title scored
  0.29 — below the 0.3 default threshold — for an *exact* match).
  Switching to `word_similarity()` (designed for exactly this: "does my
  short phrase match some substring of this longer text") fixed that,
  but the `<%` operator form of it is gated by a *different*, stricter
  GUC (`pg_trgm.word_similarity_threshold`, defaulting to 0.6, vs `0.3`
  for plain `%`) — a real `"Cermic Tile"` vs `"Ceramic Floor Tile
  (60x60)"` word-similarity score of 0.48 passed the raw function but
  silently failed the `<%` operator. The final, verified-live form calls
  `word_similarity(query, column) > 0.3` directly in the `WHERE` clause,
  matching plain similarity's own threshold instead of depending on a
  session GUC.
- **Web**: a debounced (250ms) search box added to all three marketplace
  pages (`pages/vendors/index.tsx`, `pages/marketplace/index.tsx`,
  `pages/marketplace/materials/index.tsx`), alongside their existing
  exact-match filters rather than replacing them — `q` and the other
  filters combine with `AND` in every case (e.g. category + search text).
- **Verified live** for all three marketplaces, including the two bugs
  above and their fixes: `"Leki Renovation"` (misspelled) → `Lekki
  Renovations Co.`; `"Ocean Drve"` (misspelled) → `14 Ocean Drive —
  Renovated 4-Bed Family Home`; `"Cermic Tile"` (misspelled, and only a
  fragment of the full product name) → `Ceramic Floor Tile (60x60)`; an
  unrelated nonsense query returned zero results in each marketplace, not
  a false-positive match.
- **Not done**: no typo-tolerant search on any other field (property
  address, project titles, document names, ...) — only the three
  marketplaces the blueprint's own search gap called out. Relevance
  ranking beyond trigram similarity closed in a later pass — see
  "Marketplace search relevance boosting" below.

## Marketplace search relevance boosting (this pass)

Closes "no ranking beyond trigram similarity (no relevance boosting by
recency, rating, or verification status)" — the one gap the fuzzy-search
pass above left open. Before this, two results with the same or similar
text relevance broke ties in whatever order Postgres happened to return
them, ignoring signals a real search product would obviously use.

- **One shared, generic scoring function** (`rankingBoost` in
  `apps/api/src/common/search-ranking.util.ts`), not three separate
  weightings that happen to look similar — this is bounded arithmetic
  (recency decay, a normalized rating, a flat verified bonus), not a
  domain-specific judgment call the way a trust score is, so it lives in
  `common/` and is imported by all three marketplace services rather
  than duplicated per marketplace the way this codebase's own per-domain
  business logic usually is.
- **Deliberately small and additive, never a replacement for text
  relevance**: each of the three signals contributes at most `0.05` (a
  maximum `0.15` total), added on top of the `word_similarity()` score
  the existing fuzzy search already ranks by. Because the SQL `WHERE`
  clause already excludes anything below the `0.3` relevance threshold
  before the boost is ever applied, a weakly-relevant match can
  structurally never outrank a strongly-relevant one — the boost only
  ever reorders *within* the set of already-relevant results, breaking
  near-ties in a sensible direction (newer, better-rated, verified).
- **Real signals per marketplace, not the same three everywhere**:
  listings get recency + verification (a `PropertyListing` has no rating
  field of its own); vendors get all three directly; materials/products
  get rating + verification from the product's own `Supplier` (a
  `Product` has neither field itself) plus the product's own recency —
  `MaterialsService.findProducts`'s existing `supplier` include gained
  `verificationStatus` alongside the `ratingAverage` it already selected.
- **The raw SQL changed from selecting just `id` to also returning the
  similarity `score`** for all three searches — the boost math (in
  TypeScript, not SQL) needs the actual relevance number to add to, not
  just an ordinal position, so the final sort is `word_similarity() +
  rankingBoost()` computed per row after Prisma hydration, same "raw SQL
  for the part Prisma can't express, TypeScript for everything else"
  split this feature already established.
- **Verified live with a controlled, rigorous test, not just a
  plausible-looking result**: created two real vendors named "Precision
  Plumbing Ltd" (unverified, no rating, 400 days old) and "Precision
  Plumbing Co" (verified, 4.8 rating, brand new) — confirmed by direct
  SQL query that both scored an *identical* `word_similarity()` of
  `1.0` against the query "Precision Plumbing" (a perfect substring
  match for both), so any reordering could only come from the boost,
  not a coincidental relevance difference. Searching that exact phrase
  through the real running app returned "Precision Plumbing Co" first,
  confirming the boost worked exactly as designed. Re-ran the existing
  fuzzy-search regression checks for all three marketplaces (misspelled
  vendor name, misspelled listing title, misspelled+partial product
  name) and confirmed no change in behavior for cases where relevance
  itself, not a tie, determines the order.
- **Not done**: no popularity/click-through signal (`PropertyListing.
  viewCount` exists but isn't used here — deliberately: it measures
  attention, not quality, and conflating the two felt like a real
  product decision, not a bounded technical one); the boost weights
  (`0.05` each) are a reasonable starting point, not tuned against real
  usage data, since none exists yet for this scaffold.

## Stub LLM argument extraction (this pass)

Closes "the stub LLM provider doesn't extract structured arguments from
free text." Turned out to be a much smaller gap than it sounded:
`model_roi_scenario` is the *only* skill in this entire registry whose
`inputSchema` declares anything beyond `NO_INPUT_SCHEMA` — every other
skill reads nothing from `input` at all, everything comes from
`moduleContext` plus platform data (see `ai-skill-input-schema.ts`'s own
comment, confirmed again here by grepping the whole skill registry).
So "extract structured arguments" reduces to one dedicated heuristic
parser for one skill, not a general schema-driven engine.

- **`extractModelRoiScenarioInput`** (`stub-llm.provider.ts`) — plain
  regexes over the same lowercased sentence `KEYWORD_ROUTES` already
  matches against, deliberately not generalized to read the schema
  itself: a registry of one real consumer doesn't justify a generic
  engine, and if a second skill ever grows a real schema, that's the
  point to reconsider the tradeoff, not before. Detects `scenario` from
  phrasing ("sell now", "rent increase", ...), pulls whichever of
  `rentIncreasePercent`/`appreciationRatePercent` is relevant to that
  scenario, `holdYears`, and a `currentMonthlyRent` amount.
- **A real bug caught before it ever shipped, not after**: the first
  version of the rent-amount regex used a negative lookahead
  (`(?!\s*%)`) to avoid matching a percentage figure — for "increase the
  rent by 15% to 500,000", it backtracked onto a *partial* digit run
  (just the "1" out of "15") once the full "15" failed the lookahead,
  silently returning `currentMonthlyRent: 1` instead of the intended
  500000 (or, correctly, nothing at all from that fragment). Caught by a
  standalone test script before touching the live app, not by the live
  test itself. Fixed by tracking which character ranges a percentage or
  "N year(s)" phrase already consumed, then picking the *largest*
  remaining freestanding number in the sentence (a real rent figure is
  reliably bigger than a percentage capped at 500 or hold-years capped
  at 50 by the schema itself) — proximity-to-a-keyword was exactly the
  brittle approach that produced the bug, so the fix doesn't lean on
  proximity at all.
- **Verified live through the real running app** (this environment has
  no `ANTHROPIC_API_KEY` configured, so `StubLlmProvider` is what
  actually answers every Ask AI request here, not a mocked path): asked
  "what if i increase the rent by 15% to 500,000 naira" against a real
  property and got back a real `model_roi_scenario` draft computing
  against `Current rent: 500,000 NGN/month` and `At +15%: 575,000
  NGN/month` — both numbers correct, confirming the exact bug above
  stayed fixed end-to-end, not just in the standalone test. Asked
  "should i sell now or hold for 5 years at 7% appreciation" and got
  back `Hold 5 year(s) at 7%/year appreciation` — confirming
  `holdYears` and `appreciationRatePercent` extract correctly and
  independently from the `rent_increase` scenario's own two fields, with
  no cross-contamination between scenarios.
- **Not done**: no extraction for any other skill, because no other
  skill has anything to extract; a real `ANTHROPIC_API_KEY` still
  produces meaningfully better argument-filling than this heuristic ever
  will (it reads the actual schema and full sentence semantics, not a
  handful of regexes) — this only ever had to do better than the `{}`
  it replaced, not compete with a real model.

## Semantic property search — pgvector + OpenAI embeddings (this pass)

Closes the other half of "Search and vector layers still entirely
missing" — the vector half, specifically "a vector DB for AI context
retrieval." The decision (see the options laid out and the choice made
when this pass started) was `pgvector` on the existing Postgres instance,
not a dedicated vector DB service (Pinecone/Weaviate/Qdrant) — same
reasoning as choosing `pg_trgm` over Elasticsearch above: no new service
to run, pay for, or operate.

- **`PropertyEmbedding` model** (`Unsupported("vector(1536)")` — Prisma
  has no native vector type, so every read/write of this one column goes
  through raw SQL, never the Prisma Client query builder) plus a
  hand-written migration (`CREATE EXTENSION vector`, one table, no
  ivfflat/hnsw ANN index — row counts at this scale don't need one, a
  plain cosine-distance `ORDER BY embedding <=> query` is fast enough).
  `accountId` is denormalized onto the embeddings table itself so
  semantic search can filter by account directly, without a join — the
  same tenant-isolation boundary `property:read` enforces everywhere
  else in this codebase.
- **`OpenAiEmbeddingService`** — the same "plain fetch, no SDK,
  `isConfigured` gate" shape every other optional third-party
  integration in this codebase uses (`OpenAiImageService`, `SumsubService`
  before it). `text-embedding-3-small` (1536 dimensions), OpenAI's
  cheapest embedding model — fine for a portfolio-search feature, not a
  precision-critical one.
- **Automatic indexing is fire-and-forget, not "record failure then
  re-throw"** — a deliberate difference from the visualizer/identity
  services' own pattern. A property's embedding is an enrichment nobody
  is waiting on synchronously; `PropertiesService.create` calls
  `indexEmbedding` without awaiting its result on the response path, and
  swallows+logs any failure so an unconfigured or out-of-credit OpenAI
  account never breaks property creation itself. There's no `update()`
  endpoint on `Property` in this scaffold yet, so create is currently the
  only automatic trigger.
- **Manual reindex for backfill**: `POST /properties/reindex-embeddings`
  (account-scoped) re-embeds every property on the current account,
  sequentially (gentle on OpenAI's own rate limit, not `Promise.all`),
  collecting per-property failures instead of aborting the whole batch on
  the first one — since "OpenAI has no credit" fails every property
  identically, the caller should see that clearly rather than a single
  opaque 500.
- **`GET /properties/search?q=...`** (account-scoped): embeds the query,
  then the exact same "raw SQL ranks ids by relevance, Prisma hydrates
  the full typed rows, JS `.sort()` restores order" split the pg_trgm
  marketplace search above uses — cosine distance (`<=>`) instead of
  `word_similarity()` is the only real difference.
- **Web**: a "Semantic search" box on the Portfolio page
  (`pages/properties/index.tsx`), separate from the plain property list
  rather than a client-side filter of it, and a "Reindex for search"
  button for backfill. Deliberately submit-only (Enter/button), not
  debounced-as-you-type like the free pg_trgm search — each call is a
  real OpenAI API request, not a free Postgres query.
- **Verified live, honestly**: every part of the pipeline that doesn't
  require an actual OpenAI response — routing (`/properties/search`
  registered ahead of `GET :propertyId` so it isn't swallowed as a
  property id), auth/account-scoping, the fire-and-forget hook not
  blocking property creation (confirmed: creating a property returned
  immediately, with a `Skipping embedding for property ...` warning
  logged afterward), and both new endpoints surfacing a clean, specific
  `BadRequestException` instead of a crash or opaque 500 — all verified
  live against the real running app. The embedding call itself hits the
  same pre-existing OpenAI billing block already documented for the
  visualizer (`"You have no credits remaining"` — confirmed live, both
  from the reindex button and the search box); this is an account-level
  limitation on the user's end already flagged as an open, acknowledged
  item, not a code bug, and this pass didn't attempt to work around it or
  fake a result.
- **Not done**: no automatic re-indexing on property update (no
  `PATCH`/update endpoint exists on `Property` at all yet — nothing to
  hook), no embeddings for anything other than `Property` (listings,
  vendors, projects, documents — all still pg_trgm/exact-match only), no
  hybrid search combining vector similarity with the pg_trgm results
  above, and — same honest caveat as the AI-generated visualizer — no
  actual embedding has ever been generated end-to-end, since that
  requires OpenAI credit this account doesn't currently have.

## A real report builder (this pass)

Closes "only one fixed report shape exists (portfolio overview + CSV
export + email digest)." Before this, "Reports" meant exactly one
dashboard — every user saw the same numbers in the same layout, with no
way to pick a subset, save it, or come back to it later.

- **A fixed metric registry, not a dynamic query engine**
  (`METRIC_REGISTRY` in `reports.service.ts`) — 13 keys, each a
  projection function from the *one* `getPortfolioOverview` computation
  the fixed dashboard above already runs (`properties_total`,
  `maintenance_open`, `top_vendors`, ...). A saved report is an ordered
  list of these keys, nothing more — there's no query language to parse,
  no per-metric database round-trip, and no way to express something the
  registry doesn't already name. Running or exporting a saved report
  computes the overview exactly once and picks rows out of it.
- **`ReportDefinition`** (`accountId`, `name`, `metrics: Json`) — a
  normal Prisma-managed model (unlike this pass's other two features, no
  `Unsupported` column here), with its own hand-written migration.
- **`GET /reports/metrics`, `POST/GET /reports/definitions`, `DELETE
  /reports/definitions/:id`, `GET /reports/definitions/:id/run`, `GET
  /reports/definitions/:id/export`** — `property:read` for anything that
  only reads (the registry, saved reports, a run result), `property:write`
  for create/delete, the same split every other self-service account
  setting in this codebase already uses. The CSV export reuses the exact
  same `csvField`/`csvRow` RFC-4180 escaping helpers the portfolio-overview
  export already established — one escaping implementation, not two.
- **Web**: a "Report builder" card on the Reports page
  (`pages/reports/index.tsx`) below the existing dashboard and digest
  card — a checkbox grid of every registry metric, a name field, a "Save
  report" button, and a list of saved reports each with Run (renders a
  table inline), Export CSV (reuses the page's existing `downloadCsv`
  helper), and Delete.
- **Verified live end-to-end**: saved a report with 2 metrics
  (`maintenance_total`, `top_vendors`) against real seeded data, ran it
  (correctly returned `Total maintenance requests: 8` and `Top vendor:
  Lekki Renovations Co. (NGN): 901000` — matching the fixed dashboard's
  own open+resolved+other breakdown), exported it (fetched the actual
  response body over the network, confirmed exact matching CSV), and
  deleted it (list correctly returned to empty). No server errors at any
  step.
- **Not done**: no scheduling a saved report's own digest (only the one,
  fixed portfolio-overview digest from the pass before this one exists);
  no sharing a saved report with other account members beyond it already
  being account-wide; no metrics outside the registry — see "Extending
  the report builder to Payments, Documents, and Tenant" further below,
  which closed that specific gap in a later pass.

## Extending the report builder to Payments, Documents, and Tenant (this pass)

Closes the report builder's own "no metrics outside the registry —
nothing from Payments, Documents, or Tenant modules is projectable yet"
gap. Eight new registry keys, still zero new query paths: seven reuse
the identical "compute the one overview, project rows out of it" split
the original 13 already established; the eighth (Payments) reuses
another module's own service method outright rather than recomputing
its logic a second time.

- **Payments — `payments_open_disputes`, `payments_deposited_by_currency`,
  `payments_released_by_currency`, `payments_escrow_balance_by_currency`**
  — the one metric group in this pass that isn't a new Prisma query at
  all: `ReportsService` now injects `PaymentsService` (via
  `ReportsModule` importing `PaymentsModule`, which already exported it)
  and calls the exact same `getAccountOverview` the Payments dashboard
  itself uses, inside the same `Promise.all` `getPortfolioOverview`
  already runs. One computation, one source of truth for escrow/deposit/
  release numbers, not a second copy of that grouping logic living in
  two services.
- **Documents — `documents_total`, `documents_by_verification_status`**
  — a plain count and a `verificationStatus` breakdown, the same
  `countByStatus` helper `properties_by_status`/`projects_by_status`
  already use, just fed `Document` rows instead.
- **Tenant/leases — `tenant_active_leases`, `tenant_overdue_leases`** —
  the one genuinely new piece of logic: an account-wide "does this
  lease look overdue" check, ported from `summarize_lease_status`
  (`ai/skills/summarize-lease-status.skill.ts`), which only ever ran
  per-property for one landlord-facing AI narration. Duplicated rather
  than imported — same "parallel copy with a cross-reference comment"
  convention `VendorTrustAudit`/`SupplierTrustAudit` already established
  for near-identical logic used in two different contexts — and scoped
  to every active lease across the whole account, not one property.
- **Verified live against real seeded data**: built a 3-metric report
  (`payments_deposited_by_currency`, `documents_by_verification_status`,
  `tenant_overdue_leases`), ran it, and confirmed every number —
  `Deposited (NGN): 1558000`; `Documents — verified: 7`, `rejected: 1`,
  `not_verified: 3`, `submitted: 1`; `Leases with rent overdue: 1` —
  then exported it and confirmed the CSV response body matched exactly.
  No server errors, no circular-dependency issue from the new
  cross-module `PaymentsService` injection.
- **Not done**: no metrics from Vendor/Supplier trust scores, identity
  verification status, or the compliance tracker — this pass covered
  the three modules the original gap specifically named, not every
  remaining module in the app.

## A platform compliance tracker (this pass)

Neither real AR/VR nor the compliance gap below has a direct code fix —
AR/VR needs infrastructure (native/WebXR, photogrammetry, a 3D pipeline)
that doesn't exist here, and compliance is regulatory/legal work no code
can perform. Asked which bounded, honest slice to build instead of
either, the answer was this: a real place to track that the compliance
work exists and where it stands, without pretending to do the work
itself.

- **`ComplianceItem`** — genuinely platform-wide, like `Role`/
  `Permission` (the only other account-independent tables in this
  schema): `jurisdiction` and `category` are free text, not enums — this
  scaffold can't know every market the platform might expand into —
  plus `title`, `status` (`not_started`/`in_progress`/`done`), and
  `notes`. No `accountId` anywhere: this tracks the platform operator's
  own regulatory posture, not any one tenant's.
- **`compliance:read`/`compliance:write`, granted only to
  `platform_reviewer`** — the exact same isolation every other
  neutral-reviewer permission already uses (`vendor:verify`,
  `dispute:arbitrate`, `document:arbitrate`, `review:moderate`): the role
  that owns this data never gets it, and no tenant-facing role carries
  either key. `platform_reviewer` itself is nothing special at the
  account level — confirmed by re-reading how it already works — it's an
  ordinary `AccountMember` role inside an ordinary `Account`
  (`accountType: COMPANY`, the seeded "PropertyOnTheGo Trust & Safety"
  account); "platform-wide" comes entirely from the permission only ever
  being granted to that one role, and from these routes carrying no
  `:accountId`/`:propertyId`/`:projectId` param for `PermissionsGuard`'s
  ABAC check to key on — the same shape `VendorsService.
  setVerificationStatus` already established for `vendor:verify`.
- **The two new permissions are inserted directly in the migration**
  (`INSERT INTO permissions ...` / `INSERT INTO role_permissions ...`,
  keyed off `roles.key = 'platform_reviewer'`), not left to a re-seed —
  this is data on the live shared database, not just schema, and
  `seed.ts`'s own `PERMISSIONS`/`ROLES` entries were updated identically
  so a fresh seed run never disagrees with what the migration already
  did. Verified directly against the live database that both rows
  landed and are linked only to `platform_reviewer`.
- **Web**: a new "Compliance" nav item — unlike `platform_reviewer`'s
  other actions (vendor/supplier verification, dispute arbitration,
  document verification, review moderation), which all reach their
  screens through the Vendors/Documents/Payments nav items that already
  exist for other reasons, this is its own, unrelated concern with
  nowhere existing to live, so it gets a dedicated item — shown only to
  this one role, the same exception `TENANT_NAV_ITEM` already
  established for tenant accounts. The page itself has no client-side
  role gate; it just renders whatever `GET /compliance/items` returns, or
  a plain "switch accounts" message if that 403s.
- **Verified live, both sides of the gate**: visited `/compliance` as
  the ordinary demo property-owner account — got the exact 403-driven
  message, no nav item shown. Switched to the seeded platform-reviewer
  account — nav item appeared, and a full create → change status →
  in_progress → save a note → delete cycle round-tripped correctly
  against the real API, each step confirmed against the actual network
  response, not just the UI updating optimistically. No server errors at
  any step.
- **Not done, and not pretending otherwise**: this grants no license,
  verifies no jurisdiction's actual legal requirements, and enforces no
  data residency — it's bookkeeping for humans doing that work, nothing
  more. No due-date/reminder mechanism, no file attachments per item, no
  audit trail of who changed what (only `updatedAt`, no history).

## A dedicated Inspector role (this pass)

Closes "a Vendor account can be picked for the job, but there's no
distinct role type." A `VENDOR`-type account previously always got the
identical `vendor` role — full marketplace permissions (bidding on
projects, disputes, payouts, rentals) — regardless of whether it was
actually a general contractor or a professional whose whole business is
being picked as `PropertyInspection.inspectorVendorId`.

- **A real, narrower `Role`, not a new `AccountType`** — the account
  creation flow already picks exactly one fixed role per account type
  (`AccountsService.create`'s `DEFAULT_OWNER_ROLE_BY_ACCOUNT_TYPE`); this
  adds the one place that isn't fixed. `CreateAccountDto.vendorRole`
  (`"vendor"` | `"inspector"`, a closed enum, never free text) is read
  only when `accountType === "VENDOR"` and picks between the existing
  `vendor` role and a new `inspector` role — built entirely from a
  *smaller* slice of permissions the `vendor` role already has
  (`vendor:read`, `vendor:write`, `document:read`, `ai:act` — no
  `quote:*`, `dispute:*`, `payout:read`, `rental:*`, `product:read`). No
  new permission keys were needed.
- **Deliberately doesn't gate who can be picked as an inspector** — a
  property owner can still assign *any* `Vendor` (any role) to
  `inspectorVendorId`/`assignedVendorId`, still subject to the same
  license check regulated trades already require (see "Requiring a
  license for a regulated trade before a vendor can be assigned" above).
  This role only narrows what the account itself can *do* — it's a
  professional-identity choice for the vendor, not a new access-control
  gate on the property owner's side.
- **Web**: a "Vendor type" picker on the account-creation screen
  (`pages/accounts/new.tsx`), shown only when `VENDOR` is selected.
- **A real bug found and fixed while verifying this** — creating an
  inspector-role vendor profile and loading its own dashboard
  (`pages/vendors/me.tsx`) surfaced a confusing top-level "Missing
  permission(s): dispute:read" error banner, even though the profile
  itself, license form, and bank-details form all loaded and worked
  fine. Root cause: `VendorDashboardPage.load()` used `Promise.all` over
  `myQuotes()`/`myPayouts()`/`myDisputes()` — fine when every vendor
  account had every one of those permissions, which was true for every
  role that existed before this pass, but an inspector-role account
  legitimately 403s on all three by design, and `Promise.all` rejects
  the whole load on the first failure. Fixed with `Promise.allSettled`,
  keeping whichever of the three actually succeed and silently leaving
  the rest at their empty-array default — no error shown for a
  permission gap that isn't a bug.
- **Verified live**: created a real `VENDOR` account choosing
  "Inspector," confirmed the account switcher shows `vendor · inspector`
  (not `vendor · vendor`); confirmed `POST /vendors` (creating the
  profile) succeeds; confirmed `GET /vendors/me/quotes`,
  `.../me/payouts`, and `.../me/disputes` all correctly 403 for it;
  confirmed the dashboard renders cleanly with no error banner after the
  fix above.
- **Not done**: no way to change an existing account's role after
  creation (this is a creation-time choice only); the dashboard still
  renders empty Quotes/Disputes/Payouts sections for an inspector
  account rather than hiding them outright — cosmetic, not a correctness
  issue, since they're honestly empty rather than erroring.

## Structured evidence-submission channels for document and vendor/supplier verification (this pass)

Closes "only dispute arbitration has a real evidence channel — document
verification and vendor/supplier verification don't." Document
verification already had a `"submitted"` status meaning "needs more
evidence" (and vendor/supplier's `"pending"` was already commented as
meaning the same thing), but neither had anywhere to actually *put* that
evidence — `DocumentsService.arbitrateVerify`'s own comment used to say
outright that "more evidence" meant "whatever the account does outside
this flow."

- **`DocumentEvidence`, `VendorVerificationEvidence`,
  `SupplierVerificationEvidence`** — three separate, parallel models
  (not one shared/polymorphic table), matching this codebase's
  established preference for parallel implementations over cross-cutting
  abstractions (the same choice `VendorTrustAudit`/`SupplierTrustAudit`
  already made). All three mirror `DisputeEvidence`'s exact shape
  (`note`, optional `fileUrl`, `submittedByUserId`, `createdAt`) — the
  one real difference: a dispute has two parties who might each submit,
  a document/vendor/supplier has exactly one owning account, so there's
  no `requireDisputeParty`-style ownership-resolution step, just a plain
  `accountId` match.
- **Symmetric read access, same shape across all three**: the owning
  account reads its own submissions (`GET /documents/:id/evidence`,
  `GET /vendors/me/verification-evidence`, `GET
  /suppliers/me/verification-evidence`); the reviewer reads any of
  them platform-wide gated on the exact same permission that already
  arbitrates them (`document:arbitrate`, `vendor:verify`,
  `supplier:verify`) rather than a new key. Document evidence also
  appears inline in `findPendingForArbitration`'s own response (same
  place `PaymentsService.findOpenDisputesForArbitration` already
  includes `DisputeEvidence`), so the reviewer sees it without a second
  fetch.
- **Web**: a "Submit evidence" control appears on the document's own row
  once a reviewer sets it to `"submitted"`, and a "Verification
  evidence" card appears on the vendor/supplier dashboard whenever that
  profile isn't yet verified (not gated to a specific status — evidence
  toward a first-time verification is exactly as legitimate as evidence
  in response to a specific reviewer request). Both attach an optional
  file via the new upload pipeline (see below). The reviewer's own
  screens (`DocumentArbitrationRow`, both vendor/supplier
  `PlatformReviewPanel`s) render the submitted thread inline.
- **Verified live, both directions, for documents and vendors** (the
  supplier path is byte-for-byte the same code, spot-checked via its own
  "already verified" guard and its `GET` endpoint returning `200 []`,
  not run through the full UI cycle): set a real document to
  `"submitted"` as the platform reviewer, switched to the owning
  account, submitted evidence, confirmed `POST` returned `201` and the
  account's own view showed "1 item already submitted," switched back to
  the reviewer and confirmed the submitted note appeared inline in the
  arbitration queue. Identical cycle repeated for vendor verification
  evidence against a real vendor profile, confirmed on the vendor's
  detail page's Platform review panel.
- **Not done**: no way for the reviewer to reply/converse within the
  evidence thread (it's one-directional — account submits, reviewer
  reads); no evidence-submission channel for review moderation
  (`review:moderate`) — "flagged" already plays an analogous "needs a
  decision" role there, raised by the reviewed party rather than
  requested by the reviewer, so nothing parallel was missing.

## Unifying two-party dispute resolution with arbitration (this pass)

Closes "two-party dispute resolution and arbitration coexist, not
unified." `PaymentsService.applyDisputeResolution` (shared by both
`resolveDispute` and `resolveDisputeAsVendor`) only ever checked for an
already-*final* status (`resolved`/`rejected`) before allowing a
two-party resolution — it never checked for `under_review`. That meant
once a `platform_reviewer` set a dispute to `under_review` (explicitly
saying "I'm looking into this, send more evidence"), either original
party could still call the two-party resolve endpoint and silently
overwrite the reviewer's in-progress arbitration, including resetting
`resolvedAt` to a fresh value — a real, live-confirmed bug, not a
hypothetical one.

- **The fix**: `applyDisputeResolution` now also rejects
  (`ConflictException`, same exception type the already-final check
  already used) when `dispute.status === 'under_review'`, with a message
  pointing the caller at evidence submission instead. Once a
  `platform_reviewer` touches a dispute, the two-party path is locked
  out **for good** — arbitration supersedes it rather than merely
  pausing it, so a dispute a reviewer has taken on stays theirs to
  resolve even if they set it back to `under_review` a second time. A
  dispute neither party nor reviewer has escalated is completely
  unaffected — the two paths still coexist exactly as before *until*
  arbitration is actually invoked on that specific dispute.
- **Verified live** against a real dispute and a real project/vendor
  assignment: created a dispute, had the platform reviewer set it to
  `under_review` through the real arbitration queue UI, then called the
  owning account's own `resolveDispute` endpoint directly — got back the
  new `409 Conflict` with the exact intended message. Confirmed no
  regression on a second, untouched dispute: the same two-party resolve
  endpoint succeeded normally (`201`, `status: "resolved"`) when
  arbitration had never been invoked on it.
- **Not done**: no way for a `platform_reviewer` to hand a dispute back
  to the two-party path once taken on (by design, per the "supersedes,
  doesn't pause" decision above) — if that turns out to be needed, it
  would be a deliberate new capability, not a bug fix.

## A general file-upload pipeline (this pass)

Closes "the only real object storage (R2) is narrowly wired for
AI-generated visualization images; `Document.fileUrl` is still
bring-your-own-URL." `StorageService` (Cloudflare R2 via
`@aws-sdk/client-s3`) existed only inside the visualizations module,
reachable only from the one AI-image-generation code path.

- **`StorageService` moved to its own `StorageModule`**
  (`apps/api/src/storage/`), imported by `VisualizationsModule` rather
  than owned by it — the same service, now shared. Its one method grew
  from `uploadImage(buffer, contentType, keyPrefix)` (image-only,
  extension picked from a fixed 3-format lookup table) to a general
  `upload(buffer, contentType, keyPrefix, originalFilename?)` — a real
  upload always has a filename to take a real extension from, which a
  content-type lookup table alone can't cover for arbitrary file types
  (PDFs, Office docs, ...) the way it could for the AI visualizer's own
  fixed output formats. `uploadImage` still exists as a one-line wrapper
  so that call site needed no changes.
- **`POST /uploads`** (`multipart/form-data`, field name `file`, 25MB
  cap) — real bytes in, a real R2 URL out. Deliberately gated on nothing
  but `JwtAuthGuard`/`AccountContextGuard` (any authenticated account
  member), no `@RequirePermissions`: uploading bytes to storage isn't
  itself the sensitive action, and every existing `fileUrl` field this
  now feeds (`Document.fileUrl`, `DisputeEvidence`/`DocumentEvidence`/
  `Vendor-`/`SupplierVerificationEvidence.fileUrl`) was already a plain
  string the same caller could set to anything — the real authorization
  happens at whichever permission gates attaching that URL to a real
  resource afterward.
- **No schema changes needed anywhere** — every field that used to say
  "paste a URL you already host" still is one; this just gives every one
  of them a second, real way to get a URL, on the web side by calling
  `POST /uploads` first (`ApiClient.uploadFile`) and using the URL it
  returns. Wired into the Documents upload form (a real `<input
  type="file">` now, not a URL text box) and into all three of this
  pass's new evidence-submission forms (document, vendor, supplier).
- **Verified live against the real R2 bucket**, not mocked: since a
  native OS file-picker dialog can't be driven by browser automation,
  verification used the exact request shape the real web client makes —
  a `fetch` with a `FormData`/`Blob` body plus the same CSRF token and
  `X-Account-Id` header `ApiClient` always sends — executed from inside
  the actual logged-in page. Got back a real `201` and a real
  `https://pub-....r2.dev/uploads/<accountId>/<uuid>.txt` URL; fetched
  that URL back in a separate tab and confirmed the exact uploaded bytes
  came back. The Documents-page evidence-submission cycle (see above)
  additionally exercised the whole flow through `DocumentsService`
  end-to-end, short of the browser's own native file-picker step.
- **A real, unrelated config regression found and fixed while verifying
  this**: `.env`'s R2 variable names had reverted to (or still had) a
  mismatch from before this session's own earlier R2 setup pass —
  `CLOUDFARE_R2_ACCESS_KEY_ID`/`CLOUDFARE_R2_SECRET_ACCESS_KEY`
  (misspelled prefix), `BUCKET_NAME`, and `PUBLIC_URL`, none matching
  what `StorageService` actually reads
  (`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/
  `R2_PUBLIC_BASE_URL`). Renamed the keys in place (values untouched,
  `.env` stays gitignored) so `StorageService.isConfigured` — and this
  entire pass's live verification — could actually run against real
  credentials instead of silently falling back to the "not configured"
  error path.
- **Not done**: no per-file-type validation beyond the 25MB size cap
  (any content type is accepted and stored as-is); no virus/malware
  scanning; no deletion endpoint — an uploaded file is permanent once
  stored, same as a pasted URL always effectively was.

## A comparable-sales valuation estimate (this pass)

Closes the rest of Module 15's valuation gap: `PropertyValuation` gave a
manual/AI-narrated history, and `model_roi_scenario` gave rent-increase/
sell-vs-hold modeling, but nothing produced an actual *automated*
estimate. "Comparable" means the same city and `propertyType` among
other accounts' own active sale listings — a real market signal already
sitting in `PropertyListing`, not a new integration or external data
source.

- **`PropertiesService.getComparableValuation`** — finds every other
  active, `listingType: "sale"` `PropertyListing` in the same city and
  `propertyType` (excluding the property's own listings — comparing a
  property to itself isn't a comparable-sales estimate), grouped by
  currency and never averaged across currencies (the same caution every
  other cross-listing money computation in this codebase already
  applies — `PaymentsService.getAccountOverview`, the vendor-spend
  grouping in the report builder). Below a minimum of 2 comparables, it
  still reports what it found (so the caller sees there's *something*
  nearby) but returns no averaged estimate — one listing is an anecdote,
  not a market.
- **`estimate_comparable_value`** — the new AI skill, `NO_INPUT_SCHEMA`,
  gated by the same `property:read` every other property-scoped skill
  uses. Deliberately re-implements the same search/grouping logic rather
  than calling the service method — `AiSkillDeps` only ever hands a
  skill `prisma` and `llm`, never other Nest services, the exact "kept
  in sync, not shared" split `model_roi_scenario`'s own comment already
  established against `PropertiesService.getRoiSummary`.
- **No new endpoint to "save" the estimate** — `GET
  /properties/:id/comparable-valuation` is read-only, and saving one as
  a real valuation reuses the *existing* `POST /properties/:id/valuations`
  endpoint unchanged, just with a new allowed `source: "comparable_sales"`
  value alongside `manual`/`ai_estimate`. Nothing here writes back to
  `Property.estimatedValue` automatically — same "record what's true,
  don't auto-recompute" tradeoff `addValuation` already established.
- **Web**: a "Comparable-sales estimate" card on the property detail
  page, next to the existing ROI & valuation dashboard — shows the
  estimate, the comparable count, and a min–max range, with a "Save as
  valuation" button that calls the existing valuation endpoint and feeds
  the same `valuations` state the ROI chart already watches, so saving
  one immediately updates the ROI dashboard's own "current value" too
  (no separate refresh path to keep in sync).
- **Verified live against real data, both paths independently**:
  seeded two comparable properties/listings in the same city and type
  (₦200,000,000 and ₦220,000,000 asking price) and confirmed the web
  card computed the exact expected average (₦210,000,000, range
  ₦200,000,000–₦220,000,000); clicked "Save as valuation" and confirmed
  the real `POST` request, the new entry appearing in the Valuations
  list with `source: "comparable_sales"`, and the ROI dashboard
  recalculating its own Simple ROI/current-value tiles from it
  immediately. Separately triggered the `estimate_comparable_value` AI
  skill (both via its quick-action button and by confirming its
  `POST /ai/actions` response) and confirmed its independent
  implementation computed the identical ₦210,000,000 figure. Also
  confirmed the "not enough comparables" path renders cleanly (a plain
  "No comparable active listings found in ... yet" message, no error)
  against a real property with none nearby.
- **Not done**: no comparable estimate for rent-type listings (only
  `listingType: "sale"` — a rental comparable would need a different,
  per-period basis, a real product decision this pass didn't make);
  no distance/radius matching beyond an exact city-name match — two
  properties in the same metro area but a differently-spelled or
  differently-granular city field won't match each other.

## Risk flags for projects and leases (this pass)

Closes the other named sub-piece of "the rest of risk flags/trust scores
beyond listings and vendors/suppliers" — `assess_listing_risk` was the
only entity with an explicit, flat risk-flag list; a project or a lease
only ever got prose narration (`summarize_project`,
`summarize_lease_status`) with no discrete "here's what's wrong" output
to act on.

- **`assess_project_risk`** — account-scoped (`ctx.accountId`), unlike
  `assess_listing_risk`: a project has no public/buyer-facing angle a
  marketplace listing does, so there's no reason for anyone outside the
  owning account to ask whether it looks risky. Flags overdue milestones,
  open disputes, spend released exceeding the project's own budget, and
  a project marked `in_progress` with no vendor assigned at all.
- **`assess_lease_risk`** — scoped at the *property* level, same
  `moduleContextPrefix` `summarize_lease_status` already uses, not
  per-lease: a property can carry more than one lease over time, and
  "which of this property's leases need attention" is the real
  owner-facing question. Flags each active lease that looks overdue
  (the identical anchor/period-day calculation `summarize_lease_status`
  already uses) or is ending within 60 days.
- **Both are separate skills from their existing `summarize_*`
  counterparts, not replacements for them** — the same split
  `assess_listing_risk`/`summarize_listing` already draws for listings:
  the `summarize_*` skill narrates overall health in prose: this pair
  produces a flat, explicit flag list plus a `warn` boolean a caller can
  act on without parsing a paragraph. Both reach the account's existing
  Ask AI panel automatically (`AskAiPanel` renders every registered
  skill generically) — no new REST endpoint, no new dashboard card,
  matching `assess_listing_risk`'s own footprint exactly rather than
  the fuller service+endpoint+web-card treatment the comparable-
  valuation pass just above used.
- **Verified live against real data**: ran `assess_project_risk` against
  the demo "Kitchen Renovation" project (which was carrying a real
  `under_review` test dispute from an earlier pass's own verification)
  and got back `"1 open dispute(s) on this project"` with `warn: true`;
  ran `assess_lease_risk` against "14 Ocean Drive" (carrying a real
  overdue lease from earlier seed/test data) and got back `"Overdue
  Test Tenant: rent looks ~66 day(s) overdue"` with `warn: true`;
  confirmed the clean path too — a property with no leases at all
  returned `"No risk factors flagged..."` with `warn: false`, not an
  error.
- **Not done**: no persisted/historical risk score (each call
  recomputes fresh from current data, same as every other `assess_*`/
  `summarize_*` skill in this registry); no portfolio-wide "show me
  every at-risk project/lease" view — each skill answers for one
  project or one property at a time, reachable only through that
  record's own Ask AI panel, not a cross-portfolio dashboard.

## AI narration for the report builder (this pass)

Closes the rest of Module 23's "natural-language report generation on
top of every report type" — `generate_portfolio_report` already
narrated the one fixed portfolio-overview report; the report *builder*'s
own custom, saved reports had no narration option at all.

- **`narrate_report`** — `moduleContextPrefix: "account"`, same shape
  `generate_portfolio_report` already uses (a saved `ReportDefinition`
  is account-scoped, not tied to one property/project/listing). The
  *second* skill in this entire 22-skill registry with a real
  (non-empty) `inputSchema`, after `model_roi_scenario` — a required
  `reportDefinitionId` field, since there's no sensible default for
  "which saved report," unlike `model_roi_scenario`'s own all-optional,
  all-defaulted fields.
- **A deliberate, one-time exception to "duplicate, don't share"**:
  every other skill that overlaps with a REST service
  (`model_roi_scenario`/`getRoiSummary`, `estimate_comparable_value`/
  `getComparableValuation`) re-implements its own small (10-20 line)
  computation directly against `prisma`, rather than calling the
  service — `AiSkillDeps` only ever exposed `prisma` and `llm`. This
  skill breaks that pattern on purpose: `ReportsService.runDefinition`
  is a 100+ line, cross-module computation (the fixed metric registry
  itself, plus a real dependency on `PaymentsService.getAccountOverview`
  via `ReportsModule`'s own import) — duplicating *that* a third time
  would be the actual anti-pattern, not sharing it. `AiSkillDeps` gained
  a third field, `reports: ReportsService`, and `AiModule` now imports
  `ReportsModule` (which gained a real `exports: [ReportsService]` it
  didn't have before — nothing outside its own controller could inject
  it until now), the same "AiService already imports another module's
  service when a skill genuinely needs it" shape `AiModule` already
  established by importing `ProjectsModule`/`ListingsModule` for its own
  accept-drafted-action chaining.
- **Deliberately not reachable via free-text chat or a generic quick-
  action button** — unlike every other skill, `narrate_report` has no
  `KEYWORD_ROUTES` entry in `StubLlmProvider`: there's no sentence-level
  heuristic (or, for a real model, no context) that tells you *which*
  saved report id a free-text sentence means, and `AskAiPanel`'s own
  generic per-field form would otherwise ask the user to paste a raw
  UUID. Instead, a "✦ Narrate" button sits directly on each saved
  report's own row in the report builder (next to Run/Export/Delete),
  which already has that report's real id in hand — the narration
  result renders through the exact same `AiDraftCard`
  (Accept/Edit/Discard) component every other AI output in this app
  uses, not a bespoke text block.
- **Verified live end-to-end**: clicked "Narrate" on a real saved
  report (3 metrics: deposited-by-currency, documents-by-status,
  overdue-leases) and confirmed the narrated numbers matched the
  report's own "Run" output exactly — proof `runDefinition` was actually
  reused, not recomputed differently by the skill. Accepted the
  resulting draft and confirmed the real `POST /ai/outputs/:id/decision`
  call and the card updating to show "Accepted." No server errors, and
  no circular-dependency issue at boot from the new
  `AiModule` → `ReportsModule` → `PaymentsModule` import chain.
- **Not done**: no universal `warn` signal — unlike
  `generate_portfolio_report` (which can key its own warning on its one
  fixed open-dispute count), a saved report is an arbitrary, user-chosen
  combination of metrics with no universal way to decide what counts as
  "needs attention," so `warn` is always `false` here, deliberately, not
  an oversight.

## Risk flags for vendors and suppliers (this pass)

Closes the last named sub-piece of "the rest of risk flags/trust scores
beyond listings" — `Vendor` and `Supplier` had a trust-*score* (`explain_
vendor_trust_score`, `explain_supplier_trust_score`) but no flat,
explicit risk-*flag* list the way `assess_listing_risk`/
`assess_project_risk`/`assess_lease_risk` already have.

- **`assess_vendor_risk`** — public/buyer-facing like `assess_listing_
  risk` and `explain_vendor_trust_score`, not filtered by
  `ctx.accountId`: anyone browsing the vendor marketplace can ask
  whether a vendor carries flagged risk factors before hiring them.
  Flags: verification status not `verified`, any open/`under_review`
  dispute on a project this vendor is currently assigned to, an expired
  self-reported professional license, and a `major_concerns`/
  `minor_concerns` rating from the vendor's own most recent
  `VendorTrustAudit`.
- **`assess_supplier_risk`** — the materials-marketplace counterpart,
  same shape. Flags: verification status not `verified`, any cancelled
  order on record (suppliers have no `Dispute`-equivalent model — a
  cancelled order is the closest analogue, same substitution
  `computeSupplierTrustScore` itself already makes), and the same
  audit-rating flag.
- **Deliberately separate skills from `explain_*_trust_score`, not
  replacements** — same split every other `assess_*`/`summarize_*` pair
  in this registry already draws: the `explain_*` skill narrates the
  whole score in prose; these produce a flat, explicit flag list plus a
  `warn` boolean, reusing the same underlying signals (verification,
  disputes/cancellations, the platform's own audit, license expiry)
  rather than recomputing a different set from scratch. Both reach the
  vendor/supplier's existing Ask AI panel automatically (`AskAiPanel`
  renders every registered skill generically) — no new REST endpoint, no
  new dashboard card.
- **Verified live against real data**: ran `assess_vendor_risk` against
  the demo "Lekki Renovations Co." (verified, but carrying a real
  `under_review` test dispute on its "Kitchen Renovation" assignment, an
  expired license, and a real `minor_concerns` `VendorTrustAudit` from
  earlier seed data) and got back all three flags with `warn: true`, and
  correctly *no* "not verified" flag since this vendor is verified;
  ran it again against a clean vendor ("Precision Plumbing Co" —
  verified, no license on file, no disputes, no audit) and got back "No
  risk factors flagged..." with `warn: false`. Ran `assess_supplier_risk`
  against "Lagos BuildMart" (carrying a real `major_concerns`
  `SupplierTrustAudit`) and got back that one flag with `warn: true`.
- **Not done**: no persisted/historical risk score (recomputed fresh
  every call, same as every other `assess_*` skill) — see "A
  cross-portfolio at-risk view for vendors and suppliers" below for the
  aggregate dashboard built on top of these two skills' own flag logic.

## A cross-portfolio at-risk view (this pass)

Closes the "no cross-portfolio 'show every at-risk record' view exists"
gap in full — started as vendors/suppliers only in the previous pass
(`getAtRiskPartners`), then extended in the same pass to cover projects
and leases too, since every `assess_*_risk` skill has the identical
problem: each only ever answers for one record at a time, reachable
only through that record's own Ask AI panel. There was no single place
to see "what across my whole account needs attention right now."

- **Renamed, not duplicated**: `ReportsService.getAtRiskPartners`
  became `getAtRiskOverview` (`GET /reports/at-risk-overview`,
  `property:read`, same tier as `portfolio-overview`) rather than adding
  a second, near-identical endpoint for projects/leases — "partners"
  never fit projects/leases anyway, since those are the account's own
  assets, not external parties it works with. Returns four identically-
  shaped buckets (`projects`, `leases`, `vendors`, `suppliers`), each
  `{ total, atRisk: [{ id, label, flags }] }`.
- **Two more shared flag-helper extractions**, same reasoning
  `getVendorRiskFlags`/`getSupplierRiskFlags` already established (a
  deliberate departure from this codebase's usual "duplicate
  near-identical logic with a cross-reference comment" convention — see
  `isLeaseOverdue` in `reports.service.ts` for that convention's own
  reasoning): `getProjectRiskFlags` (`projects/risk-flags.ts`) and
  `getPropertyLeaseRiskFlags` (`properties/lease-risk-flags.ts`), both
  now shared between their `assess_*_risk` skill and this dashboard so
  the wording can never drift between the two surfaces. Lease risk stays
  scoped at the *property* level in both places, same reason
  `assess_lease_risk` itself is — a property can carry more than one
  active lease, so the dashboard's own "lease" row is a property (with
  each flag naming its own tenant), and its `total` counts properties
  with at least one active lease, not raw lease rows.
- **A dashboard card on the Reports page** (`AtRiskOverviewCard`,
  renamed from `AtRiskPartnersCard`, self-fetching) — one generic
  `AtRiskEntryRow` renders all four buckets identically rather than
  four near-duplicate blocks, since every bucket now shares the exact
  same `{id, label, flags}` shape.
- **Verified live**: the demo owner account's "Kitchen Renovation"
  project (its real `under_review` test dispute) and "14 Ocean Drive"
  (its real overdue lease) both appeared in `GET /reports/
  at-risk-overview` alongside the vendor/supplier rows from the
  previous pass. Re-ran `assess_project_risk` and `assess_lease_risk`
  against those same two records directly afterward and got back
  exactly the same flag text the dashboard showed — proof the
  extraction reused the logic rather than recomputing a second,
  possibly-diverging version of it.
- **Not done**: no persisted history — recomputed fresh on every
  request, same as every `assess_*` skill; no severity ranking or
  sorting across the four buckets — every at-risk record is shown, in
  the order its own category query returned it.

## Admin operations — a platform accounts directory and account suspension (this pass)

The first real sub-piece of the genuinely undefined Modules 3, 16-21, 24
bucket — nothing in this repo's history, including the blueprint review
itself, ever names what those modules actually contain beyond bare
labels ("compliance," "community management," "AR/VR," "admin
operations"). Compliance already has a real tracker (see "A platform
compliance tracker" above) and AR/VR has a written feasibility spike;
"admin operations" had nothing. Picked over "community management" for
this pass specifically because it's a well-understood SaaS pattern with
an undebatable gap in this codebase, while "community management" on a
property/vendor/materials marketplace could mean several genuinely
different things (tenant forums, HOA tools, event postings) with no
existing hint of which — building it would mean guessing at scope, not
closing a defined gap.

- **The actual gap**: this platform is fully multi-tenant by design —
  every account only ever sees its own data — but nothing platform-wide
  existed to *operate* the platform itself: no way to see every account
  that exists, no way to act on one that's abusive or dormant, no record
  of who did what. `platform_reviewer` (Module 6's neutral reviewer)
  never crosses tenant boundaries either — it reviews one vendor/
  supplier/dispute/document/review at a time, never lists or acts on
  accounts themselves.
- **A new `platform_admin` role**, deliberately distinct from
  `platform_reviewer` — trust & safety review and platform operations
  are different jobs a real platform would likely staff separately. Same
  "one user, several accounts" demo pattern as every other role in this
  scaffold: a sixth membership on the demo user, on a new "PropertyOnTheGo
  Operations" account (`COMPANY` type, not a new enum value — same
  reasoning the existing "PropertyOnTheGo Trust & Safety" account already
  uses). Carries exactly two permissions, `account:read_all` and
  `account:suspend` — not even `ai:act`, same "a handful of mechanical
  actions on other accounts' data" scope `platform_reviewer` itself
  keeps to.
- **`GET /platform-admin/accounts`** — the directory itself: every
  account platform-wide, with `accountType`, `status`, `memberCount`, and
  `createdAt`. Deliberately no "last activity" signal — nothing on
  `Account` tracks that honestly (`updatedAt` only moves when the account
  row itself changes, not on general use), and a fabricated signal would
  be worse than none. Suspended accounts sort first, for triage.
- **`POST /platform-admin/accounts/:targetAccountId/{suspend,reinstate}`**
  — wires up `Account.status`, a column that has existed in the schema
  since Module 1 and was never once read or written anywhere in this
  codebase until now. A suspended account can no longer act as itself on
  *any* route — enforced in `AccountContextGuard` itself (the one place
  every authenticated request already resolves its account context), not
  a new check bolted onto each controller. No token to revoke and
  nothing cached: the very next request re-hits the same guard and gets
  turned away immediately. A real, cheap safeguard against self-lockout:
  a platform_admin cannot suspend the account it's currently acting as.
  Both actions require a `reason`, and both are recorded in a new
  `PlatformAdminAction` table — permanent, never edited or deleted, same
  "an audit with no reasoning recorded isn't an audit" reasoning
  `VendorTrustAudit.notes` already established — surfaced as
  `GET /platform-admin/audit-log`.
- **A subtle correctness detail worth naming**: every route here uses
  `:targetAccountId`, never literally `:accountId` — `PermissionsGuard`
  already hardcodes a same-account IDOR check on any route param
  literally named `:accountId` (see its own comment), which would have
  silently 404'd a `platform_admin` trying to act on any account but its
  own. `vendor:verify`'s own `:vendorId` param avoids the identical trap
  for the identical reason.
- **A new `/admin` page**, shown only to the `platform_admin` role — same
  "gated entirely server-side, this page just renders whatever the API
  returns" shape `CompliancePage` already uses for its own single-role
  screen.
- **Not done**: no severity/pagination on the audit log (capped at 200,
  most recent first); no way to suspend a *member* rather than a whole
  account (Module 6's own moderation tools already cover a misbehaving
  individual within an otherwise-fine account); nothing here obtains a
  license, verifies a jurisdiction, or performs any of the actual
  regulatory work — that's still Section 15, tracked but not done by
  code, same as the compliance tracker above.

## Community management — landlord-to-tenant announcements (this pass)

The second, and last, sub-piece the genuinely undefined Modules 3,
16-21, 24 bucket has real scope for — see "Admin operations" above for
the first, and its own comment for why building this bucket at all
means picking a scope rather than finding one in a blueprint that never
names what it contains. "Community management" means the same thing in
every real property-management product: a landlord communicating with
the tenants of its own portfolio — an announcement/notice board, not a
social feature.

- **`PropertyAnnouncement`** — `propertyId` is deliberately nullable:
  null reaches every tenant currently linked to any of the account's
  properties (a portfolio-wide notice — "the tenant portal will be down
  this weekend"), set reaches only that one property's own tenant(s) (a
  building-specific notice — "the elevator is broken"). No new
  permission keys — reuses `property:write`/`property:read` for the
  landlord side and `lease:read` for the tenant side, the same "reuse
  what already gates the exact same tenancy" reasoning `TenantController`
  itself documents for every one of its own routes.
- **`POST/GET/DELETE /properties/announcements`** — account-wide, not
  nested under `:propertyId` (an announcement can reach the whole
  portfolio), registered before `GET /properties/:propertyId` for the
  same route-ordering reason `semanticSearch`'s own comment gives for
  "search". A `propertyId` supplied in the body is validated by hand
  against the caller's own account — `PermissionsGuard`'s `:propertyId`
  ABAC only ever fires for a route *param* of that exact name, never a
  body field.
- **`GET /tenant/announcements`** — a tenant sees exactly two kinds: one
  scoped to its own leased property, and any portfolio-wide one from the
  same account that owns that property. Never another landlord's
  account, and never another property's own announcement — enforced by
  the query itself (`propertyId = my lease's property OR (propertyId IS
  NULL AND accountId = my property's owning account)`), on top of
  `AccountContextGuard`'s own membership check, which already refuses
  the request entirely for an account the caller doesn't belong to.
- **Web**: an "Announcements to your tenants" card on the Portfolio page
  (create/list/delete, with a property picker defaulting to "All
  properties"), and an "Announcements from your landlord" card at the
  top of the tenant's own "My Lease" page.
- **A real bug found and fixed during verification**: the create
  response is a plain `Prisma.create()` result with no joined
  `property` — the web page's optimistic list update was showing "All
  properties" for a announcement actually scoped to one property, until
  the next full reload corrected it. Fixed by resolving the property
  name client-side from the portfolio list already in hand, rather than
  trusting the raw create response's shape to match the list endpoint's
  joined one.
- **Verified live end-to-end**: posted one portfolio-wide and one
  property-scoped announcement as the demo owner, confirmed both showed
  the correct property label immediately (no reload needed, post-fix),
  switched to the linked "Demo Tenant" account and confirmed both
  appeared in `GET /tenant/announcements` — the property-scoped one
  because it matches the tenant's own lease, the portfolio-wide one
  because it matches the owning account — and confirmed delete removes
  one from the landlord's own list.
- **Not done**: no read receipts, no notification (email/push) when one
  is posted — a tenant only sees it by opening their own portal; no edit
  after posting, only delete-and-repost.

## Module 3: Property Details — specs, amenities, and a photo gallery (this pass)

Unlike Modules 16-24, Module 3 was never a bare label with no real
scope — it's a genuinely missing sequential module number, sitting
between Module 2 (`src/properties` — property portfolio CRUD) and
Module 4 (`src/documents` — the document vault), both already named
and built earlier in this scaffold's history. Positional inference, not
a blueprint quote: no text anywhere names what Module 3 itself contains
either, but the numbering gap between "manage your properties" and
"manage your paperwork" pointed at one obvious, self-evidently-missing
piece already hinted at elsewhere in this codebase — see below.

- **A real gap the code already flagged on its own**: `PropertiesService
  .embeddingText`'s own comment gives `"3 bedroom flat in Lekki under
  renovation"` as an example semantic-search query — and until this
  pass, `Property` had no `bedrooms` field, or any physical
  characteristic at all beyond `propertyType`/`estimatedValue`, for that
  query to ever actually match against.
- **`bedrooms`, `bathrooms`, `squareFootage`, `yearBuilt`, `amenities`
  (`String[]`), `photoUrls`(`String[]`)** — all optional, same "a
  property is real and useful before its owner fills in every field"
  reasoning every other optional column on `Property` already follows.
  `photoUrls` is the property's own general gallery — distinct from
  `PropertyListing.photoUrls` (a listing's own marketing photos) and
  `RenovationVisualization`'s before/after pair — same "URL you provide
  yourself" convention every other `*Url` field in this schema uses; no
  upload pipeline changed.
- **The first update endpoint the base `Property` record has ever had**
  (`PATCH /properties/:propertyId`, `property:write`) — every other
  field on `Property` (name, address, status, `currentUse`,
  `estimatedValue`, ...) was create-only until now; only nested
  resources (valuations, inspections, leases, maintenance) could be
  edited after creation. Reuses `PermissionsGuard`'s own `:propertyId`
  ABAC check for tenant isolation, the same as every other route already
  keyed on that param — no new isolation logic needed.
- **`embeddingText` now actually includes what its own example query
  needs** — bedrooms/bathrooms/square footage/year built/amenities all
  feed the same semantic-search embedding text now, and `create`/
  `updateProperty` both re-index fire-and-forget on every change,
  closing the gap the comment's own words used to point at with nothing
  behind them.
- **Web**: the "+ Add property" form now collects bedrooms/bathrooms/
  square footage/year built up front; a new "Property details" card on
  the property page shows amenities as badges and photos as a real
  gallery grid, with an "Edit details" toggle backing the new PATCH
  endpoint (amenities/photo URLs as comma-separated text, not a bespoke
  tag-input widget — same tradeoff this app already accepts for fields
  with no fixed vocabulary). The portfolio grid's own cards show
  bed/bath/sq-ft inline when set.
- **Verified live**: created a property with bedrooms/bathrooms/sq-ft/
  year built set, confirmed all four persisted and rendered on both the
  portfolio card and the detail page; used "Edit details" to add
  amenities and a photo URL, confirmed the `PATCH` response and the
  rendered badges/gallery matched; ran "Reindex for search" against the
  updated property and confirmed it still fails the same documented way
  (`"You have no credits remaining"`) rather than a new, different
  error — the embedding-text change didn't introduce a regression, it's
  still blocked on the same pre-existing OpenAI billing issue as
  everywhere else semantic search is discussed in this file.
- **Not done**: no way to reorder or caption individual photos, no
  amenities autocomplete/fixed vocabulary (freeform, matching the
  "record what's true" tradeoff `Lease.tenantName` already accepts), and
  semantic search still can't be verified end-to-end against these new
  fields until OpenAI billing is restored — a pre-existing block, not a
  new one this pass introduced.

## Module 17: Estate and Community Management — Phase 1 (this pass)

Unlike Module 3 and unlike the rest of the 16-24 bucket, this one has
real, user-supplied scope: "apartment buildings, estates, gated
communities, and managed communities" — resident records, service
charge collection, community announcements, visitor access requests,
facility booking, estate dues, complaint management, security notices,
community polls/voting, and estate reports, with `communities`,
`residents`, `community_announcements`, `visitor_access_requests`,
`facility_bookings`, `community_dues`, and `community_polls` as the
suggested entities. Ten features and seven entities is too much for one
pass — Phase 1 builds the three that everything else would need to
exist first anyway: **Communities**, **Residents**, and **Community
Announcements**. The other seven features are explicitly deferred, not
attempted partially.

- **A genuinely different shape from Property/Lease, on purpose.** An
  estate has many residents managed by one account at once — a
  meaningfully different relationship than a single owner's single
  tenant. `Community` is a new top-level owned resource (`accountId`,
  same as `Property`/`Project`), deliberately not linked to `Property`
  or `Lease` at all: a `Resident` is a simpler record (name, unit
  number, contact) than a full `Property`, matching how `Lease.
  tenantName` itself started as freeform text long before a real Tenant
  identity existed — resident self-service (a resident logging in to
  see its own community) is the same kind of later phase this
  codebase's own Module 13 history already went through, not attempted
  here.
- **`Community { accountId, name, address, communityType }`,
  `Resident { communityId, name, unitNumber, email?, phone?,
  residentType }`, `CommunityAnnouncement { communityId, title, body,
  createdByUserId }`** — every `Resident` field but name/unit is
  optional, same "record what's true, no forced workflow" reasoning
  `Lease.tenantName`/`MaintenanceRequest.assignedTo` already document.
  `CommunityAnnouncement` is the estate-level counterpart to
  `PropertyAnnouncement` (see "Community management" above) — same
  "landlord communicating with the people it houses" shape one level
  up, but always scoped to exactly one community (no nullable
  portfolio-wide broadcast the way `PropertyAnnouncement.propertyId`
  has) — an account managing several communities at once broadcasting
  across all of them isn't a need this phase's scope covers.
- **Two new permissions, `community:read`/`community:write`**, granted
  to the same three owner-tier roles `property:read`/`write` already
  sit on (`property_owner`, `family_admin`, `company_admin`) — not a
  new role, since managing an estate is a natural extension of what an
  account that already manages properties can do, not a distinct job
  the way `platform_reviewer`/`platform_admin` are.
- **`PermissionsGuard` gained a fourth ABAC check, for `:communityId`**
  — structurally identical to its existing `:propertyId`/`:projectId`
  checks (see its own comment): every route nested under a community
  (residents, announcements) gets tenant isolation for free, the same
  way `Property`'s own nested resources (valuations, inspections, ...)
  already do, rather than each `CommunitiesService` method re-validating
  ownership by hand.
- **`GET/POST /communities`, `GET/POST/DELETE .../residents`,
  `GET/POST/DELETE .../announcements`** — a new `CommunitiesModule`,
  and a new "Communities" nav item shown at the same reach as Portfolio
  itself (same three roles carry both permission pairs).
- **Verified live**: created "Palm Court Estate" as the demo owner,
  added a resident ("Jane Doe," unit "Block B, Flat 3"), posted a
  community announcement ("Gate maintenance"), and confirmed all three
  persisted and rendered correctly on the community's own detail page.
  Confirmed the vendor account (no `community:*` permission at all) gets
  a real 403 attempting the same route.
- **Not done, by explicit scope, not oversight**: service charge/estate
  dues collection, visitor access requests, facility booking, complaint
  management, security notices, community polls/voting, and estate
  reports — all seven remaining named features, and their four
  remaining suggested entities (`visitor_access_requests`,
  `facility_bookings`, `community_dues`, `community_polls`). No resident
  self-service portal yet (a `Resident` has no linked account the way
  `Lease.tenantAccountId` does) — the same phasing gap Module 13 itself
  had before its own Tenant identity pass.

## Not built yet

Deliberately out of scope for this pass — beyond Priority 6 in the
blueprint, or explicitly cut from it:

- **Modules 6, 14, 16-24** (the full property-verification/trust
  workflow; compliance, community management, AR/VR, admin
  operations, ...) — this scaffold now proves the pattern for Modules 1,
  2, 3, 4, 5, 7, 9, 10, 11, and a slice of 6, 8, 12, 13, 14, 15, 17, 23,
  and now two real slices of the 16-24 bucket itself — see "Admin operations
  — a platform accounts directory and account suspension" and "Community
  management — landlord-to-tenant announcements" above: a `platform_admin`
  role with a cross-tenant accounts directory, account suspension/
  reinstatement (wiring up `Account.status`, unused since Module 1), and
  an audit log; and a landlord-to-tenant announcement board, scoped
  either to one property or the whole portfolio. Module 3 is closed too
  now — see "Module 3: Property Details — specs, amenities, and a photo
  gallery" above: unlike 16-24, it was never an unscoped bucket, just a
  numbering gap between Module 2 (property CRUD) and Module 4
  (documents) with one self-evidently missing piece the code's own
  comments already pointed at (bedrooms/bathrooms/square footage/year
  built/amenities/a photo gallery, plus the first update endpoint the
  base property record has ever had). Module 17 (Estate and Community
  Management) now has real, user-supplied scope too — see "Module 17:
  Estate and Community Management — Phase 1" above: Communities,
  Residents, and Community Announcements are built; service charges,
  visitor access, facility booking, complaints, security notices, polls,
  and estate reports are explicitly deferred, not attempted. What's left
  genuinely unscoped is narrower now: Modules 18-21 and 24 — no
  blueprint text anywhere names what they contain, so nothing further
  here is buildable without real input. Module 6's risk-flag coverage is
  complete now across every entity type that has one — see "Risk flags
  for projects and leases" and
  "Risk flags for vendors and suppliers" above: `assess_listing_risk` used
  to be the only entity with a flat, explicit flag list; `Project`,
  `Lease`, `Vendor`, and `Supplier` now all have the same treatment
  (`assess_project_risk`, `assess_lease_risk`, `assess_vendor_risk`,
  `assess_supplier_risk`). A cross-portfolio "show every at-risk record"
  view exists now too, across all four — see "A cross-portfolio at-risk
  view" above (`GET /reports/at-risk-overview`).
  Module 15 is a bigger slice now too — see "A comparable-
  sales valuation estimate" above: a real automated estimate from other
  active sale listings nearby, alongside the manual/AI-narrated history
  and rent/hold-sell modeling that already existed. Still not a real
  AVM (automated valuation model) integration or anything beyond a
  same-city, same-property-type comparison. Module 14
  (Reports) is a bigger slice now — see "A project summary skill, and a real
  Reports dashboard" and "CSV export and scheduled email digests for
  Reports" above: `GET /reports/portfolio-overview` (real counts across
  a portfolio), a CSV export of the same data, and real scheduled email
  digests (a genuine `@nestjs/schedule` cron, not a fake toggle). A real
  report *builder* exists now too — see "A real report builder" further
  below — though it's a fixed metric registry projected from the same
  portfolio computation, not a custom-query designer; it also now has an
  AI-narration option of its own — see "AI narration for the report
  builder" above — closing the piece of Module 23's "natural-language
  report generation on top of every report type" that
  `generate_portfolio_report` alone didn't reach (the report builder's
  own custom, saved reports). Modules 8 and 12
  are slices, not the full modules — both can point an inspector/
  assignee at a real `Vendor` account, now optionally carrying a
  dedicated `inspector` role (see "A dedicated Inspector role" above),
  but still fall back to freeform text for a non-platform professional;
  Module 13 has no Tenant identity to link to at all, platform vendor or
  otherwise. Module 6's own evidence-request gap is now closed for three
  of its four neutral-reviewer actions — see "Structured
  evidence-submission channels for document and vendor/supplier
  verification" above — leaving only review `moderationStatus` without
  one, which isn't a gap: "flagged" already plays an analogous "needs a
  decision" role there, raised by the reviewed party rather than
  requested by the reviewer.
- **Property inspections — closer to closed still.** `inspectorVendorId`
  can point at a platform `Vendor` now, that vendor can self-report a
  professional license, picking an electrical/security-installation/
  general-contracting vendor with no license (or an expired one) is
  actually rejected, and a vendor can now carry a dedicated `inspector`
  role distinct from the general marketplace `vendor` role (see "A
  self-reported professional license for vendors," "Requiring a license
  for a regulated trade before a vendor can be assigned," and "A
  dedicated Inspector role" above). What's left: the role is a
  professional-identity choice at account-creation time, not an
  access-control gate — a property owner can still pick *any* vendor
  (any role) as an inspector, and the freeform `inspectorName` path for a
  non-vendor still records nothing about licensing at all, inherent to
  that path. Editing a scheduled inspection's date/type/project/inspector
  is now possible — see "Edit endpoints for Inspections, Leases, and
  Maintenance requests" below.
- **Leases — Tenant identity is fully closed now.** A tenant has a real
  account type, role, and its own lease/document/maintenance view; a
  tenant signing up auto-links to a matching lease and notifies the
  landlord; documents can be tagged to a tenancy; `summarize_my_tenancy`
  exists (see "A real Tenant identity" and "Closing the three Tenant
  identity gaps" above). Editing a lease's rent/dates/deposit, and
  overdue-rent detection, are also possible now — see "Edit endpoints"
  and "Overdue-rent detection" below.
- **Maintenance requests — closer to closed still.** `assignedVendorId`
  can point at a platform `Vendor` now, that vendor can self-report a
  professional license the same way a vendor-linked inspector can, and
  assigning an unlicensed (or expired-license) electrical/security-
  installation/general-contracting vendor is now actually rejected —
  the same `requireVendor` check inspections use, since both pass
  through it (see "Maintenance requests", "Linking inspectors and
  maintenance assignees to real vendor accounts", "A self-reported
  professional license for vendors", and "Requiring a license for a
  regulated trade before a vendor can be assigned" above). `assignedTo`
  is still freeform text for anyone off-platform — inherent to that
  path, not a license-check gap. Editing a request's title/description/
  priority is now possible — see "Edit endpoints" below.
- **Vendor and supplier trust scores are no longer *only* the platform's
  own arithmetic, but still aren't a full independent audit of the
  business.** See "Vendor and supplier trust audits" above: the score
  now blends in a `platform_reviewer`'s own recorded judgment call
  (`VendorTrustAudit`/`SupplierTrustAudit`, kept as history, most recent
  one scored) and whether the account's own operator has passed real
  identity verification (Sumsub) — real signals, not just recomputed marketplace
  activity. What it still isn't: a reviewer's audit checks what that
  reviewer chose to check (there's no mandated checklist — a physical
  site visit, insurance/license lookups, credit history), and nothing
  requires an audit to exist at all, so a vendor/supplier with no audit
  on record just scores on activity plus identity, same as before this
  pass.
- **The neutral reviewer's decisions carry real context for all four
  fields now, and three of the four have a real evidence-submission
  channel behind them too.** `platform_reviewer` covers `Vendor`/
  `Supplier.verificationStatus`, dispute arbitration,
  `Document.verificationStatus`, and review `moderationStatus` (see "A
  real neutral reviewer", "Extending the neutral reviewer to dispute
  arbitration", "Extending the neutral reviewer to document
  verification", and "Review moderation" above). Dispute arbitration and
  document verification both have an evidence-request step
  (`under_review` / `submitted`); vendor/supplier verification's
  `pending` plays the same "awaiting evidence" role. All three now also
  have a real, structured way for the reviewed account to *submit*
  evidence in response — see "Structured evidence-submission channels
  for document and vendor/supplier verification" above — not just
  general tools unrelated to the review itself. Review `moderationStatus`
  is the one exception, by design rather than oversight: "flagged"
  already plays an analogous "needs a decision" role there, raised by
  the reviewed party rather than requested by the reviewer, so there's
  nothing parallel to add.
- **Real AR/VR renovation visualization — deliberately not attempted.**
  See "AI-generated renovation visualizations — the 2D half only" above:
  a bounded 2D "AI-edited before/after photo" slice is built, and its
  storage half (Cloudflare R2) is now confirmed live with real
  credentials — a real upload, fetched back over a real public URL. Only
  the actual OpenAI image generation call remains unverified, blocked on
  a billing/credits issue on the account the key belongs to, not on
  anything left to build. Real AR/VR needs a native mobile app or
  WebXR, photogrammetry/3D reconstruction, and a full 3D content
  pipeline — none of which exist here, and none of which are a bounded
  addition to this scaffold the way everything else on this list is. See
  [`docs/ar-vr-feasibility-spike.md`](docs/ar-vr-feasibility-spike.md)
  for a written-only (no code) breakdown of what each of those four
  pieces would actually require, the mobile-vs-web tradeoff underneath
  all of it, and one genuinely bounded first slice (a WebXR,
  Android-only material/color preview) that would fit inside this repo
  if a future pass wants to start somewhere real instead of nowhere.
- **The stub LLM provider now extracts structured arguments for the one
  skill that has any to extract.** See "Stub LLM argument extraction"
  above: `model_roi_scenario` is the only skill in the registry whose
  `inputSchema` declares anything beyond `NO_INPUT_SCHEMA`, so a
  dedicated heuristic parser (plain regexes, not a schema-driven engine)
  closes the actual gap rather than a generic one built for a registry
  of one real consumer. `AnthropicLlmProvider` (a real model reading the
  sentence and the schema together) still does this properly for every
  skill; the stub only ever had to do better than always sending `{}`,
  which it now does for the one skill where that mattered.
- **All four gateways Section 16 named are live now — deposits on all
  four, payouts on three of them.** See "A real payout gateway —
  Paystack Transfers", "Flutterwave and PayPal: a second and third real
  gateway", and "Stripe: the fourth gateway, now live too" above.
  Paystack, Flutterwave, and PayPal all process real deposits and
  payouts, each verified live against its own real API (Paystack's own
  payout still blocked on external account activation at the OTP step;
  Flutterwave and PayPal both verified further, including a real payout
  attempt). Stripe is deposit-only by design, not by omission — see
  StripeService's own comment for why a payout path would need Stripe
  Connect, a materially different product, rather than being something
  this file could "complete in advance" — but its deposit side is fully
  live and was verified furthest of all four: an actual test-card
  checkout completed end to end, not just a session created. The
  licensing/compliance workstream the blueprint says to run alongside
  all of this (Section 15) is still entirely open — that was never code
  this pass could close.
- **Real identity verification (Sumsub, swapped from Dojah) is now
  fully live-verified, short of submitting an actual ID document.** See
  "Real identity (KYC) verification — Sumsub" above — real sandbox
  credentials created a genuine Sumsub applicant, minted a real WebSDK
  access token, and launched Sumsub's actual onboarding widget in the
  browser; `GET /identity/me`/`POST /identity/refresh` both correctly
  reflected the result against the real API. Only stopped short of
  clicking through actual document upload (nothing legitimate to test
  with). The Dojah-specific caveat this bullet used to carry
  (exact-token, not fuzzy, name-matching) no longer applies — that code
  doesn't exist anymore, and Sumsub's own document-review matching isn't
  something this integration controls or can characterize the same way.
- **Dispute arbitration's evidence gap is closed on both sides now, and
  the two-party path is no longer just coexisting alongside it
  unrelated.** See "Extending the neutral reviewer to dispute
  arbitration", "An evidence-request step for dispute arbitration", and
  "Submitting evidence on a dispute" above — `platform_reviewer` can
  arbitrate any open dispute platform-wide without ever having raised
  it, set it `under_review` with a note requesting more, and either
  party can now submit evidence in response through a real
  `DisputeEvidence` channel the arbitrator sees inline. See "Unifying
  two-party dispute resolution with arbitration" further below for the
  other half: once a reviewer sets a dispute `under_review`, the
  two-party resolve path is now actually locked out on it (a real gap
  found live — it previously wasn't, so either original party could
  silently overwrite an in-progress arbitration). Before arbitration
  ever touches a given dispute, the two-party path still works exactly
  as before — the account that raised a dispute still can't resolve it
  itself, and an open dispute still holds its milestone/payment.
- **Deeper AI (Priority 6)** — real AR/VR renovation visualization
  (needs Module 22 first, deliberately not attempted — see above) is the
  one item left on this list; a bounded 2D "AI-edited before/after
  photo" version of it is no longer on it either. Natural-language
  project summaries, valuation/ROI dashboards, and listing summaries
  beyond `assess_listing_risk` are no longer on it — see "A project
  summary skill, and a real Reports dashboard", "An ROI & valuation
  dashboard", and "A seller-facing listing summary skill" above.
- **The rest of the web app.** Several passes now built the app shell, the
  reusable `AskAiPanel`, and screens for portfolio + projects + vendor
  marketplace + payments/escrow + property/materials marketplace +
  documents + reviews + a payments rollup + a portfolio reports dashboard
  (see "Web app" above). Document
  verification is no longer on this list — see "Document verification"
  above — though it's still an account's own admin doing the verifying,
  not an independent reviewer.
- **Reviews now have moderation.** See "Review moderation — flagging and
  the neutral reviewer (Module 6)" above for the report/flag mechanism and
  the `platform_reviewer` role's hide/dismiss/restore actions this closed.
  `compare_vendor_quotes` and `boq_to_order` now read reviews (see "AI
  skills read reviews" below) — `assess_listing_risk` still doesn't, but
  that's because listings have no vendor/supplier relationship to read in
  the first place, not because it was skipped.
- **Auth hardening — down to one real tradeoff, explicitly accepted
  rather than deferred.** Rate limiting and refresh-token revocation are
  no longer on this list — see "Auth hardening: rate limiting,
  refresh-token revocation, refunds" above — and neither is client-side
  validation (see "Real client-side validation" above — password-
  confirmation is real now; email format and required fields still lean
  on native HTML plus the backend's own validation, deliberately, see
  that section), the password-reset email (now actually sent — see "A
  real email provider — Resend" above), or the access token living in
  `localStorage` (see "Moving auth off localStorage: httpOnly cookies +
  CSRF" above — it's in an httpOnly cookie now, with real CSRF
  protection alongside it). What that pass's own comment flags as the
  cost, not a gap: a `curl` request or a future mobile app can no longer
  authenticate with a bearer header, only a browser holding the httpOnly
  cookies can — a production system serving non-browser clients too would
  need a second auth mechanism (API keys) alongside this one.
- **Both halves of "Search and vector layers" now wired, neither one a
  literal match for what the Technical Architecture section named; object
  storage exists, but only for one narrow purpose.** The search half —
  see "Fuzzy free-text search for all three marketplaces" above — uses
  Postgres `pg_trgm`, not a real Elasticsearch/OpenSearch cluster: no
  fielded queries, no relevance tuning, no distributed index, but it does
  close the actual "can't search by name/keyword" gap for listings,
  vendors, and materials. The vector half — see "Semantic property search
  — pgvector + OpenAI embeddings" above — uses `pgvector` on the same
  Postgres instance rather than a dedicated vector DB service, and is
  fully wired for `Property` only (routing, auth/account-scoping, and
  error handling all verified live) but has never actually generated a
  real embedding end-to-end: it hits the same pre-existing OpenAI billing
  block already documented for the visualizer below. Neither pass stood
  up new infrastructure to run or pay for — that was the explicit
  tradeoff made when choosing them. S3-compatible object storage is no
  longer narrow, either — see "A general file-upload pipeline" above:
  `StorageService` (Cloudflare R2) moved out of the visualizations
  module into its own, and a real `POST /uploads` endpoint feeds a real
  URL into `Document.fileUrl` and every evidence `fileUrl` field, not
  just AI-generated visualization images.
- **Payment/escrow licensing, market-specific verification mechanisms,
  and data residency remain real regulatory work, not something code
  solves — but there's now a real place to track it.** See "A platform
  compliance tracker" above: a checklist the platform's own trust &
  safety function uses to record which items exist, per market, and
  where each stands. It doesn't obtain a license, verify a jurisdiction's
  actual requirements, or enforce data residency — no code could — it
  just replaces "nothing" with an honest, live-verified tracking surface
  for the humans who do that work.
- **Invite/accept is fully closed out now.** See "Real invite/accept
  flow", "Revoking and resending pending invites", "A real email
  provider — Resend", and "Finding out you've been invited" above —
  invites are emailed, revocable, resendable, and now discoverable from
  both the account switcher and a fresh registration, not just the
  inviting account's own Members page. Nothing left on this list from the
  original invite/accept gap.
- **Chaining an AI Accept into its drafted action — down to one skill
  left, and it's advisory by design.** See "Accepting a status-update
  draft now posts it" and "Accepting a listing-description draft now
  saves it" above for the two skills this closed. Every other skill's
  Accept still only records the decision — and for the ones left that's
  not a shortcut, it's the design: `compare_vendor_quotes` and
  `boq_to_order` are explicitly advisory (see their own code comments),
  and `flag_payment_anomaly` reports anomalies that already happened in
  the ledger, not a pending action there's anything to "hold" — the
  milestone-release-hold example this bullet used to give doesn't
  actually correspond to any flag that skill raises.
