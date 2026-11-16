import { useContext, useEffect, useRef } from 'react';
import { RealtimeContext } from '../context/RealtimeContext';

/**
 * Llama a `onChange` cuando llega un aviso de cambio de alguno de los
 * módulos indicados (o tras una reconexión). Agrupa ráfagas de avisos en una
 * sola llamada para no repetir peticiones.
 *
 *   useLiveRefresh(['projects', 'timesheets'], reload);
 */
export function useLiveRefresh(modules, onChange, { debounceMs = 400 } = {}) {
  const realtime = useContext(RealtimeContext);
  const callback = useRef(onChange);
  callback.current = onChange;
  const key = (modules ?? []).join(',');

  useEffect(() => {
    if (!realtime || !key) return undefined;

    const watched = new Set(key.split(','));
    let timer = null;

    const unsubscribe = realtime.subscribe((event) => {
      if (event.module !== '*' && !watched.has(event.module)) return;
      clearTimeout(timer);
      timer = setTimeout(() => callback.current?.(event), debounceMs);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [realtime, key, debounceMs]);
}
