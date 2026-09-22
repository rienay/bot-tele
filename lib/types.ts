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

export interface SummaryReport {
  totalPengeluaran: number;
  totalPemasukan: number;
  saldo: number;
  count: number;
  bulan: string;
}
