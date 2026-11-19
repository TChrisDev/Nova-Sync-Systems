import { useMemo, useState } from 'react';
import { AssetsShell, SeverityTone } from '../components/assets/AssetsShell';
import { RuleFormModal } from '../components/assets/RuleFormModal';
import { SensorChart } from '../components/assets/SensorChart';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ErrorState, LoadingState } from '../components/ui/StateMessage';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { monitoringService } from '../services/assetsService';
import { formatDayTime, formatReading, readingStatus } from '../utils/assets';
import { cx } from '../utils/cx';
import { formatNumber } from '../utils/format';
import styles from '../components/assets/Assets.module.scss';

function Telemetry({ client, meta, version }) {
  const { can } = useAuth();
  const toast = useToast();
  const canManage = can('assets.monitor');
  const [location, setLocation] = useState('');
  const [type, setType] = useState('TEMP');
  const [ruleModal, setRuleModal] = useState(null); // null | 'new' | rule
  const [evaluating, setEvaluating] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const sensors = useApiResource((signal) => monitoringService.sensors(client.id, { signal }), [client.id, version, refresh]);
  const rules = useApiResource((signal) => monitoringService.rules(client.id, { signal }), [client.id, version, refresh]);

  const all = useMemo(() => sensors.data?.sensors ?? [], [sensors.data]);
  const visible = all.filter((s) => !location || s.location === location);
  const types = useMemo(() => [...new Set(all.map((s) => s.reading_type))], [all]);
  const chartSensors = useMemo(() => all.filter((s) => s.reading_type === type && (!location || s.location === location)), [all, type, location]);
  const typeInfo = meta?.reading_types?.find((t) => t.value === type);
  const typeRule = (rules.data ?? []).find((r) => r.reading_type === type && r.is_active && ['gte', 'gt', 'lt', 'lte'].includes(r.operator.value));

  async function evaluate() {
    setEvaluating(true);
    try {
      const response = await monitoringService.evaluate(client.id);
      toast.success(response.message);
      setRefresh((r) => r + 1);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setEvaluating(false);
    }
  }

  async function toggle(rule) {
    try {
      await monitoringService.updateRule(rule.id, { is_active: !rule.is_active });
      toast.success(rule.is_active ? 'Regla desactivada.' : 'Regla activada. Evalúa las reglas para aplicarla a las lecturas guardadas.');
      rules.reload();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function remove(rule) {
    try {
      const response = await monitoringService.removeRule(rule.id);
      toast.success(response.message);
      rules.reload();
    } catch (error) {
      toast.error(error.message);
    }
  }

  if (sensors.error) return <ErrorState error={sensors.error} onRetry={sensors.reload} />;
  if (sensors.loading && !sensors.data) return <LoadingState label="Cargando sensores…" />;

  return (
    <>
      {all.length === 0 ? (
        <p className={styles.notice}>Este cliente no tiene sensores con lecturas. Importa el archivo de IoT (dispositivos y registros) para verlos aquí.</p>
      ) : (
        <>
          <div className={styles.toolbarRow}>
            <div className={styles.segmented} role="group" aria-label="Ubicación">
              {['', ...sensors.data.locations].map((loc) => (
                <button key={loc || 'all'} type="button" aria-pressed={location === loc} onClick={() => setLocation(loc)}>
                  {loc || 'Todas las ubicaciones'}
                </button>
              ))}
            </div>
            <span className={styles.muted}>
              {formatNumber(sensors.data.range.readings)} lecturas · del {formatDayTime(sensors.data.range.from)} al {formatDayTime(sensors.data.range.to)}
            </span>
          </div>

          <div className={styles.sensorGrid}>
            {visible.map((s) => {
              const [label, tone] = readingStatus(s.last_status);
              return (
                <div key={s.id} className={cx(styles.sensor, tone !== 'success' && tone !== 'neutral' && styles[`sensor-${tone}`])}>
                  <span className={styles.sensorName}>
                    {s.reading_label} · {s.name}
                  </span>
                  <strong>{formatReading(s.last_value, s.unit, s.reading_type)}</strong>
                  <span className={styles.sensorMeta}>
                    <Badge tone={tone}>{label}</Badge>
                    {s.location ? ` ${s.location}` : ''}
                  </span>
                </div>
              );
            })}
          </div>

          <section className={styles.card} aria-labelledby="sensor-chart">
            <div className={styles.cardHeader}>
              <h2 id="sensor-chart">{typeInfo?.label ?? type} en el tiempo</h2>
              <div className={styles.segmented} role="group" aria-label="Tipo de lectura">
                {types.map((t) => (
                  <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
                    {meta?.reading_types?.find((r) => r.value === t)?.label ?? t}
                  </button>
                ))}
              </div>
            </div>
            <SensorChart
              clientId={client.id}
              sensors={chartSensors}
              unit={typeInfo?.unit}
              metric={typeRule && ['lt', 'lte'].includes(typeRule.operator.value) ? 'min' : 'max'}
              version={version + refresh}
              width={960}
              threshold={typeRule ? { value: typeRule.threshold, label: `${typeRule.name} ${typeRule.condition}` } : undefined}
            />
          </section>
        </>
      )}

      <section className={styles.card} aria-labelledby="rules-title">
        <div className={styles.cardHeader}>
          <div>
            <h2 id="rules-title">Reglas de alerta</h2>
            <p className={styles.muted}>Una regla que abre incidente agrupa las alertas de varios sensores en pocos minutos.</p>
          </div>
          {canManage && (
            <div className={styles.inlineActions}>
              <Button variant="secondary" icon="refresh" onClick={evaluate} loading={evaluating}>
                Evaluar reglas
              </Button>
              <Button icon="plus" onClick={() => setRuleModal('new')}>
                Nueva regla
              </Button>
            </div>
          )}
        </div>
        {rules.error ? (
          <ErrorState compact error={rules.error} onRetry={rules.reload} />
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.simpleTable}>
              <thead>
                <tr>
                  <th scope="col">Regla</th>
                  <th scope="col">Condición</th>
                  <th scope="col">Severidad</th>
                  <th scope="col" className={styles.num}>
                    Alertas
                  </th>
                  <th scope="col">Estado</th>
                  {canManage && (
                    <th scope="col" className={styles.num}>
                      <span className="visually-hidden">Acciones</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {(rules.data ?? []).map((r) => (
                  <tr key={r.id} className={!r.is_active ? styles.inactiveRow : undefined}>
                    <td>
                      <span className={styles.strong}>{r.name}</span>
                      <span className={styles.subtle}>
                        {r.scope === 'global' ? 'Todos los clientes' : 'Solo este cliente'}
                        {r.opens_incident ? ' · abre incidente' : ''}
                      </span>
                    </td>
                    <td>
                      {r.reading_label} {r.condition}
                    </td>
                    <td>
                      <Badge tone={SeverityTone(r.severity.value)}>{r.severity.label}</Badge>
                    </td>
                    <td className={styles.num}>{formatNumber(r.alerts_count ?? 0)}</td>
                    <td>{r.is_active ? 'Activa' : 'Inactiva'}</td>
                    {canManage && (
                      <td className={cx(styles.num, styles.rowButtons)}>
                        <Button variant="ghost" size="sm" onClick={() => toggle(r)}>
                          {r.is_active ? 'Desactivar' : 'Activar'}
                        </Button>
                        <Button variant="ghost" size="sm" icon="edit" onClick={() => setRuleModal(r)} aria-label={`Editar regla ${r.name}`} />
                        <Button variant="dangerGhost" size="sm" icon="trash" onClick={() => remove(r)} aria-label={`Eliminar regla ${r.name}`} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage && (
        <RuleFormModal
          open={ruleModal !== null}
          rule={ruleModal === 'new' ? null : ruleModal}
          client={client}
          readingTypes={meta?.reading_types ?? []}
          onClose={() => setRuleModal(null)}
          onSaved={() => {
            setRuleModal(null);
            rules.reload();
          }}
        />
      )}
    </>
  );
}

export default function TelemetryPage() {
  useDocumentTitle('Telemetría IoT');
  return <AssetsShell description="Último estado de los sensores, sus lecturas en el tiempo y las reglas que convierten lecturas en alertas.">{(props) => <Telemetry {...props} />}</AssetsShell>;
}
