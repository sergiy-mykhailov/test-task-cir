import * as validator from '../validators/capacity.js';
import { CapacityHandler } from '../handlers/capacity.js';

export default [
  {
    method: 'POST',
    path: '/programs',
    options: {
      handler: CapacityHandler.createProgram,
      description: 'Create financing program with initial capacity balance',
      validate: validator.createProgram.req,
      response: {
        failAction: 'log',
        status: {
          201: validator.createProgram.res,
        },
      },
    },
  },
  {
    method: 'GET',
    path: '/programs/{programId}/capacity',
    options: {
      handler: CapacityHandler.getCapacity,
      description: 'Read current program capacity',
      validate: validator.getCapacity.req,
      response: {
        failAction: 'log',
        status: {
          200: validator.getCapacity.res,
        },
      },
    },
  },
  {
    method: 'POST',
    path: '/programs/{programId}/reservations',
    options: {
      handler: CapacityHandler.createReservation,
      description: 'Create invoice capacity reservation',
      validate: validator.createReservation.req,
      response: {
        failAction: 'log',
        status: {
          201: validator.createReservation.res,
        },
      },
    },
  },
  {
    method: 'POST',
    path: '/programs/{programId}/invoices/{invoiceId}/release',
    options: {
      handler: CapacityHandler.releaseReservation,
      description: 'Release an invoice capacity reservation after repayment',
      validate: validator.releaseReservation.req,
      response: {
        failAction: 'log',
        status: {
          200: validator.releaseReservation.res,
        },
      },
    },
  },
];
