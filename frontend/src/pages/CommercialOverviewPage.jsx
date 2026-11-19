import { Link } from 'react-router';
import { ModuleTabs } from '../components/business/ModuleTabs';
import { BarList, ColumnChart, Legend, StackedBar } from '../components/timesheets/Charts';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateMessage';
import { useApiResource } from '../hooks/useApiResource';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { contractsService } from '../services/contractsService';
import { cx } from '../utils/cx';
import { formatCalendarDate, formatCurrency, formatHours, formatNumber } from '../utils/format';
import ov from '../components/business/Overview.module.scss';
import styles from '../components/timesheets/Timesheets.module.scss';

const STATUS_TONE = { draft: 'neutral', active: 'success', suspended: 'warning', finished: 'primary', cancelled: 'danger' };
const ALERT_LABELS = {
  bag_exceeded: 'Bolsas excedidas',
  bag_low: 'Bolsas por agotarse',
  monthly_overage: 'Mensualidades con excedente',
  expired: 'Contratos con fecha de fin vencida',
  expiring: 'Contratos que vencen pronto',
};
const monthFormat = new Intl.DateTimeFormat('es-CO', { month: 'short', timeZone: 'UTC' });

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return monthFormat.format(new Date(Date.UTC(y, m - 1, 1))).replace('.', '');
}

/** $ 196.000.000 → "$ 196 M" para las etiquetas de los gráficos. */
function millions(value) {
  return value >= 1000000 ? `$ ${formatNumber(Math.round(value / 100000) / 10)} M` : formatCurrency(value);
}

export default function CommercialOverviewPage() {
  useDocumentTitle('Indicadores comerciales');
  const { data, error, loading, reload } = useApiResource((signal) => contractsService.overview({ signal }), []);

  return (
    <>
      <PageHeader title="Clientes y contratos" description="Mensualidades, bolsas de horas, vencimientos y alertas de los contratos vigentes." />
      <ModuleTabs module="clients" />

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <LoadingState label="Calculando los indicadores…" />
      ) : !data.totals.open_contracts ? (
        <section className={styles.panel}>
          <EmptyState icon="briefcase" title="Aún no hay contratos vigentes" message="Cuando actives un contrato, aquí verás sus mensualidades, bolsas y alertas." />
        </section>
      ) : (
        <Overview data={data} />
      )}
    </>
  );
}

