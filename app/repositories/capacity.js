import { transaction } from 'objection';
import CapacityEvents from '../models/capacity-events.js';
import FxRates from '../models/fx-rates.js';
import ProgramCapacityBalances from '../models/program-capacity-balances.js';
import Programs from '../models/programs.js';
import Reservations from '../models/reservations.js';

export default class CapacityRepository {
  constructor({
    programsModel = Programs,
    balancesModel = ProgramCapacityBalances,
    reservationsModel = Reservations,
    capacityEventsModel = CapacityEvents,
    fxRatesModel = FxRates,
  } = {}) {
    this.programsModel = programsModel;
    this.balancesModel = balancesModel;
    this.reservationsModel = reservationsModel;
    this.capacityEventsModel = capacityEventsModel;
    this.fxRatesModel = fxRatesModel;
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

  findBalanceByProgramIdForUpdate(programId, trx) {
    return this.balancesModel.query(trx).findById(programId).forUpdate();
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

  findReservationByProgramAndInvoiceForUpdate(programId, invoiceId, trx) {
    return this.reservationsModel.query(trx).findOne({ programId, invoiceId }).forUpdate();
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

  findFxRateByPairAndEffectiveAt(baseCurrency, quoteCurrency, effectiveAt, trx) {
    return this.fxRatesModel.query(trx).findOne({ baseCurrency, quoteCurrency, effectiveAt });
  }

  findLatestFxRate(baseCurrency, quoteCurrency, effectiveAt, trx) {
    return this.fxRatesModel.query(trx)
      .where({ baseCurrency, quoteCurrency })
      .where('effectiveAt', '<=', effectiveAt)
      .orderBy('effectiveAt', 'desc')
      .orderBy('id', 'desc')
      .first();
  }

  createFxRate(data, trx) {
    return this.fxRatesModel.query(trx).insert(data).returning('*');
  }
}
