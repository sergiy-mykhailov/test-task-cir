export const ReservationStatus = Object.freeze({
  Reserved: 'RESERVED',
  Released: 'RELEASED',
});

export const CapacityEventType = Object.freeze({
  ProgramCreated: 'PROGRAM_CREATED',
  ReservationCreated: 'RESERVATION_CREATED',
  ReservationReleased: 'RESERVATION_RELEASED',
  ReconciliationApplied: 'RECONCILIATION_APPLIED',
});

export const CapacityEventSource = Object.freeze({
  Api: 'API',
  KafkaTreasury: 'KAFKA_TREASURY',
  Reconciliation: 'RECONCILIATION',
});

export const TreasuryKafkaEventType = Object.freeze({
  ReservationApproved: 'RESERVATION_APPROVED',
  InvoiceRepaid: 'INVOICE_REPAID',
  ProgramReconciled: 'PROGRAM_RECONCILED',
});

export const TreasuryKafkaMessageStatus = Object.freeze({
  Processed: 'PROCESSED',
  Rejected: 'REJECTED',
});
