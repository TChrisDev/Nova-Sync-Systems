# Kafka: eventos de dominio y tiempo real

Cada cambio de negocio del ERP (clientes, contratos, proyectos, asignaciones, horas, usuarios, roles) se publica como un **evento en Apache Kafka**. Con esos eventos:

1. **Las pantallas se actualizan solas.** Si alguien aprueba horas o cambia un proyecto, quien tenga esa vista abierta lo ve en segundos, sin recargar.
2. **Otros sistemas se sincronizan.** Facturación, BI, otra sede o un data lake pueden suscribirse a los tópicos en lugar de consultar la base de datos.

```
 Laravel (API)                          servicio realtime                 Navegador
 ─────────────                          ─────────────────                 ─────────
 servicio de negocio ── transacción ──┐
   cambio en la tabla                 │
   fila en outbox_events  ◄───────────┘
                                         relay ── SELECT … FOR UPDATE ──►
                                               ── produce ──► Kafka  nova.<módulo>
                                                                 │
                                         gateway ◄── consume ────┘
                                               ── Server-Sent Events ──────► /realtime/stream
                                                                               (aviso de cambio)
                                                                             la vista vuelve a pedir
                                                                             el dato a /api/v1/...
```

## 1. Por qué una bandeja de salida (outbox)

Laravel no le habla a Kafka directamente. El evento se escribe en la tabla `outbox_events` **en la misma transacción** que el cambio (`DomainEventObserver` → `DomainEventRecorder`):

- Si la transacción se revierte, el evento desaparece con ella: nunca se anuncia un cambio que no ocurrió.
- Si Kafka está caído, el evento espera en la tabla y se publica cuando vuelva: no se pierden cambios.
- PHP no necesita la extensión `rdkafka`, y una petición web nunca espera a Kafka.

El **relay** (`realtime/`, modo `relay`) lee los pendientes con `FOR UPDATE SKIP LOCKED`, los publica con un productor idempotente y los marca con `published_at`. La entrega es **al menos una vez**: si el relay cae justo después de publicar, el evento se publica de nuevo. Los consumidores deduplican con `event_id`.

Para conservar el orden por registro, corre **una sola réplica del relay**. Los mensajes llevan como clave `tipo:id` (por ejemplo `project:42`), así que todos los eventos de un mismo registro caen en la misma partición y en orden.

`nova:outbox-prune` (programado a diario a las 3:30 a. m.) borra de la tabla los eventos publicados hace más de `NOVA_EVENTS_RETENTION_DAYS` días. Los pendientes nunca se borran.

## 2. Tópicos y formato

| Tópico | Eventos |
| --- | --- |
| `nova.clients` | `client.*`, `client_contact.*`, `contract.*`, `contract_hour_movement.created` |
| `nova.projects` | `project.*`, `allocation.*`, `staff_profile.*` |
| `nova.timesheets` | `time_entry.*` |
| `nova.users` | `user.*`, `user.roles_changed` |
| `nova.access_control` | `role.*`, `role.permissions_changed` |
| `nova.notifications` | `notification.created` (solo para su destinatario; la campana se actualiza sola) |

`*` = `created`, `updated`, `deleted` y, para usuarios, `restored`. El prefijo se cambia con `NOVA_EVENTS_TOPIC_PREFIX`.

Mensaje (valor en JSON; cabeceras `event_id`, `type` y `content_type`):

```json
{
  "schema_version": 1,
  "event_id": "019a8f2c-7d1e-7c3a-9b1f-2a6e4c0d9e11",
  "type": "time_entry.updated",
  "module": "timesheets",
  "aggregate": { "type": "time_entry", "id": 5812 },
  "changed": ["status", "reviewed_by", "reviewed_at"],
  "refs": { "project_id": 12, "user_id": 31 },
  "audience": { "user_ids": [31, 7] },
  "actor_id": 7,
  "occurred_at": "2026-11-16T20:14:03.512345Z"
}
```

**Los eventos son avisos, no copias de los datos.** Llevan qué cambió (los nombres de los campos, nunca sus valores), el identificador, las referencias a los registros padre y las personas involucradas. Los costos internos (`hourly_cost`, `cost_rate`) no aparecen ni siquiera como nombre de campo. Un sistema que necesite el dato lo pide a la API con sus propias credenciales, y la API aplica los permisos de siempre.

Para agregar un modelo: inclúyelo en `DomainEventRecorder::MODELS` con su nombre de agregado y su módulo, y si hace falta en `refs()` e `involvedUsers()`. Los cambios en tablas pivote (roles de un usuario, permisos de un rol) no los ve Eloquent, por eso se registran explícitamente en sus servicios.

## 3. Tiempo real en el navegador

