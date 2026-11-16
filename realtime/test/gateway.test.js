import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { affectsAccess, canReceive, toClientEvent } from '../src/audience.js';
import { ConnectionHub, createGatewayServer } from '../src/gateway.js';
import { publishBatch } from '../src/relay.js';
import { signTicket, verifyTicket } from '../src/ticket.js';

const SECRET = 'test-realtime-secret-0123456789abcdef';
const now = () => Math.floor(Date.now() / 1000);
const claims = (extra = {}) => ({ uid: 7, scopes: ['projects'], iat: now(), exp: now() + 60, sx: now() + 900, ...extra });

const event = (extra = {}) => ({
  event_id: '0193-abc',
  type: 'time_entry.created',
  module: 'timesheets',
  aggregate: { type: 'time_entry', id: 10 },
  changed: [],
  refs: { project_id: 3 },
  audience: { user_ids: [7, 9] },
  actor_id: 9,
  occurred_at: '2026-11-16T15:00:00.000000Z',
  ...extra,
});

describe('tickets', () => {
  it('acepta un ticket firmado y vigente', () => {
    const result = verifyTicket(signTicket(claims(), SECRET), SECRET);
    assert.equal(result.uid, 7);
    assert.deepEqual([...result.scopes], ['projects']);
  });

  it('rechaza firmas de otra clave', () => {
    assert.throws(() => verifyTicket(signTicket(claims(), 'otra-clave-0123456789abcdef-xxxxxx'), SECRET), { code: 'invalid_ticket' });
  });

  it('rechaza contenido alterado', () => {
    const [v, , sig] = signTicket(claims(), SECRET).split('.');
    const forged = Buffer.from(JSON.stringify(claims({ scopes: ['clients', 'users'] }))).toString('base64url');
    assert.throws(() => verifyTicket(`${v}.${forged}.${sig}`, SECRET), { code: 'invalid_ticket' });
  });

  it('rechaza tickets vencidos', () => {
    assert.throws(() => verifyTicket(signTicket(claims({ exp: now() - 1 }), SECRET), SECRET), { code: 'expired_ticket' });
  });

  it('exige una clave larga', () => {
    assert.throws(() => verifyTicket(signTicket(claims(), 'corta'), 'corta'), { code: 'not_configured' });
  });
});

describe('audiencia', () => {
  const connection = (uid, scopes = []) => ({ uid, scopes: new Set(scopes) });

  it('entrega a quien puede ver todo el módulo', () => {
    assert.equal(canReceive(event({ audience: { user_ids: [] } }), connection(1, ['timesheets'])), true);
  });

  it('entrega a las personas involucradas', () => {
    assert.equal(canReceive(event(), connection(9)), true);
  });

  it('no entrega a quien no ve el módulo ni está involucrado', () => {
    assert.equal(canReceive(event(), connection(1, ['projects'])), false);
  });

  it('detecta cambios de acceso de la propia cuenta', () => {
    assert.equal(affectsAccess(event({ type: 'user.roles_changed', module: 'users', audience: { user_ids: [7] } }), connection(7)), true);
    assert.equal(affectsAccess(event({ type: 'user.updated', changed: ['is_active'], audience: { user_ids: [7] } }), connection(7)), true);
    assert.equal(affectsAccess(event({ type: 'user.updated', changed: ['name'], audience: { user_ids: [7] } }), connection(7)), false);
    assert.equal(affectsAccess(event({ type: 'user.roles_changed', audience: { user_ids: [8] } }), connection(7)), false);
  });

  it('no envía al navegador la audiencia ni el autor', () => {
    const sent = toClientEvent(event());
    assert.equal('audience' in sent, false);
    assert.equal('actor_id' in sent, false);
    assert.equal(sent.id, '0193-abc');
  });
});

