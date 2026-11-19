import { useMemo } from 'react';
import { Legend, LineChart } from '../timesheets/Charts';
import { ErrorState, LoadingState } from '../ui/StateMessage';
import { useApiResource } from '../../hooks/useApiResource';
import { monitoringService } from '../../services/assetsService';
import { formatDecimal, formatTime, SERIES_TONES } from '../../utils/assets';
import styles from './Assets.module.scss';

/**
 * Serie de tiempo de uno o varios sensores del mismo tipo (por ejemplo, la
 * temperatura de cada oficina), con el umbral de la regla si existe.
 */
export function SensorChart({ clientId, sensors, unit, threshold, bucket = 10, metric = 'avg', version = 0, width }) {
  const ids = sensors.map((s) => s.id);
  const key = ids.join(',');
  const { data, error, loading, reload } = useApiResource(
    (signal) => (ids.length ? monitoringService.series(clientId, ids, { bucket }, { signal }) : Promise.resolve(null)),
    [clientId, key, bucket, version],
  );

  const chart = useMemo(() => {
    if (!data) return null;
    const times = [...new Set(data.series.flatMap((s) => s.points.map((p) => p.at)))].sort();
    return {
      labels: times.map(formatTime),
      series: data.series.map((s, index) => {
        const byTime = new Map(s.points.map((p) => [p.at, p[metric]]));
        return { name: `${s.asset.name}${s.asset.location ? ` · ${s.asset.location}` : ''}`, tone: SERIES_TONES[index % SERIES_TONES.length], values: times.map((t) => byTime.get(t) ?? null) };
      }),
      bucket: data.bucket_minutes,
    };
  }, [data, metric]);

  if (!ids.length) return <p className={styles.muted}>No hay sensores de este tipo.</p>;
  if (error) return <ErrorState compact error={error} onRetry={reload} />;
  if (loading && !chart) return <LoadingState label="Cargando lecturas…" />;
  if (!chart?.labels.length) return <p className={styles.muted}>Estos sensores todavía no tienen lecturas.</p>;

  // Varios sensores con exactamente las mismas lecturas casi nunca es real:
  // suele ser un origen simulado o equipos mal identificados.
  const identical = chart.series.length > 1 && chart.series.every((serie) => serie.values.join('|') === chart.series[0].values.join('|'));
  const fmt = (v) => `${formatDecimal(v)}${unit ? ` ${unit}` : ''}`;
  return (
    <div className={styles.chartBody}>
      {chart.series.length > 1 && <Legend items={chart.series.map((s) => ({ tone: s.tone, label: s.name, line: true }))} />}
      <LineChart
        labels={chart.labels}
        series={chart.series}
        zeroBased={false}
        width={width}
        threshold={threshold}
        formatValue={fmt}
        formatTick={(v) => formatDecimal(Math.round(v * 10) / 10)}
        ariaLabel={`${chart.series.map((s) => s.name).join(', ')}: ${metric === 'max' ? 'máximo' : 'promedio'} cada ${chart.bucket} minutos entre ${chart.labels[0]} y ${chart.labels.at(-1)}`}
      />
      <p className={styles.muted}>
        {metric === 'max' ? 'Máximo' : 'Promedio'} cada {chart.bucket} minutos, hora de Colombia.
      </p>
      {identical && (
        <p className={styles.anomaly} role="note">
          <strong>Lecturas idénticas.</strong> Los {chart.series.length} sensores reportan exactamente los mismos valores en cada momento, por eso se ve una sola línea. Puede ser un origen simulado o sensores mal identificados: conviene revisarlo antes de abrir incidentes por ubicación.
        </p>
      )}
    </div>
  );
}
