// Typed client for the NestJS API (apps/api). One file, one shape per
// endpoint, so every screen and the Ask AI panel share the exact same
// request/response contracts instead of each hand-rolling fetch calls.
//
// Auth pattern (mirrors apps/api/src/common/guards): the actual access
// token lives in an httpOnly cookie this JS can never read — every fetch
// below just sends `credentials: "include"` and the browser attaches it
// automatically. `ApiClient`'s own `token` field is NOT a credential
// anymore; it's a non-secret "does the caller believe a session is
// active" marker (see lib/auth.tsx's AuthProvider), kept only so the
// 401-triggers-a-refresh-then-retry logic below still has something to
// gate on. A separate `X-Account-Id` header says which account the user
// is currently acting as (Module 1 — one user can belong to several
// accounts) — that one really is just plumbed straight through, since
// it's not a secret.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  // NOT sent anywhere — the real credential lives in an httpOnly cookie
  // the browser attaches on its own. This only gates whether request()
  // believes the call was meant to be authenticated, i.e. whether a 401
  // is worth retrying after a silent refresh. See the module comment.
  token?: string | null;
  accountId?: string | null;
  // Internal — set when request() re-issues a call after a successful
  // silent refresh, so a second 401 (refresh token also expired/invalid,
  // or the server rejects the retry for some other reason) fails instead
  // of looping forever.
  _isRetry?: boolean;
};

// ---- Access-token refresh -------------------------------------------------
//
// AuthService issues a short-lived (1h) access token plus a long-lived
// (30d) refresh token (see apps/api/src/auth/auth.service.ts), both now
// httpOnly cookies (see AuthController) — this module never sees either
// token's actual value. Rather than making every screen notice a 401 and
// handle it, request() below does it once, centrally: on a 401 from an
// authenticated call, it transparently asks POST /auth/refresh to mint a
// new pair (the browser sends the existing refresh_token cookie
// automatically; the response Set-Cookie headers replace both cookies,
// invisibly to this code), retries the original call, and only surfaces
// an error to the caller if that retry also fails (refresh token expired
// too, or this account was otherwise signed out — either way, the right
// response is a real logout).
//
// lib/auth.tsx's AuthProvider is the only caller of configureAuthSession —
// it's the one place that knows how to force a logout and redirect, so
// this module never touches storage or routing itself.
type AuthSessionHooks = {
  onRefreshFailed: () => void;
};

let authSessionHooks: AuthSessionHooks | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function configureAuthSession(hooks: AuthSessionHooks | null) {
  authSessionHooks = hooks;
}

// Endpoints that either don't need a session or ARE the refresh flow
// itself — a 401 from any of these must never trigger another refresh
// attempt.
const NO_REFRESH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh"];

function performRefresh(): Promise<boolean> {
  // Concurrent 401s (several requests firing around the same time, all
  // hitting the same expired access token) share one in-flight refresh
  // call instead of each racing their own — the check-and-set here is
  // synchronous, so it's safe without a lock.
  if (!refreshInFlight) {
    refreshInFlight = request<unknown>("/auth/refresh", { method: "POST" })
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

// Reads the CSRF double-submit cookie (see apps/api/src/common/guards/
// csrf.guard.ts) so it can be echoed back as a header on mutating
// requests — this cookie is deliberately NOT httpOnly, it carries no
// authority on its own, only proof that this same-site page could read
// it. SSR-safe: `document` doesn't exist server-side, and there's no
// session to protect there either.
function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.accountId) headers["X-Account-Id"] = opts.accountId;
  if (method !== "GET") {
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    // Sends the httpOnly auth cookies (and the readable CSRF one) on
    // every request, including cross-origin ones to the API's own port —
    // see main.ts's CORS config for the other half of making that work.
    credentials: "include",
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // A 2xx with no application/json content-type is what every
  // "not found"/"no profile yet" endpoint in this API produces when its
  // handler returns null (see e.g. GET /vendors/me, GET /tenant/lease) —
  // Nest sends an empty body with no content-type at all for that, not
  // the literal JSON string "null". Reading it back as `null` (not
  // `undefined`) matters: several pages use `undefined` as their own
  // "still loading" sentinel (e.g. VendorDashboardPage's `vendor` state),
  // so returning `undefined` here made a real "no profile yet" result
  // indistinguishable from "hasn't resolved yet" and left those pages
  // stuck on their loading state forever. Draining the body either way
  // (even though it's empty in the null case) also avoids the browser
  // reporting the response as an aborted/unconsumed stream.
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => undefined) : await res.text().then(() => null).catch(() => null);

  if (!res.ok) {
    // getCsrfToken() !== null is a "was there ever a session to refresh"
    // check, not the actual credential — the csrf_token cookie is set and
    // cleared in lockstep with refresh_token (see cookie.util.ts), so its
    // absence is a reliable signal there's nothing to refresh, without
    // this code ever needing to see the real refresh token. Skips a
    // guaranteed-to-fail (and CSRF-guard-rejected, not even a clean 401)
    // round trip on every page load for a visitor who was never signed in.
    if (res.status === 401 && opts.token && !opts._isRetry && !NO_REFRESH_PATHS.includes(path) && getCsrfToken() !== null) {
      const refreshed = await performRefresh();
      if (refreshed) {
        return request<T>(path, { ...opts, _isRetry: true });
      }
      authSessionHooks?.onRefreshFailed();
    }
    // Nest's default HttpException body: { statusCode, message, error }
    // where `message` can be a string or a class-validator string[].
    const rawMessage = data?.message;
    const message = Array.isArray(rawMessage) ? rawMessage.join(", ") : rawMessage ?? res.statusText;
    throw new ApiError(res.status, message || `Request failed (${res.status})`);
  }

  return data as T;
}

// ---- Shapes -----------------------------------------------------------

export type CurrentUser = { id: string; email: string };

export type IdentityStatus = {
  identityVerificationStatus: "not_verified" | "pending" | "verified" | "failed" | string;
  identityVerificationNotes?: string | null;
  identityVerifiedAt?: string | null;
  // Set once startIdentityVerification has created a Sumsub applicant —
  // present even before a result comes back, since it's what
  // refreshIdentityStatus polls against.
  sumsubApplicantId?: string | null;
};

export type AccountSummary = {
  accountId: string;
  accountName: string;
  accountType: "INDIVIDUAL" | "FAMILY" | "COMPANY" | "VENDOR" | "SUPPLIER" | string;
  role: string;
};

export type AccountMemberSummary = {
  id: string;
  status: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
  role: { key: string; name: string };
};

export type AccountInviteSummary = {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  role: { key: string; name: string };
};

// GET /invites/mine — every pending invite sent to the signed-in user's
// own email, across every account, not just the one Members page they
// happen to be looking at. See AccountsService.findMyInvites.
export type AccountInviteMine = {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  account: { id: string; name: string; accountType: string };
  role: { key: string; name: string };
};

export type InvitePreview = {
  accountName: string;
  accountType: string;
  roleName: string;
  email: string;
  expiresAt: string;
  hasAccount: boolean;
};

export type Property = {
  id: string;
  accountId: string;
  propertyType: string;
  name: string;
  addressLine: string;
  city?: string | null;
  state?: string | null;
  country: string;
  status: string;
  currentUse?: string | null;
  estimatedValue?: string | null;
  createdAt: string;
  updatedAt: string;
  owners?: unknown[];
  documents?: PropertyDocument[];
  timelineEvents?: PropertyTimelineEvent[];
};

export type PropertyDocument = {
  id: string;
  documentType: string;
  fileUrl: string;
  verificationStatus: string;
  expiryDate?: string | null;
  createdAt: string;
};

