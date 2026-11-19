import { Link } from 'react-router';
import { ModuleTabs } from '../components/business/ModuleTabs';
import { BarList, ColumnChart, Legend, StackedBar } from '../components/timesheets/Charts';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateMessage';
import { useApiResource } from '../hooks/useApiResource';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { projectsService } from '../services/projectsService';
import { cx } from '../utils/cx';
import { formatHours, formatNumber } from '../utils/format';
import { shortDate } from '../utils/timesheet';
import ov from '../components/business/Overview.module.scss';
import styles from '../components/timesheets/Timesheets.module.scss';

const STATUS_TONE = { planned: 'neutral', active: 'success', on_hold: 'warning', closed: 'primary' };

export default function ProjectsOverviewPage() {
  useDocumentTitle('Indicadores de proyectos');
  const { data, error, loading, reload } = useApiResource((signal) => projectsService.overview({ signal }), []);

  return (
    <>
      <PageHeader
        title="Proyectos y capacidad"
        description={data?.scope === 'led' ? 'Estado, salud y horas de los proyectos que lideras.' : 'Estado, salud y horas de todos los proyectos y servicios continuos.'}
      />
      <ModuleTabs module="projects" />

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <LoadingState label="Calculando los indicadores…" />
      ) : !data.totals.projects ? (
        <section className={styles.panel}>
          <EmptyState icon="folder" title="Aún no hay proyectos" message="Cuando crees un proyecto sobre un contrato, aquí verás su salud y sus horas." />
        </section>
      ) : (
        <Overview data={data} />
      )}
    </>
  );
}

function Overview({ data }) {
  const { totals, health } = data;
  const last = data.weekly_hours.at(-1);
  const thisWeek = last ? last.approved + last.submitted + last.draft : 0;
  const periodTotal = data.weekly_hours.reduce((t, w) => t + w.approved + w.submitted + w.draft, 0);
  const columns = data.weekly_hours.map((w) => {
    const total = w.approved + w.submitted + w.draft;
    return {
      key: w.week_start,
      label: shortDate(w.week_start),
      segments: [
        { tone: 'success', value: w.approved },
        { tone: 'primary', value: w.submitted },
        { tone: 'neutral', value: w.draft },
      ],
      tooltip: `Semana del ${shortDate(w.week_start)}: ${formatHours(total)} (${formatHours(w.approved)} aprobadas, ${formatHours(w.submitted)} por aprobar)`,
    };
  });

  return (
    <>
      <dl className={styles.kpis}>
        <div className={styles.kpi}>
          <dt>Proyectos abiertos</dt>
          <dd>{formatNumber(totals.open)}</dd>
          <span className={styles.kpiDetail}>{formatNumber(totals.active)} en curso</span>
        </div>
        <div className={styles.kpi}>
          <dt>Con alertas de salud</dt>
          <dd className={cx(totals.at_risk > 0 && styles.tonewarning)}>{formatNumber(totals.at_risk)}</dd>
          <span className={styles.kpiDetail}>{health.danger ? `${formatNumber(health.danger)} en estado crítico` : 'Ninguno en estado crítico'}</span>
        </div>
        <div className={styles.kpi}>
          <dt>Personas asignadas</dt>
          <dd>{formatNumber(totals.team_members)}</dd>
          <span className={styles.kpiDetail}>Con una asignación vigente</span>
        </div>
        <div className={styles.kpi}>
          <dt>Horas en 8 semanas</dt>
          <dd>{formatHours(periodTotal)}</dd>
          <span className={styles.kpiDetail}>{formatHours(thisWeek)} esta semana</span>
        </div>
      </dl>

      <div className={styles.charts}>
        <div className={ov.stack}>
        <section className={styles.chartCard} aria-labelledby="pv-weeks">
          <div className={styles.chartHeader}>
            <h2 id="pv-weeks">Horas por semana</h2>
            <p>Las últimas 8 semanas, por estado de aprobación.</p>
          </div>
          <Legend
            items={[
              { tone: 'success', label: 'Aprobado' },
              { tone: 'primary', label: 'Enviado' },
              { tone: 'neutral', label: 'Borrador' },
            ]}
          />
          <ColumnChart
            columns={columns}
            formatValue={(m) => formatNumber(Math.round(m / 60))}
            formatTick={(m) => `${formatNumber(Math.round(m / 60))} h`}
            unit={60}
            ariaLabel={`Horas por semana: ${columns.map((c) => c.tooltip).join('; ')}`}
          />
        </section>

        <section className={styles.chartCard} aria-labelledby="pv-health">
          <div className={styles.chartHeader}>
            <h2 id="pv-health">Salud de los proyectos abiertos</h2>
            <p>Se calcula con las horas y las fechas de cada proyecto; nadie la marca a mano.</p>
          </div>
          <StackedBar
            formatValue={formatNumber}
            segments={[
              { label: 'Sin alertas', tone: 'success', value: health.ok },
              { label: 'Atención', tone: 'warning', value: health.warning },
              { label: 'Crítico', tone: 'danger', value: health.danger },
            ]}
          />
          {data.flags.length > 0 && (
            <ul className={ov.list}>
              {data.flags.map((f) => (
                <li key={f.code} className={cx(ov.item, f.severity === 'danger' ? ov.itemDanger : ov.itemWarning)}>
                  <span>{f.label}</span>
                  <strong>{formatNumber(f.count)}</strong>
                </li>
              ))}
            </ul>
          )}
          <Link to="/app/projects" className={ov.link}>
            Ver el listado de proyectos
          </Link>
        </section>

        </div>
        <div className={ov.stack}>
        <section className={styles.chartCard} aria-labelledby="pv-budgets">
          <div className={styles.chartHeader}>
            <h2 id="pv-budgets">Consumo del presupuesto de horas</h2>
            <p>Horas aprobadas y enviadas frente al presupuesto del proyecto o de su bolsa.</p>
          </div>
          <BarList
            emptyText="Ningún proyecto abierto tiene presupuesto de horas."
            formatValue={(v) => `${formatNumber(v)} %`}
            items={data.budgets.map((b) => {
              const pct = Math.round(b.ratio * 100);
              return {
                key: String(b.id),
                label: b.name,
                title: `${b.code} · ${b.client ?? ''}`,
                value: pct,
                detail: `${b.code} · ${formatHours(b.consumed_minutes)} de ${formatHours(b.budget_minutes)}`,
                tone: pct > 100 ? 'danger' : pct >= 90 ? 'warning' : 'success',
              };
            })}
          />
        </section>

        <section className={styles.chartCard} aria-labelledby="pv-status">
          <div className={styles.chartHeader}>
            <h2 id="pv-status">Proyectos por estado y tipo</h2>
            <p>El tipo cuenta solo los proyectos abiertos.</p>
          </div>
          <StackedBar formatValue={formatNumber} segments={data.by_status.map((s) => ({ label: s.label, tone: STATUS_TONE[s.value] ?? 'neutral', value: s.count }))} />
          <BarList formatValue={formatNumber} items={data.by_kind.map((k) => ({ key: k.value, label: k.label, value: k.count, tone: 'accent' }))} />
        </section>
        </div>
      </div>
    </>
  );
}
