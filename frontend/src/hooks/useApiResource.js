import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveRefresh } from './useLiveRefresh';

/**
 * Carga un recurso remoto con estados de carga, error y recarga.
 * Cancela la petición anterior cuando cambian las dependencias.
 *
 *   const { data, error, loading, reload } = useApiResource((signal) => service.list(params, { signal }), [params]);
 *
 * Con `{ live: ['projects'] }` el recurso se vuelve a pedir, sin mostrar el
 * estado de carga, cada vez que llega un aviso de cambio de esos módulos.
 */
export function useApiResource(fetcher, deps = [], { live } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const controller = useRef(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fetcher, deps);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      if (!silent) setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const data = await run(current.signal);
        if (!current.signal.aborted) setState({ data, error: null, loading: false });
      } catch (error) {
        // Un refresco silencioso que falla no reemplaza datos ya visibles.
        if (error.name !== 'AbortError' && !current.signal.aborted && !silent) {
          setState((prev) => ({ ...prev, error, loading: false }));
        }
      }
    },
    [run],
  );

  useEffect(() => {
    load();
    return () => controller.current?.abort();
  }, [load]);

  useLiveRefresh(live, () => load({ silent: true }));

  return {
    ...state,
    reload: () => load(),
    setData: (updater) => setState((prev) => ({ ...prev, data: typeof updater === 'function' ? updater(prev.data) : updater })),
  };
}