describe('gateway SSE', () => {
  const config = {
    gateway: { secret: SECRET, heartbeatMs: 60_000, maxConnections: 100, maxConnectionsPerUser: 2 },
  };
  const hub = new ConnectionHub(config.gateway);
  const server = createGatewayServer(config, hub, () => {});
  let base;

  before(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    hub.closeAll();
    await new Promise((resolve) => server.close(resolve));
  });

  async function open(ticket) {
    const controller = new AbortController();
    const response = await fetch(`${base}/realtime/stream?ticket=${encodeURIComponent(ticket)}`, { signal: controller.signal });
    return { response, controller };
  }

  async function readUntil(reader, text) {
    const decoder = new TextDecoder();
    let buffer = '';
    while (!buffer.includes(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    return buffer;
  }

  it('rechaza conexiones sin ticket válido', async () => {
    const response = await fetch(`${base}/realtime/stream?ticket=v1.x.y`);
    assert.equal(response.status, 401);
  });

  it('entrega solo los eventos permitidos y no reutiliza tickets', async () => {
    const ticket = signTicket(claims({ uid: 7, scopes: [] }), SECRET);
    const { response, controller } = await open(ticket);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);

    const reader = response.body.getReader();
    await readUntil(reader, 'event: ready');

    assert.equal(hub.dispatch(event({ event_id: 'otro', audience: { user_ids: [1] } })), 0);
    assert.equal(hub.dispatch(event()), 1);
    const received = await readUntil(reader, 'event: change');
    assert.match(received, /id: 0193-abc/);
    assert.doesNotMatch(received, /audience/);

    const again = await fetch(`${base}/realtime/stream?ticket=${encodeURIComponent(ticket)}`);
    assert.equal(again.status, 401);
    assert.equal((await again.json()).code, 'ticket_reused');

    controller.abort();
  });

  it('cierra la conexión cuando cambia el acceso de la persona', async () => {
    const { response } = await open(signTicket(claims({ uid: 11, scopes: ['users'] }), SECRET));
    const reader = response.body.getReader();
    await readUntil(reader, 'event: ready');

    hub.dispatch(event({ type: 'user.roles_changed', module: 'users', audience: { user_ids: [11] } }));
    const text = await readUntil(reader, 'event: access');
    assert.match(text, /user\.roles_changed/);
    assert.equal((await reader.read()).done, true);
  });
});

describe('relay', () => {
  it('publica por tópico y marca las filas como publicadas', async () => {
    const queries = [];
    const rows = [
      { id: 1, event_id: 'e1', topic: 'nova.projects', message_key: 'project:1', type: 'project.created', payload: { a: 1 } },
      { id: 2, event_id: 'e2', topic: 'nova.clients', message_key: 'client:4', type: 'client.updated', payload: '{"b":2}' },
    ];
    const client = {
      query: async (sql, params) => {
        queries.push(sql.trim().split(/\s+/)[0]);
        return sql.includes('SELECT') ? { rows } : { rows: [] };
      },
      release: () => {},
    };
    const db = { connect: async () => client, query: async () => ({}) };
    let sent;
    const producer = { sendBatch: async (batch) => (sent = batch) };

    assert.equal(await publishBatch(db, producer, 100), 2);
    assert.deepEqual(queries, ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
    assert.equal(sent.topicMessages.length, 2);
    assert.equal(sent.topicMessages[0].messages[0].value, '{"a":1}');
    assert.equal(sent.topicMessages[1].messages[0].headers.event_id, 'e2');
  });

  it('no marca nada si Kafka falla', async () => {
    const queries = [];
    let failureUpdate;
    const client = {
      query: async (sql) => {
        queries.push(sql.trim().split(/\s+/)[0]);
        return sql.includes('SELECT') ? { rows: [{ id: 5, event_id: 'e5', topic: 't', message_key: 'k', type: 'x', payload: {} }] } : { rows: [] };
      },
      release: () => {},
    };
    const db = { connect: async () => client, query: async (sql, params) => (failureUpdate = params) };
    const producer = { sendBatch: async () => { throw new Error('broker caído'); } };

    await assert.rejects(publishBatch(db, producer, 100), /broker caído/);
    assert.deepEqual(queries, ['BEGIN', 'SELECT', 'ROLLBACK']);
    assert.deepEqual(failureUpdate, [[5], 'broker caído']);
  });
});