1. Al entrar al panel, el navegador pide `POST /api/v1/realtime/ticket` (requiere sesión y CSRF). Laravel firma con HMAC-SHA256 y `NOVA_REALTIME_SECRET` un ticket con el usuario, los módulos que puede seguir completos y dos vencimientos: 60 s para conectarse y 15 min de vida de la conexión.
2. El navegador abre `GET /realtime/stream?ticket=…` (Server-Sent Events). El **gateway** (`realtime/`, modo `gateway`) verifica la firma y rechaza tickets vencidos o ya usados. nginx no registra esa URL en sus logs.
3. Cada evento de Kafka se envía a una conexión solo si:
   - la persona puede ver todo el módulo (`clients.view`, `projects.view`, `timesheets.view` o `timesheets.approve_any`, `users.view`, `access_control.view`), **o**
   - aparece en `audience.user_ids`: el dueño de las horas o de la asignación, el líder del proyecto o la propia cuenta.

   Al navegador no llegan ni `audience` ni `actor_id`.
4. La página que tiene abierta ese módulo vuelve a pedir sus datos a la API. Usa `useApiResource(..., { live: ['projects'] })`, que agrupa ráfagas de avisos en una sola petición y no muestra el indicador de carga.
5. Si cambian los roles o permisos de la persona, o la desactivan, el gateway le envía `access` y cierra la conexión. El navegador recarga `/me` y pide un ticket nuevo. Si la cuenta ya no está activa, Laravel no lo entrega.
6. Al cumplirse los 15 minutos, o si se corta la conexión, el navegador pide otro ticket. Así Laravel vuelve a revisar la sesión y los permisos. Tras un corte, todas las vistas recargan una vez, por si se perdieron avisos.

La barra superior muestra **En vivo**, **Conectando…** o **Reconectando…**. Si el servidor no tiene el tiempo real habilitado (`503 realtime_unavailable`), el indicador no aparece y el ERP funciona igual que antes.

## 4. Configuración

| Variable | Dónde | Descripción |
| --- | --- | --- |
| `NOVA_EVENTS_ENABLED` | Laravel | `true` para registrar eventos. Por defecto `false` fuera de Docker. |
| `NOVA_EVENTS_TOPIC_PREFIX` | Laravel y realtime | Prefijo de los tópicos (`nova`). |
| `NOVA_EVENTS_RETENTION_DAYS` | Laravel | Días que se conservan en la tabla los eventos ya publicados (7). |
| `NOVA_REALTIME_SECRET` | Laravel y gateway | Clave compartida para firmar los tickets (mínimo 32 caracteres). |
| `KAFKA_BROKERS` | realtime | Lista separada por comas (`kafka:9092`). |
| `KAFKA_TOPIC_PARTITIONS` / `KAFKA_REPLICATION_FACTOR` | relay | Para crear los tópicos que falten (3 particiones y réplica 1 por defecto). |
| `DATABASE_URL` o `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | relay | Conexión a PostgreSQL. El relay requiere PostgreSQL. |
| `GATEWAY_MAX_CONNECTIONS_PER_USER` | gateway | Conexiones simultáneas por persona (10). |

## 5. Desarrollo sin Docker

```bash
# Kafka local (KRaft, un nodo) publicado en localhost:9092
docker run -d --name nova-kafka -p 9092:9092 apache/kafka:3.9.1

# backend/.env
#   NOVA_EVENTS_ENABLED=true
#   NOVA_REALTIME_SECRET=<32+ caracteres>

cd realtime && npm install
DATABASE_URL=postgres://nova:secreto@localhost:5432/nova_sync npm run relay
NOVA_REALTIME_SECRET=<la misma clave> npm run gateway      # http://localhost:3001
```

Vite reenvía `/realtime` a `VITE_REALTIME_URL` (por defecto `http://localhost:3001`). Pruebas del servicio: `cd realtime && npm test`.

Para conectar herramientas de tu equipo (kcat, Kafka UI…) al Kafka de `docker compose`, agrega un listener externo al servicio `kafka`, por ejemplo `EXTERNAL://localhost:29092`, y publica ese puerto solo en `127.0.0.1`.

## 6. Producción

- Kafka con al menos 3 brokers, `KAFKA_REPLICATION_FACTOR=3` y `min.insync.replicas=2`. Usa TLS/SASL si sale de la red privada (kafkajs admite `ssl` y `sasl`; agrégalos en `realtime/src/kafka.js`).
- Una réplica de `realtime-relay`. Las réplicas de `realtime-gateway` que haga falta: cada una consume todos los eventos con su propio grupo.
- El proxy debe tener `proxy_buffering off` y un `proxy_read_timeout` largo para `/realtime/` (ya incluido en `frontend/docker/nginx.conf`).
- Vigila los eventos pendientes: `SELECT count(*) FROM outbox_events WHERE published_at IS NULL`. `nova:outbox-prune` también los informa al terminar.
