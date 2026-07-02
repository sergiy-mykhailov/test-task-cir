import Joi from 'joi';
import { ReservationStatus } from '../constants/capacity.js';

const programIdParam = Joi.object({
  programId: Joi.string().trim().min(1).max(255).required(),
}).required();

const invoiceReleaseParam = Joi.object({
  programId: Joi.string().trim().min(1).max(255).required(),
  invoiceId: Joi.string().trim().min(1).max(255).required(),
}).required();

const amount = Joi.number().positive().required();
const currency = Joi.string().trim().uppercase().length(3).required();
const timestamp = Joi.string().isoDate().required();
const nullableTimestamp = Joi.string().isoDate().allow(null).required();

const capacityResponse = Joi.object({
  programId: Joi.string().required(),
  currency: Joi.string().length(3).required(),
  totalLimit: Joi.number().min(0).required(),
  reservedAmount: Joi.number().min(0).required(),
  availableAmount: Joi.number().min(0).required(),
  updatedAt: timestamp,
}).required();

const programResponse = Joi.object({
  id: Joi.number().integer().positive().required(),
  externalId: Joi.string().required(),
  currency: Joi.string().length(3).required(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).required();

const reservationResponse = Joi.object({
  id: Joi.number().integer().positive().required(),
  programId: Joi.string().required(),
  invoiceId: Joi.string().required(),
  invoiceAmount: Joi.number().positive().required(),
  invoiceCurrency: Joi.string().length(3).required(),
  amount: Joi.number().positive().required(),
  currency: Joi.string().length(3).required(),
  fxRateId: Joi.number().integer().positive().allow(null).required(),
  status: Joi.string().valid(...Object.values(ReservationStatus)).required(),
  releasedAmount: Joi.number().min(0).required(),
  reservedAt: timestamp,
  releasedAt: nullableTimestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
}).required();

const reservationResultResponse = Joi.object({
  reservation: reservationResponse,
  capacity: capacityResponse,
}).required();

const fxRateResponse = Joi.object({
  id: Joi.number().integer().positive().required(),
  baseCurrency: Joi.string().length(3).required(),
  quoteCurrency: Joi.string().length(3).required(),
  rate: Joi.number().positive().required(),
  effectiveAt: timestamp,
  createdAt: timestamp,
}).required();

export const createProgram = {
  req: {
    payload: Joi.object({
      externalId: Joi.string().trim().min(1).max(255).required(),
      currency,
      totalLimit: amount,
    }).required(),
  },
  res: Joi.object({
    program: programResponse,
    capacity: capacityResponse,
  }).required(),
};

export const createFxRate = {
  req: {
    payload: Joi.object({
      baseCurrency: currency,
      quoteCurrency: currency,
      rate: amount,
      effectiveAt: timestamp,
    }).required(),
  },
  res: fxRateResponse,
};

export const getCapacity = {
  req: {
    params: programIdParam,
  },
  res: capacityResponse,
};

export const createReservation = {
  req: {
    params: programIdParam,
    payload: Joi.object({
      invoiceId: Joi.string().trim().min(1).max(255).required(),
      amount,
      currency,
    }).required(),
  },
  res: reservationResultResponse,
};

export const releaseReservation = {
  req: {
    params: invoiceReleaseParam,
  },
  res: reservationResultResponse,
};
