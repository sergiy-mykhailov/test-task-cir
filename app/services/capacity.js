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

  async createReservation(programExternalId, payload) {
    return this.repository.withTransaction(async (trx) => {
      const { program, balance } = await this.getProgramState(programExternalId, trx);
      const amount = this.#getValidatedAmount(payload.amount);

      if (payload.currency !== program.currency) {
        throwError(
          'Reservation currency must match program currency',
          HttpStatusCode.UnprocessableEntity,
          { programCurrency: program.currency, reservationCurrency: payload.currency },
        );
      }

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

      const availableAmount = balance.totalLimit - balance.reservedAmount;

      if (amount > availableAmount) {
        throwError(
          'Insufficient available capacity',
          HttpStatusCode.Conflict,
          { availableAmount, requestedAmount: amount },
        );
      }

      const occurredAt = toTimestamp(this.now());
      const reservation = await this.repository.createReservation({
        programId: program.id,
        invoiceId: payload.invoiceId,
        amount,
        currency: payload.currency,
        status: ReservationStatus.Reserved,
        releasedAmount: 0,
        reservedAt: occurredAt,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      }, trx);

      const updatedBalance = await this.repository.updateBalance(program.id, {
        reservedAmount: balance.reservedAmount + amount,
        updatedAt: occurredAt,
      }, trx);

      await this.repository.createCapacityEvent({
        programId: program.id,
        reservationId: reservation.id,
        eventType: CapacityEventType.ReservationCreated,
        source: CapacityEventSource.Api,
        invoiceId: payload.invoiceId,
        amount,
        currency: program.currency,
        occurredAt,
        createdAt: occurredAt,
      }, trx);

      return {
        reservation: this.#buildReservationResponse(program, reservation),
        capacity: this.#buildCapacityResponse(program, updatedBalance),
      };
    });
  }

  async releaseReservation(programExternalId, invoiceId) {
    return this.repository.withTransaction(async (trx) => {
      const { program, balance } = await this.getProgramState(programExternalId, trx);
      const reservation = await this.repository.findReservationByProgramAndInvoice(
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
      const occurredAt = toTimestamp(this.now());
      const updatedReservation = await this.repository.updateReservation(reservation.id, {
        status: ReservationStatus.Released,
        releasedAmount: amount,
        releasedAt: occurredAt,
        updatedAt: occurredAt,
      }, trx);
      const updatedBalance = await this.repository.updateBalance(program.id, {
        reservedAmount: balance.reservedAmount - amount,
        updatedAt: occurredAt,
      }, trx);

      await this.repository.createCapacityEvent({
        programId: program.id,
        reservationId: reservation.id,
        eventType: CapacityEventType.ReservationReleased,
        source: CapacityEventSource.Api,
        invoiceId: reservation.invoiceId,
        amount,
        currency: program.currency,
        occurredAt,
        createdAt: occurredAt,
      }, trx);

      return {
        reservation: this.#buildReservationResponse(program, updatedReservation),
        capacity: this.#buildCapacityResponse(program, updatedBalance),
      };
    });
  }

  async getProgramState(programExternalId, trx) {
    const program = await this.repository.findProgramByExternalId(programExternalId, trx);

    if (!program) {
      throwError('Program not found', HttpStatusCode.NotFound, { programId: programExternalId });
    }

    const balance = await this.repository.findBalanceByProgramId(program.id, trx);

    if (!balance) {
      throwError('Program capacity balance not found', HttpStatusCode.NotFound, {
        programId: programExternalId,
      });
    }

    return { program, balance };
  }

  #getValidatedAmount(amount, fieldName = 'amount') {
    const numericAmount = toAmount(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throwError(`${fieldName} must be positive`, HttpStatusCode.BadRequest, { [fieldName]: amount });
    }

    return numericAmount;
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
      amount: reservation.amount,
      currency: reservation.currency,
      status: reservation.status,
      releasedAmount: reservation.releasedAmount,
      reservedAt: toTimestamp(reservation.reservedAt),
      releasedAt: toTimestamp(reservation.releasedAt),
      createdAt: toTimestamp(reservation.createdAt),
      updatedAt: toTimestamp(reservation.updatedAt),
    };
  }
}

export const capacityService = new CapacityService();
