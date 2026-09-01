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
  src/properties/        Property portfolio CRUD (Module 2)
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
- **What's still open**: the JWT (now the short-lived access token) still
  lives in `localStorage`, not an httpOnly cookie — moving to cookies
  would mean the API setting them itself (CORS + `credentials: 'include'`
  + CSRF protection, none of which exists here) and stops working cleanly
  for non-browser API callers (curl, the eventual mobile app) the way a
  bearer header does. That tradeoff is deliberate for this pass, not an
  oversight, but it's still the reason `localStorage` XSS exposure is
  listed under "Not built yet" rather than closed.

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

Priority 4 — Module 11. No real payment gateway is wired up (Section 16
lists Paystack/Flutterwave/Stripe/PayPal as day-one integrations); every
deposit and payout here is simulated and completes instantly, the same way
`StubLlmProvider` simulates a model. What's real is the ledger — every
balance change is an `EscrowLedgerEntry`, so a project's escrow balance is
always derivable from its history rather than just a number someone could
edit directly.

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
  bypass around them. It's deliberately one tool call per turn, reported
  straight back to the user rather than looped into a second model call —
  an explicit scope boundary, not a full agent loop.

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
- **Still not a neutral reviewer.** This scaffold's RBAC has no
  reviewer identity outside the account itself — an account's own
  owner/admin can verify a document its own member uploaded, which isn't
  what Module 6's "neutral reviewer" ultimately calls for. The bullet
  below about the fuller trust workflow (risk flags, trust scores, a real
  independent reviewer) stays open; this pass only adds the mechanical
  ability to change the status at all.

## Not built yet

Deliberately out of scope for this pass — beyond Priority 6 in the
blueprint, or explicitly cut from it:

- **Modules 6, 8, 12-14, 16-24** (the full property-verification/trust
  workflow — a neutral reviewer, risk flags, trust scores; inspections,
  maintenance, leases, the rest of valuation beyond `PropertyValuation`,
  compliance, community management, AR/VR, the full fixed-dashboard side of
  reports, admin operations, ...) — this scaffold now proves the pattern
  for Modules 1, 2, 4, 5, 7, 9, 10, 11, and a slice of 15 and 23, not the
  full 24.
- **AI-generated renovation visualizations.** Explicitly deferred by
  Priority 6 itself, pending Module 22 (AR/VR) existing at all.
- **Multi-turn tool use in one chat turn.** `ChatService` calls at most one
  tool per message and reports the result directly — no agent loop where
  the model chains several tool calls before replying.
- **The stub LLM provider doesn't extract structured arguments from free
  text.** Every skill now declares a real `inputSchema` (see "Per-skill AI
  input schemas" above) and `AnthropicLlmProvider` passes it to the model,
  but `StubLlmProvider`'s keyword router only ever calls a matched tool with
  `{}` — a real model reads the sentence and the schema together to fill in
  arguments (e.g. "model a 10% rent increase" → `{ scenario:
  "rent_increase", rentIncreasePercent: 10 }`); the no-API-key stub doesn't
  attempt that.
- **A real payment gateway.** `src/payments` simulates every deposit and
  payout instantly — Paystack/Flutterwave/Stripe/PayPal integration
  (Section 16), and the licensing/compliance workstream the blueprint says
  to run in parallel with it (Section 15), are both still open.
- **A real dispute-resolution workflow.** Right now any account member with
  `dispute:write` can both raise and resolve a dispute — no neutral
  reviewer, evidence request, or payment hold tied to an open dispute.
- **A cart, and tool/equipment rental booking.** `src/materials` goes
  straight from browsing to a line-item order; Module 10's rental calendar/
  booking flow for tools and equipment isn't built.
- **Deeper AI (Priority 6)** — natural-language project summaries beyond
  what `summarize_property`/`draft_project_status_update` already do,
  financial modeling chat, listing/risk summaries, valuation/ROI
  dashboards, AI-generated renovation visualizations (needs AR/VR first).
- **The rest of the web app.** Several passes now built the app shell, the
  reusable `AskAiPanel`, and screens for portfolio + projects + vendor
  marketplace + payments/escrow + property/materials marketplace +
  documents + reviews + a payments rollup (see "Web app" above). Document
  verification is no longer on this list — see "Document verification"
  above — though it's still an account's own admin doing the verifying,
  not an independent reviewer.
- **Order carts and favorites don't persist server-side beyond what the API
  already tracks.** The materials order widget's "cart" is local component
  state cleared on submit (one order per checkout, no saved cart across
  visits); the listing detail page's Favorite button is optimistic-only
  since there's no `GET` that reports whether the current account already
  favorited a given listing (see the code comment in `pages/marketplace/[id].tsx`).
- **Reviews are one-shot and unmoderated.** No editing or deleting a review
  once submitted (by the reviewer or an admin), no reply from the
  vendor/supplier being reviewed, and no surfacing of a vendor's/supplier's
  *own* received reviews on their "me" dashboard (only on their public
  profile/storefront page — matches the pre-existing gap on the vendor
  dashboard, not a new one). `compare_vendor_quotes` and `boq_to_order` now
  read reviews (see "AI skills read reviews" below) — `assess_listing_risk`
  still doesn't, but that's because listings have no vendor/supplier
  relationship to read in the first place, not because it was skipped.
- **Auth hardening that's still open.** The access token lives in
  `localStorage` (XSS-exposed) rather than an httpOnly cookie — a
  deliberate tradeoff, see "Web app auth hardening" above, not an
  oversight. The password-reset email is logged/returned instead of
  actually emailed (no provider wired up). No client-side validation
  beyond native HTML `required`/`minLength`/`type="email"`. Rate limiting
  and refresh-token revocation are no longer on this list — see "Auth
  hardening: rate limiting, refresh-token revocation, refunds" above.
- **Ask AI panel input forms.** Quick actions always call `POST /ai/actions`
  with an empty `input: {}` — fine today since every skill either ignores
  `input` or has sensible defaults, but ties directly to the "per-skill
  structured input schemas" gap above: once a skill needs required input
  (e.g. `model_roi_scenario`'s `scenario` choice), the panel will need a
  small per-skill form, not just a button.
- **Search, media, and vector layers** (Elasticsearch/OpenSearch, S3-
  compatible object storage, a vector DB for AI context retrieval) — the
  Technical Architecture section calls these out, none are wired up here.
  `Document.fileUrl` currently expects a URL you provide yourself.
- **Payment/escrow licensing, market-specific verification mechanisms,
  and data residency** — the compliance work the blueprint review flagged
  needs to run in parallel with engineering, not be solved by this code.
- **A real invite/accept flow.** `POST /accounts/:accountId/members` only
  adds an *existing* user by email; inviting someone who doesn't have an
  account yet is future work.
- **Chaining an AI Accept into the action it drafted for** (e.g. accepting
  a milestone-release anomaly flag should actually place the payment hold
  described in Module 11) — right now Accept only records the decision.
