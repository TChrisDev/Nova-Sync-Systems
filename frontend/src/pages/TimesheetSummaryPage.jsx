import { useState } from 'react';
import { ModuleTabs } from '../components/business/ModuleTabs';
import { ENTRY_STATUS, longDateLabel, monthRange } from '../components/timesheets/timesheetUtils';
import styles from '../components/timesheets/Timesheets.module.scss';
import { Badge } from '../components/ui/Badge';
import { Select, TextField } from '../components/ui/Field';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { EmptyState, ErrorState } from '../components/ui/StateMessage';
import { Cell, SkeletonRows, Table } from '../components/ui/Table';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { timesheetsService } from '../services/timesheetsService';
import { formatCurrency, formatHours, formatPercent, todayInBogota } from '../utils/format';
import pageStyles from './AdminPage.module.scss';

const COLUMNS = [
  { key: 'person', label: 'Persona' },
  { key: 'project', label: 'Proyecto' },
  { key: 'date', label: 'Fecha' },
  { key: 'status', label: 'Estado' },
  { key: 'hours', label: 'Horas', align: 'end' },
];

/** Resumen del mes: totales por estado, facturables, recargos y costo (con permiso). */
export default function TimesheetSummaryPage() {
  useDocumentTitle('Resumen de horas');
  const { can, canAny } = useAuth();
  const scopes = [
    canAny(['timesheets.view', 'timesheets.approve_any']) && { value: 'all', label: 'Todas las horas' },
    canAny(['timesheets.approve', 'timesheets.approve_any']) && { value: 'review', label: 'Mi equipo' },
    can('timesheets.create') && { value: 'mine', label: 'Mis horas' },
  ].filter(Boolean);

  const [scope, setScope] = useState(scopes[0]?.value ?? 'mine');
  const [month, setMonth] = useState(todayInBogota().slice(0, 7));
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const range = monthRange(month);
  const params = { scope, ...range, status: status || undefined };

  const summary = useApiResource((signal) => timesheetsService.summary(params, { signal }), [scope, month, status], { live: ['timesheets'] });
  const list = useApiResource(
    (signal) => timesheetsService.list({ ...params, page, per_page: 20 }, { signal }),
    [scope, month, status, page],
    { live: ['timesheets'] },
  );

  const s = summary.data;
  const total = s?.total_minutes ?? 0;
  const ratio = (value) => (total ? value / total : null);
  const entries = list.data?.data ?? [];

  return (
    <>
      <PageHeader title="Registro de horas" description="Totales del mes por estado, horas facturables, fuera de horario y disponibilidad." />
      <ModuleTabs module="timesheets" />

      <section className={pageStyles.panel} aria-label="Filtros del resumen" style={{ marginBottom: '1.25rem' }}>
        <div className={pageStyles.toolbar}>
          {scopes.length > 1 && (
            <Select label="Horas de" className={pageStyles.filter} value={scope} onChange={(e) => { setScope(e.target.value); setPage(1); }} options={scopes} />
          )}
          <TextField label="Mes" type="month" className={pageStyles.filter} value={month} max={todayInBogota().slice(0, 7)} onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setPage(1); } }} />
          <Select
            label="Estado"
            className={pageStyles.filter}
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            options={[{ value: '', label: 'Todos los estados' }, ...Object.entries(ENTRY_STATUS).map(([value, item]) => ({ value, label: item.label }))]}
          />
        </div>
      </section>

      {summary.error ? (
        <ErrorState error={summary.error} onRetry={summary.reload} />
      ) : (
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <p className={styles.metricLabel}>Total registrado</p>
            <p className={styles.metricValue}>{formatHours(total)}</p>
            <p className={styles.metricDetail}>{s ? `${s.entries} registros` : '—'}</p>
          </div>
          <div className={styles.metric}>
            <p className={styles.metricLabel}>Aprobadas</p>
            <p className={styles.metricValue}>{formatHours(s?.approved_minutes ?? 0)}</p>
            <p className={styles.metricDetail}>{formatPercent(ratio(s?.approved_minutes ?? 0))} del total</p>
          </div>
          <div className={styles.metric}>
            <p className={styles.metricLabel}>Por aprobar</p>
            <p className={styles.metricValue}>{formatHours(s?.submitted_minutes ?? 0)}</p>
            <p className={styles.metricDetail}>
              {formatHours(s?.draft_minutes ?? 0)} en borrador · {formatHours(s?.rejected_minutes ?? 0)} rechazadas
            </p>
          </div>
          <div className={styles.metric}>
            <p className={styles.metricLabel}>Facturables</p>
            <p className={styles.metricValue}>{formatHours(s?.billable_minutes ?? 0)}</p>
            <p className={styles.metricDetail}>{formatPercent(ratio(s?.billable_minutes ?? 0))} del total</p>
          </div>
          <div className={styles.metric}>
            <p className={styles.metricLabel}>Fuera de horario</p>
            <p className={styles.metricValue}>{formatHours(s?.after_hours_minutes ?? 0)}</p>
            <p className={styles.metricDetail}>{formatHours(s?.on_call_minutes ?? 0)} de disponibilidad</p>
          </div>
          {typeof s?.approved_cost === 'number' && (
            <div className={styles.metric}>
              <p className={styles.metricLabel}>Costo aprobado</p>
              <p className={styles.metricValue}>{formatCurrency(s.approved_cost)}</p>
              <p className={styles.metricDetail}>Tarifa interna al aprobar</p>
            </div>
          )}
        </div>
      )}

      <section className={pageStyles.panel} aria-label="Registros del mes">
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : !list.loading && entries.length === 0 ? (
          <EmptyState icon="clock" title="Sin registros en este mes" message="Cambia el mes o los filtros para ver otras horas." />
        ) : (
          <Table caption="Registros de horas del mes" columns={COLUMNS}>
            {list.loading && !list.data ? (
              <SkeletonRows columns={COLUMNS.length} />
            ) : (
              entries.map((entry) => (
                <tr key={entry.id}>
                  <Cell label="Persona">{entry.user?.name}</Cell>
                  <Cell label="Proyecto">
                    <span className={pageStyles.primaryText}>{entry.project?.code}</span>
                    <span className={pageStyles.secondary}>{entry.description}</span>
                  </Cell>
                  <Cell label="Fecha">{longDateLabel(entry.work_date)}</Cell>
                  <Cell label="Estado">
                    <Badge tone={ENTRY_STATUS[entry.status]?.tone}>{ENTRY_STATUS[entry.status]?.label}</Badge>
                  </Cell>
                  <Cell label="Horas" align="end">
                    <span className="tabular">{formatHours(entry.minutes)}</span>
                  </Cell>
                </tr>
              ))
            )}
          </Table>
        )}
        <Pagination meta={list.data?.meta} onPageChange={setPage} label="registros" />
      </section>
    </>
  );
}
