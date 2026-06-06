export function formatCurrency(value: unknown, maximumFractionDigits = 2) {
  return `${Number(value || 0).toLocaleString("ar-SA", { maximumFractionDigits })} ريال سعودي`;
}
