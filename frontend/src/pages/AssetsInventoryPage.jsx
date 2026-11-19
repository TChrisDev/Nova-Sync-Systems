import { useState } from 'react';
import { AssetFormModal } from '../components/assets/AssetFormModal';
import { AssetsShell, CriticalityBadgeTone } from '../components/assets/AssetsShell';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Checkbox, Select } from '../components/ui/Field';
import { Pagination } from '../components/ui/Pagination';
import { SearchInput } from '../components/ui/SearchInput';
import { EmptyState, ErrorState } from '../components/ui/StateMessage';
import { Cell, SkeletonRows, Table } from '../components/ui/Table';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../hooks/useAuth';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { assetsService } from '../services/assetsService';
import { formatReading, readingStatus } from '../utils/assets';
import adminStyles from './AdminPage.module.scss';
import styles from '../components/assets/Assets.module.scss';

const GROUPS = [
  { value: '', label: 'Todos los equipos' },
  { value: 'network', label: 'Equipos de red' },
  { value: 'user', label: 'Equipos de usuario' },
  { value: 'iot', label: 'CCTV e IoT' },
  { value: 'other', label: 'Otros' },
];

function Inventory({ client, meta, version, editing, setEditing }) {
  const { can } = useAuth();
  const technical = can('assets.technical');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ group: '', category: '', criticality: '' });
  const [unmonitored, setUnmonitored] = useState(false);
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search.trim());

  const { data, error, loading, reload } = useApiResource(
    (signal) => assetsService.list({ client_id: client.id, search: debounced, ...filters, unmonitored: unmonitored ? 1 : undefined, page, per_page: 20 }, { signal }),
    [client.id, debounced, filters, unmonitored, page, version, editing === null],
  );

  const columns = [
    { key: 'asset', label: 'Activo' },
    { key: 'category', label: 'Categoría' },
    { key: 'role', label: 'Rol' },
    { key: 'criticality', label: 'Criticidad' },
    { key: 'where', label: technical ? 'IP / ubicación' : 'Ubicación' },
    { key: 'monitoring', label: 'Monitoreo o lectura' },
    { key: 'actions', label: 'Acciones', hidden: true, align: 'end' },
  ];

  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };
  const assets = data?.data ?? [];
  const filtered = Boolean(debounced || filters.group || filters.category || filters.criticality || unmonitored);

  return (
    <section className={adminStyles.panel} aria-label="Inventario de activos">
      <div className={adminStyles.toolbar}>
        <SearchInput
          label="Buscar equipos"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={technical ? 'Nombre, modelo, serial, IP o MAC' : 'Nombre, modelo o ubicación'}
        />
        <Select label="Grupo" className={adminStyles.filter} value={filters.group} onChange={setFilter('group')} options={GROUPS} />
        <Select label="Categoría" className={adminStyles.filter} value={filters.category} onChange={setFilter('category')} options={[{ value: '', label: 'Todas las categorías' }, ...(meta?.categories ?? [])]} />
        <Select label="Criticidad" className={adminStyles.filter} value={filters.criticality} onChange={setFilter('criticality')} options={[{ value: '', label: 'Toda criticidad' }, ...(meta?.criticalities ?? [])]} />
        <Checkbox
          checked={unmonitored}
          onChange={(e) => {
            setUnmonitored(e.target.checked);
            setPage(1);
          }}
          label="Equipos de red con monitoreo incompleto"
        />
      </div>
      {!technical && <p className={styles.notice}>Las IP, MAC y seriales solo se muestran a quienes tienen permiso para ver datos técnicos.</p>}

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !loading && assets.length === 0 ? (
        <EmptyState icon="search" title={filtered ? 'Sin resultados' : 'Este cliente no tiene equipos'} message={filtered ? 'Ningún equipo coincide con la búsqueda o los filtros.' : 'Registra equipos o impórtalos desde Excel.'} />
      ) : (
        <Table caption="Equipos del cliente" columns={columns}>
          {loading && !data ? (
            <SkeletonRows columns={columns.length} />
          ) : (
            assets.map((a) => {
              const [statusLabel, statusTone] = readingStatus(a.last_status);
              return (
                <tr key={a.id} className={!a.is_active ? styles.inactiveRow : undefined}>
                  <Cell label="Activo">
                    <span className={adminStyles.primaryText}>{a.name}</span>
                    <span className={adminStyles.secondary}>
                      {[a.model, technical ? a.serial : null].filter(Boolean).join(' · ') || '—'}
                      {!a.is_active && ' · fuera de servicio'}
                    </span>
                  </Cell>
                  <Cell label="Categoría">{a.category.label}</Cell>
                  <Cell label="Rol">{a.role ?? '—'}</Cell>
                  <Cell label="Criticidad">
                    <Badge tone={CriticalityBadgeTone(a.criticality.value)}>{a.criticality.label}</Badge>
                  </Cell>
                  <Cell label={technical ? 'IP / ubicación' : 'Ubicación'}>
                    <span className="tabular">{technical && a.ip_addresses?.length ? a.ip_addresses.slice(0, 2).join(' · ') : null}</span>
                    {technical && a.ip_addresses?.length > 2 && <span className={adminStyles.secondary}>+{a.ip_addresses.length - 2} más</span>}
                    {(a.location || a.vlan) && <span className={adminStyles.secondary}>{[a.location, a.vlan].filter(Boolean).join(' · ')}</span>}
                    {!(technical && a.ip_addresses?.length) && !a.location && !a.vlan && <span className={adminStyles.placeholder}>Sin datos</span>}
                  </Cell>
                  <Cell label="Monitoreo o lectura">
                    {a.monitoring ? (
                      <span className={a.monitoring_count === 0 ? styles.dangerText : a.monitoring_count < 5 ? styles.warningText : styles.successText}>
                        {a.monitoring_count} de 5
                        <span className={adminStyles.secondary}>
                          {Object.entries(a.monitoring)
                            .filter(([, on]) => on)
                            .map(([k]) => meta?.controls?.find((c) => c.value === k)?.label ?? k)
                            .join(' · ') || 'Sin controles'}
                        </span>
                      </span>
                    ) : a.reading_type ? (
                      <span>
                        {formatReading(a.last_value, a.reading_unit, a.reading_type)}
                        <span className={adminStyles.secondary}>
                          <Badge tone={statusTone}>{statusLabel}</Badge>
                        </span>
                      </span>
                    ) : (
                      <span className={adminStyles.placeholder}>No aplica</span>
                    )}
                  </Cell>
                  <Cell label="Acciones" align="end">
                    {a.can.update && (
                      <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditing(a)} aria-label={`Editar ${a.name}`}>
                        Editar
                      </Button>
                    )}
                  </Cell>
                </tr>
              );
            })
          )}
        </Table>
      )}
      <Pagination meta={data?.meta} onPageChange={setPage} label="equipos" />
    </section>
  );
}

export default function AssetsInventoryPage() {
  useDocumentTitle('Inventario de activos');
  const { can } = useAuth();
  const [editing, setEditing] = useState(null); // null | 'new' | asset

  return (
    <AssetsShell
      description="Inventario de equipos del cliente: red, usuarios, CCTV e IoT, con su criticidad y su cobertura de monitoreo."
      actions={({ openImport }) => (
        <>
          {can('assets.import') && (
            <Button variant="secondary" icon="upload" onClick={openImport}>
              Importar desde Excel
            </Button>
          )}
          {can('assets.create') && (
            <Button icon="plus" onClick={() => setEditing('new')}>
              Registrar equipo
            </Button>
          )}
        </>
      )}
    >
      {({ client, meta, version, refresh }) => (
        <>
          <Inventory client={client} meta={meta} version={version} editing={editing} setEditing={setEditing} />
          <AssetFormModal
            open={editing !== null}
            asset={editing === 'new' ? null : editing}
            client={client}
            meta={meta}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              refresh();
            }}
          />
        </>
      )}
    </AssetsShell>
  );
}
