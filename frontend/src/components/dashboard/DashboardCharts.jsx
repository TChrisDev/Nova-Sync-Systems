import { useMemo } from 'react';
import { Link } from 'react-router';
import { useApiResource } from '../../hooks/useApiResource';
import { readStored } from '../../hooks/useAssetClient';
import { useAuth } from '../../hooks/useAuth';
import { assetsService } from '../../services/assetsService';
import { timeEntriesService } from '../../services/timeEntriesService';
import { formatDayTime } from '../../utils/assets';
import { cx } from '../../utils/cx';
import { formatHours, formatNumber, formatPercent, todayInBogota } from '../../utils/format';
import { addDays, mondayOf, shortDate } from '../../utils/timesheet';
import { BarList, ColumnChart, Legend } from '../timesheets/Charts';
import { ErrorState } from '../ui/StateMessage';
import styles from '../../pages/DashboardPage.module.scss';

// Resumen gráfico del Panel. Cada tarjeta consulta la misma API que su
// módulo, así que muestra solo lo que el rol puede ver y nada inventado.

const STATUS_ORDER = ['approved', 'submitted', 'draft', 'rejected'];
const TONE = { approved: 'success', submitted: 'primary', draft: 'neutral', rejected: 'danger' };
const LEGEND = [
  { tone: 'success', label: 'Aprobado' },
  { tone: 'primary', label: 'Enviado' },
  { tone: 'neutral', label: 'Borrador' },
  { tone: 'danger', label: 'Rechazado' },
];
const SEVERITY_TONE = { critical: 'danger', warning: 'warning', info: 'primary' };

function Loading() {
  return (
    <div className={styles.chartLoading} aria-hidden="true">
      <span className={styles.skeleton} />
      <span className={styles.skeletonChart} />
    </div>
  );
}

function HoursCard({ scope }) {
  const today = todayInBogota();
  const range = useMemo(() => {
    const monday = mondayOf(today);
    return { from: addDays(monday, -49), to: addDays(monday, 6) };
  }, [today]);
  const { data, error, loading, reload } = useApiResource((signal) => timeEntriesService.report({ scope, ...range }, { signal }), [scope, range]);

  const title = { all: 'Horas del equipo', review: 'Horas de tus proyectos', mine: 'Tus horas' }[scope];
  const link = scope === 'mine' ? { to: '/app/timesheets', label: 'Ir a mi registro' } : { to: '/app/timesheets/reports', label: 'Ver reportes' };
  const totals = data?.totals;
  const weeks = data?.weeks ?? [];
  const columns = weeks.map((w) => ({
    key: w.week_start,
    label: shortDate(w.week_start),
    note: w.holidays.length ? 'festivo' : undefined,
    segments: STATUS_ORDER.map((s) => ({ tone: TONE[s], value: w.by_status[s] ?? 0 })),
    tooltip: `Semana del ${shortDate(w.week_start)}: ${formatHours(w.total_minutes)}`,
  }));

  return (
    <section className={styles.panel} aria-labelledby="dash-hours">
      <header className={styles.panelHeader}>
        <h2 id="dash-hours" className={styles.panelTitle}>
          {title} · últimas 8 semanas
        </h2>
        <Link to={link.to} className={styles.panelLink}>
          {link.label}
        </Link>
      </header>
      <div className={styles.chartBody}>
        {error ? (
          <ErrorState error={error} onRetry={reload} compact />
        ) : loading && !data ? (
          <Loading />
        ) : !totals.total_minutes ? (
          <p className={styles.chartEmpty}>No hay horas registradas en las últimas 8 semanas.</p>
        ) : (
          <>
            <dl className={styles.miniStats}>
              <div>
                <dt>Registradas</dt>
                <dd>{formatHours(totals.total_minutes)}</dd>
              </div>
              <div>
                <dt>Aprobadas</dt>
                <dd className={styles.toneSuccess}>{formatHours(totals.approved_minutes)}</dd>
              </div>
              <div>
                <dt>Por aprobar</dt>
                <dd className={styles.tonePrimary}>{formatHours(totals.submitted_minutes)}</dd>
              </div>
              {scope !== 'mine' && (
                <div>
                  <dt>Personas</dt>
                  <dd>{formatNumber(data.people)}</dd>
                </div>
              )}
            </dl>
            <Legend items={LEGEND} />
            <ColumnChart
              columns={columns}
              formatValue={(m) => formatNumber(Math.round(m / 60))}
              formatTick={(m) => `${formatNumber(Math.round(m / 60))} h`}
              unit={60}
              ariaLabel={`Horas por semana: ${columns.map((c) => c.tooltip).join('; ')}`}
            />
          </>
        )}
      </div>
    </section>
  );
}

