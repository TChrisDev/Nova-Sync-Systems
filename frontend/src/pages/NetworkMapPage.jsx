import { useMemo, useState } from 'react';
import { AssetsShell, CriticalityBadgeTone } from '../components/assets/AssetsShell';
import { Badge } from '../components/ui/Badge';
import { ErrorState, LoadingState } from '../components/ui/StateMessage';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { assetsService } from '../services/assetsService';
import { cx } from '../utils/cx';
import { formatNumber } from '../utils/format';
import styles from '../components/assets/Assets.module.scss';

const W = 1000;
const NODE_H = 66;
const LAYER_GAP = 150;
const LAYERS = ['Internet (WAN)', 'Perímetro', 'Núcleo', 'Acceso'];
const GROUP_LABELS = { user: 'de usuario', iot: 'CCTV/IoT', other: 'otros', network: 'de red' };

/** Ubica los equipos de red por capas, repartidos a lo ancho. */
function layout(nodes) {
  const byLayer = [0, 1, 2, 3].map((layer) => nodes.filter((n) => n.layer === layer).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })));
  const used = byLayer.map((list, i) => (list.length ? i : null)).filter((i) => i !== null);
  const positions = new Map();
  used.forEach((layer, row) => {
    const list = byLayer[layer];
    const slot = (W - 40) / list.length;
    const width = Math.min(190, slot - 24);
    list.forEach((node, i) => positions.set(node.id, { x: 20 + slot * i + (slot - width) / 2, y: 36 + row * LAYER_GAP, w: width, row, layer }));
  });
  return { positions, rows: used, height: 36 + (used.length - 1) * LAYER_GAP + NODE_H + 70 };
}

