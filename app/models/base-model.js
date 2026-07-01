import { Model, AjvValidator } from 'objection';

export default class BaseModel extends Model {
  constructor() {
    super();
  }

  static createValidator() {
    return new AjvValidator({
      onCreateAjv: () => {
        // Here you can modify the `Ajv` instance.
      },
      options: {
        removeAdditional: true,
        allowUnionTypes: true,
      },
    });
  }
}
