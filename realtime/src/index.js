// Punto de entrada: `node src/index.js relay` o `node src/index.js gateway`.

import { loadConfig } from './config.js';
import { runGateway } from './gateway.js';
import { createKafka } from './kafka.js';
import { runRelay } from './relay.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function log(level, message, extra = {}) {
  if ((LEVELS[level] ?? LEVELS.info) < minLevel) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...extra });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
}

const mode = process.argv[2];
if (!['relay', 'gateway'].includes(mode)) {
  log('error', 'Indica el modo: relay o gateway');
  process.exit(64);
}

const config = loadConfig();
const kafka = createKafka(config, log);

try {
  const service = mode === 'relay' ? await runRelay(config, kafka, log) : await runGateway(config, kafka, log);

  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      log('info', 'Deteniendo', { mode, signal });
      await service.close().catch((error) => log('error', 'Error al detener', { error: error.message }));
      process.exit(0);
    });
  }
} catch (error) {
  log('error', `No se pudo iniciar el modo ${mode}`, { error: error.message });
  process.exit(1);
}
