import { roundMoney, type JournalLineInput } from "@/lib/accounting/validation";

export type ProductSaleAccountingLine = {
  netAmount: number;
  cost: number;
  commission: number;
  revenueAccountId: string;
  cogsAccountId: string;
  inventoryAccountId: string;
};

function add(
  target: Map<string, JournalLineInput>,
  accountId: string,
  side: "debit" | "credit",
  amount: number,
  description: string
) {
  const value = roundMoney(amount);
  if (!accountId || value <= 0) return;
  const key = `${accountId}:${side}`;
  const current = target.get(key);
  target.set(key, {
    account_id: accountId,
    debit: side === "debit" ? roundMoney(Number(current?.debit || 0) + value) : 0,
    credit: side === "credit" ? roundMoney(Number(current?.credit || 0) + value) : 0,
    description,
  });
}

export function buildProductReceiptAccountingLines(values: {
  reference: string;
  inventoryGroups: Array<{ accountId: string; cost: number }>;
  settlementAccountId: string;
  settlementDescription: string;
}) {
  const lines = new Map<string, JournalLineInput>();
  for (const group of values.inventoryGroups) {
    add(lines, group.accountId, "debit", group.cost, `Inventory received ${values.reference}`);
  }
  const totalCost = roundMoney(
    values.inventoryGroups.reduce((sum, group) => sum + Number(group.cost || 0), 0)
  );
  add(lines, values.settlementAccountId, "credit", totalCost, values.settlementDescription);
  return { lines: [...lines.values()], totalCost };
}

export function buildProductSaleAccountingLines(values: {
  reference: string;
  receivableAccountId: string;
  vatPayableAccountId?: string;
  total: number;
  vat: number;
  saleLines: ProductSaleAccountingLine[];
  accrueCommission: boolean;
  commissionExpenseAccountId?: string;
  commissionPayableAccountId?: string;
}) {
  const lines = new Map<string, JournalLineInput>();
  add(lines, values.receivableAccountId, "debit", values.total, `Agent receivable ${values.reference}`);
  let cost = 0;
  let revenue = 0;
  let commission = 0;
  for (const line of values.saleLines) {
    cost = roundMoney(cost + line.cost);
    revenue = roundMoney(revenue + line.netAmount);
    commission = roundMoney(commission + line.commission);
    add(lines, line.revenueAccountId, "credit", line.netAmount, `Product revenue ${values.reference}`);
    add(lines, line.cogsAccountId, "debit", line.cost, `Product COGS ${values.reference}`);
    add(lines, line.inventoryAccountId, "credit", line.cost, `Inventory released ${values.reference}`);
  }
  add(lines, values.vatPayableAccountId || "", "credit", values.vat, `Output VAT ${values.reference}`);
  if (values.accrueCommission) {
    add(lines, values.commissionExpenseAccountId || "", "debit", commission, `Agent commission expense ${values.reference}`);
    add(lines, values.commissionPayableAccountId || "", "credit", commission, `Agent commission payable ${values.reference}`);
  }
  return {
    lines: [...lines.values()],
    cost,
    revenue,
    commission: values.accrueCommission ? commission : 0,
  };
}

export function buildProductCollectionAccountingLines(values: {
  reference: string;
  receiptAccountId: string;
  receivableAccountId: string;
  amount: number;
}) {
  const amount = roundMoney(values.amount);
  return [
    {
      account_id: values.receiptAccountId,
      debit: amount,
      credit: 0,
      description: `Collection received ${values.reference}`,
    },
    {
      account_id: values.receivableAccountId,
      debit: 0,
      credit: amount,
      description: `Agent receivable settled ${values.reference}`,
    },
  ] satisfies JournalLineInput[];
}

export function buildProductLossAccountingLines(values: {
  reference: string;
  shrinkageAccountId: string;
  inventoryAccountId: string;
  cost: number;
}) {
  const cost = roundMoney(values.cost);
  return [
    {
      account_id: values.shrinkageAccountId,
      debit: cost,
      credit: 0,
      description: `Inventory shrinkage ${values.reference}`,
    },
    {
      account_id: values.inventoryAccountId,
      debit: 0,
      credit: cost,
      description: `Inventory written off ${values.reference}`,
    },
  ] satisfies JournalLineInput[];
}

export function productAccountingBalance(lines: JournalLineInput[]) {
  const debit = roundMoney(lines.reduce((sum, line) => sum + Number(line.debit || 0), 0));
  const credit = roundMoney(lines.reduce((sum, line) => sum + Number(line.credit || 0), 0));
  return { debit, credit, balanced: debit === credit };
}
