// Configuración del servicio realtime. Todo llega por variables de entorno;
// los valores por defecto sirven para desarrollo local.

import os from 'node:os';

/** Módulos del ERP que publican eventos (mismos que DomainEventRecorder). */
export const MODULES = ['clients', 'projects', 'timesheets', 'users', 'access_control'];

function int(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function list(name, fallback) {
  const raw = process.env[name];
  return raw ? raw.split(',').map((v) => v.trim()).filter(Boolean) : fallback;
}

export function loadConfig(env = process.env) {
  const topicPrefix = env.NOVA_EVENTS_TOPIC_PREFIX || 'nova';

  return {
    kafka: {
      clientId: env.KAFKA_CLIENT_ID || 'nova-realtime',
      brokers: list('KAFKA_BROKERS', ['localhost:9092']),
      partitions: int('KAFKA_TOPIC_PARTITIONS', 3),
      replicationFactor: int('KAFKA_REPLICATION_FACTOR', 1),
    },
    topics: MODULES.map((module) => `${topicPrefix}.${module}`),
    topicPrefix,
    relay: {
      databaseUrl: env.DATABASE_URL || '',
      batchSize: int('RELAY_BATCH_SIZE', 200),
      pollMs: int('RELAY_POLL_MS', 500),
      maxBackoffMs: int('RELAY_MAX_BACKOFF_MS', 30_000),
    },
    gateway: {
      port: int('PORT', 3001),
      secret: env.NOVA_REALTIME_SECRET || '',
      heartbeatMs: int('GATEWAY_HEARTBEAT_MS', 25_000),
      maxConnectionsPerUser: int('GATEWAY_MAX_CONNECTIONS_PER_USER', 10),
      maxConnections: int('GATEWAY_MAX_CONNECTIONS', 5_000),
      // Cada instancia necesita su propio grupo: todas deben recibir todos
      // los eventos para entregarlos a sus conexiones.
      groupId: env.GATEWAY_GROUP_ID || `${topicPrefix}-realtime-gateway-${os.hostname()}-${process.pid}`,
    },
  };
}