function AssetsCard() {
  const clients = useApiResource((signal) => assetsService.clients({ signal }), []);
  const list = clients.data?.with_assets ?? [];
  const stored = readStored();
  const client = list.find((c) => String(c.id) === String(stored)) ?? list[0] ?? null;
  const dashboard = useApiResource((signal) => (client ? assetsService.dashboard(client.id, { signal }) : Promise.resolve(null)), [client?.id]);
  const data = dashboard.data;
  const error = clients.error ?? dashboard.error;

  return (
    <section className={styles.panel} aria-labelledby="dash-assets">
      <header className={styles.panelHeader}>
        <h2 id="dash-assets" className={styles.panelTitle}>
          Activos y monitoreo{client ? ` · ${client.name}` : ''}
        </h2>
        <Link to={client ? `/app/assets?client=${client.id}` : '/app/assets'} className={styles.panelLink}>
          Abrir panel de activos
        </Link>
      </header>
      <div className={styles.chartBody}>
        {error ? (
          <ErrorState error={error} onRetry={clients.error ? clients.reload : dashboard.reload} compact />
        ) : clients.loading || (client && !data) ? (
          <Loading />
        ) : !client ? (
          <p className={styles.chartEmpty}>Aún no hay inventario cargado. Importa los archivos de Excel del cliente desde el módulo de activos.</p>
        ) : (
          <>
            <dl className={styles.miniStats}>
              <div>
                <dt>Activos</dt>
                <dd>{formatNumber(data.totals.assets)}</dd>
              </div>
              <div>
                <dt>Críticos</dt>
                <dd>{formatNumber(data.totals.critical)}</dd>
              </div>
              <div>
                <dt>Cobertura</dt>
                <dd className={cx(data.coverage.ratio !== null && data.coverage.ratio < 0.5 && styles.toneDanger)}>{data.coverage.ratio === null ? '—' : formatPercent(data.coverage.ratio)}</dd>
              </div>
              <div>
                <dt>Incidentes abiertos</dt>
                <dd className={cx(data.incidents.open > 0 && styles.toneDanger)}>{formatNumber(data.incidents.open)}</dd>
              </div>
            </dl>
            <h3 className={styles.chartSubtitle}>Alertas por severidad</h3>
            <BarList
              emptyText="Sin alertas registradas."
              formatValue={formatNumber}
              items={data.alerts.by_severity.filter((s) => s.count > 0).map((s) => ({ key: s.value, label: s.label, value: s.count, tone: SEVERITY_TONE[s.value] }))}
            />
            <h3 className={styles.chartSubtitle}>Activos por grupo</h3>
            <BarList formatValue={formatNumber} items={data.by_group.map((g) => ({ key: g.value, label: g.label, value: g.count, tone: 'accent' }))} />
            {data.last_reading_at && <p className={styles.chartNote}>Última lectura de sensores: {formatDayTime(data.last_reading_at)}.</p>}
          </>
        )}
      </div>
    </section>
  );
}

export function DashboardCharts() {
  const { can, canAny } = useAuth();
  const scope = canAny(['timesheets.view', 'timesheets.approve_any']) ? 'all' : can('timesheets.approve') ? 'review' : can('timesheets.create') ? 'mine' : null;
  const showAssets = can('assets.view');
  if (!scope && !showAssets) return null;

  return (
    <div className={styles.chartsRow}>
      {scope && <HoursCard scope={scope} />}
      {showAssets && <AssetsCard />}
    </div>
  );
}
