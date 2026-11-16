import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from '../config/app';
import { useAuth } from '../hooks/useAuth';
import { realtimeService } from '../services/realtimeService';

export const RealtimeContext = createContext(null);

/** Aviso interno para que todas las vistas se pongan al día tras un corte. */
export const RESYNC_EVENT = { type: 'resync', module: '*' };

/**
 * Canal de actualizaciones en tiempo real (Server-Sent Events).
 *
 * Laravel entrega un ticket de un solo uso; con él el navegador se conecta
 * al servicio realtime, que reenvía los avisos de cambio que llegan de
 * Kafka. Los avisos no traen datos: cada vista vuelve a pedirlos a la API,
 * que aplica los permisos de siempre.
 *
 * Estados: connecting → live ⇄ reconnecting, u off si el servidor no tiene
 * el tiempo real habilitado (la aplicación funciona igual, sin refrescos
 * automáticos).
 */
export function RealtimeProvider({ children }) {
  const { load: reloadSession } = useAuth();
  const [status, setStatus] = useState('connecting');
  const listeners = useRef(new Set());

  const emit = useCallback((event) => {
    listeners.current.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Una vista con error no debe cortar el canal para las demás.
      }
    });
  }, []);

  useEffect(() => {
    let source = null;
    let timer = null;
    let stopped = false;
    let failures = 0;
    let wasLive = false;

    function retry() {
      if (stopped) return;
      failures += 1;
      setStatus('reconnecting');
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)) + Math.random() * 1000;
      timer = setTimeout(connect, delay);
    }

    function reopen() {
      source?.close();
      source = null;
      connect();
    }

    async function connect() {
      if (stopped) return;

      let ticket;
      try {
        ticket = await realtimeService.ticket();
      } catch (error) {
        // 503: el servidor no tiene tiempo real. 401/403: la sesión terminó
        // (AuthContext se encarga de llevar al login).
        if ([401, 403, 503].includes(error.status)) {
          setStatus('off');
          return;
        }
        retry();
        return;
      }
      if (stopped) return;

      source = new EventSource(`${API_BASE}${ticket.stream_url}?ticket=${encodeURIComponent(ticket.ticket)}`);

      source.addEventListener('ready', () => {
        failures = 0;
        setStatus('live');
        // Después de un corte pudieron perderse avisos: todas las vistas
        // recargan una vez.
        if (wasLive) emit(RESYNC_EVENT);
        wasLive = true;
      });

      source.addEventListener('change', (message) => {
        try {
          emit(JSON.parse(message.data));
        } catch {
          // Mensaje ilegible: se ignora.
        }
      });

      // Vida máxima de la conexión: se pide un ticket nuevo.
      source.addEventListener('reconnect', reopen);

      // Cambió el acceso de esta persona: se recargan sus permisos y, si
      // la cuenta sigue activa, se vuelve a conectar.
      source.addEventListener('access', () => {
        reloadSession();
        reopen();
      });

      // EventSource reintentaría con el mismo ticket (ya usado); se cierra y
      // se pide otro.
      source.onerror = () => {
        source?.close();
        source = null;
        retry();
      };
    }

    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [emit, reloadSession]);

  const subscribe = useCallback((listener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  const value = useMemo(() => ({ status, subscribe }), [status, subscribe]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
