import pino from 'pino';
import pretty from 'pino-pretty';
import { isProd } from '../constants/env.js';

const prefixOptions = {
  messageFormat: '[{prefix}] {msg}',
  ignore: 'prefix',
};

export const logger = !isProd
  ? pino({ level: 'debug', base: null }, pretty({ colorize: true, colorizeObjects: true, ...prefixOptions }))
  : pino({ level: 'info' }, pretty(prefixOptions));
