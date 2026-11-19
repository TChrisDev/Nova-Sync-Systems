import { cx } from '../../utils/cx';
import styles from './Charts.module.scss';

// Gráficos livianos en SVG, sin librerías externas: usan los colores del
// sistema, escalan con el ancho de la tarjeta y cada uno trae una
// descripción en texto (aria-label) para lectores de pantalla.

const W = 640;
const H = 248;
const PLOT = { left: 52, right: 12, top: 26, bottom: 196 };

const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * Tope del eje redondeado para que la marca del medio sea legible. `unit`
 * permite redondear en horas aunque los valores vengan en minutos.
 */
function niceMax(value, unit = 1) {
  const scaled = value / unit;
  if (scaled <= 0) return unit;
  const exponent = 10 ** Math.floor(Math.log10(scaled));
  const nice = NICE.find((n) => scaled / exponent <= n) ?? 10;
  return nice * exponent * unit;
}

const y = (value, max) => PLOT.bottom - (value / max) * (PLOT.bottom - PLOT.top);

function Axis({ max, formatTick }) {
  const ticks = [0, max / 2, max];
  return (
    <g aria-hidden="true">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={PLOT.left} x2={W - PLOT.right} y1={y(tick, max)} y2={y(tick, max)} className={styles.grid} />
          <text x={PLOT.left - 8} y={y(tick, max) + 4} className={styles.tick} textAnchor="end">
            {formatTick(tick)}
          </text>
        </g>
      ))}
    </g>
  );
}