function NetworkMap({ client, version }) {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApiResource((signal) => assetsService.map(client.id, { signal }), [client.id, version]);
  const [selected, setSelected] = useState(null);
  const geometry = useMemo(() => (data ? layout(data.nodes) : null), [data]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState label="Dibujando la red…" />;
  if (!data.nodes.length)
    return <p className={styles.notice}>Este cliente no tiene routers, firewalls ni switches en el inventario. Importa el inventario de red para ver el mapa.</p>;

  const { positions, rows, height } = geometry;
  const singles = new Set(data.single_points.map((s) => s.id));
  const node = data.nodes.find((n) => n.id === selected);
  const busiest = [...data.nodes].sort((a, b) => b.endpoint_total - a.endpoint_total)[0];
  const totalEndpoints = data.nodes.reduce((t, n) => t + n.endpoint_total, 0);

  function edgePath(edge) {
    const a = positions.get(edge.source);
    const b = positions.get(edge.target);
    if (!a || !b) return null;
    if (a.row === b.row) {
      const [left, right] = a.x < b.x ? [a, b] : [b, a];
      const yMid = left.y + NODE_H / 2;
      const adjacent = Math.abs(right.x - (left.x + left.w)) < 120;
      return adjacent ? `M ${left.x + left.w} ${yMid} L ${right.x} ${yMid}` : `M ${left.x + left.w / 2} ${left.y} C ${left.x + left.w / 2} ${left.y - 40}, ${right.x + right.w / 2} ${right.y - 40}, ${right.x + right.w / 2} ${right.y}`;
    }
    const [top, bottom] = a.row < b.row ? [a, b] : [b, a];
    return `M ${top.x + top.w / 2} ${top.y + NODE_H} C ${top.x + top.w / 2} ${top.y + NODE_H + 50}, ${bottom.x + bottom.w / 2} ${bottom.y - 50}, ${bottom.x + bottom.w / 2} ${bottom.y}`;
  }

  return (
    <>
      <section className={styles.card} aria-labelledby="map-title">
        <div className={styles.cardHeader}>
          <h2 id="map-title">Topología de la red</h2>
          <ul className={styles.legendInline}>
            <li>
              <span className={cx(styles.swatchBox, styles.critical)} aria-hidden="true" />
              Crítica
            </li>
            <li>
              <span className={cx(styles.swatchBox, styles.high)} aria-hidden="true" />
              Alta
            </li>
            <li>
              <span className={cx(styles.swatchBox, styles.medium)} aria-hidden="true" />
              Media o baja
            </li>
            <li>
              <span className={styles.swatchLine} aria-hidden="true" />
              Enlace funcional
            </li>
          </ul>
        </div>
        <p className={styles.scrollHint}>Desliza hacia los lados para ver toda la red.</p>
        <div className={styles.mapScroll}>
          <svg viewBox={`0 0 ${W} ${height}`} className={styles.mapSvg} role="group" aria-label={`Mapa de red con ${data.nodes.length} equipos y ${data.edges.length} enlaces entre ellos`}>
            {rows.map((layer, row) => (
              <text key={layer} x={8} y={36 + row * LAYER_GAP - 10} className={styles.layerLabel}>
                {LAYERS[layer]}
              </text>
            ))}
            {data.edges.map((edge, i) => {
              const d = edgePath(edge);
              return d ? <path key={i} d={d} className={cx(styles.edge, edge.functional === false && styles.edgeDown)} /> : null;
            })}
            {data.nodes.map((n) => {
              const p = positions.get(n.id);
              const crit = n.criticality.value === 'critical' ? styles.critical : n.criticality.value === 'high' ? styles.high : styles.medium;
              return (
                <g
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${n.name}, ${n.category.label}, criticidad ${n.criticality.label}${n.endpoint_total ? `, ${n.endpoint_total} equipos conectados` : ''}`}
                  aria-pressed={selected === n.id}
                  className={cx(styles.node, crit, selected === n.id && styles.nodeSelected)}
                  onClick={() => setSelected(n.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(n.id);
                    }
                  }}
                >
                  <rect x={p.x} y={p.y} width={p.w} height={NODE_H} rx={10} />
                  <text x={p.x + p.w / 2} y={p.y + 27} textAnchor="middle" className={styles.nodeName}>
                    {n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}
                  </text>
                  <text x={p.x + p.w / 2} y={p.y + 47} textAnchor="middle" className={styles.nodeMeta}>
                    {n.ip ?? n.model ?? n.category.label}
                  </text>
                  {singles.has(n.id) && (
                    <text x={p.x + p.w / 2} y={p.y - 8} textAnchor="middle" className={styles.nodeWarning}>
                      Punto único de falla
                    </text>
                  )}
                  {n.endpoint_total > 0 && (
                    <text x={p.x + p.w / 2} y={p.y + NODE_H + 20} textAnchor="middle" className={styles.nodeEndpoints}>
                      {formatNumber(n.endpoint_total)} equipos conectados
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        {node ? (
          <div className={styles.nodeDetail} aria-live="polite">
            <div>
              <strong>{node.name}</strong>
              <span>
                {node.category.label}
                {node.model ? ` · ${node.model}` : ''}
                {node.role ? ` · ${node.role}` : ''}
              </span>
            </div>
            <Badge tone={CriticalityBadgeTone(node.criticality.value)}>{node.criticality.label}</Badge>
            {can('assets.technical') && node.ip && <span className="tabular">{node.ip}</span>}
            <span>{node.monitoring} de 5 controles de monitoreo</span>
            {node.endpoint_total > 0 && (
              <span>
                Conectados:{' '}
                {Object.entries(node.endpoints)
                  .map(([g, n]) => `${n} ${GROUP_LABELS[g] ?? g}`)
                  .join(', ')}
              </span>
            )}
          </div>
        ) : (
          <p className={styles.muted}>Escoge un equipo para ver su detalle.</p>
        )}
      </section>

      <div className={styles.grid3}>
        <div className={cx(styles.insight, data.single_points.length && styles.insightDanger)}>
          <span className={styles.insightLabel}>Puntos únicos de falla</span>
          <strong>{data.single_points.length ? data.single_points.map((s) => s.name).join(', ') : 'Ninguno'}</strong>
          <p>
            {data.single_points.length
              ? 'Toda una capa de la red depende de un solo equipo: si falla, la sede pierde la conexión aunque el resto funcione.'
              : 'Cada capa de la red tiene al menos dos equipos.'}
          </p>
        </div>
        {busiest?.endpoint_total > 0 && (
          <div className={cx(styles.insight, styles.insightWarning)}>
            <span className={styles.insightLabel}>Mayor concentración</span>
            <strong>
              {busiest.name} · {formatNumber(busiest.endpoint_total)} equipos
            </strong>
            <p>{totalEndpoints ? `${Math.round((busiest.endpoint_total / totalEndpoints) * 100)} % de los equipos conectados dependen de este switch.` : ''}</p>
          </div>
        )}
        <div className={styles.insight}>
          <span className={styles.insightLabel}>Enlaces</span>
          <strong>
            {formatNumber(data.totals.links)} en total · {formatNumber(data.totals.network_links)} entre equipos de red
          </strong>
          <p>{formatNumber(data.totals.functional)} marcados como funcionales en el archivo importado.</p>
        </div>
      </div>
    </>
  );
}

export default function NetworkMapPage() {
  useDocumentTitle('Mapa de red');
  return <AssetsShell description="Cómo están conectados los equipos de red del cliente, según los enlaces importados.">{(props) => <NetworkMap {...props} />}</AssetsShell>;
}
