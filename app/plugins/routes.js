import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import lodash from 'lodash';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.resolve(path.dirname(__filename), '../routes');

const validateRoutesFilenames = (fileName) =>
  fileName.indexOf('.') !== 0
  && fileName !== 'index.js'
  && fileName.slice(-3) === '.js'
  && !fileName.endsWith('.test.js');

const register = async (server) => {
  const fileNames = fs.readdirSync(__dirname)
    .filter(validateRoutesFilenames);

  for (let index = 0; index < fileNames.length; index++) {
    const fileName = fileNames[index];

    const routeName = fileName.split('.')[0];
    server.logger.info(`[routes] Init route: ${routeName}`);

    try {
      const { default: module } = await import(path.join(__dirname, fileName));

      if (!module || lodash.isEmpty(module)) {
        continue;
      }

      module.forEach((route) => {
        server.route(route);
      });
    } catch (err) {
      server.logger.error(err);
    }
  }
};

export default {
  name: 'routes',
  version: '0.0.1',
  register,
};