export function Legend({ items }) {
  return (
    <ul className={styles.legend}>
      {items.map((item) => (
        <li key={item.label}>
          <span className={cx(styles.swatch, styles[`bg-${item.tone}`], item.line && styles.swatchLine)} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Columnas apiladas. Cada columna trae sus segmentos (de abajo hacia
 * arriba) y opcionalmente una referencia propia, como la capacidad de una
 * semana con festivo. `reference` dibuja además una línea común.
 */
export function ColumnChart({ columns, reference, ariaLabel, formatValue, formatTick = formatValue, unit = 1 }) {
  const totals = columns.map((c) => c.segments.reduce((sum, s) => sum + s.value, 0));
  const refs = columns.map((c) => c.reference ?? 0);
  const max = niceMax(Math.max(1, ...totals, ...refs, reference?.value ?? 0) * 1.08, unit);
  const slot = (W - PLOT.left - PLOT.right) / Math.max(columns.length, 1);
  const width = Math.min(56, slot * 0.62);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={ariaLabel}>
      <Axis max={max} formatTick={formatTick} />
      {columns.map((column, index) => {
        const x = PLOT.left + slot * index + (slot - width) / 2;
        let base = PLOT.bottom;
        const total = totals[index];
        return (
          <g key={column.key}>
            <title>{column.tooltip ?? `${column.label}: ${formatValue(total)}`}</title>
            {column.segments
              .filter((s) => s.value > 0)
              .map((segment) => {
                const height = (segment.value / max) * (PLOT.bottom - PLOT.top);
                base -= height;
                return <rect key={segment.tone} x={x} y={base} width={width} height={height} className={cx(styles[`fill-${segment.tone}`], column.muted && styles.muted)} />;
              })}
            {column.reference > 0 && <line x1={x - 6} x2={x + width + 6} y1={y(column.reference, max)} y2={y(column.reference, max)} className={styles.capacity} />}
            {total > 0 && (
              <text x={x + width / 2} y={Math.min(y(total, max), column.reference > 0 ? y(column.reference, max) : PLOT.bottom) - 7} className={styles.value} textAnchor="middle">
                {formatValue(total)}
              </text>
            )}
            <text x={x + width / 2} y={PLOT.bottom + 18} className={styles.label} textAnchor="middle">
              {column.label}
            </text>
            {column.note && (
              <text x={x + width / 2} y={PLOT.bottom + 34} className={styles.note} textAnchor="middle">
                {column.note}
              </text>
            )}
          </g>
        );
      })}
      {reference?.value > 0 && <line x1={PLOT.left} x2={W - PLOT.right} y1={y(reference.value, max)} y2={y(reference.value, max)} className={styles.reference} aria-hidden="true" />}
    </svg>
  );
}

/**
 * Líneas en el tiempo; marca el punto más alto de cada serie con su valor.
 * Con zeroBased=false el eje se ajusta a los datos (útil para temperaturas,
 * que nunca bajan a cero). `threshold` dibuja una línea de referencia, por
 * ejemplo el umbral de una regla de alerta. Los valores null dejan un hueco.
 * `width` ensancha el lienzo en tarjetas anchas para que el texto no crezca.
 */
export function LineChart({ labels, series, ariaLabel, formatValue, formatTick = formatValue, unit = 1, zeroBased = true, threshold, width = W }) {
  const values = series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined);
  if (threshold?.value !== undefined) values.push(threshold.value);
  const dataMax = Math.max(...values, zeroBased ? 1 : -Infinity);
  const dataMin = Math.min(...values, zeroBased ? 0 : Infinity);
  let lo = 0;
  let hi = niceMax(dataMax * 1.15, unit);
  if (!zeroBased && values.length) {
    const pad = Math.max((dataMax - dataMin) * 0.25, 0.5);
    lo = Math.floor(dataMin - pad);
    hi = Math.ceil(dataMax + pad);
  }
  const py = (v) => PLOT.bottom - ((v - lo) / (hi - lo || 1)) * (PLOT.bottom - PLOT.top);
  const step = labels.length > 1 ? (width - PLOT.left - PLOT.right - 40) / (labels.length - 1) : 0;
  const x = (index) => PLOT.left + 20 + step * index;
  const every = Math.max(1, Math.ceil(labels.length / 8));
  const ticks = [lo, (lo + hi) / 2, hi];
  const dots = labels.length <= 40;

  return (
    <svg viewBox={`0 0 ${width} ${H}`} className={styles.svg} role="img" aria-label={ariaLabel}>
      <g aria-hidden="true">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PLOT.left} x2={width - PLOT.right} y1={py(tick)} y2={py(tick)} className={styles.grid} />
            <text x={PLOT.left - 8} y={py(tick) + 4} className={styles.tick} textAnchor="end">
              {formatTick(tick)}
            </text>
          </g>
        ))}
      </g>
      {threshold?.value !== undefined && (
        <g aria-hidden="true">
          <line x1={PLOT.left} x2={width - PLOT.right} y1={py(threshold.value)} y2={py(threshold.value)} className={styles.threshold} />
          <text x={width - PLOT.right} y={py(threshold.value) - 6} className={styles.thresholdText} textAnchor="end">
            {threshold.label}
          </text>
        </g>
      )}
      {series.map((s) => {
        const valid = s.values.filter((v) => v !== null && v !== undefined);
        const peak = valid.length ? s.values.indexOf(Math.max(...valid)) : -1;
        let path = '';
        s.values.forEach((v, i) => {
          if (v === null || v === undefined) return;
          const prev = s.values[i - 1];
          path += `${i && prev !== null && prev !== undefined ? 'L' : 'M'} ${x(i)} ${py(v)} `;
        });
        return (
          <g key={s.name}>
            <path d={path.trim()} className={cx(styles.line, styles[`stroke-${s.tone}`])} />
            {dots &&
              s.values.map((v, i) =>
                v === null || v === undefined ? null : (
                  <circle key={labels[i] + i} cx={x(i)} cy={py(v)} r={i === peak ? 5 : 3} className={styles[`fill-${s.tone}`]}>
                    <title>{`${s.name}, ${labels[i]}: ${formatValue(v)}`}</title>
                  </circle>
                ),
              )}
            {peak >= 0 && s.values[peak] > (zeroBased ? 0 : -Infinity) && (
              <text x={Math.min(x(peak) + 8, width - 60)} y={py(s.values[peak]) - 8} className={cx(styles.value, styles[`text-${s.tone}`])}>
                {formatValue(s.values[peak])}
              </text>
            )}
          </g>
        );
      })}
      {labels.map((label, i) =>
        i % every === 0 || i === labels.length - 1 ? (
          <text key={label + i} x={x(i)} y={PLOT.bottom + 18} className={styles.label} textAnchor="middle" aria-hidden="true">
            {label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** Barras horizontales con nombre y valor: proyectos, personas... */
export function BarList({ items, formatValue, emptyText = 'Sin datos en este periodo.' }) {
  if (!items.length) return <p className={styles.empty}>{emptyText}</p>;
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <ul className={styles.barList}>
      {items.map((item) => (
        <li key={item.key} className={styles.barRow}>
          <span className={styles.barName} title={item.title ?? item.label}>
            {item.label}
            {item.detail && <span className={styles.barDetail}>{item.detail}</span>}
          </span>
          <span className={styles.barTrack} aria-hidden="true">
            <span className={cx(styles.barFill, styles[`bg-${item.tone ?? 'primary'}`])} style={{ width: `${(item.value / max) * 100}%` }} />
          </span>
          <span className={styles.barValue}>{formatValue(item.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Una barra dividida en partes que suman el 100 %. */
export function StackedBar({ segments, formatValue }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const pct = (value) => (total ? (value / total) * 100 : 0);
  const description = segments.map((s) => `${s.label}: ${formatValue(s.value)} (${Math.round(pct(s.value))} %)`).join(', ');

  return (
    <div className={styles.stacked}>
      <div className={styles.stackedTrack} role="img" aria-label={description}>
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <span key={s.label} className={styles[`bg-${s.tone}`]} style={{ width: `${pct(s.value)}%` }} title={`${s.label}: ${formatValue(s.value)}`} />
          ))}
      </div>
      <ul className={styles.legend}>
        {segments.map((s) => (
          <li key={s.label}>
            <span className={cx(styles.swatch, styles[`bg-${s.tone}`])} aria-hidden="true" />
            {s.label} <strong>{formatValue(s.value)}</strong>
            <span className={styles.percent}>{Math.round(pct(s.value))} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
