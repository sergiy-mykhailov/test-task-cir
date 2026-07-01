import Joi from 'joi';

export default [
  {
    method: 'GET',
    path: '/ping',
    options: {
      handler: () => 'pong',
      description: 'Health check ping',
      response: {
        failAction: 'log',
        status: {
          200: Joi.string(),
        },
      },
    },
  },
];
