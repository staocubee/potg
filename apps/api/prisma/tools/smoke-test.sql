-- Real-Postgres structural smoke test for schema.prisma, written because
-- this schema can't be validated with actual Prisma tooling in a sandbox
-- that can't reach binaries.prisma.sh (see prisma_to_sql.py's header
-- comment, and the "Real end-to-end smoke test" section of README.md).
--
-- Usage (needs a real Postgres reachable at $DATABASE_URL, or point psql
-- at one directly):
--   python3 prisma/tools/prisma_to_sql.py prisma/schema.prisma > /tmp/potg_schema.sql
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /tmp/potg_schema.sql
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/tools/smoke-test.sql
-- Expect the final row to read "SMOKE TEST PASSED" and three NOTICE lines
-- confirming the constraint/cascade checks below actually fired.
--
-- One representative row per table (43/43), inserted in FK dependency
-- order, exercising the real relationships and unique constraints the
-- application code relies on (AccountMember's [accountId,userId], the
-- vendor/supplier review one-per-project/order constraints, etc).

INSERT INTO accounts (id, "accountType", name, country, currency, timezone) VALUES
  ('acct-owner', 'INDIVIDUAL', 'Owner Account', 'NG', 'NGN', 'Africa/Lagos'),
  ('acct-vendor', 'VENDOR', 'Vendor Account', 'NG', 'NGN', 'Africa/Lagos'),
  ('acct-supplier', 'SUPPLIER', 'Supplier Account', 'NG', 'NGN', 'Africa/Lagos');

INSERT INTO users (id, name, email, "passwordHash") VALUES
  ('user-1', 'Demo User', 'demo@example.com', 'x');

INSERT INTO roles (id, key, name) VALUES ('role-1', 'property_owner', 'Property Owner');
INSERT INTO permissions (id, key, label) VALUES ('perm-1', 'property:read', 'View properties');
INSERT INTO role_permissions ("roleId", "permissionId") VALUES ('role-1', 'perm-1');

INSERT INTO account_members (id, "accountId", "userId", "roleId") VALUES
  ('member-1', 'acct-owner', 'user-1', 'role-1');

INSERT INTO password_reset_tokens (id, "userId", "tokenHash", "expiresAt") VALUES
  ('reset-1', 'user-1', 'hash1', now() + interval '1 hour');

INSERT INTO kyc_verifications (id, "userId") VALUES ('kyc-1', 'user-1');

INSERT INTO properties (id, "accountId", "propertyType", name, "addressLine", country) VALUES
  ('property-1', 'acct-owner', 'residential', 'Demo House', '1 Demo Street', 'NG');

INSERT INTO property_owners (id, "propertyId", "ownerType", "ownerAccountId") VALUES
  ('powner-1', 'property-1', 'account', 'acct-owner');

INSERT INTO property_access_grants (id, "propertyId", "accountMemberId") VALUES
  ('grant-1', 'property-1', 'member-1');

INSERT INTO property_timeline_events (id, "propertyId", "eventType", label) VALUES
  ('event-1', 'property-1', 'purchased', 'Property purchased');

INSERT INTO documents (id, "accountId", "propertyId", "documentType", "fileUrl", "uploadedByUserId") VALUES
  ('doc-1', 'acct-owner', 'property-1', 'title_document', 'https://example.com/doc.pdf', 'user-1');

INSERT INTO ai_requests (id, "accountId", "accountMemberId", "moduleContext", "actionType", input) VALUES
  ('airequest-1', 'acct-owner', 'member-1', 'property:property-1', 'summarize_property', '{}'::jsonb);

INSERT INTO ai_outputs (id, "aiRequestId", "draftLabel", "draftBody") VALUES
  ('aioutput-1', 'airequest-1', 'Property summary — draft', '{"items":[]}'::jsonb);

INSERT INTO ai_action_approvals (id, "aiOutputId", "decidedByUserId", decision) VALUES
  ('aiapproval-1', 'aioutput-1', 'user-1', 'accepted');

INSERT INTO vendors (id, "accountId", "businessName", "serviceCategory") VALUES
  ('vendor-1', 'acct-vendor', 'Demo Renovations', 'renovation');

INSERT INTO projects (id, "accountId", "propertyId", "projectType", title) VALUES
  ('project-1', 'acct-owner', 'property-1', 'renovation', 'Kitchen remodel');

INSERT INTO project_stages (id, "projectId", name, "sortOrder") VALUES
  ('stage-1', 'project-1', 'Scope', 1);

INSERT INTO project_milestones (id, "projectId", title) VALUES
  ('milestone-1', 'project-1', 'Demolition complete');

INSERT INTO project_updates (id, "projectId", "submittedByUserId", description) VALUES
  ('update-1', 'project-1', 'user-1', 'Demolition started');

INSERT INTO vendor_quotes (id, "projectId", "vendorId", amount) VALUES
  ('quote-1', 'project-1', 'vendor-1', 500000);

INSERT INTO project_vendor_assignments (id, "projectId", "vendorId") VALUES
  ('assignment-1', 'project-1', 'vendor-1');

INSERT INTO vendor_reviews (id, "vendorId", "projectId", "accountId", rating) VALUES
  ('vreview-1', 'vendor-1', 'project-1', 'acct-owner', 5);

INSERT INTO escrow_accounts (id, "projectId", currency) VALUES
  ('escrow-1', 'project-1', 'NGN');