// The account-wide shape GET /documents and GET /documents/property/:id
// return — a superset of PropertyDocument (which is what GET
// /properties/:id embeds inline instead).
export type AppDocument = {
  id: string;
  accountId: string;
  propertyId?: string | null;
  // Tags this document as belonging to a specific tenancy — see the
  // schema comment on Document.leaseId. Set via createDocument's own
  // leaseId input; `lease` is only populated by GET /documents and GET
  // /documents/property/:id (the landlord's own views), not returned by
  // GET /tenant/documents which already knows whose tenancy it's asking
  // about.
  leaseId?: string | null;
  lease?: { tenantName: string } | null;
  documentType: string;
  fileUrl: string;
  verificationStatus: "not_verified" | "submitted" | "verified" | "rejected" | string;
  verificationNotes?: string | null;
  expiryDate?: string | null;
  uploadedByUserId: string;
  createdAt: string;
  // Only present on GET /documents/pending (the neutral-reviewer queue) —
  // the account-scoped /documents routes already know whose document it is.
  account?: { id: string; name: string };
  property?: { id: string; name: string } | null;
};

export type PropertyTimelineEvent = {
  id: string;
  eventType: string;
  label: string;
  occurredAt: string;
};

export type PropertyValuation = {
  id: string;
  propertyId: string;
  estimatedValue: string;
  currency: string;
  source: string;
  notes?: string | null;
  valuedAt: string;
};

// The 2D "AI-generated renovation visualization" slice — see the schema
// comment on RenovationVisualization for why real AR/VR (Module 22)
// isn't what this is.
export type RenovationVisualization = {
  id: string;
  propertyId: string;
  projectId?: string | null;
  requestedByUserId: string;
  prompt: string;
  beforeImageUrl: string;
  afterImageUrl?: string | null;
  status: "pending" | "completed" | "failed" | string;
  errorMessage?: string | null;
  createdAt: string;
  completedAt?: string | null;
};

export type RoiSummary = {
  currency: string;
  currentValue: number;
  acquisitionValue: number;
  totalProjectSpend: number;
  invested: number;
  simpleRoiPercent: number;
  totalAnnualRent: number;
  grossYieldPercent: number;
  valuationHistory: { id: string; estimatedValue: number; currency: string; source: string; valuedAt: string }[];
};

export type InspectionFinding = {
  id: string;
  inspectionId: string;
  area: string;
  description: string;
  severity: "minor" | "moderate" | "major" | string;
  createdAt: string;
};

export type AssignedVendor = { id: string; businessName: string; serviceCategory: string; verificationStatus: string };

export type PropertyInspection = {
  id: string;
  propertyId: string;
  projectId?: string | null;
  inspectionType: "general" | "pre_purchase" | "move_in" | "move_out" | "safety" | "post_renovation" | string;
  status: "scheduled" | "completed" | "cancelled" | string;
  scheduledFor: string;
  inspectorVendorId?: string | null;
  inspectorVendor?: AssignedVendor | null;
  inspectorName?: string | null;
  overallResult?: "pass" | "needs_attention" | "fail" | string | null;
  summary?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  findings?: InspectionFinding[];
};

export type LeaseRentPayment = {
  id: string;
  leaseId: string;
  amount: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  method: string;
  notes?: string | null;
  paidAt: string;
};

export type Lease = {
  id: string;
  propertyId: string;
  tenantName: string;
  tenantEmail?: string | null;
  tenantPhone?: string | null;
  // Set once the tenant has their own AccountType.TENANT account and a
  // landlord has linked it — see POST .../leases/:leaseId/link-tenant.
  tenantAccountId?: string | null;
  tenantAccount?: { id: string; name: string } | null;
  rentAmount: string;
  currency: string;
  rentFrequency: "weekly" | "monthly" | "annually" | string;
  depositAmount?: string | null;
  startDate: string;
  endDate?: string | null;
  status: "active" | "ended" | "terminated" | string;
  notes?: string | null;
  endedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  rentPayments?: LeaseRentPayment[];
  property?: { id: string; name: string; addressLine: string; city?: string | null; country: string };
};

export type MaintenanceRequest = {
  id: string;
  propertyId: string;
  leaseId?: string | null;
  title: string;
  description: string;
  priority: "low" | "normal" | "high" | "urgent" | string;
  status: "open" | "in_progress" | "resolved" | "cancelled" | string;
  reportedBy?: string | null;
  assignedVendorId?: string | null;
  assignedVendor?: AssignedVendor | null;
  assignedTo?: string | null;
  resolutionNotes?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiSkillInputField = {
  type: "string" | "number" | "boolean";
  description: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  default?: string | number | boolean;
};

export type AiSkillInputSchema = {
  type: "object";
  properties: Record<string, AiSkillInputField>;
  required?: string[];
};

export type AiSkill = {
  key: string;
  label: string;
  requiredPermission: string;
  moduleContextPrefix: string;
  inputSchema: AiSkillInputSchema;
};

export type AiActionResult = {
  requestId: string;
  outputId: string;
  draftLabel: string;
  items: string[];
  warn: boolean;
};

export type AiMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  toolName?: string | null;
  aiOutputId?: string | null;
  createdAt: string;
};

export type AiConversation = {
  id: string;
  accountId: string;
  moduleContext?: string | null;
  title?: string | null;
  createdAt: string;
  updatedAt: string;
  messages?: AiMessage[];
};

export type AiActionApproval = {
  id: string;
  aiOutputId: string;
  decision: "accepted" | "edited" | "discarded";
  decidedAt: string;
  notes?: string | null;
};

// --- Projects & vendor marketplace (Priority 3) -------------------------

export type ProjectStage = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  status: "not_started" | "in_progress" | "completed" | string;
};

export type ProjectMilestone = {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  paymentAmount?: string | null;
  dueDate?: string | null;
  status: "pending" | "in_progress" | "completed" | string;
  approvalStatus: "not_requested" | "requested" | "approved" | "rejected" | string;
  createdAt: string;
};

export type ProjectUpdate = {
  id: string;
  projectId: string;
  milestoneId?: string | null;
  submittedByUserId: string;
  description: string;
  mediaUrls: string[];
  createdAt: string;
};

export type TrustAuditFactor = { rating: string; notes: string; createdAt: string } | null;

export type VendorTrustScore = {
  score: number;
  band: "excellent" | "good" | "fair" | "caution" | string;
  factors: {
    verificationStatus: string;
    ratingAverage: number | null;
    reviewCount: number;
    completedProjects: number;
    disputeCount: number;
    latestAudit: TrustAuditFactor;
    identityVerifiedOperator: boolean;
    licenseExpired: boolean;
  };
};

export type VendorTrustAudit = {
  id: string;
  vendorId: string;
  reviewedByUserId: string;
  rating: "clean" | "minor_concerns" | "major_concerns" | string;
  notes: string;
  createdAt: string;
};

export type Vendor = {
  id: string;
  accountId: string;
  businessName: string;
  serviceCategory: string;
  locationCoverage?: string | null;
  verificationStatus: string;
  verificationNotes?: string | null;
  ratingAverage?: string | null;
  bankAccountNumber?: string | null;
  bankCode?: string | null;
  bankAccountName?: string | null;
  // Which real payout gateway bankAccountNumber/bankCode/bankAccountName
  // (or paypalPayoutEmail) are currently set up for — "paystack" |
  // "flutterwave" | "paypal" | null. Null falls back to a simulated
  // payout, same as no bank details on file at all.
  payoutProvider?: string | null;
  paypalPayoutEmail?: string | null;
  // Self-reported, unverified — see the schema comment on
  // Vendor.licenseNumber. Set together via setVendorLicense.
  licenseNumber?: string | null;
  licenseIssuingBody?: string | null;
  licenseExpiresAt?: string | null;
  createdAt: string;
  reviews?: VendorReview[];
  trustScore?: VendorTrustScore;
};

