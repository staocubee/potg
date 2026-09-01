// Typed client for the NestJS API (apps/api). One file, one shape per
// endpoint, so every screen and the Ask AI panel share the exact same
// request/response contracts instead of each hand-rolling fetch calls.
//
// Auth pattern (mirrors apps/api/src/common/guards): a bearer JWT
// identifies the user, and a separate `X-Account-Id` header says which
// account they're currently acting as (Module 1 — one user can belong to
// several accounts). Both are threaded through here rather than read from
// storage directly, so this file has no dependency on how the caller
// persists them (see lib/auth.tsx).

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
  token?: string | null;
  accountId?: string | null;
  // Internal — set when request() re-issues a call with a freshly refreshed
  // access token, so a second 401 (refresh token also expired/invalid, or
  // the server rejects the new token for some other reason) fails instead
  // of looping forever.
  _isRetry?: boolean;
};

// ---- Access-token refresh -------------------------------------------------
//
// AuthService issues a short-lived (1h) access token plus a long-lived
// (30d) refresh token (see apps/api/src/auth/auth.service.ts). Rather than
// making every screen notice a 401 and handle it, request() below does it
// once, centrally: on a 401 from an authenticated call, it transparently
// swaps the refresh token for a new pair via POST /auth/refresh, retries
// the original call with the new access token, and only surfaces an error
// to the caller if that retry also fails (refresh token expired too, or
// this account was otherwise signed out — either way, the right response
// is a real logout).
//
// lib/auth.tsx's AuthProvider is the only caller of configureAuthSession —
// it's the one place that knows how to persist a refreshed pair and how to
// force a logout, so this module never touches localStorage or routing
// itself.
type AuthSessionHooks = {
  getRefreshToken: () => string | null;
  onRefreshed: (tokens: { accessToken: string; refreshToken: string }) => void;
  onRefreshFailed: () => void;
};

let authSessionHooks: AuthSessionHooks | null = null;
let refreshInFlight: Promise<{ accessToken: string; refreshToken: string } | null> | null = null;

export function configureAuthSession(hooks: AuthSessionHooks | null) {
  authSessionHooks = hooks;
}

// Endpoints that either don't take a token or ARE the refresh flow itself —
// a 401 from any of these must never trigger another refresh attempt.
const NO_REFRESH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh"];

