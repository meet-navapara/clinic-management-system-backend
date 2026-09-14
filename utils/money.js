export const roundMoney = (n) => {
  const value = Number(n);
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

export const computeInvoiceTotals = ({ items = [], discount = 0, taxRate = 0, taxAmount = 0 } = {}) => {
  const lines = items.map((item) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = roundMoney(item.unitPrice);
    const lineDiscount = roundMoney(item.discount || 0);
    const amount = roundMoney(Math.max(0, quantity * unitPrice - lineDiscount));
    return { ...item, quantity, unitPrice, discount: lineDiscount, amount };
  });
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  const discountValue = roundMoney(discount);
  const taxable = Math.max(0, subtotal - discountValue);
  const tax = taxAmount != null && taxAmount !== '' && Number(taxAmount) > 0
    ? roundMoney(taxAmount)
    : roundMoney(taxable * (Number(taxRate) || 0) / 100);
  const total = roundMoney(taxable + tax);
  return { items: lines, subtotal, discount: discountValue, tax, total };
};

export const paymentStatusFromAmounts = (total, paidAmount, refundedAmount = 0) => {
  const due = roundMoney(Math.max(0, Number(total) - Number(paidAmount) + Number(refundedAmount)));
  const paid = roundMoney(Number(paidAmount));
  const refunded = roundMoney(Number(refundedAmount));
  if (refunded > 0 && paid <= refunded) return { paymentStatus: 'refunded', dueAmount: roundMoney(total), paidAmount: paid };
  if (paid <= 0) return { paymentStatus: 'unpaid', dueAmount: roundMoney(total), paidAmount: 0 };
  if (due > 0) return { paymentStatus: 'partially_paid', dueAmount: due, paidAmount: paid };
  return { paymentStatus: 'paid', dueAmount: 0, paidAmount: paid };
};