function Overview({ data }) {
  const { totals } = data;
  const months = data.monthly_hours;
  const columns = months.map((m) => ({
    key: m.month,
    label: monthLabel(m.month),
    segments: [
      { tone: 'primary', value: m.hour_bag },
      { tone: 'accent', value: m.monthly_recurring },
    ],
    tooltip: `${monthLabel(m.month)}: ${formatHours(m.hour_bag + m.monthly_recurring)} aprobadas (${formatHours(m.hour_bag)} en bolsas, ${formatHours(m.monthly_recurring)} en mensualidades)`,
  }));

  return (
    <>
      <dl className={styles.kpis}>
        <div className={styles.kpi}>
          <dt>Contratos vigentes</dt>
          <dd>{formatNumber(totals.open_contracts)}</dd>
          <span className={styles.kpiDetail}>
            {formatNumber(totals.clients_with_open_contracts)} de {formatNumber(totals.clients)} clientes
          </span>
        </div>
        <div className={styles.kpi}>
          <dt>Mensualidades del mes</dt>
          <dd>{millions(totals.monthly_recurring_amount)}</dd>
          <span className={styles.kpiDetail}>{formatCurrency(totals.monthly_recurring_amount)}</span>
        </div>
        <div className={styles.kpi}>
          <dt>Horas libres en bolsas</dt>
          <dd>{formatHours(totals.bag_balance_minutes)}</dd>
          <span className={styles.kpiDetail}>
            {data.bag_count === 1 ? '1 bolsa vigente' : `${formatNumber(data.bag_count)} bolsas vigentes`}
          </span>
        </div>
        <div className={styles.kpi}>
          <dt>Alertas</dt>
          <dd className={cx(totals.alerts > 0 && styles.tonewarning)}>{formatNumber(totals.alerts)}</dd>
          <span className={styles.kpiDetail}>{totals.alerts ? 'Revisa los contratos marcados' : 'Ningún contrato pide atención'}</span>
        </div>
      </dl>

      <div className={styles.charts}>
        <section className={styles.chartCard} aria-labelledby="ov-months">
          <div className={styles.chartHeader}>
            <h2 id="ov-months">Horas aprobadas por mes</h2>
            <p>Lo que ya consumió cada modalidad de cobro. Lo enviado sin aprobar no cuenta.</p>
          </div>
          <Legend
            items={[
              { tone: 'primary', label: 'Bolsas de horas' },
              { tone: 'accent', label: 'Mensualidades' },
            ]}
          />
          <ColumnChart
            columns={columns}
            formatValue={(m) => formatNumber(Math.round(m / 60))}
            formatTick={(m) => `${formatNumber(Math.round(m / 60))} h`}
            unit={60}
            ariaLabel={`Horas aprobadas por mes: ${columns.map((c) => c.tooltip).join('; ')}`}
          />
        </section>

        <section className={styles.chartCard} aria-labelledby="ov-lines">
          <div className={styles.chartHeader}>
            <h2 id="ov-lines">Mensualidad por línea de servicio</h2>
            <p>Lo que facturan este mes los contratos activos con cobro mensual. Las líneas que solo tienen bolsas de horas no aparecen.</p>
          </div>
          <BarList
            emptyText="Sin mensualidades activas."
            formatValue={millions}
            items={data.by_service_line.filter((l) => l.monthly_amount > 0).map((l) => ({
              key: l.value,
              label: l.label,
              value: l.monthly_amount,
              detail: l.contracts === 1 ? '1 contrato vigente' : `${l.contracts} contratos vigentes`,
              tone: 'accent',
            }))}
          />
        </section>

        <section className={styles.chartCard} aria-labelledby="ov-bags">
          <div className={styles.chartHeader}>
            <h2 id="ov-bags">Consumo de las bolsas de horas</h2>
            <p>
              Horas aprobadas frente a las compradas.{' '}
              {data.bag_count > data.bags.length ? `Las ${data.bags.length} más consumidas de ${data.bag_count}.` : 'Todas las bolsas vigentes.'}
            </p>
          </div>
          <BarList
            emptyText="No hay bolsas de horas vigentes."
            formatValue={(v) => `${formatNumber(v)} %`}
            items={data.bags.map((b) => {
              const pct = b.consumed_ratio === null ? 0 : Math.round(b.consumed_ratio * 100);
              return {
                key: String(b.id),
                label: b.name,
                title: `${b.code} · ${b.client}`,
                value: pct,
                detail: `${b.client} · ${formatHours(b.approved_minutes)} de ${formatHours(b.purchased_minutes)}`,
                tone: pct > 100 ? 'danger' : pct >= 80 ? 'warning' : 'success',
              };
            })}
          />
        </section>

        <section className={styles.chartCard} aria-labelledby="ov-status">
          <div className={styles.chartHeader}>
            <h2 id="ov-status">Contratos por estado</h2>
            <p>Todos los contratos registrados, incluidos los cerrados.</p>
          </div>
          <StackedBar formatValue={formatNumber} segments={data.by_status.map((s) => ({ label: s.label, tone: STATUS_TONE[s.value] ?? 'neutral', value: s.count }))} />

          <h3 className={ov.subhead}>Qué pide atención</h3>
          {data.alerts.length === 0 && data.expiring.length === 0 ? (
            <p className={ov.empty}>Ningún contrato vigente tiene alertas.</p>
          ) : (
            <ul className={ov.list}>
              {data.alerts.map((a) => (
                <li key={a.code} className={cx(ov.item, a.level === 'danger' ? ov.itemDanger : ov.itemWarning)}>
                  <span>{ALERT_LABELS[a.code] ?? a.code}</span>
                  <strong>{formatNumber(a.count)}</strong>
                </li>
              ))}
              {data.expiring.slice(0, 5).map((c) => (
                <li key={c.id} className={cx(ov.item, c.days_left < 0 && ov.itemDanger)}>
                  <span>
                    <Link to={`/app/contracts/${c.id}`}>{c.name}</Link>
                    <span className={ov.meta}>
                      {c.code} · {c.client}
                    </span>
                  </span>
                  <span className={ov.meta}>
                    {c.days_left < 0 ? 'Venció el' : `Vence en ${c.days_left} ${c.days_left === 1 ? 'día' : 'días'} ·`} {formatCalendarDate(c.end_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className={ov.note}>Las horas se cuentan cuando se aprueban. Los costos y márgenes siguen en el detalle de cada contrato, solo para quien tiene permiso de costos.</p>
    </>
  );
}