function performRefresh(): Promise<{ accessToken: string; refreshToken: string } | null> {
  if (!authSessionHooks) return Promise.resolve(null);
  const refreshToken = authSessionHooks.getRefreshToken();
  if (!refreshToken) return Promise.resolve(null);

  // Concurrent 401s (several requests firing around the same time, all
  // hitting the same expired access token) share one in-flight refresh
  // call instead of each racing their own — the check-and-set here is
  // synchronous, so it's safe without a lock.
  if (!refreshInFlight) {
    refreshInFlight = request<{ accessToken: string; refreshToken: string }>("/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    })
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts.accountId) headers["X-Account-Id"] = opts.accountId;

  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => undefined) : undefined;

  if (!res.ok) {
    if (res.status === 401 && opts.token && !opts._isRetry && !NO_REFRESH_PATHS.includes(path)) {
      const refreshed = await performRefresh();
      if (refreshed) {
        authSessionHooks?.onRefreshed(refreshed);
        return request<T>(path, { ...opts, token: refreshed.accessToken, _isRetry: true });
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

export type AuthResponse = { accessToken: string; refreshToken: string };

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
  documentType: string;
  fileUrl: string;
  verificationStatus: "not_verified" | "submitted" | "verified" | "rejected" | string;
  verificationNotes?: string | null;
  expiryDate?: string | null;
  uploadedByUserId: string;
  createdAt: string;
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

export type InspectionFinding = {
  id: string;
  inspectionId: string;
  area: string;
  description: string;
  severity: "minor" | "moderate" | "major" | string;
  createdAt: string;
};

export type PropertyInspection = {
  id: string;
  propertyId: string;
  projectId?: string | null;
  inspectionType: "general" | "pre_purchase" | "move_in" | "move_out" | "safety" | "post_renovation" | string;
  status: "scheduled" | "completed" | "cancelled" | string;
  scheduledFor: string;
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

export type Vendor = {
  id: string;
  accountId: string;
  businessName: string;
  serviceCategory: string;
  locationCoverage?: string | null;
  verificationStatus: string;
  ratingAverage?: string | null;
  createdAt: string;
  reviews?: VendorReview[];
};

export type VendorReview = {
  id: string;
  vendorId: string;
  projectId: string;
  accountId: string;
  rating: number;
  comment?: string | null;
  response?: string | null;
  respondedAt?: string | null;
  createdAt: string;
  updatedAt: string;
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
  // Only present on GET /vendors/me/disputes — the owner-side
  // /projects/:projectId/disputes routes already know the project.
  project?: { id: string; title: string };
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

export type Supplier = {
  id: string;
  accountId: string;
  businessName: string;
  category: "materials" | "tools" | "equipment" | string;
  locationCoverage?: string | null;
  verificationStatus: "not_verified" | "pending" | "verified" | string;
  ratingAverage?: string | null;
  createdAt: string;
  updatedAt: string;
  products?: Product[];
  reviews?: SupplierReview[];
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
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
  supplier?: Supplier | { id: string; businessName: string; ratingAverage?: string | null };
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
  register(input: { name: string; email: string; phone?: string; password: string; inviteToken?: string }) {
    return request<AuthResponse>("/auth/register", { method: "POST", body: input });
  }
  login(email: string, password: string) {
    return request<AuthResponse>("/auth/login", { method: "POST", body: { email, password } });
  }
  refresh(refreshToken: string) {
    return request<AuthResponse>("/auth/refresh", { method: "POST", body: { refreshToken } });
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
  // AccountsService.addMember. inviteToken is only ever present because
  // there's no real email provider wired up (same tradeoff as
  // forgotPassword's resetToken); a real deployment would drop it and
  // rely on the email actually sent.
  addAccountMember(accountId: string, input: { email: string; roleKey: string }) {
    return request<
      | { type: "member"; member: AccountMemberSummary }
      | { type: "invite"; invite: AccountInviteSummary; inviteToken: string }
    >(`/accounts/${accountId}/members`, { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }

  // --- Invites (no account context — the recipient isn't a member yet) ---
  getInvite(token: string) {
    return request<InvitePreview>(`/invites/${token}`);
  }
  acceptInvite(token: string) {
    return request<AccountMemberSummary>(`/invites/${token}/accept`, { method: "POST", token: this.token });
  }

  // --- Properties (account-scoped) ---
  listProperties() {
    return request<Property[]>("/properties", { token: this.token, accountId: this.accountId });
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
  scheduleInspection(propertyId: string, input: { inspectionType: string; scheduledFor: string; projectId?: string; inspectorName?: string }) {
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
    return request<{ conversationId: string; message: AiMessage }>("/ai/chat", {
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
  listVendors(serviceCategory?: string) {
    const qs = serviceCategory ? `?serviceCategory=${encodeURIComponent(serviceCategory)}` : "";
    return request<Vendor[]>(`/vendors${qs}`, { token: this.token, accountId: this.accountId });
  }
  getVendor(vendorId: string) {
    return request<Vendor>(`/vendors/${vendorId}`, { token: this.token, accountId: this.accountId });
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

  // --- Payments & escrow (per-project routes below; the account-wide
  // rollup is getPaymentsOverview() further down) ---
  deposit(projectId: string, input: { amount: number; currency?: string; provider?: string; providerReference?: string }) {
    return request<{ payment: Payment; receipt: Receipt }>(`/projects/${projectId}/payments`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
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
    return request<{ payout: Payout; receipt: Receipt }>(`/projects/${projectId}/milestones/${milestoneId}/release`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
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
  getPaymentsOverview() {
    return request<PaymentsOverview>("/payments/overview", { token: this.token, accountId: this.accountId });
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

  // --- Property marketplace (listings) ---
  createListing(input: { propertyId: string; listingType: string; askingPrice: number; currency?: string; title: string; description?: string; photoUrls?: string[] }) {
    return request<Listing>("/listings", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  searchListings(query: { listingType?: string; city?: string; propertyType?: string; minPrice?: string; maxPrice?: string }) {
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
  createProduct(input: { name: string; category: string; unit: string; unitPrice: number; currency?: string; stockQuantity?: number; description?: string }) {
    return request<Product>("/suppliers/me/products", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  updateProduct(productId: string, input: { unitPrice?: number; stockQuantity?: number; status?: string; description?: string }) {
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
  findProducts(category?: string, supplierId?: string) {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (supplierId) params.set("supplierId", supplierId);
    const qs = params.toString();
    return request<Product[]>(`/products${qs ? `?${qs}` : ""}`, { token: this.token, accountId: this.accountId });
  }
  getProduct(productId: string) {
    return request<Product>(`/products/${productId}`, { token: this.token, accountId: this.accountId });
  }
  createOrder(input: { supplierId: string; projectId?: string; items: { productId: string; quantity: number }[]; deliveryAddress?: string }) {
    return request<MaterialOrder>("/orders", { method: "POST", body: input, token: this.token, accountId: this.accountId });
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

  // --- Document vault ---
  createDocument(input: { documentType: string; fileUrl: string; propertyId?: string; expiryDate?: string }) {
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
}
