import { transaction } from 'objection';
import CapacityEvents from '../models/capacity-events.js';
import ProgramCapacityBalances from '../models/program-capacity-balances.js';
import Programs from '../models/programs.js';
import Reservations from '../models/reservations.js';

export default class CapacityRepository {
  constructor({
    programsModel = Programs,
    balancesModel = ProgramCapacityBalances,
    reservationsModel = Reservations,
    capacityEventsModel = CapacityEvents,
  } = {}) {
    this.programsModel = programsModel;
    this.balancesModel = balancesModel;
    this.reservationsModel = reservationsModel;
    this.capacityEventsModel = capacityEventsModel;
  }

  withTransaction(callback) {
    return transaction(this.programsModel.knex(), callback);
  }

  findProgramByExternalId(externalId, trx) {
    return this.programsModel.query(trx).findOne({ externalId });
  }

  findProgramById(id, trx) {
    return this.programsModel.query(trx).findById(id);
  }

  createProgram(data, trx) {
    return this.programsModel.query(trx).insert(data).returning('*');
  }

  findBalanceByProgramId(programId, trx) {
    return this.balancesModel.query(trx).findById(programId);
  }

  createBalance(data, trx) {
    return this.balancesModel.query(trx).insert(data).returning('*');
  }

  updateBalance(programId, patch, trx) {
    return this.balancesModel.query(trx).patchAndFetchById(programId, patch);
  }

  findReservationByProgramAndInvoice(programId, invoiceId, trx) {
    return this.reservationsModel.query(trx).findOne({ programId, invoiceId });
  }

  createReservation(data, trx) {
    return this.reservationsModel.query(trx).insert(data).returning('*');
  }

  updateReservation(id, patch, trx) {
    return this.reservationsModel.query(trx).patchAndFetchById(id, patch);
  }

  createCapacityEvent(data, trx) {
    return this.capacityEventsModel.query(trx).insert(data).returning('*');
  }
}
