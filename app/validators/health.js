import Joi from 'joi';

export const getHealth = {
  res: Joi.object({
    status: Joi.string().valid('ok').required(),
    database: Joi.string().valid('ok').required(),
  }).required(),
};
