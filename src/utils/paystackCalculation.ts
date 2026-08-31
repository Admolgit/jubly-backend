export function addPaystackFee(amount: number): {
  serviceAmount: number;
  processingFee: number;
  totalAmount: number;
} {
  const percentage = 0.015;
  const feeCap = 2000;

  // Paystack waives the ₦100 flat fee below ₦2,500
  const flatFee = amount < 2500 ? 0 : 100;

  // Check whether the normal fee would hit the ₦2,000 cap
  const normalFee = amount * percentage + flatFee;

  let totalAmount: number;

  if (normalFee >= feeCap) {
    totalAmount = amount + feeCap;
  } else {
    // Gross-up because Paystack also charges 1.5%
    // on the additional amount being passed to the customer.
    totalAmount = (amount + flatFee) / (1 - percentage);
  }

  // Round up so Jubly doesn't lose money due to Kobo rounding
  totalAmount = Math.ceil(totalAmount * 100) / 100;

  return {
    serviceAmount: amount,
    processingFee: Math.round((totalAmount - amount) * 100) / 100,
    totalAmount,
  };
}
