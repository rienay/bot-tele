export type TransactionType = 'Pengeluaran' | 'Pemasukan';

export interface ParsedTransaction {
  type: TransactionType;
  amount: number;
  category: string;
  description: string;
  date: string; // Format: YYYY-MM-DD
  noteLink?: string;
  rawMerchantOrItem?: string;
}

export interface ExpenseDetail {
  date: string;
  category: string;
  nominal: number;
  description: string;
  noteLink?: string;
}

export interface SummaryReport {
  isAllTime: boolean;
  periodeLabel: string;
  totalPengeluaran: number;
  totalPemasukan: number;
  saldo: number;
  count: number;
  categoryExpenses: Record<string, number>;
  categoryIncome: Record<string, number>;
  expenseDetails: ExpenseDetail[];
  incomeDetails: ExpenseDetail[];
}

export interface BookSummary {
  bookName: string;
  totalPengeluaran: number;
  totalPemasukan: number;
  saldo: number;
  count: number;
}

export interface GlobalSummaryReport {
  isAllTime: boolean;
  periodeLabel: string;
  totalPengeluaran: number;
  totalPemasukan: number;
  saldo: number;
  count: number;
  categoryExpenses: Record<string, number>;
  categoryIncome: Record<string, number>;
  books: BookSummary[];
}
