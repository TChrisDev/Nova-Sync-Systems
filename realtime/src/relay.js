// Modo relay: publica en Kafka los eventos pendientes de outbox_events.
//
// Entrega "al menos una vez": si el proceso cae después de publicar y antes
// de marcar la fila, el evento se publica de nuevo. Los consumidores
// deduplican con event_id. Para conservar el orden por agregado debe
// correr una sola réplica del relay.

import pg from 'pg';
import { ensureTopics } from './kafka.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function publishBatch(db, producer, batchSize) {
  const client = await db.connect();
  let rows = [];
  try {
    await client.query('BEGIN');
    ({ rows } = await client.query(
      `SELECT id, event_id, topic, message_key, type, payload
         FROM outbox_events
        WHERE published_at IS NULL
        ORDER BY id
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [batchSize],
    ));

    if (rows.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    const byTopic = new Map();
    for (const row of rows) {
      const payload = typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);
      if (!byTopic.has(row.topic)) byTopic.set(row.topic, []);
      byTopic.get(row.topic).push({
        key: row.message_key,
        value: payload,
        headers: { event_id: row.event_id, type: row.type, content_type: 'application/json' },
      });
    }

    await producer.sendBatch({
      topicMessages: [...byTopic].map(([topic, messages]) => ({ topic, messages })),
    });

    await client.query(
      `UPDATE outbox_events
          SET published_at = now(), attempts = attempts + 1, last_error = NULL
        WHERE id = ANY($1::bigint[])`,
      [rows.map((row) => row.id)],
    );
    await client.query('COMMIT');

    return rows.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (rows.length) {
      await db
        .query(
          `UPDATE outbox_events SET attempts = attempts + 1, last_error = $2 WHERE id = ANY($1::bigint[])`,
          [rows.map((row) => row.id), String(error.message).slice(0, 500)],
        )
        .catch(() => {});
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function runRelay(config, kafka, log) {
  // DATABASE_URL o las variables estándar de PostgreSQL (PGHOST, PGUSER,
  // PGPASSWORD, PGDATABASE...), que evitan escapar la contraseña en una URL.
  if (!config.relay.databaseUrl && !process.env.PGHOST) {
    throw new Error('Define DATABASE_URL o PGHOST/PGUSER/PGPASSWORD/PGDATABASE en modo relay.');
  }

  const db = new pg.Pool({ ...(config.relay.databaseUrl ? { connectionString: config.relay.databaseUrl } : {}), max: 2 });
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1, allowAutoTopicCreation: false });

  await ensureTopics(kafka, config, log);
  await producer.connect();
  log('info', 'Relay listo', { brokers: config.kafka.brokers, topics: config.topics });

  let stopping = false;
  const stop = async () => {
    stopping = true;
  };

  const loop = (async () => {
    let backoff = config.relay.pollMs;
    while (!stopping) {
      try {
        const published = await publishBatch(db, producer, config.relay.batchSize);
        backoff = config.relay.pollMs;
        if (published > 0) {
          log('debug', 'Eventos publicados', { count: published });
          continue; // puede haber más pendientes
        }
        await sleep(config.relay.pollMs);
      } catch (error) {
        log('error', 'No se pudo publicar en Kafka; se reintentará', { error: error.message, retryInMs: backoff });
        await sleep(backoff);
        backoff = Math.min(backoff * 2, config.relay.maxBackoffMs);
      }
    }
  })();

  return {
    async close() {
      await stop();
      await loop;
      await producer.disconnect();
      await db.end();
    },
  };
}
