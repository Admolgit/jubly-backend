import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs/operators';

const bookingFields = [
  'financialMode',
  'financialVersion',
  'financialReviewReason',
];
const transactionFields = [
  'servicePrincipalKobo',
  'expectedGrossChargeKobo',
  'verifiedChargedAmountKobo',
  'processingMarkupKobo',
  'providerTransactionId',
  'paymentEvidenceState',
  'paymentVerifiedAt',
  'checkoutSnapshot',
  'refundState',
  'refundOperation',
];
const settlementFields = [
  'purpose',
  'transactionId',
  'currency',
  'financialVersion',
  'principalKobo',
  'refundAllocationKobo',
  'grossVendorAllocationKobo',
  'commissionKobo',
  'netTransferKobo',
  'commissionRate',
  'policySnapshot',
  'operationState',
  'providerState',
  'dispatchStartedAt',
  'reconcileAfter',
  'attemptHistory',
];

// Applied only at the HTTP boundary: services still receive complete DB records.
export function publicFinancialResponse(value: any): any {
  if (Array.isArray(value)) return value.map(publicFinancialResponse);
  if (
    !value ||
    typeof value !== 'object' ||
    value instanceof Date ||
    Buffer.isBuffer(value)
  )
    return value;
  const hidden = new Set<string>();
  if ('financialMode' in value || 'financialReviewReason' in value)
    bookingFields.forEach((key) => hidden.add(key));
  if ('servicePrincipalKobo' in value || 'refundOperation' in value)
    transactionFields.forEach((key) => hidden.add(key));
  if ('netTransferKobo' in value || 'operationState' in value)
    settlementFields.forEach((key) => hidden.add(key));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !hidden.has(key))
      .map(([key, item]) => [key, publicFinancialResponse(item)]),
  );
}

@Injectable()
export class FinancialResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(map(publicFinancialResponse));
  }
}
