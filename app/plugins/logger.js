import HapiPino from 'hapi-pino';
import { isProd } from '../constants/env.js';

const prettyPrintProps = isProd
  ? {
    singleLine: true,
  }
  : {
    base: null,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'req,req.headers,res,res.headers,id,responseTime,payload',
      },
    },
  };

export default {
  plugin: HapiPino,
  options: {
    ignorePaths: ['/health'],
    logPayload: true,
    logRouteTags: true,
    redact: ['req.headers.authorization'],
    ...prettyPrintProps,
  },
};
