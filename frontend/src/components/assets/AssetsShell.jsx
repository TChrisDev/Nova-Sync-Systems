import { useState } from 'react';
import { ModuleTabs } from '../business/ModuleTabs';
import { Button } from '../ui/Button';
import { Select } from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../ui/StateMessage';
import { useAssetClient } from '../../hooks/useAssetClient';
import { useAuth } from '../../hooks/useAuth';
import { ImportModal } from './ImportModal';
import styles from './Assets.module.scss';

/**
 * Marco común de las pantallas de activos: título, selector de cliente,
 * pestañas del módulo y los estados de carga o de "aún no hay equipos".
 * El contenido recibe el cliente escogido y el catálogo (categorías,
 * criticidades, tipos de lectura y controles de monitoreo).
 */
export function AssetsShell({ description, actions, children }) {
  const { can } = useAuth();
  const { meta, clients, client, setClient, loading, error, reload } = useAssetClient();
  const [importing, setImporting] = useState(false);
  // Sube cada vez que se importa, para que la pantalla vuelva a pedir sus datos.
  const [version, setVersion] = useState(0);
  const canImport = can('assets.import');

  return (
    <>
      <PageHeader
        title="Activos y monitoreo"
        description={description}
        actions={
          <div className={styles.headerActions}>
            {clients.length > 0 && (
              <Select
                label="Cliente"
                className={styles.clientSelect}
                value={client ? String(client.id) : ''}
                onChange={(e) => setClient(e.target.value)}
                options={clients.map((c) => ({ value: String(c.id), label: `${c.name} · ${c.assets} equipos` }))}
              />
            )}
            {client && actions?.({ client, meta, openImport: () => setImporting(true) })}
          </div>
        }
      />
      <ModuleTabs module="assets" />

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !meta ? (
        <LoadingState label="Cargando…" />
      ) : !client ? (
        <section className={styles.panel}>
          <EmptyState
            icon="server"
            title="Aún no hay equipos registrados"
            message={
              canImport
                ? 'Importa el inventario de red y los registros de los sensores desde Excel para empezar.'
                : 'Cuando se importe el inventario de un cliente aparecerá aquí. Pide a alguien con permiso de importación que lo cargue.'
            }
            action={
              canImport && (
                <Button icon="upload" onClick={() => setImporting(true)}>
                  Importar desde Excel
                </Button>
              )
            }
          />
        </section>
      ) : (
        children({
          client,
          meta,
          version,
          openImport: () => setImporting(true),
          // Tras crear o eliminar un equipo: recalcula el panel y el conteo del selector.
          refresh: () => {
            setVersion((v) => v + 1);
            reload();
          },
        })
      )}

      {canImport && (
        <ImportModal
          open={importing}
          clients={meta?.all ?? []}
          defaultClientId={client?.id}
          onClose={() => setImporting(false)}
          onImported={(clientId) => {
            setImporting(false);
            setClient(clientId);
            setVersion((v) => v + 1);
            reload();
          }}
        />
      )}
    </>
  );
}

export function CriticalityBadgeTone(value) {
  return { critical: 'danger', high: 'warning', medium: 'neutral', low: 'neutral' }[value] ?? 'neutral';
}

export function SeverityTone(value) {
  return { critical: 'danger', warning: 'warning', info: 'primary' }[value] ?? 'neutral';
}

export function IncidentTone(value) {
  return { open: 'danger', in_progress: 'primary', resolved: 'success', false_positive: 'neutral' }[value] ?? 'neutral';
}
