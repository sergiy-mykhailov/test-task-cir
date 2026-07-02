import {
  CapacityEventSource,
  CapacityEventType,
  ReservationStatus,
} from '../constants/capacity.js';
import { HttpStatusCode } from '../constants/http.js';
import CapacityRepository from '../repositories/capacity.js';
import { throwError } from '../utils/errors.js';
import { toAmount, toTimestamp } from '../utils/format.js';

export default class CapacityService {
  constructor({
    repository = new CapacityRepository(),
    now = () => new Date(),
  } = {}) {
    this.repository = repository;
    this.now = now;
  }

  async getCapacity(programExternalId) {
    const { program, balance } = await this.getProgramState(programExternalId);

    return this.#buildCapacityResponse(program, balance);
  }

  async createProgram(payload) {
    return this.repository.withTransaction(async (trx) => {
      const existingProgram = await this.repository.findProgramByExternalId(payload.externalId, trx);

      if (existingProgram) {
        throwError('Program already exists', HttpStatusCode.Conflict, { programId: payload.externalId });
      }

      const totalLimit = this.#getValidatedAmount(payload.totalLimit, 'totalLimit');
      const occurredAt = toTimestamp(this.now());
      const program = await this.repository.createProgram({
        externalId: payload.externalId,
        currency: payload.currency,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      }, trx);
      const balance = await this.repository.createBalance({
        programId: program.id,
        totalLimit,
        reservedAmount: 0,
        updatedAt: occurredAt,
      }, trx);

      await this.repository.createCapacityEvent({
        programId: program.id,
        reservationId: null,
        eventType: CapacityEventType.ProgramCreated,
        source: CapacityEventSource.Api,
        invoiceId: null,
        amount: totalLimit,
        currency: program.currency,
        occurredAt,
        createdAt: occurredAt,
      }, trx);

      return {
        program: this.#buildProgramResponse(program),
        capacity: this.#buildCapacityResponse(program, balance),
      };
    });
  }

  async createFxRate(payload) {
    return this.repository.withTransaction(async (trx) => {
      if (payload.baseCurrency === payload.quoteCurrency) {
        throwError(
          'FX rate currencies must differ',
          HttpStatusCode.BadRequest,
          { baseCurrency: payload.baseCurrency, quoteCurrency: payload.quoteCurrency },
        );
      }

      const rate = this.#getValidatedAmount(payload.rate, 'rate');
      const effectiveAt = toTimestamp(payload.effectiveAt);
      const existingFxRate = await this.repository.findFxRateByPairAndEffectiveAt(
        payload.baseCurrency,
        payload.quoteCurrency,
        effectiveAt,
        trx,
      );

      if (existingFxRate) {
        throwError(
          'FX rate already exists for this currency pair and timestamp',
          HttpStatusCode.Conflict,
          {
            baseCurrency: payload.baseCurrency,
            quoteCurrency: payload.quoteCurrency,
            effectiveAt,
          },
        );
      }

      const createdAt = toTimestamp(this.now());
      const fxRate = await this.repository.createFxRate({
        baseCurrency: payload.baseCurrency,
        quoteCurrency: payload.quoteCurrency,
        rate,
        effectiveAt,
        createdAt,
      }, trx);

      return this.#buildFxRateResponse(fxRate);
    });
  }

