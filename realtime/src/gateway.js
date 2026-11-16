// Modo gateway: consume los tópicos de Kafka y envía los avisos de cambio a
// los navegadores conectados por Server-Sent Events.

import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { affectsAccess, canReceive, toClientEvent } from './audience.js';
import { TicketError, verifyTicket } from './ticket.js';

export class ConnectionHub {
  constructor({ maxConnections, maxConnectionsPerUser }) {
    this.maxConnections = maxConnections;
    this.maxConnectionsPerUser = maxConnectionsPerUser;
    this.connections = new Map();
    // Tickets ya usados (firma → vencimiento): un ticket abre una sola conexión.
    this.usedTickets = new Map();
  }

  countFor(uid) {
    let count = 0;
    for (const connection of this.connections.values()) if (connection.uid === uid) count++;
    return count;
  }

  /** Marca el ticket como usado; false si ya se había usado. */
  consumeTicket(ticket, exp) {
    const now = Math.floor(Date.now() / 1000);
    for (const [signature, expiry] of this.usedTickets) if (expiry < now) this.usedTickets.delete(signature);

    const signature = ticket.slice(ticket.lastIndexOf('.') + 1);
    if (this.usedTickets.has(signature)) return false;
    this.usedTickets.set(signature, exp);
    return true;
  }

  add(connection) {
    this.connections.set(connection.id, connection);
  }

  remove(id) {
    this.connections.delete(id);
  }

  /** Entrega un evento de Kafka a las conexiones que pueden recibirlo. */
  dispatch(event) {
    let delivered = 0;
    for (const connection of this.connections.values()) {
      if (affectsAccess(event, connection)) {
        // Cambió el acceso de esta persona: que el navegador revise su
        // sesión y vuelva a conectarse con un ticket nuevo.
        connection.send('access', { type: event.type });
        connection.close();
        continue;
      }
      if (canReceive(event, connection)) {
        connection.send('change', toClientEvent(event), event.event_id);
        delivered++;
      }
    }
    return delivered;
  }

  closeAll() {
    for (const connection of this.connections.values()) connection.close();
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createGatewayServer(config, hub, log, isReady = () => true) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://gateway.local');

    if (req.method === 'GET' && url.pathname === '/realtime/health') {
      return isReady()
        ? json(res, 200, { status: 'ok', connections: hub.connections.size })
        : json(res, 503, { status: 'starting' });
    }

    if (req.method !== 'GET' || url.pathname !== '/realtime/stream') {
      return json(res, 404, { message: 'No encontrado.', code: 'not_found' });
    }

    const ticket = url.searchParams.get('ticket');
    let claims;
    try {
      claims = verifyTicket(ticket, config.gateway.secret);
    } catch (error) {
      const code = error instanceof TicketError ? error.code : 'invalid_ticket';
      return json(res, code === 'not_configured' ? 503 : 401, { message: 'No autorizado.', code });
    }

    if (!hub.consumeTicket(ticket, claims.exp)) {
      return json(res, 401, { message: 'No autorizado.', code: 'ticket_reused' });
    }
    if (hub.connections.size >= config.gateway.maxConnections || hub.countFor(claims.uid) >= config.gateway.maxConnectionsPerUser) {
      return json(res, 429, { message: 'Demasiadas conexiones abiertas.', code: 'too_many_connections' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx no debe acumular el flujo
    });
    res.flushHeaders?.();

    const id = randomUUID();
    let closed = false;

    const connection = {
      id,
      uid: claims.uid,
      scopes: claims.scopes,
      send(event, data, eventId) {
        if (closed) return;
        res.write(`${eventId ? `id: ${eventId}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
      close() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        hub.remove(id);
        res.end();
      },
    };

    // El navegador reintenta a los 3 s si se corta la conexión.
    res.write('retry: 3000\n\n');
    connection.send('ready', { modules: [...claims.scopes] });

    const heartbeat = setInterval(() => !closed && res.write(': ping\n\n'), config.gateway.heartbeatMs);
    // Al cumplir su vida máxima se pide un ticket nuevo (Laravel revisa de
    // nuevo la sesión y los permisos).
    const lifetime = setTimeout(() => {
      connection.send('reconnect', {});
      connection.close();
    }, Math.max(1000, claims.sx * 1000 - Date.now()));

    req.on('close', () => connection.close());
    hub.add(connection);
    log('debug', 'Conexión abierta', { uid: claims.uid, connections: hub.connections.size });
  });
}

export async function runGateway(config, kafka, log) {
  if (!config.gateway.secret || config.gateway.secret.length < 32) {
    throw new Error('NOVA_REALTIME_SECRET (mínimo 32 caracteres) es obligatorio en modo gateway.');
  }

  const hub = new ConnectionHub(config.gateway);
  let ready = false;
  const server = createGatewayServer(config, hub, log, () => ready);
  // Las conexiones SSE son largas: sin límite de tiempo por solicitud.
  server.requestTimeout = 0;
  server.headersTimeout = 10_000;

  await new Promise((resolve) => server.listen(config.gateway.port, resolve));
  log('info', 'Gateway escuchando', { port: config.gateway.port });

  const consumer = kafka.consumer({ groupId: config.gateway.groupId, allowAutoTopicCreation: false });
  await consumer.connect();
  await consumer.subscribe({ topics: config.topics, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      let event;
      try {
        event = JSON.parse(message.value.toString('utf8'));
      } catch {
        log('warn', 'Mensaje ignorado: no es JSON', { topic, offset: message.offset });
        return;
      }
      hub.dispatch(event);
    },
  });
  ready = true;
  log('info', 'Gateway suscrito a Kafka', { topics: config.topics, groupId: config.gateway.groupId });

  return {
    async close() {
      ready = false;
      hub.closeAll();
      await new Promise((resolve) => server.close(resolve));
      await consumer.disconnect();
    },
  };
}