export type PaystackBank = { name: string; code: string; currency: string };

export type VendorReview = {
  id: string;
  vendorId: string;
  projectId: string;
  accountId: string;
  rating: number;
  comment?: string | null;
  response?: string | null;
  respondedAt?: string | null;
  moderationStatus: "published" | "flagged" | "hidden" | string;
  flagReason?: string | null;
  flaggedAt?: string | null;
  moderationNotes?: string | null;
  moderatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  // Only present on GET /vendors/reviews/flagged
  vendor?: { id: string; businessName: string };
};

export type VendorQuote = {
  id: string;
  projectId: string;
  vendorId: string;
  amount: string;
  currency: string;
  notes?: string | null;
  status: "requested" | "submitted" | "accepted" | "declined" | "withdrawn" | string;
  createdAt: string;
  vendor?: Vendor;
  project?: { id: string; title: string; status: string };
};

export type ProjectVendorAssignment = {
  id: string;
  projectId: string;
  vendorId: string;
  role: string;
  vendor?: Vendor;
};

export type Project = {
  id: string;
  accountId: string;
  propertyId: string;
  projectType: string;
  title: string;
  scopeDescription?: string | null;
  budget?: string | null;
  currency: string;
  status: "planning" | "in_progress" | "on_hold" | "completed" | "cancelled" | string;
  startDate?: string | null;
  expectedEndDate?: string | null;
  createdAt: string;
  updatedAt: string;
  stages?: ProjectStage[];
  milestones?: ProjectMilestone[];
  updates?: ProjectUpdate[];
  quotes?: VendorQuote[];
  assignments?: ProjectVendorAssignment[];
  reviews?: VendorReview[];
};

export type Payout = {
  id: string;
  vendorId: string;
  projectId: string;
  milestoneId?: string | null;
  amount: string;
  currency: string;
  status: "pending" | "processing" | "paid" | "failed" | string;
  payoutMethod: string;
  provider: "manual" | "paystack" | "flutterwave" | "paypal" | string;
  providerReference?: string | null;
  createdAt: string;
  paidAt?: string | null;
  project?: { id: string; title: string };
};

// --- Payments & escrow (Priority 4) --------------------------------------

export type Payment = {
  id: string;
  accountId: string;
  projectId: string;
  escrowAccountId: string;
  amount: string;
  currency: string;
  provider: string;
  providerReference?: string | null;
  status: "pending" | "completed" | "failed" | "refunded" | string;
  createdAt: string;
};

export type EscrowLedgerEntry = {
  id: string;
  escrowAccountId: string;
  entryType: "deposit" | "release" | "refund" | "adjustment" | string;
  amount: string;
  balanceAfter: string;
  relatedPaymentId?: string | null;
  relatedMilestoneId?: string | null;
  relatedPayoutId?: string | null;
  notes?: string | null;
  createdAt: string;
};

// GET /projects/:id/escrow returns this shape even for a project that's
// never been funded (no EscrowAccount row exists yet) — id/createdAt/
// updatedAt are absent in that case, which is why they're optional here
// rather than just using Prisma's real EscrowAccount shape.
export type EscrowAccount = {
  id?: string;
  projectId: string;
  balance: string | number;
  currency: string | null;
  status: "active" | "closed" | "not_funded" | string;
  createdAt?: string;
  updatedAt?: string;
  ledgerEntries: EscrowLedgerEntry[];
};

export type Receipt = {
  id: string;
  accountId: string;
  receiptNumber: string;
  paymentId?: string | null;
  payoutId?: string | null;
  amount: string;
  currency: string;
  issuedAt: string;
};

export type Dispute = {
  id: string;
  projectId: string;
  raisedByAccountId: string;
  milestoneId?: string | null;
  paymentId?: string | null;
  payoutId?: string | null;
  reason: string;
  status: "open" | "under_review" | "resolved" | "rejected" | string;
  resolutionNotes?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  // Only present on GET /vendors/me/disputes and GET /payments/disputes/
  // open — the owner-side /projects/:projectId/disputes routes already
  // know the project.
  project?: { id: string; title: string; accountId?: string };
  // Only present on GET /payments/disputes/open — the neutral reviewer's
  // queue includes it directly so arbitrating isn't done blind; the
  // owner/vendor-side dispute lists fetch it separately via
  // findDisputeEvidence/findDisputeEvidenceAsVendor (see DisputeEvidence
  // below) once a specific dispute is opened.
  evidence?: DisputeEvidence[];
};

// The structured "submit more evidence" channel for a dispute under
// arbitration — see PaymentsService.submitDisputeEvidence.
export type DisputeEvidence = {
  id: string;
  disputeId: string;
  accountId: string;
  submittedByUserId: string;
  note: string;
  fileUrl?: string | null;
  createdAt: string;
};

// GET /payments/overview — the account-wide rollup that finally backs the
// sidebar's "Payments" screen (previously every route lived only inside a
// single project's page). Money is grouped by currency rather than summed
// across currencies, same caution the portfolio-report AI skill takes.
export type PaymentsOverview = {
  projectCount: number;
  escrowByCurrency: { currency: string; balance: number }[];
  depositedByCurrency: { currency: string; total: number }[];
  releasedByCurrency: { currency: string; total: number }[];
  openDisputeCount: number;
  projects: {
    projectId: string;
    title: string;
    propertyName: string | null;
    status: string;
    currency: string;
    escrowBalance: number;
    escrowCurrency: string;
    escrowStatus: string;
    openDisputeCount: number;
  }[];
};

export type PortfolioOverview = {
  currency: string;
  // The account's own standing subscription (Account.reportDigestFrequency)
  // — surfaced here rather than a separate fetch since this page already
  // loads the account's report context. Set via setDigestSubscription.
  digestFrequency: "off" | "weekly" | "monthly" | string;
  properties: { total: number; byStatus: { status: string; count: number }[]; totalEstimatedValue: number };
  projects: { total: number; byStatus: { status: string; count: number }[] };
  maintenance: { total: number; open: number; resolved: number };
  inspections: { total: number; scheduled: number; pass: number; needsAttention: number; fail: number };
  vendorSpendByCurrency: { currency: string; total: number }[];
  topVendors: { vendorId: string; businessName: string; currency: string; total: number }[];
};

export type ReportDefinition = {
  id: string;
  accountId: string;
  name: string;
  metrics: string[];
  createdAt: string;
  updatedAt: string;
};

export type Listing = {
  id: string;
  propertyId: string;
  accountId: string;
  listingType: "sale" | "rent" | "short_let" | string;
  askingPrice: string;
  currency: string;
  title: string;
  description?: string | null;
  photoUrls: string[];
  status: "draft" | "active" | "under_offer" | "sold" | "rented" | "withdrawn" | string;
  verificationStatus: "not_verified" | "submitted" | "verified" | "rejected" | string;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  property?: Property | { propertyType: string; city?: string | null; country: string };
  // Only present on GET /listings/:listingId — whether the calling
  // account has favorited this listing.
  isFavorited?: boolean;
};

export type ListingInquiry = {
  id: string;
  listingId: string;
  accountId: string;
  message: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  status: "new" | "responded" | "closed" | string;
  createdAt: string;
};

export type ListingOffer = {
  id: string;
  listingId: string;
  accountId: string;
  amount: string;
  currency: string;
  message?: string | null;
  status: "submitted" | "countered" | "accepted" | "rejected" | "withdrawn" | string;
  createdAt: string;
  updatedAt: string;
  listing?: { id: string; title: string; status: string };
};

export type ListingFavorite = {
  listingId: string;
  accountId: string;
  createdAt: string;
  listing?: { id: string; title: string; askingPrice: string; currency: string; status: string };
};

