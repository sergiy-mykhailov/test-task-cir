export const ReservationStatus = Object.freeze({
  Reserved: 'RESERVED',
  Released: 'RELEASED',
});

export const CapacityEventType = Object.freeze({
  ProgramCreated: 'PROGRAM_CREATED',
  ReservationCreated: 'RESERVATION_CREATED',
  ReservationReleased: 'RESERVATION_RELEASED',
});

export const CapacityEventSource = Object.freeze({
  Api: 'API',
  KafkaTreasury: 'KAFKA_TREASURY',
  Reconciliation: 'RECONCILIATION',
});