INSERT INTO payments (id, "accountId", "projectId", "escrowAccountId", amount, currency) VALUES
  ('payment-1', 'acct-owner', 'project-1', 'escrow-1', 500000, 'NGN');

INSERT INTO escrow_ledger_entries (id, "escrowAccountId", "entryType", amount, "balanceAfter", "relatedPaymentId") VALUES
  ('ledger-1', 'escrow-1', 'deposit', 500000, 500000, 'payment-1');

INSERT INTO payouts (id, "vendorId", "projectId", "milestoneId", amount, currency) VALUES
  ('payout-1', 'vendor-1', 'project-1', 'milestone-1', 200000, 'NGN');

INSERT INTO receipts (id, "accountId", "receiptNumber", "paymentId", amount, currency) VALUES
  ('receipt-1', 'acct-owner', 'RCPT-0001', 'payment-1', 500000, 'NGN');

INSERT INTO disputes (id, "projectId", "raisedByAccountId", reason) VALUES
  ('dispute-1', 'project-1', 'acct-owner', 'Work incomplete');

INSERT INTO property_listings (id, "propertyId", "accountId", "listingType", "askingPrice", currency, title) VALUES
  ('listing-1', 'property-1', 'acct-owner', 'sale', 50000000, 'NGN', 'Demo House for sale');

INSERT INTO listing_inquiries (id, "listingId", "accountId", message) VALUES
  ('inquiry-1', 'listing-1', 'acct-vendor', 'Is this still available?');

INSERT INTO listing_offers (id, "listingId", "accountId", amount, currency) VALUES
  ('offer-1', 'listing-1', 'acct-vendor', 48000000, 'NGN');

INSERT INTO listing_favorites (id, "listingId", "accountId") VALUES
  ('favorite-1', 'listing-1', 'acct-vendor');

INSERT INTO suppliers (id, "accountId", "businessName", category) VALUES
  ('supplier-1', 'acct-supplier', 'Demo Building Supplies', 'materials');

INSERT INTO products (id, "supplierId", name, category, unit, "unitPrice", currency) VALUES
  ('product-1', 'supplier-1', 'Ceramic tile', 'tile', 'sqm', 5000, 'NGN');

INSERT INTO orders (id, "accountId", "supplierId", "projectId", "totalAmount", currency) VALUES
  ('order-1', 'acct-owner', 'supplier-1', 'project-1', 50000, 'NGN');

INSERT INTO order_items (id, "orderId", "productId", quantity, "unitPrice", "lineTotal") VALUES
  ('orderitem-1', 'order-1', 'product-1', 10, 5000, 50000);

INSERT INTO deliveries (id, "orderId", status) VALUES
  ('delivery-1', 'order-1', 'delivered');

INSERT INTO supplier_reviews (id, "supplierId", "orderId", "accountId", rating) VALUES
  ('sreview-1', 'supplier-1', 'order-1', 'acct-owner', 4);

INSERT INTO ai_conversations (id, "accountId", "accountMemberId") VALUES
  ('conversation-1', 'acct-owner', 'member-1');

INSERT INTO ai_messages (id, "conversationId", role, content) VALUES
  ('message-1', 'conversation-1', 'user', 'Summarize this property for me');

INSERT INTO property_valuations (id, "propertyId", "estimatedValue", currency) VALUES
  ('valuation-1', 'property-1', 52000000, 'NGN');

-- Constraint checks: these must fail, or the smoke test itself is broken.
DO $$
BEGIN
  BEGIN
    INSERT INTO account_members (id, "accountId", "userId", "roleId") VALUES ('member-dup', 'acct-owner', 'user-1', 'role-1');
    RAISE EXCEPTION 'expected account_members unique(accountId,userId) violation did not occur';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK: account_members [accountId,userId] uniqueness enforced';
  END;

  BEGIN
    INSERT INTO vendor_reviews (id, "vendorId", "projectId", "accountId", rating) VALUES ('vreview-dup', 'vendor-1', 'project-1', 'acct-owner', 3);
    RAISE EXCEPTION 'expected vendor_reviews unique(projectId,vendorId) violation did not occur';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK: vendor_reviews [projectId,vendorId] uniqueness enforced';
  END;

  BEGIN
    INSERT INTO documents (id, "accountId", "propertyId", "documentType", "fileUrl", "uploadedByUserId") VALUES ('doc-bad', 'acct-owner', 'no-such-property', 'title_document', 'x', 'user-1');
    RAISE EXCEPTION 'expected documents FK violation did not occur';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'OK: documents.propertyId FK enforced';
  END;
END $$;

-- documents.propertyId is ON DELETE SET NULL — deleting the property should
-- null the FK, not cascade-delete the document.
DELETE FROM properties WHERE id = 'property-1';

DO $$
DECLARE
  remaining_docs INTEGER;
  doc_property_id TEXT;
BEGIN
  SELECT count(*) INTO remaining_docs FROM documents WHERE id = 'doc-1';
  SELECT "propertyId" INTO doc_property_id FROM documents WHERE id = 'doc-1';
  IF remaining_docs != 1 OR doc_property_id IS NOT NULL THEN
    RAISE EXCEPTION 'expected doc-1 to survive with propertyId=NULL after property delete, got remaining=% propertyId=%', remaining_docs, doc_property_id;
  END IF;
  RAISE NOTICE 'OK: deleting a property SET NULLs documents.propertyId instead of deleting the document';
END $$;

SELECT 'SMOKE TEST PASSED' AS result;