export type SupplierTrustScore = {
  score: number;
  band: "excellent" | "good" | "fair" | "caution" | string;
  factors: {
    verificationStatus: string;
    ratingAverage: number | null;
    reviewCount: number;
    deliveredOrders: number;
    cancelledOrders: number;
    latestAudit: TrustAuditFactor;
    identityVerifiedOperator: boolean;
  };
};

export type SupplierTrustAudit = {
  id: string;
  supplierId: string;
  reviewedByUserId: string;
  rating: "clean" | "minor_concerns" | "major_concerns" | string;
  notes: string;
  createdAt: string;
};

export type Supplier = {
  id: string;
  accountId: string;
  businessName: string;
  category: "materials" | "tools" | "equipment" | string;
  locationCoverage?: string | null;
  verificationStatus: "not_verified" | "pending" | "verified" | string;
  verificationNotes?: string | null;
  ratingAverage?: string | null;
  createdAt: string;
  updatedAt: string;
  products?: Product[];
  reviews?: SupplierReview[];
  trustScore?: SupplierTrustScore;
};

export type SupplierReview = {
  id: string;
  supplierId: string;
  orderId: string;
  accountId: string;
  rating: number;
  comment?: string | null;
  response?: string | null;
  respondedAt?: string | null;
  moderationStatus: "published" | "flagged" | "hidden" | string;
  flagReason?: string | null;
  flaggedAt?: string | null;
  moderationNotes?: string | null;
  moderatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  // Only present on GET /suppliers/reviews/flagged
  supplier?: { id: string; businessName: string };
};

export type Product = {
  id: string;
  supplierId: string;
  name: string;
  category: string;
  unit: string;
  unitPrice: string;
  currency: string;
  stockQuantity: number;
  description?: string | null;
  status: "active" | "out_of_stock" | "discontinued" | string;
  isRentable: boolean;
  rentalPricePerDay?: string | null;
  createdAt: string;
  updatedAt: string;
  supplier?: Supplier | { id: string; businessName: string; ratingAverage?: string | null };
};

export type RentalBooking = {
  id: string;
  productId: string;
  accountId: string;
  quantity: number;
  startDate: string;
  endDate: string;
  status: "requested" | "confirmed" | "returned" | "cancelled" | string;
  totalPrice: string;
  currency: string;
  notes?: string | null;
  returnedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  product?: { id: string; name: string; supplierId?: string };
};

export type CartItem = {
  id: string;
  accountId: string;
  productId: string;
  quantity: number;
  createdAt: string;
  updatedAt: string;
  product?: Product & { supplier?: { id: string; businessName: string } };
};

export type OrderItem = {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  product?: Product;
};

export type Delivery = {
  id: string;
  orderId: string;
  status: "pending" | "in_transit" | "delivered" | "failed" | string;
  trackingReference?: string | null;
  estimatedDeliveryDate?: string | null;
  deliveredAt?: string | null;
};

export type MaterialOrder = {
  id: string;
  accountId: string;
  supplierId: string;
  projectId?: string | null;
  status: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled" | string;
  totalAmount: string;
  currency: string;
  deliveryAddress?: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  delivery?: Delivery | null;
  supplier?: Supplier;
  review?: SupplierReview | null;
};

// ---- Client -------------------------------------------------------------

// A thin class rather than loose functions so lib/auth.tsx can hand every
// screen one `api` instance that already knows the current token + account.
export class ApiClient {
  constructor(
    private token: string | null,
    private accountId: string | null,
  ) {}

