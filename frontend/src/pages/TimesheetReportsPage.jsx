import { useMemo, useState } from 'react';
import { ModuleTabs } from '../components/business/ModuleTabs';
import { BarList, ColumnChart, Legend, LineChart, StackedBar } from '../components/timesheets/Charts';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Field';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateMessage';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useReferenceData } from '../hooks/useReferenceData';
import { useToast } from '../hooks/useToast';
import { timeEntriesService } from '../services/timeEntriesService';
import { cx } from '../utils/cx';
import { formatCurrency, formatHours, formatNumber, todayInBogota } from '../utils/format';
import { addDays, mondayOf, shortDate } from '../utils/timesheet';
import styles from '../components/timesheets/Timesheets.module.scss';

const STATUS_ORDER = ['approved', 'submitted', 'draft', 'rejected'];
const TONE = { approved: 'success', submitted: 'primary', draft: 'neutral', rejected: 'danger' };
const LEGEND = [
  { tone: 'success', label: 'Aprobado' },
  { tone: 'primary', label: 'Enviado' },
  { tone: 'neutral', label: 'Borrador' },
  { tone: 'danger', label: 'Rechazado' },
];

function periodRange(period, today) {
  const monday = mondayOf(today);
  switch (period) {
    case '12w':
      return { from: addDays(monday, -77), to: addDays(monday, 6) };
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'prev': {
      const firstThis = `${today.slice(0, 7)}-01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
    }
    default:
      return { from: addDays(monday, -49), to: addDays(monday, 6) };
  }
}

const hoursNoUnit = (m) => formatHours(m, { unit: false });
const tickHours = (m) => `${formatNumber(Math.round(m / 60))} h`;

export default function TimesheetReportsPage() {
  useDocumentTitle('Reportes de horas');
  const { canAny } = useAuth();
  const toast = useToast();
  const reference = useReferenceData();
  const today = todayInBogota();
  const [period, setPeriod] = useState('8w');
  const [siteId, setSiteId] = useState('');
  const [exporting, setExporting] = useState(false);

  // Gerencia ve a todo el equipo; un líder, los proyectos que lidera.
  const scope = canAny(['timesheets.view', 'timesheets.approve_any']) ? 'all' : 'review';
  const range = useMemo(() => periodRange(period, today), [period, today]);
  const query = { scope, ...range, site_id: siteId };

  const { data, error, loading, reload } = useApiResource((signal) => timeEntriesService.report(query, { signal }), [scope, range, siteId]);

  async function exportCsv() {
    setExporting(true);
    try {
      await timeEntriesService.exportCsv(query);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(false);
    }
  }

  const totals = data?.totals;
  const weeks = data?.weeks ?? [];
  const registered = totals?.total_minutes ?? 0;
  const share = (minutes) => (registered ? `${Math.round((minutes / registered) * 100)} %` : '—');

  const columns = weeks.map((w) => ({
    key: w.week_start,
    label: shortDate(w.week_start),
    note: w.holidays.length ? 'festivo' : undefined,
    segments: STATUS_ORDER.map((s) => ({ tone: TONE[s], value: w.by_status[s] ?? 0 })),
    tooltip: `Semana del ${shortDate(w.week_start)}: ${formatHours(w.total_minutes)}${w.holidays.length ? ` (festivo: ${w.holidays.map((h) => h.name).join(', ')})` : ''}`,
  }));

  const peakAfterHours = weeks.reduce((best, w) => (!best || w.after_hours_minutes > best.after_hours_minutes ? w : best), null);

  return (
    <>
      <PageHeader
        title="Registro de horas"
        description={scope === 'all' ? 'Horas de todo el equipo, su estado de aprobación y dónde se concentran.' : 'Horas de los proyectos que lideras, su estado de aprobación y dónde se concentran.'}
        actions={
          <Button variant="secondary" icon="download" onClick={exportCsv} loading={exporting} disabled={!registered}>
            Exportar CSV
          </Button>
        }
      />
      <ModuleTabs module="timesheets" />

      <div className={styles.reportFilters}>
        <Select
          label="Periodo"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          options={[
            { value: '8w', label: 'Últimas 8 semanas' },
            { value: '12w', label: 'Últimas 12 semanas' },
            { value: 'month', label: 'Este mes' },
            { value: 'prev', label: 'Mes anterior' },
          ]}
        />
        <Select label="Sede" value={siteId} onChange={(e) => setSiteId(e.target.value)} options={reference.options('sites', 'Todas las sedes')} />
        <p className={styles.rangeText}>
          Del {shortDate(range.from)}{range.from.slice(0, 4) !== range.to.slice(0, 4) ? ` de ${range.from.slice(0, 4)}` : ''} al {shortDate(range.to)} de {range.to.slice(0, 4)}
        </p>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <LoadingState label="Calculando el reporte…" />
      ) : !registered ? (
        <section className={styles.panel}>
          <EmptyState icon="chart" title="Sin horas en este periodo" message="Prueba con otro periodo u otra sede." />
        </section>
      ) : (
        <>
          <dl className={styles.kpis}>
            <div className={styles.kpi}>
              <dt>Horas registradas</dt>
              <dd>{formatHours(registered)}</dd>
              <span className={styles.kpiDetail}>{data.people === 1 ? '1 persona' : `${formatNumber(data.people)} personas`}</span>
            </div>
            <div className={styles.kpi}>
              <dt>Aprobadas</dt>
              <dd className={styles.tonesuccess}>{formatHours(totals.approved_minutes)}</dd>
              <span className={styles.kpiDetail}>{share(totals.approved_minutes)} de lo registrado</span>
            </div>
            <div className={styles.kpi}>
              <dt>Esperando aprobación</dt>
              <dd className={styles.toneprimary}>{formatHours(totals.submitted_minutes)}</dd>
              <span className={styles.kpiDetail}>{share(totals.submitted_minutes)} · aún no consumen bolsa</span>
            </div>
            {'approved_cost' in totals ? (
              <div className={styles.kpi}>
                <dt>Costo interno aprobado</dt>
                <dd>{formatCurrency(totals.approved_cost)}</dd>
                <span className={styles.kpiDetail}>Solo visible con permiso de costos</span>
              </div>
            ) : (
              <div className={styles.kpi}>
                <dt>Fuera de horario</dt>
                <dd className={styles.tonewarning}>{formatHours(totals.after_hours_minutes)}</dd>
                <span className={styles.kpiDetail}>{share(totals.after_hours_minutes)} de lo registrado</span>
              </div>
            )}
          </dl>

          <section className={cx(styles.chartCard, styles.standalone)} aria-labelledby="status-title">
            <div className={styles.chartHeader}>
              <h2 id="status-title">Estado de las horas del periodo</h2>
            </div>
            <StackedBar
              formatValue={(m) => formatHours(m)}
              segments={[
                { label: 'Aprobadas', tone: 'success', value: totals.approved_minutes },
                { label: 'Enviadas', tone: 'primary', value: totals.submitted_minutes },
                { label: 'Rechazadas', tone: 'danger', value: totals.rejected_minutes },
                { label: 'Borrador', tone: 'neutral', value: totals.draft_minutes },
              ]}
            />
          </section>

          <div className={styles.charts}>
            <section className={styles.chartCard} aria-labelledby="weeks-title">
              <div className={styles.chartHeader}>
                <h2 id="weeks-title">Horas por semana</h2>
                <p>{weeks.some((w) => w.holidays.length) ? 'Las semanas con festivo tienen menos días hábiles.' : 'De lunes a domingo.'}</p>
              </div>
              <Legend items={LEGEND} />
              <ColumnChart columns={columns} formatValue={(m) => formatNumber(Math.round(m / 60))} formatTick={tickHours} unit={60} ariaLabel={`Horas por semana: ${columns.map((c) => c.tooltip).join('; ')}`} />
            </section>

            <section className={styles.chartCard} aria-labelledby="projects-title">
              <div className={styles.chartHeader}>
                <h2 id="projects-title">Proyectos con más horas</h2>
                <p>
                  {data.by_project.count > data.by_project.items.length
                    ? `Los ${data.by_project.items.length} primeros de ${data.by_project.count} proyectos.`
                    : `${data.by_project.count === 1 ? '1 proyecto' : `${data.by_project.count} proyectos`} con horas en el periodo.`}
                </p>
              </div>
              <BarList
                formatValue={(m) => formatHours(m)}
                items={data.by_project.items.map((p) => ({ key: String(p.project.id), label: p.project.name, detail: `${p.project.code} · ${formatHours(p.approved_minutes)} aprobadas`, value: p.minutes }))}
              />
            </section>
          </div>

          <div className={styles.charts}>
            <section className={styles.chartCard} aria-labelledby="after-title">
              <div className={styles.chartHeader}>
                <h2 id="after-title">Fuera de horario y disponibilidad 24/7</h2>
                <p>
                  {peakAfterHours?.after_hours_minutes
                    ? `El pico fue la semana del ${shortDate(peakAfterHours.week_start)}: ${formatHours(peakAfterHours.after_hours_minutes)} fuera de horario.`
                    : 'No hubo horas fuera de horario en el periodo.'}
                </p>
              </div>
              <Legend
                items={[
                  { tone: 'warning', label: 'Fuera de horario', line: true },
                  { tone: 'ink', label: 'Disponibilidad 24/7', line: true },
                ]}
              />
              <LineChart
                labels={weeks.map((w) => shortDate(w.week_start))}
                series={[
                  { name: 'Fuera de horario', tone: 'warning', values: weeks.map((w) => w.after_hours_minutes) },
                  { name: 'Disponibilidad 24/7', tone: 'ink', values: weeks.map((w) => w.on_call_minutes) },
                ]}
                formatValue={(m) => formatHours(m)}
                formatTick={tickHours}
                unit={60}
                ariaLabel={`Horas fuera de horario por semana: ${weeks.map((w) => `${shortDate(w.week_start)} ${formatHours(w.after_hours_minutes)}`).join(', ')}`}
              />
            </section>

            <section className={styles.chartCard} aria-labelledby="people-title">
              <div className={styles.chartHeader}>
                <h2 id="people-title">Personas con más horas</h2>
                <p>{data.by_user.count > data.by_user.items.length ? `Las ${data.by_user.items.length} primeras de ${data.by_user.count}.` : 'Todas las personas del periodo.'}</p>
              </div>
              <BarList formatValue={(m) => formatHours(m)} items={data.by_user.items.map((u) => ({ key: String(u.user.id), label: u.user.name, value: u.minutes, tone: 'accent' }))} />
            </section>
          </div>
          <p className={styles.footnote}>Promedio por semana: {formatHours(Math.round(registered / Math.max(weeks.length, 1)))} · {hoursNoUnit(totals.billable_minutes)} h facturables.</p>
        </>
      )}
    </>
  );
}
