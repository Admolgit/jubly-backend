# Booking cancellation finances

Cancellation uses `CancellationPolicyService.getFinancialPolicySnapshot()` and
the existing `computeCancellationOutcome()` utility. The actual cancellation
actor selects the existing client/vendor policy. A refund request's `amount`
cannot override an allocation. Administrators can process an existing
cancellation; they cannot invent its cancellation actor through the refund API.

Commission uses the checkout-captured rate and `calculateJublyCommission()`.
New authoritative amounts are integer kobo (BSON long); existing naira fields
and HTTP response shapes remain available. A response interceptor hides internal
payment evidence and operation fields, including nested records.

## Durable decisions

All allocation changes and dispatch claims conditionally write the booking in a
MongoDB transaction. `financialVersion` identifies the frozen allocation.
`Settlement.bookingId` remains unique. The same settlement holds normal vendor
payment or cancellation compensation, including a zero-payout instruction.

Refund instructions are embedded in Transaction. Cancellation persists both
instructions before HTTP dispatch. Compensation waits for a confirmed refund,
unless the configured refund is zero. A pending or uncertain operation continues
to reserve its allocation. A completed booking is not proof of a successful bank
transfer.

Never automatically resubmit an uncertain refund. Reconciliation uses its
provider ID, or a list result matching its original charge, amount, currency and
durable merchant-note marker. Missing/ambiguous results require review. A transfer
with an uncertain outcome is verified by its saved reference; a new reference is
created only after provider-confirmed failure under the same financial decision.
Prior transfer attempts remain in history. A late contradictory result freezes
the booking for review.

Paystack requests are outside MongoDB transactions. `PROCESSING` records left by
a crashed worker are reconciled; they are never reclaimed for blind submission.

## Deployment / activation

1. Run Prisma format, validate and generate. Verify the intended development
   database is exactly `jublyDev` before any development DB access or schema push.
2. Stop **all** old app/worker instances that can initiate refunds/transfers.
   Deploy the updated coordinator and all calling paths together. Old binaries
   do not understand this database claim and must not coexist with enabled
   cancellation dispatch.
3. `JUBLY_FINANCIAL_DISPATCH_ENABLED=true` enables new refund/transfer dispatch.
   It is intentionally off when absent. Reconciliation remains available while
   dispatch is off. This change does not set the variable or deploy production.
4. Confirm the development flow with Paystack test-mode credentials before a
   separately authorized production rollout. This implementation did not call
   Paystack with development or production credentials during tests.

Historical payments without a reliable checkout snapshot, cash payments,
conflicting previous operations and missing references require manual review.
No backfill guesses principal, commission or payment success. Original completed
settlements without references are left untouched; provider history must be
established before financial repair. No manual-review override endpoint is
introduced by this change.

Configuration whose allocations exceed principal is blocked. If the existing
utility's independent rounding would exceed the budget by one kobo, review is
required rather than inventing a client/vendor rounding preference.

## Verification

`financial-allocation.spec.ts` checks policy reuse, commission, budgets and HTTP
field filtering. `booking-finance.dev.spec.ts` is opt-in with
`JUBLY_FINANCE_DEV_INTEGRATION=true`, refuses any database other than `jublyDev`,
uses real MongoDB transactions with **mocked Paystack only**, and removes only
the fixture IDs it created. Run after the required Prisma/development checks.
Ordinary tests skip this database suite.