  async createReservation(programExternalId, payload, {
    source = CapacityEventSource.Api,
    occurredAt,
    trx,
  } = {}) {
    return this.#withTransaction(trx, async (trx) => {
      const { program, balance } = await this.getProgramState(programExternalId, trx, { lockBalance: true });
      const invoiceAmount = this.#getValidatedAmount(payload.amount);

      const existingReservation = await this.repository.findReservationByProgramAndInvoice(
        program.id,
        payload.invoiceId,
        trx,
      );

      if (existingReservation) {
        throwError(
          'Reservation already exists for this program and invoice',
          HttpStatusCode.Conflict,
          { programId: program.externalId, invoiceId: payload.invoiceId },
        );
      }

      const reservationOccurredAt = toTimestamp(occurredAt || this.now());
      const { amount, fxRateId } = await this.#resolveReservationAmount({
        program,
        invoiceAmount,
        invoiceCurrency: payload.currency,
        occurredAt: reservationOccurredAt,
        trx,
      });
      const availableAmount = balance.totalLimit - balance.reservedAmount;

      if (amount > availableAmount) {
        throwError(
          'Insufficient available capacity',
          HttpStatusCode.Conflict,
          { availableAmount, requestedAmount: amount },
        );
      }

      const reservation = await this.repository.createReservation({
        programId: program.id,
        invoiceId: payload.invoiceId,
        invoiceAmount,
        invoiceCurrency: payload.currency,
        amount,
        currency: program.currency,
        fxRateId,
        status: ReservationStatus.Reserved,
        releasedAmount: 0,
        reservedAt: reservationOccurredAt,
        createdAt: reservationOccurredAt,
        updatedAt: reservationOccurredAt,
      }, trx);

      const updatedBalance = await this.repository.updateBalance(program.id, {
        reservedAmount: balance.reservedAmount + amount,
        updatedAt: reservationOccurredAt,
      }, trx);

      await this.repository.createCapacityEvent({
        programId: program.id,
        reservationId: reservation.id,
        eventType: CapacityEventType.ReservationCreated,
        source,
        invoiceId: payload.invoiceId,
        amount,
        currency: program.currency,
        occurredAt: reservationOccurredAt,
        createdAt: reservationOccurredAt,
      }, trx);

      return {
        reservation: this.#buildReservationResponse(program, reservation),
        capacity: this.#buildCapacityResponse(program, updatedBalance),
      };
    });
  }

  async releaseReservation(programExternalId, invoiceId, {
    source = CapacityEventSource.Api,
    occurredAt,
    trx,
  } = {}) {
    return this.#withTransaction(trx, async (trx) => {
      const { program, balance } = await this.getProgramState(programExternalId, trx, { lockBalance: true });
      const reservation = await this.repository.findReservationByProgramAndInvoiceForUpdate(
        program.id,
        invoiceId,
        trx,
      );

      if (!reservation) {
        throwError('Reservation not found', HttpStatusCode.NotFound, {
          programId: programExternalId,
          invoiceId,
        });
      }

      if (reservation.status !== ReservationStatus.Reserved) {
        throwError(
          'Only reserved reservations can be released',
          HttpStatusCode.Conflict,
          { programId: programExternalId, invoiceId, status: reservation.status },
        );
      }

      const amount = reservation.amount;
      const releaseOccurredAt = toTimestamp(occurredAt || this.now());
      const updatedReservation = await this.repository.updateReservation(reservation.id, {
        status: ReservationStatus.Released,
        releasedAmount: amount,
        releasedAt: releaseOccurredAt,
        updatedAt: releaseOccurredAt,
      }, trx);
      const updatedBalance = await this.repository.updateBalance(program.id, {
        reservedAmount: balance.reservedAmount - amount,
        updatedAt: releaseOccurredAt,
      }, trx);

      await this.repository.createCapacityEvent({
        programId: program.id,
        reservationId: reservation.id,
        eventType: CapacityEventType.ReservationReleased,
        source,
        invoiceId: reservation.invoiceId,
        amount,
        currency: program.currency,
        occurredAt: releaseOccurredAt,
        createdAt: releaseOccurredAt,
      }, trx);

      return {
        reservation: this.#buildReservationResponse(program, updatedReservation),
        capacity: this.#buildCapacityResponse(program, updatedBalance),
      };
    });
  }

  // Reconciliation corrects the balance projection; reservation history remains unchanged.
  async reconcileProgramSnapshot(programExternalId, payload, {
    source = CapacityEventSource.Reconciliation,
    occurredAt,
    trx,
  } = {}) {
    return this.#withTransaction(trx, async (trx) => {
      const { program } = await this.getProgramState(programExternalId, trx, { lockBalance: true });
      const totalLimit = this.#getValidatedAmount(payload.totalLimit, 'totalLimit');
      const reservedAmount = this.#getValidatedNonNegativeAmount(payload.reservedAmount, 'reservedAmount');

      if (payload.currency !== program.currency) {
        throwError(
          'Reconciliation currency must match program currency',
          HttpStatusCode.UnprocessableEntity,
          { programId: programExternalId, expectedCurrency: program.currency, receivedCurrency: payload.currency },
        );
      }

      if (reservedAmount > totalLimit) {
        throwError(
          'reservedAmount must not exceed totalLimit',
          HttpStatusCode.BadRequest,
          { totalLimit, reservedAmount },
        );
      }

      const reconciliationOccurredAt = toTimestamp(occurredAt || payload.occurredAt || this.now());
      const updatedBalance = await this.repository.updateBalance(program.id, {
        totalLimit,
        reservedAmount,
        updatedAt: reconciliationOccurredAt,
      }, trx);

      await this.repository.createCapacityEvent({
        programId: program.id,
        reservationId: null,
        eventType: CapacityEventType.ReconciliationApplied,
        source,
        invoiceId: null,
        amount: reservedAmount,
        currency: program.currency,
        occurredAt: reconciliationOccurredAt,
        createdAt: reconciliationOccurredAt,
      }, trx);

      return {
        capacity: this.#buildCapacityResponse(program, updatedBalance),
      };
    });
  }

  async getProgramState(programExternalId, trx, { lockBalance = false } = {}) {
    const program = await this.repository.findProgramByExternalId(programExternalId, trx);

    if (!program) {
      throwError('Program not found', HttpStatusCode.NotFound, { programId: programExternalId });
    }

    const balance = lockBalance
      ? await this.repository.findBalanceByProgramIdForUpdate(program.id, trx)
      : await this.repository.findBalanceByProgramId(program.id, trx);

    if (!balance) {
      throwError('Program capacity balance not found', HttpStatusCode.NotFound, {
        programId: programExternalId,
      });
    }

    return { program, balance };
  }

  #withTransaction(trx, callback) {
    return trx ? callback(trx) : this.repository.withTransaction(callback);
  }

  #getValidatedAmount(amount, fieldName = 'amount') {
    const numericAmount = toAmount(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throwError(`${fieldName} must be positive`, HttpStatusCode.BadRequest, { [fieldName]: amount });
    }

    return numericAmount;
  }

  #getValidatedNonNegativeAmount(amount, fieldName) {
    const numericAmount = toAmount(amount);

    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      throwError(`${fieldName} must be non-negative`, HttpStatusCode.BadRequest, { [fieldName]: amount });
    }

    return numericAmount;
  }

  async #resolveReservationAmount({
    program,
    invoiceAmount,
    invoiceCurrency,
    occurredAt,
    trx,
  }) {
    if (invoiceCurrency === program.currency) {
      return {
        amount: invoiceAmount,
        fxRateId: null,
      };
    }

    const fxRate = await this.repository.findLatestFxRate(invoiceCurrency, program.currency, occurredAt, trx);

    if (!fxRate) {
      throwError(
        'No usable FX rate found for reservation currency',
        HttpStatusCode.UnprocessableEntity,
        { baseCurrency: invoiceCurrency, quoteCurrency: program.currency, effectiveAt: occurredAt },
      );
    }

    return {
      amount: this.#roundMoney(invoiceAmount * fxRate.rate),
      fxRateId: fxRate.id,
    };
  }

  #roundMoney(amount) {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
  }

  #buildProgramResponse(program) {
    return {
      id: program.id,
      externalId: program.externalId,
      currency: program.currency,
      createdAt: toTimestamp(program.createdAt),
      updatedAt: toTimestamp(program.updatedAt),
    };
  }

  #buildCapacityResponse(program, balance) {
    return {
      programId: program.externalId,
      currency: program.currency,
      totalLimit: balance.totalLimit,
      reservedAmount: balance.reservedAmount,
      availableAmount: balance.totalLimit - balance.reservedAmount,
      updatedAt: toTimestamp(balance.updatedAt),
    };
  }

  #buildReservationResponse(program, reservation) {
    return {
      id: reservation.id,
      programId: program.externalId,
      invoiceId: reservation.invoiceId,
      invoiceAmount: reservation.invoiceAmount ?? reservation.amount,
      invoiceCurrency: reservation.invoiceCurrency ?? reservation.currency,
      amount: reservation.amount,
      currency: reservation.currency,
      fxRateId: reservation.fxRateId ?? null,
      status: reservation.status,
      releasedAmount: reservation.releasedAmount,
      reservedAt: toTimestamp(reservation.reservedAt),
      releasedAt: toTimestamp(reservation.releasedAt),
      createdAt: toTimestamp(reservation.createdAt),
      updatedAt: toTimestamp(reservation.updatedAt),
    };
  }

  #buildFxRateResponse(fxRate) {
    return {
      id: fxRate.id,
      baseCurrency: fxRate.baseCurrency,
      quoteCurrency: fxRate.quoteCurrency,
      rate: fxRate.rate,
      effectiveAt: toTimestamp(fxRate.effectiveAt),
      createdAt: toTimestamp(fxRate.createdAt),
    };
  }
}

export const capacityService = new CapacityService();