  // --- Auth (no account context needed) ---
  // register/login set the session as httpOnly cookies server-side (see
  // AuthController) and hand back nothing sensitive — call me() right
  // after to find out who's actually signed in. logout() clears them the
  // same way; there's no client-side refresh() wrapper since the only
  // caller is request()'s own silent-refresh retry, which calls the
  // endpoint directly (see performRefresh above).
  register(input: { name: string; email: string; phone?: string; password: string; inviteToken?: string }) {
    return request<Record<string, never>>("/auth/register", { method: "POST", body: input });
  }
  login(email: string, password: string) {
    return request<Record<string, never>>("/auth/login", { method: "POST", body: { email, password } });
  }
  logout() {
    return request<{ message: string }>("/auth/logout", { method: "POST" });
  }
  // token: "pending" here (rather than this.token, which the caller — see
  // AuthProvider's hydrate effect — genuinely doesn't have yet) is what
  // tells request() a 401 is worth a silent-refresh retry instead of just
  // meaning "not signed in": the access-token cookie can be stale while
  // the longer-lived refresh_token cookie is still good.
  me() {
    return request<CurrentUser>("/auth/me", { token: "pending" });
  }
  getIdentityStatus() {
    return request<IdentityStatus>("/identity/me", { token: this.token, accountId: this.accountId });
  }
  // Creates (or reuses) a Sumsub applicant and mints a fresh short-lived
  // WebSDK access token — the frontend hands this straight to Sumsub's
  // own widget, which talks to Sumsub directly. No document/selfie image
  // ever passes through this backend.
  startIdentityVerification() {
    return request<{ applicantId: string; accessToken: string }>("/identity/start", {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  // Pull-based — Sumsub's own review happens asynchronously on their
  // side, so this re-reads their current answer rather than waiting on
  // a webhook (this scaffold has nowhere to receive one in local dev).
  refreshIdentityStatus() {
    return request<IdentityStatus>("/identity/refresh", {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  forgotPassword(email: string) {
    return request<{ message: string; resetToken?: string }>("/auth/forgot-password", { method: "POST", body: { email } });
  }
  resetPassword(token: string, newPassword: string) {
    return request<{ message: string }>("/auth/reset-password", { method: "POST", body: { token, newPassword } });
  }
  listMyAccounts() {
    return request<AccountSummary[]>("/auth/accounts", { token: this.token });
  }

  // --- Accounts ---
  createAccount(input: { accountType: string; name: string; country: string; currency: string; timezone: string }) {
    return request<{ id: string }>("/accounts", { method: "POST", body: input, token: this.token });
  }
  listAccountMembers(accountId: string) {
    return request<{ members: AccountMemberSummary[]; invites: AccountInviteSummary[] }>(
      `/accounts/${accountId}/members`,
      { token: this.token, accountId: this.accountId },
    );
  }
  // Existing email -> added immediately ({type:"member"}); new email ->
  // a pending invite is created ({type:"invite", inviteToken}) — see
  // AccountsService.addMember. inviteToken is only present when
  // EmailService couldn't actually deliver the invite (no RESEND_API_KEY
  // configured, same fallback shape as forgotPassword's resetToken) —
  // once a real send succeeds, the raw token is dropped from the response.
  addAccountMember(accountId: string, input: { email: string; roleKey: string }) {
    return request<
      | { type: "member"; member: AccountMemberSummary }
      | { type: "invite"; invite: AccountInviteSummary; inviteToken?: string }
    >(`/accounts/${accountId}/members`, { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  // Kills a pending invite without replacing it — see
  // AccountsService.revokeInvite.
  revokeInvite(accountId: string, inviteId: string) {
    return request<AccountInviteSummary>(`/accounts/${accountId}/invites/${inviteId}/revoke`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  // Rotates a pending invite's token/expiry — see AccountsService.resendInvite.
  // Same inviteToken-only-on-fallback shape as addAccountMember above.
  resendInvite(accountId: string, inviteId: string) {
    return request<{ invite: AccountInviteSummary; inviteToken?: string }>(
      `/accounts/${accountId}/invites/${inviteId}/resend`,
      { method: "POST", token: this.token, accountId: this.accountId },
    );
  }

  // --- Invites (no account context — the recipient isn't a member yet) ---
  getInvite(token: string) {
    return request<InvitePreview>(`/invites/${token}`);
  }
  acceptInvite(token: string) {
    return request<AccountMemberSummary>(`/invites/${token}/accept`, { method: "POST", token: this.token });
  }
  // Every invite sent to the signed-in user's own email, across every
  // account — see AccountsService.findMyInvites.
  listMyInvites() {
    return request<AccountInviteMine[]>("/invites/mine", { token: this.token });
  }
  acceptMyInvite(inviteId: string) {
    return request<AccountMemberSummary>(`/invites/mine/${inviteId}/accept`, { method: "POST", token: this.token });
  }

  // --- Properties (account-scoped) ---
  listProperties() {
    return request<Property[]>("/properties", { token: this.token, accountId: this.accountId });
  }
  // Semantic search (pgvector + OpenAI embeddings) — a free-text query
  // like "flat under renovation in Lekki", not a field filter.
  searchProperties(q: string) {
    const params = new URLSearchParams({ q });
    return request<Property[]>(`/properties/search?${params.toString()}`, { token: this.token, accountId: this.accountId });
  }
  reindexPropertyEmbeddings() {
    return request<{ total: number; indexed: number; failed: number; failures: { propertyId: string; error: string }[] }>(
      "/properties/reindex-embeddings",
      { method: "POST", token: this.token, accountId: this.accountId },
    );
  }
  getProperty(propertyId: string) {
    return request<Property>(`/properties/${propertyId}`, { token: this.token, accountId: this.accountId });
  }
  createProperty(input: {
    propertyType: string;
    name: string;
    addressLine: string;
    city?: string;
    state?: string;
    country: string;
    currentUse?: string;
    estimatedValue?: number;
  }) {
    return request<Property>("/properties", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  addValuation(propertyId: string, input: { estimatedValue: number; currency?: string; source?: string; notes?: string }) {
    return request<PropertyValuation>(`/properties/${propertyId}/valuations`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listValuations(propertyId: string) {
    return request<PropertyValuation[]>(`/properties/${propertyId}/valuations`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  createVisualization(propertyId: string, input: { beforeImageUrl: string; prompt: string; projectId?: string }) {
    return request<RenovationVisualization>(`/visualizations/property/${propertyId}`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listVisualizations(propertyId: string) {
    return request<RenovationVisualization[]>(`/visualizations/property/${propertyId}`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  getRoiSummary(propertyId: string) {
    return request<RoiSummary>(`/properties/${propertyId}/roi-summary`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  scheduleInspection(
    propertyId: string,
    input: { inspectionType: string; scheduledFor: string; projectId?: string; inspectorName?: string; inspectorVendorId?: string },
  ) {
    return request<PropertyInspection>(`/properties/${propertyId}/inspections`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listInspections(propertyId: string) {
    return request<PropertyInspection[]>(`/properties/${propertyId}/inspections`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  updateInspection(
    propertyId: string,
    inspectionId: string,
    input: { inspectionType?: string; scheduledFor?: string; projectId?: string; inspectorName?: string; inspectorVendorId?: string },
  ) {
    return request<PropertyInspection>(`/properties/${propertyId}/inspections/${inspectionId}`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  completeInspection(
    propertyId: string,
    inspectionId: string,
    input: { overallResult: string; summary?: string; findings?: { area: string; description: string; severity?: string }[] },
  ) {
    return request<PropertyInspection>(`/properties/${propertyId}/inspections/${inspectionId}/complete`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  cancelInspection(propertyId: string, inspectionId: string) {
    return request<PropertyInspection>(`/properties/${propertyId}/inspections/${inspectionId}/cancel`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  createLease(
    propertyId: string,
    input: {
      tenantName: string;
      tenantEmail?: string;
      tenantPhone?: string;
      rentAmount: number;
      currency?: string;
      rentFrequency: string;
      depositAmount?: number;
      startDate: string;
      endDate?: string;
      notes?: string;
    },
  ) {
    return request<Lease>(`/properties/${propertyId}/leases`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listLeases(propertyId: string) {
    return request<Lease[]>(`/properties/${propertyId}/leases`, { token: this.token, accountId: this.accountId });
  }
  updateLease(
    propertyId: string,
    leaseId: string,
    input: {
      tenantName?: string;
      tenantEmail?: string;
      tenantPhone?: string;
      rentAmount?: number;
      rentFrequency?: string;
      depositAmount?: number;
      startDate?: string;
      endDate?: string;
      notes?: string;
    },
  ) {
    return request<Lease>(`/properties/${propertyId}/leases/${leaseId}`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  recordRentPayment(
    propertyId: string,
    leaseId: string,
    input: { amount: number; currency?: string; periodStart: string; periodEnd: string; method?: string; notes?: string },
  ) {
    return request<LeaseRentPayment>(`/properties/${propertyId}/leases/${leaseId}/rent-payments`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  endLease(propertyId: string, leaseId: string, input: { status: "ended" | "terminated"; notes?: string }) {
    return request<Lease>(`/properties/${propertyId}/leases/${leaseId}/end`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  linkTenantAccount(propertyId: string, leaseId: string) {
    return request<Lease>(`/properties/${propertyId}/leases/${leaseId}/link-tenant`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  reportMaintenanceRequest(
    propertyId: string,
    input: {
      title: string;
      description: string;
      priority?: string;
      leaseId?: string;
      reportedBy?: string;
      assignedTo?: string;
      assignedVendorId?: string;
    },
  ) {
    return request<MaintenanceRequest>(`/properties/${propertyId}/maintenance-requests`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listMaintenanceRequests(propertyId: string) {
    return request<MaintenanceRequest[]>(`/properties/${propertyId}/maintenance-requests`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  // Tenant-facing — see apps/api/src/tenant. Scoped to whichever lease
  // the acting TENANT-type account is linked to, never a client-supplied
  // property/lease id.
  myTenantLease() {
    return request<Lease | null>("/tenant/lease", { token: this.token, accountId: this.accountId });
  }
  myTenantMaintenanceRequests() {
    return request<MaintenanceRequest[]>("/tenant/maintenance-requests", { token: this.token, accountId: this.accountId });
  }
  reportTenantMaintenanceRequest(input: { title: string; description: string; priority?: string }) {
    return request<MaintenanceRequest>("/tenant/maintenance-requests", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  myTenantDocuments() {
    return request<AppDocument[]>("/tenant/documents", { token: this.token, accountId: this.accountId });
  }
  updateMaintenanceRequest(propertyId: string, requestId: string, input: { title?: string; description?: string; priority?: string }) {
    return request<MaintenanceRequest>(`/properties/${propertyId}/maintenance-requests/${requestId}`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  startMaintenanceRequest(propertyId: string, requestId: string, input: { assignedTo?: string; assignedVendorId?: string }) {
    return request<MaintenanceRequest>(`/properties/${propertyId}/maintenance-requests/${requestId}/start`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  resolveMaintenanceRequest(propertyId: string, requestId: string, input: { resolutionNotes?: string }) {
    return request<MaintenanceRequest>(`/properties/${propertyId}/maintenance-requests/${requestId}/resolve`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  cancelMaintenanceRequest(propertyId: string, requestId: string) {
    return request<MaintenanceRequest>(`/properties/${propertyId}/maintenance-requests/${requestId}/cancel`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- AI Copilot Layer (account-scoped) ---
  listAiSkills() {
    return request<AiSkill[]>("/ai/skills", { token: this.token, accountId: this.accountId });
  }
  runAiAction(moduleContext: string, actionType: string, input?: Record<string, unknown>) {
    return request<AiActionResult>("/ai/actions", {
      method: "POST",
      body: { moduleContext, actionType, input },
      token: this.token,
      accountId: this.accountId,
    });
  }
  decideAiOutput(outputId: string, decision: "accepted" | "edited" | "discarded", notes?: string) {
    return request<AiActionApproval>(`/ai/outputs/${outputId}/decision`, {
      method: "POST",
      body: { decision, notes },
      token: this.token,
      accountId: this.accountId,
    });
  }
  sendChatMessage(input: { conversationId?: string; moduleContext?: string; message: string }) {
    return request<{ conversationId: string; messages: AiMessage[] }>("/ai/chat", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listConversations() {
    return request<AiConversation[]>("/ai/conversations", { token: this.token, accountId: this.accountId });
  }
  getConversation(conversationId: string) {
    return request<AiConversation>(`/ai/conversations/${conversationId}`, {
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- Projects (account-scoped) ---
  listProjects() {
    return request<Project[]>("/projects", { token: this.token, accountId: this.accountId });
  }
  getProject(projectId: string) {
    return request<Project>(`/projects/${projectId}`, { token: this.token, accountId: this.accountId });
  }
  createProject(input: {
    propertyId: string;
    projectType: string;
    title: string;
    scopeDescription?: string;
    budget?: number;
    currency?: string;
    startDate?: string;
    expectedEndDate?: string;
  }) {
    return request<Project>("/projects", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  addMilestone(projectId: string, input: { title: string; description?: string; paymentAmount?: number; dueDate?: string }) {
    return request<ProjectMilestone>(`/projects/${projectId}/milestones`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  addProjectUpdate(projectId: string, input: { description: string; milestoneId?: string; mediaUrls?: string[] }) {
    return request<ProjectUpdate>(`/projects/${projectId}/updates`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  requestQuote(projectId: string, vendorId: string) {
    return request<VendorQuote>(`/projects/${projectId}/quotes/request`, {
      method: "POST",
      body: { vendorId },
      token: this.token,
      accountId: this.accountId,
    });
  }
  acceptQuote(projectId: string, quoteId: string) {
    return request<Project>(`/projects/${projectId}/quotes/${quoteId}/accept`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- Vendors (marketplace browse is cross-account by design; "me" routes
  // are scoped to whichever account is currently active, which only makes
  // sense for a VENDOR-type account) ---
  listVendors(serviceCategory?: string, q?: string) {
    const params = new URLSearchParams();
    if (serviceCategory) params.set("serviceCategory", serviceCategory);
    if (q) params.set("q", q);
    const qs = params.toString();
    return request<Vendor[]>(`/vendors${qs ? `?${qs}` : ""}`, { token: this.token, accountId: this.accountId });
  }
  getVendor(vendorId: string) {
    return request<Vendor>(`/vendors/${vendorId}`, { token: this.token, accountId: this.accountId });
  }
  setVendorVerification(vendorId: string, status: string, notes?: string) {
    return request<Vendor>(`/vendors/${vendorId}/verification`, {
      method: "PATCH",
      body: { status, notes },
      token: this.token,
      accountId: this.accountId,
    });
  }
  submitVendorTrustAudit(vendorId: string, input: { rating: string; notes: string }) {
    return request<VendorTrustAudit>(`/vendors/${vendorId}/trust-audits`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listVendorTrustAudits(vendorId: string) {
    return request<VendorTrustAudit[]>(`/vendors/${vendorId}/trust-audits`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  createVendor(input: { businessName: string; serviceCategory: string; locationCoverage?: string }) {
    return request<Vendor>("/vendors", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  myVendorProfile() {
    return request<Vendor | null>("/vendors/me", { token: this.token, accountId: this.accountId });
  }
  myQuotes() {
    return request<VendorQuote[]>("/vendors/me/quotes", { token: this.token, accountId: this.accountId });
  }
  myPayouts() {
    return request<Payout[]>("/vendors/me/payouts", { token: this.token, accountId: this.accountId });
  }
  listBanks(provider?: string) {
    const qs = provider ? `?provider=${encodeURIComponent(provider)}` : "";
    return request<PaystackBank[]>(`/vendors/banks${qs}`, { token: this.token, accountId: this.accountId });
  }
  setVendorBankDetails(input: { bankAccountNumber: string; bankCode: string; provider?: string }) {
    return request<Vendor>("/vendors/me/bank-details", {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  setPaypalPayoutEmail(input: { email: string }) {
    return request<Vendor>("/vendors/me/paypal-payout-email", {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  setVendorLicense(input: { licenseNumber: string; licenseIssuingBody: string; licenseExpiresAt: string }) {
    return request<Vendor>("/vendors/me/license", {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  submitVendorQuote(input: { projectId: string; amount: number; currency?: string; notes?: string }) {
    return request<VendorQuote>("/vendors/me/quotes", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  myDisputes() {
    return request<Dispute[]>("/vendors/me/disputes", { token: this.token, accountId: this.accountId });
  }
  raiseDisputeAsVendor(input: { projectId: string; reason: string; milestoneId?: string; paymentId?: string; payoutId?: string }) {
    return request<Dispute>("/vendors/me/disputes", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  resolveDisputeAsVendor(disputeId: string, input: { status: "resolved" | "rejected"; resolutionNotes?: string }) {
    return request<Dispute>(`/vendors/me/disputes/${disputeId}/resolve`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  submitDisputeEvidenceAsVendor(disputeId: string, input: { note: string; fileUrl?: string }) {
    return request<DisputeEvidence>(`/vendors/me/disputes/${disputeId}/evidence`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findDisputeEvidenceAsVendor(disputeId: string) {
    return request<DisputeEvidence[]>(`/vendors/me/disputes/${disputeId}/evidence`, {
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- Payments & escrow (per-project routes below; the account-wide
  // rollup is getPaymentsOverview() further down) ---
  // Two shapes back, depending on provider: "manual" (the default)
  // credits escrow instantly and returns a receipt, same as before.
  // "paystack" returns an authorizationUrl instead — nothing is credited
  // until the buyer completes checkout there and the caller calls
  // verifyDeposit with the returned payment's id.
  deposit(projectId: string, input: { amount: number; currency?: string; provider?: string; providerReference?: string }) {
    return request<{ payment: Payment; receipt: Receipt } | { payment: Payment; authorizationUrl: string }>(
      `/projects/${projectId}/payments`,
      { method: "POST", body: input, token: this.token, accountId: this.accountId },
    );
  }
  verifyDeposit(projectId: string, paymentId: string) {
    return request<{ payment: Payment; receipt: Receipt | null; alreadyVerified: boolean }>(
      `/projects/${projectId}/payments/${paymentId}/verify`,
      { method: "POST", token: this.token, accountId: this.accountId },
    );
  }
  findPayments(projectId: string) {
    return request<Payment[]>(`/projects/${projectId}/payments`, { token: this.token, accountId: this.accountId });
  }
  getEscrow(projectId: string) {
    return request<EscrowAccount>(`/projects/${projectId}/escrow`, { token: this.token, accountId: this.accountId });
  }
  approveMilestone(projectId: string, milestoneId: string) {
    return request<ProjectMilestone>(`/projects/${projectId}/milestones/${milestoneId}/approve`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  releaseMilestone(projectId: string, milestoneId: string) {
    // receipt is null while a real Paystack transfer is still
    // "processing" — see verifyPayout below.
    return request<{ payout: Payout; receipt: Receipt | null }>(`/projects/${projectId}/milestones/${milestoneId}/release`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  verifyPayout(projectId: string, payoutId: string) {
    return request<{ payout: Payout; receipt: Receipt | null; alreadyVerified: boolean }>(
      `/projects/${projectId}/payouts/${payoutId}/verify`,
      { method: "POST", token: this.token, accountId: this.accountId },
    );
  }
  finalizePayoutOtp(projectId: string, payoutId: string, otp: string) {
    return request<{ payout: Payout; receipt: Receipt | null; alreadyVerified: boolean }>(
      `/projects/${projectId}/payouts/${payoutId}/finalize`,
      { method: "POST", body: { otp }, token: this.token, accountId: this.accountId },
    );
  }
  findProjectPayouts(projectId: string) {
    return request<Payout[]>(`/projects/${projectId}/payouts`, { token: this.token, accountId: this.accountId });
  }
  findReceipts(projectId: string) {
    return request<Receipt[]>(`/projects/${projectId}/receipts`, { token: this.token, accountId: this.accountId });
  }
  raiseDispute(projectId: string, input: { reason: string; milestoneId?: string; paymentId?: string; payoutId?: string }) {
    return request<Dispute>(`/projects/${projectId}/disputes`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findDisputes(projectId: string) {
    return request<Dispute[]>(`/projects/${projectId}/disputes`, { token: this.token, accountId: this.accountId });
  }
  resolveDispute(projectId: string, disputeId: string, input: { status: "resolved" | "rejected"; resolutionNotes?: string }) {
    return request<Dispute>(`/projects/${projectId}/disputes/${disputeId}/resolve`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  submitDisputeEvidence(projectId: string, disputeId: string, input: { note: string; fileUrl?: string }) {
    return request<DisputeEvidence>(`/projects/${projectId}/disputes/${disputeId}/evidence`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findDisputeEvidence(projectId: string, disputeId: string) {
    return request<DisputeEvidence[]>(`/projects/${projectId}/disputes/${disputeId}/evidence`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  getPaymentsOverview() {
    return request<PaymentsOverview>("/payments/overview", { token: this.token, accountId: this.accountId });
  }
  getPortfolioOverview() {
    return request<PortfolioOverview>("/reports/portfolio-overview", { token: this.token, accountId: this.accountId });
  }
  // Not routed through request<T>() — that helper only ever parses JSON
  // responses (see its own isJson check), and this one is a real CSV
  // file. Mirrors request()'s own credentials/header shape by hand.
  async exportPortfolioOverviewCsv(): Promise<string> {
    const headers: Record<string, string> = {};
    if (this.accountId) headers["X-Account-Id"] = this.accountId;
    const res = await fetch(`${API_URL}/reports/portfolio-overview/export`, { headers, credentials: "include" });
    if (!res.ok) {
      const data = await res.json().catch(() => undefined);
      throw new ApiError(res.status, data?.message ?? `Request failed (${res.status})`);
    }
    return res.text();
  }
  setDigestSubscription(frequency: "off" | "weekly" | "monthly") {
    return request<{ id: string; reportDigestFrequency: string }>("/reports/digest-subscription", {
      method: "PATCH",
      body: { frequency },
      token: this.token,
      accountId: this.accountId,
    });
  }
  sendDigestNow() {
    return request<{ sent: boolean; recipients: number }>("/reports/digest-subscription/send-now", {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  // --- Report builder ---
  listReportMetrics() {
    return request<{ key: string; label: string }[]>("/reports/metrics", { token: this.token, accountId: this.accountId });
  }
  listReportDefinitions() {
    return request<ReportDefinition[]>("/reports/definitions", { token: this.token, accountId: this.accountId });
  }
  createReportDefinition(input: { name: string; metrics: string[] }) {
    return request<ReportDefinition>("/reports/definitions", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  deleteReportDefinition(id: string) {
    return request<{ deleted: boolean }>(`/reports/definitions/${id}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  runReportDefinition(id: string) {
    return request<{ name: string; generatedAt: string; rows: { label: string; value: string | number }[] }>(
      `/reports/definitions/${id}/run`,
      { token: this.token, accountId: this.accountId },
    );
  }
  async exportReportDefinitionCsv(id: string): Promise<string> {
    const headers: Record<string, string> = {};
    if (this.accountId) headers["X-Account-Id"] = this.accountId;
    const res = await fetch(`${API_URL}/reports/definitions/${id}/export`, { headers, credentials: "include" });
    if (!res.ok) {
      const data = await res.json().catch(() => undefined);
      throw new ApiError(res.status, data?.message ?? `Request failed (${res.status})`);
    }
    return res.text();
  }
  findOpenDisputesForArbitration() {
    return request<Dispute[]>("/payments/disputes/open", { token: this.token, accountId: this.accountId });
  }
  arbitrateDispute(disputeId: string, input: { status: "resolved" | "rejected" | "under_review"; resolutionNotes?: string }) {
    return request<Dispute>(`/payments/disputes/${disputeId}/arbitrate`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  completeProject(projectId: string) {
    return request<Project>(`/projects/${projectId}/complete`, { method: "POST", token: this.token, accountId: this.accountId });
  }
  reviewVendor(projectId: string, input: { vendorId: string; rating: number; comment?: string }) {
    return request<VendorReview>(`/projects/${projectId}/reviews`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  updateVendorReview(projectId: string, reviewId: string, input: { rating?: number; comment?: string }) {
    return request<VendorReview>(`/projects/${projectId}/reviews/${reviewId}`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  deleteVendorReview(projectId: string, reviewId: string) {
    return request<{ deleted: boolean }>(`/projects/${projectId}/reviews/${reviewId}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  replyToVendorReview(reviewId: string, input: { response: string }) {
    return request<VendorReview>(`/vendors/me/reviews/${reviewId}/reply`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  // The report side of review moderation — see VendorsService.flagReview.
  flagVendorReview(reviewId: string, input: { reason: string }) {
    return request<VendorReview>(`/vendors/me/reviews/${reviewId}/flag`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  // Module 6's neutral-reviewer queue for flagged vendor reviews.
  listFlaggedVendorReviews() {
    return request<VendorReview[]>("/vendors/reviews/flagged", { token: this.token, accountId: this.accountId });
  }
  moderateVendorReview(reviewId: string, input: { status: "hidden" | "published"; moderationNotes?: string }) {
    return request<VendorReview>(`/vendors/reviews/${reviewId}/moderate`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- Property marketplace (listings) ---
  createListing(input: { propertyId: string; listingType: string; askingPrice: number; currency?: string; title: string; description?: string; photoUrls?: string[] }) {
    return request<Listing>("/listings", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  searchListings(query: { listingType?: string; city?: string; propertyType?: string; minPrice?: string; maxPrice?: string; q?: string }) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    const qs = params.toString();
    return request<Listing[]>(`/listings${qs ? `?${qs}` : ""}`, { token: this.token, accountId: this.accountId });
  }
  myListings() {
    return request<Listing[]>("/listings/me", { token: this.token, accountId: this.accountId });
  }
  myOffers() {
    return request<ListingOffer[]>("/listings/me/offers", { token: this.token, accountId: this.accountId });
  }
  myFavorites() {
    return request<ListingFavorite[]>("/listings/me/favorites", { token: this.token, accountId: this.accountId });
  }
  getListing(listingId: string) {
    return request<Listing>(`/listings/${listingId}`, { token: this.token, accountId: this.accountId });
  }
  publishListing(listingId: string) {
    return request<Listing>(`/listings/${listingId}/publish`, { method: "POST", token: this.token, accountId: this.accountId });
  }
  createInquiry(listingId: string, input: { message: string; contactEmail?: string; contactPhone?: string }) {
    return request<ListingInquiry>(`/listings/${listingId}/inquiries`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findInquiries(listingId: string) {
    return request<ListingInquiry[]>(`/listings/${listingId}/inquiries`, { token: this.token, accountId: this.accountId });
  }
  createOffer(listingId: string, input: { amount: number; currency?: string; message?: string }) {
    return request<ListingOffer>(`/listings/${listingId}/offers`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findOffers(listingId: string) {
    return request<ListingOffer[]>(`/listings/${listingId}/offers`, { token: this.token, accountId: this.accountId });
  }
  respondToOffer(listingId: string, offerId: string, input: { status: "countered" | "accepted" | "rejected"; counterAmount?: number }) {
    return request<ListingOffer>(`/listings/${listingId}/offers/${offerId}/respond`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  favoriteListing(listingId: string) {
    return request<ListingFavorite>(`/listings/${listingId}/favorites`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  unfavoriteListing(listingId: string) {
    return request<{ removed?: boolean }>(`/listings/${listingId}/favorites`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- Materials marketplace (suppliers, products, orders) ---
  createSupplierProfile(input: { businessName: string; category: string; locationCoverage?: string }) {
    return request<Supplier>("/suppliers", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  listSuppliers(category?: string) {
    const qs = category ? `?category=${encodeURIComponent(category)}` : "";
    return request<Supplier[]>(`/suppliers${qs}`, { token: this.token, accountId: this.accountId });
  }
  mySupplierProfile() {
    return request<Supplier | null>("/suppliers/me", { token: this.token, accountId: this.accountId });
  }
  findOrdersForSupplier() {
    return request<MaterialOrder[]>("/suppliers/me/orders", { token: this.token, accountId: this.accountId });
  }
  createProduct(input: {
    name: string;
    category: string;
    unit: string;
    unitPrice: number;
    currency?: string;
    stockQuantity?: number;
    description?: string;
    isRentable?: boolean;
    rentalPricePerDay?: number;
  }) {
    return request<Product>("/suppliers/me/products", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  updateProduct(
    productId: string,
    input: {
      unitPrice?: number;
      stockQuantity?: number;
      status?: string;
      description?: string;
      isRentable?: boolean;
      rentalPricePerDay?: number;
    },
  ) {
    return request<Product>(`/suppliers/me/products/${productId}`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  getSupplier(supplierId: string) {
    return request<Supplier>(`/suppliers/${supplierId}`, { token: this.token, accountId: this.accountId });
  }
  setSupplierVerification(supplierId: string, status: string, notes?: string) {
    return request<Supplier>(`/suppliers/${supplierId}/verification`, {
      method: "PATCH",
      body: { status, notes },
      token: this.token,
      accountId: this.accountId,
    });
  }
  submitSupplierTrustAudit(supplierId: string, input: { rating: string; notes: string }) {
    return request<SupplierTrustAudit>(`/suppliers/${supplierId}/trust-audits`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listSupplierTrustAudits(supplierId: string) {
    return request<SupplierTrustAudit[]>(`/suppliers/${supplierId}/trust-audits`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  findProducts(category?: string, supplierId?: string, q?: string) {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (supplierId) params.set("supplierId", supplierId);
    if (q) params.set("q", q);
    const qs = params.toString();
    return request<Product[]>(`/products${qs ? `?${qs}` : ""}`, { token: this.token, accountId: this.accountId });
  }
  getProduct(productId: string) {
    return request<Product>(`/products/${productId}`, { token: this.token, accountId: this.accountId });
  }
  createOrder(input: { supplierId: string; projectId?: string; items: { productId: string; quantity: number }[]; deliveryAddress?: string }) {
    return request<MaterialOrder>("/orders", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  getCart() {
    return request<CartItem[]>("/cart", { token: this.token, accountId: this.accountId });
  }
  upsertCartItem(productId: string, quantity: number) {
    return request<CartItem | { removed: true }>("/cart/items", {
      method: "POST",
      body: { productId, quantity },
      token: this.token,
      accountId: this.accountId,
    });
  }
  removeCartItem(productId: string) {
    return request<{ removed: true }>(`/cart/items/${productId}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  checkoutCart(input: { supplierId: string; projectId?: string; deliveryAddress?: string }) {
    return request<MaterialOrder>("/cart/checkout", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  createRentalBooking(productId: string, input: { startDate: string; endDate: string; quantity?: number; notes?: string }) {
    return request<RentalBooking>(`/products/${productId}/rental-bookings`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  myRentalBookings() {
    return request<RentalBooking[]>("/rental-bookings/me", { token: this.token, accountId: this.accountId });
  }
  supplierRentalBookings() {
    return request<RentalBooking[]>("/suppliers/me/rental-bookings", { token: this.token, accountId: this.accountId });
  }
  confirmRentalBooking(bookingId: string) {
    return request<RentalBooking>(`/rental-bookings/${bookingId}/confirm`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  returnRentalBooking(bookingId: string) {
    return request<RentalBooking>(`/rental-bookings/${bookingId}/return`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  cancelRentalBooking(bookingId: string) {
    return request<RentalBooking>(`/rental-bookings/${bookingId}/cancel`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  findOrdersForBuyer() {
    return request<MaterialOrder[]>("/orders", { token: this.token, accountId: this.accountId });
  }
  getOrder(orderId: string) {
    return request<MaterialOrder>(`/orders/${orderId}`, { token: this.token, accountId: this.accountId });
  }
  updateOrderStatus(orderId: string, status: "confirmed" | "shipped" | "delivered" | "cancelled") {
    return request<MaterialOrder>(`/orders/${orderId}/status`, {
      method: "PATCH",
      body: { status },
      token: this.token,
      accountId: this.accountId,
    });
  }
  upsertDelivery(orderId: string, input: { status: string; trackingReference?: string; estimatedDeliveryDate?: string }) {
    return request<Delivery>(`/orders/${orderId}/delivery`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  reviewOrder(orderId: string, input: { rating: number; comment?: string }) {
    return request<SupplierReview>(`/orders/${orderId}/reviews`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  updateOrderReview(orderId: string, reviewId: string, input: { rating?: number; comment?: string }) {
    return request<SupplierReview>(`/orders/${orderId}/reviews/${reviewId}`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  deleteOrderReview(orderId: string, reviewId: string) {
    return request<{ deleted: boolean }>(`/orders/${orderId}/reviews/${reviewId}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  replyToOrderReview(reviewId: string, input: { response: string }) {
    return request<SupplierReview>(`/suppliers/me/reviews/${reviewId}/reply`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  // The report side of review moderation — see MaterialsService.flagOrderReview.
  flagOrderReview(reviewId: string, input: { reason: string }) {
    return request<SupplierReview>(`/suppliers/me/reviews/${reviewId}/flag`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  // Module 6's neutral-reviewer queue for flagged supplier reviews.
  listFlaggedOrderReviews() {
    return request<SupplierReview[]>("/suppliers/reviews/flagged", { token: this.token, accountId: this.accountId });
  }
  moderateOrderReview(reviewId: string, input: { status: "hidden" | "published"; moderationNotes?: string }) {
    return request<SupplierReview>(`/suppliers/reviews/${reviewId}/moderate`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- Document vault ---
  createDocument(input: { documentType: string; fileUrl: string; propertyId?: string; leaseId?: string; expiryDate?: string }) {
    return request<AppDocument>("/documents", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  listDocuments() {
    return request<AppDocument[]>("/documents", { token: this.token, accountId: this.accountId });
  }
  findDocumentsForProperty(propertyId: string) {
    return request<AppDocument[]>(`/documents/property/${propertyId}`, { token: this.token, accountId: this.accountId });
  }
  verifyDocument(documentId: string, input: { status: "verified" | "rejected"; notes?: string }) {
    return request<AppDocument>(`/documents/${documentId}/verify`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findPendingDocumentsForArbitration() {
    return request<AppDocument[]>("/documents/pending", { token: this.token, accountId: this.accountId });
  }
  arbitrateDocumentVerification(documentId: string, input: { status: "verified" | "rejected" | "submitted"; notes?: string }) {
    return request<AppDocument>(`/documents/${documentId}/arbitrate`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
}
