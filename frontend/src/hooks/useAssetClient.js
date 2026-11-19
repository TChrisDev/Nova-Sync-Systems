import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { assetsService } from '../services/assetsService';
import { useApiResource } from './useApiResource';

const STORAGE_KEY = 'nova.assets.client';

/** Último cliente consultado en el módulo (o null). */
export function readStored() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(id) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    // Sin almacenamiento (navegación privada): se usa solo la URL.
  }
}

/**
 * Cliente que se está viendo en el módulo de activos. Se lee de la URL
 * (?client=) y se recuerda en el navegador para que las pestañas del módulo
 * mantengan el mismo cliente.
 */
export function useAssetClient() {
  const [params, setParams] = useSearchParams();
  const meta = useApiResource((signal) => assetsService.clients({ signal }), []);
  const clients = meta.data?.with_assets ?? [];
  const wanted = params.get('client') ?? readStored();
  const client = clients.find((c) => String(c.id) === String(wanted)) ?? clients[0] ?? null;

  const setClient = useCallback(
    (id) => {
      store(id);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('client', String(id));
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { meta: meta.data, clients, client, setClient, loading: meta.loading, error: meta.error, reload: meta.reload };
}
