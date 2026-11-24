// Tipos inferidos del esquema (única fuente de verdad).
import type {
  adminCases,
  bankAccounts,
  bankAllocations,
  cashPayments,
  paymentReports,
  paymentReviews,
} from "./schema";

export type BankAccount = typeof bankAccounts.$inferSelect;
export type NewBankAccount = typeof bankAccounts.$inferInsert;

export type BankAllocation = typeof bankAllocations.$inferSelect;
export type NewBankAllocation = typeof bankAllocations.$inferInsert;

export type PaymentReport = typeof paymentReports.$inferSelect;
export type NewPaymentReport = typeof paymentReports.$inferInsert;

export type PaymentReview = typeof paymentReviews.$inferSelect;
export type NewPaymentReview = typeof paymentReviews.$inferInsert;

export type CashPayment = typeof cashPayments.$inferSelect;
export type NewCashPayment = typeof cashPayments.$inferInsert;

export type AdminCase = typeof adminCases.$inferSelect;
export type NewAdminCase = typeof adminCases.$inferInsert;
