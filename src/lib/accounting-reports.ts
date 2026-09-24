import type { ChartOfAccount, JournalEntry, JournalLine } from './types';

export type LedgerLine = JournalLine & {
  entryDate?: string;
  entryNumber?: string;
  sourceLabel?: string;
  sourceType?: string;
  sourceRef?: string;
  sourceNumber?: string;
  status?: string;
};

export type LedgerAccountSummary = {
  account: ChartOfAccount;
  debit: number;
  credit: number;
  balance: number;
};

export type BalanceSheetSummary = {
  assets: number;
  liabilities: number;
  equity: number;
  currentEarnings: number;
  totalEquity: number;
  liabilitiesAndEquity: number;
  balanceGap: number;
};

function getFinancialStatementBalance(summary: Pick<LedgerAccountSummary, 'account' | 'debit' | 'credit'>) {
  if (
    summary.account.accountType === 'ASSET' ||
    summary.account.accountType === 'EXPENSE' ||
    summary.account.accountType === 'CONTRA_REVENUE'
  ) {
    return summary.debit - summary.credit;
  }
  return summary.credit - summary.debit;
}

export function formatAccountingCurrency(amount: number) {
  return `Rp ${Math.round(amount || 0).toLocaleString('id-ID')}`;
}

export function isDateInPeriod(dateValue: string | undefined, startDate: string, endDate: string) {
  if (!dateValue) return false;
  return dateValue >= startDate && dateValue <= endDate;
}

export function getJournalLinesForPeriod(
  entries: JournalEntry[],
  lines: JournalLine[],
  startDate: string,
  endDate: string,
) {
  const activeEntryRefs = new Set(
    entries
      .filter(entry => entry.status !== 'VOID' && isDateInPeriod(entry.entryDate, startDate, endDate))
      .map(entry => entry._id),
  );
  return lines.filter(line => activeEntryRefs.has(line.journalEntryRef));
}

export function getJournalLinesUntil(entries: JournalEntry[], lines: JournalLine[], endDate: string) {
  const entryById = new Map(entries.map(entry => [entry._id, entry]));
  return lines.filter(line => {
    const entry = entryById.get(line.journalEntryRef);
    return Boolean(entry?.status !== 'VOID' && entry?.entryDate && entry.entryDate <= endDate);
  });
}

export function buildJournalLineLookup(entries: JournalEntry[], lines: JournalLine[]) {
  const entryById = new Map(entries.map(entry => [entry._id, entry]));
  return lines.map<LedgerLine>(line => {
    const entry = entryById.get(line.journalEntryRef);
    return {
      ...line,
      entryDate: entry?.entryDate,
      entryNumber: entry?.entryNumber,
      sourceLabel: entry?.sourceLabel,
      sourceType: entry?.sourceType,
      sourceRef: entry?.sourceRef,
      sourceNumber: entry?.sourceNumber,
      status: entry?.status,
    };
  });
}

export function buildLedgerSummary(accounts: ChartOfAccount[], lines: JournalLine[]): LedgerAccountSummary[] {
  const totalsByAccount = new Map<string, { debit: number; credit: number }>();
  for (const line of lines) {
    const existing = totalsByAccount.get(line.accountRef) || { debit: 0, credit: 0 };
    existing.debit += Number(line.debit || 0);
    existing.credit += Number(line.credit || 0);
    totalsByAccount.set(line.accountRef, existing);
  }

  return accounts
    .map(account => {
      const totals = totalsByAccount.get(account._id);
      const debit = totals?.debit || 0;
      const credit = totals?.credit || 0;
      const balance = getFinancialStatementBalance({ account, debit, credit });
      return { account, debit, credit, balance };
    })
    .filter(summary => summary.debit !== 0 || summary.credit !== 0 || summary.account.active !== false)
    .sort((left, right) => left.account.code.localeCompare(right.account.code));
}

export function buildProfitLossFromLedger(summaries: LedgerAccountSummary[]) {
  const revenue = summaries
    .filter(summary => summary.account.accountType === 'REVENUE')
    .reduce((sum, summary) => sum + summary.balance, 0);
  const deductions = summaries
    .filter(summary => summary.account.accountType === 'CONTRA_REVENUE')
    .reduce((sum, summary) => sum + summary.balance, 0);
  const expenses = summaries
    .filter(summary => summary.account.accountType === 'EXPENSE')
    .reduce((sum, summary) => sum + summary.balance, 0);
  return {
    revenue,
    deductions,
    netRevenue: revenue - deductions,
    expenses,
    netProfit: revenue - deductions - expenses,
  };
}

export function buildBalanceSheetFromLedger(summaries: LedgerAccountSummary[]) {
  const assets = summaries
    .filter(summary => summary.account.accountType === 'ASSET')
    .reduce((sum, summary) => sum + summary.balance, 0);
  const liabilities = summaries
    .filter(summary => summary.account.accountType === 'LIABILITY')
    .reduce((sum, summary) => sum + summary.balance, 0);
  const equity = summaries
    .filter(summary => summary.account.accountType === 'EQUITY')
    .reduce((sum, summary) => sum + summary.balance, 0);
  const currentEarnings = buildProfitLossFromLedger(summaries).netProfit;
  const totalEquity = equity + currentEarnings;
  const liabilitiesAndEquity = liabilities + totalEquity;
  return {
    assets,
    liabilities,
    equity,
    currentEarnings,
    totalEquity,
    liabilitiesAndEquity,
    balanceGap: assets - liabilitiesAndEquity,
  } satisfies BalanceSheetSummary;
}
