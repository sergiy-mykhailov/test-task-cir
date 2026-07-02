import { pathToFileURL } from 'node:url';
import {
  buildReservationApprovedMessage,
  publishTreasuryMessage,
} from './kafka-producer.js';

export const start = async () => {
  const result = await publishTreasuryMessage(buildReservationApprovedMessage());

  return `Produced ${result.payload.eventType} message ${result.payload.messageId} to ${result.topic} with key ${result.key}.`;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start()
    .then((message) => {
      console.log(message);
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
