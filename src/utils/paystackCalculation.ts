export function addPaystackFee(amount: number): {
  serviceAmount: number;
  processingFee: number;
  totalAmount: number;
} {
  const percentage = 0.015;
  const feeCap = 2000;
  const flatFee = amount < 2500 ? 0 : 100;
  const normalFee = amount * percentage + flatFee;

  let totalAmount: number;

  if (normalFee >= feeCap) {
    totalAmount = amount + feeCap;
  } else {
    totalAmount = (amount + flatFee) / (1 - percentage);
  }
  
  totalAmount = Math.ceil(totalAmount * 100) / 100;

  return {
    serviceAmount: amount,
    processingFee: Math.round((totalAmount - amount) * 100) / 100,
    totalAmount,
  };
}

export function calculateJublyCommission(
  amount: number,
  commissionRate: number,
) {
  const JUBLY_COMMISSION_CAP = 4_000;

  const percentageFee = amount * commissionRate;

  return Math.min(percentageFee, JUBLY_COMMISSION_CAP);
}