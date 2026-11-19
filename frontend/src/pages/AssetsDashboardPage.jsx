import { Link } from 'react-router';
import { AssetsShell, SeverityTone } from '../components/assets/AssetsShell';
import { SensorChart } from '../components/assets/SensorChart';
import { BarList, ColumnChart, Legend, StackedBar } from '../components/timesheets/Charts';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ErrorState, LoadingState } from '../components/ui/StateMessage';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { assetsService, monitoringService } from '../services/assetsService';
import { formatDay, formatDayTime, formatDecimal, formatTime } from '../utils/assets';
import { cx } from '../utils/cx';
import { formatNumber, formatPercent } from '../utils/format';
import styles from '../components/assets/Assets.module.scss';

const CRITICALITY_TONE = { critical: 'danger', high: 'warning', medium: 'primary', low: 'neutral' };
const SEVERITY_BAR = { critical: 'danger', warning: 'warning', info: 'primary' };

function Dashboard({ client, version }) {
  const { data, error, loading, reload } = useApiResource((signal) => assetsService.dashboard(client.id, { signal }), [client.id, version]);
  const sensors = useApiResource((signal) => monitoringService.sensors(client.id, { signal }), [client.id, version]);
  const rules = useApiResource((signal) => monitoringService.rules(client.id, { signal }), [client.id, version]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState label="Calculando el panel…" />;

  const temp = (sensors.data?.sensors ?? []).filter((s) => s.reading_type === 'TEMP');
  const tempRule = (rules.data ?? []).find((r) => r.reading_type === 'TEMP' && r.is_active && ['gte', 'gt'].includes(r.operator.value));
  const groups = Object.fromEntries(data.by_group.map((g) => [g.value, g.count]));
  const cov = data.coverage;
  const timeline = data.alerts.timeline;
  const alertColumns = timeline.points.map((p) => {
    const label = timeline.bucket_minutes >= 1440 ? formatDay(p.at) : formatTime(p.at);
    const total = p.critical + p.warning + p.info;
    return {
      key: p.at,
      label,
      segments: [
        { tone: 'danger', value: p.critical },
        { tone: 'warning', value: p.warning },
        { tone: 'primary', value: p.info },
      ],
      tooltip: `${label}: ${total} ${total === 1 ? 'alerta' : 'alertas'}${p.critical ? ` (${p.critical} críticas)` : ''}`,
    };
  });

  return (
    <>
      {data.last_reading_at && <p className={styles.source}>Última lectura de sensores: {formatDayTime(data.last_reading_at)}. Todo lo que ves sale del inventario y las lecturas importadas de este cliente.</p>}

      <dl className={styles.kpis}>
        <div className={styles.kpi}>
          <dt>Activos registrados</dt>
          <dd>{formatNumber(data.totals.assets)}</dd>
          <span>
            {formatNumber(groups.network ?? 0)} de red · {formatNumber(groups.user ?? 0)} de usuario · {formatNumber(groups.iot ?? 0)} CCTV/IoT
          </span>
        </div>
        <div className={styles.kpi}>
          <dt>Equipos críticos</dt>
          <dd>{formatNumber(data.totals.critical)}</dd>
          <span>{formatNumber(data.totals.high)} de criticidad alta</span>
        </div>
        <div className={styles.kpi}>
          <dt>Cobertura de monitoreo</dt>
          <dd className={cx(cov.ratio !== null && cov.ratio < 0.5 && styles.danger)}>{cov.ratio === null ? '—' : formatPercent(cov.ratio)}</dd>
          <span>
            {formatNumber(cov.configured)} de {formatNumber(cov.possible)} controles en {formatNumber(cov.devices)} equipos de red
          </span>
        </div>
        <div className={styles.kpi}>
          <dt>Incidentes abiertos</dt>
          <dd className={cx(data.incidents.open > 0 && styles.danger)}>{formatNumber(data.incidents.open)}</dd>
          <span>{formatNumber(data.alerts.total)} alertas registradas</span>
        </div>
      </dl>

      <div className={styles.grid2}>
        <section className={styles.card} aria-labelledby="by-category">
          <div className={styles.cardHeader}>
            <h2 id="by-category">Activos por categoría</h2>
            <Link to="/app/assets/inventory">Ver inventario</Link>
          </div>
          <BarList items={data.by_category.map((c) => ({ key: c.value, label: c.label, value: c.count }))} formatValue={formatNumber} />
        </section>
        <section className={styles.card} aria-labelledby="by-control">
          <div className={styles.cardHeader}>
            <h2 id="by-control">Controles de monitoreo · {formatNumber(cov.devices)} equipos de red</h2>
            <Link to="/app/assets/coverage">Ver cobertura</Link>
          </div>
          <BarList
            items={cov.by_control.map((c) => ({ key: c.value, label: c.label, value: c.configured, tone: c.configured === 0 ? 'danger' : 'success', detail: `${c.configured} de ${c.devices}` }))}
            formatValue={(v) => `${v} / ${cov.devices}`}
          />
          {cov.without_any > 0 && <p className={styles.warningText}>{cov.without_any === 1 ? '1 equipo de red no tiene' : `${cov.without_any} equipos de red no tienen`} ningún control configurado.</p>}
        </section>
      </div>

      <div className={styles.grid21}>
        <section className={styles.card} aria-labelledby="alerts-time">
          <div className={styles.cardHeader}>
            <h2 id="alerts-time">Alertas en el tiempo</h2>
            <span className={styles.muted}>{timeline.bucket_minutes >= 1440 ? 'Por día' : `Cada ${timeline.bucket_minutes === 60 ? 'hora' : `${timeline.bucket_minutes} minutos`}`}, hora de Colombia</span>
          </div>
          {timeline.points.length === 0 ? (
            <p className={styles.muted}>Ninguna lectura ha cumplido una regla de alerta.</p>
          ) : (
            <>
              <Legend
                items={[
                  { tone: 'danger', label: 'Crítica' },
                  { tone: 'warning', label: 'Aviso' },
                  { tone: 'primary', label: 'Informativa' },
                ]}
              />
              <ColumnChart
                columns={alertColumns}
                formatValue={formatNumber}
                ariaLabel={`Alertas en el tiempo: ${alertColumns.map((c) => c.tooltip).join('; ')}`}
              />
            </>
          )}
        </section>
        <section className={styles.card} aria-labelledby="by-criticality">
          <div className={styles.cardHeader}>
            <h2 id="by-criticality">Activos por criticidad</h2>
          </div>
          <StackedBar
            formatValue={formatNumber}
            segments={data.by_criticality.map((c) => ({ label: c.label, value: c.count, tone: CRITICALITY_TONE[c.value] ?? 'neutral' }))}
          />
          <h3 className={styles.subhead}>Alertas por severidad</h3>
          <BarList
            emptyText="Sin alertas registradas."
            formatValue={formatNumber}
            items={data.alerts.by_severity.map((s) => ({ key: s.value, label: s.label, value: s.count, tone: SEVERITY_BAR[s.value] ?? 'primary' }))}
          />
        </section>
      </div>

      <div className={styles.grid21}>
        <section className={styles.card} aria-labelledby="temp-chart">
          <div className={styles.cardHeader}>
            <h2 id="temp-chart">Temperatura</h2>
            <Link to="/app/assets/telemetry">Ver telemetría</Link>
          </div>
          <SensorChart clientId={client.id} sensors={temp} unit="°C" metric="max" version={version} threshold={tempRule ? { value: tempRule.threshold, label: `${tempRule.name} ${tempRule.condition}` } : undefined} />
        </section>
        <section className={styles.card} aria-labelledby="recent-alerts">
          <div className={styles.cardHeader}>
            <h2 id="recent-alerts">Alertas recientes</h2>
            <Link to="/app/assets/incidents">Incidentes</Link>
          </div>
          {data.alerts.recent.length === 0 ? (
            <p className={styles.muted}>Ninguna lectura ha cumplido una regla de alerta.</p>
          ) : (
            <ul className={styles.alertList}>
              {data.alerts.recent.map((a) => {
                const content = (
                  <>
                    <span className={styles.alertMeta}>
                      <Badge tone={SeverityTone(a.severity.value)}>{a.severity.label}</Badge>
                      <span>{formatDayTime(a.triggered_at)}</span>
                    </span>
                    <strong>
                      {a.rule}: {formatDecimal(a.value)} {a.unit}
                    </strong>
                    <span className={styles.muted}>
                      {a.assets.length > 2 ? `${a.assets.length} equipos` : a.assets.join(', ')}
                      {a.locations.length ? ` · ${a.locations.join(', ')}` : ''}
                    </span>
                  </>
                );
                return (
                  <li key={`${a.rule}-${a.triggered_at}`} className={cx(styles.alertItem, styles[`alert-${a.severity.value}`])}>
                    {a.incident_id ? (
                      <Link to={`/app/assets/incidents/${a.incident_id}`} className={styles.alertLink}>
                        {content}
                      </Link>
                    ) : (
                      <div className={styles.alertLink}>{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {data.critical_assets.length > 0 && (
        <section className={styles.card} aria-labelledby="critical">
          <div className={styles.cardHeader}>
            <h2 id="critical">Equipos críticos</h2>
            <Link to="/app/assets/map">Ver en el mapa</Link>
          </div>
          <ul className={styles.chips}>
            {data.critical_assets.map((a) => (
              <li key={a.id}>
                <strong>{a.name}</strong> {a.category}
                {a.role ? ` · ${a.role}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export default function AssetsDashboardPage() {
  useDocumentTitle('Activos y monitoreo');
  const { can } = useAuth();

  return (
    <AssetsShell
      description="Equipos de red, CCTV e IoT de cada cliente, con su cobertura de monitoreo y las alertas que generan."
      actions={({ openImport }) =>
        can('assets.import') && (
          <Button variant="secondary" icon="upload" onClick={openImport}>
            Importar desde Excel
          </Button>
        )
      }
    >
      {(props) => <Dashboard {...props} />}
    </AssetsShell>
  );
}
