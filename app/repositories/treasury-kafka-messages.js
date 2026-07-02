import { transaction } from 'objection';
import TreasuryKafkaMessages from '../models/treasury-kafka-messages.js';

export default class TreasuryKafkaMessagesRepository {
  constructor({
    treasuryKafkaMessagesModel = TreasuryKafkaMessages,
  } = {}) {
    this.treasuryKafkaMessagesModel = treasuryKafkaMessagesModel;
  }

  withTransaction(callback) {
    return transaction(this.treasuryKafkaMessagesModel.knex(), callback);
  }

  findHandledMessage({
    messageId,
    topic,
    partition,
    messageOffset,
  }, trx) {
    return this.treasuryKafkaMessagesModel.query(trx)
      .where((builder) => {
        builder.where({ topic, partition, messageOffset });

        if (messageId) {
          builder.orWhere({ messageId });
        }
      })
      .first();
  }

  createMessage(data, trx) {
    return this.treasuryKafkaMessagesModel.query(trx).insert(data).returning('*');
  }
}
