import { Kafka, logLevel } from 'kafkajs';

export function createKafka(config, log) {
  return new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 300, retries: 10 },
    logCreator:
      () =>
      ({ level, log: entry }) => {
        const { message, ...extra } = entry;
        log(level <= logLevel.ERROR ? 'error' : 'warn', `kafka: ${message}`, extra);
      },
  });
}

/** Crea los tópicos que falten (no toca los existentes). */
export async function ensureTopics(kafka, config, log) {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const existing = new Set(await admin.listTopics());
    const missing = config.topics.filter((topic) => !existing.has(topic));
    if (missing.length) {
      await admin.createTopics({
        waitForLeaders: true,
        topics: missing.map((topic) => ({
          topic,
          numPartitions: config.kafka.partitions,
          replicationFactor: config.kafka.replicationFactor,
        })),
      });
      log('info', 'Tópicos creados', { topics: missing });
    }
  } finally {
    await admin.disconnect();
  }
}
