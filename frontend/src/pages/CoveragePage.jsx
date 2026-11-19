import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AssetsShell, CriticalityBadgeTone } from '../components/assets/AssetsShell';
import { ProjectFormModal } from '../components/projects/ProjectFormModal';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ErrorState, LoadingState } from '../components/ui/StateMessage';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { assetsService } from '../services/assetsService';
import { cx } from '../utils/cx';
import { formatNumber, formatPercent } from '../utils/format';
import styles from '../components/assets/Assets.module.scss';

function Coverage({ client, version }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useApiResource((signal) => assetsService.coverage(client.id, { signal }), [client.id, version]);

  // Memorizado: el formulario del proyecto se reinicia si cambia el preset.
  const { missing, pending, projectPreset } = useMemo(() => {
    if (!data) return { missing: [], pending: [], projectPreset: null };
    const missingControls = data.controls.filter((c) => data.assets.some((a) => !a.monitoring[c.value]));
    const incomplete = data.assets.filter((a) => a.configured < data.controls.length);
    return {
      missing: missingControls,
      pending: incomplete,
      projectPreset: {
        name: `Hardening y monitoreo · ${client.name}`.slice(0, 150),
        description: `Configurar ${missingControls.map((c) => c.label).join(', ')} en ${incomplete.length} equipos de red (${incomplete.map((a) => a.name).join(', ')}). Cobertura actual: ${formatPercent(data.summary.ratio)}.`.slice(0, 1000),
      },
    };
  }, [data, client.name]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState label="Calculando la cobertura…" />;
  const { summary } = data;
  if (!summary.devices) return <p className={styles.notice}>Este cliente no tiene equipos de red en el inventario.</p>;


  return (
    <>
      <div className={styles.coverageTop}>
        <div className={styles.kpi}>
          <dt>Cobertura total</dt>
          <dd className={cx(summary.ratio < 0.5 && styles.danger)}>{formatPercent(summary.ratio)}</dd>
          <span>
            {formatNumber(summary.configured)} de {formatNumber(summary.possible)} controles configurados
          </span>
          <span className={styles.meter} aria-hidden="true">
            <span style={{ width: `${Math.round(summary.ratio * 100)}%` }} />
          </span>
        </div>
        {pending.length > 0 && (
          <div className={styles.opportunity}>
            <div>
              <span className={styles.opportunityLabel}>Oportunidad de servicio</span>
              <strong>Proyecto de hardening y monitoreo</strong>
              <p>
                Configurar {missing.map((c) => c.label).join(', ')} en {formatNumber(pending.length)} {pending.length === 1 ? 'equipo' : 'equipos'} de red. Se crea en Proyectos sobre un contrato del cliente.
              </p>
            </div>
            {can('projects.create') && (
              <Button variant="light" onClick={() => setCreating(true)}>
                Crear proyecto
              </Button>
            )}
          </div>
        )}
      </div>

      <section className={styles.card} aria-labelledby="coverage-table">
        <div className={styles.cardHeader}>
          <h2 id="coverage-table">Controles por equipo</h2>
          <span className={styles.muted}>Según la configuración registrada de cada equipo</span>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.matrix}>
            <thead>
              <tr>
                <th scope="col">Equipo</th>
                {data.controls.map((c) => (
                  <th key={c.value} scope="col" title={c.transport}>
                    {c.label}
                  </th>
                ))}
                <th scope="col" className={styles.num}>
                  Cobertura
                </th>
              </tr>
            </thead>
            <tbody>
              {data.assets.map((a) => (
                <tr key={a.id}>
                  <th scope="row">
                    <span className={styles.strong}>{a.name}</span>
                    <span className={styles.subtle}>
                      <Badge tone={CriticalityBadgeTone(a.criticality.value)}>{a.criticality.label}</Badge> {a.category.label}
                    </span>
                  </th>
                  {data.controls.map((c) => (
                    <td key={c.value} className={a.monitoring[c.value] ? styles.yes : styles.no}>
                      {a.monitoring[c.value] ? '✓ Sí' : '✕ Falta'}
                    </td>
                  ))}
                  <td className={cx(styles.num, styles.cellStrong, a.configured === 0 && styles.dangerText)}>{formatPercent(a.configured / data.controls.length)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="controls-help">
        <div className={styles.cardHeader}>
          <h2 id="controls-help">Qué se configura y para qué</h2>
        </div>
        <div className={styles.grid3}>
          {data.controls.map((c) => (
            <div key={c.value} className={styles.helpCard}>
              <strong>
                {c.label} · {c.transport}
              </strong>
              <p>{c.purpose}</p>
            </div>
          ))}
        </div>
        <p className={styles.muted}>Para activarlos hay que definir con el cliente la IP del colector de logs y los servidores NTP institucionales.</p>
      </section>

      <ProjectFormModal open={creating} preset={projectPreset} onClose={() => setCreating(false)} onSaved={(project) => navigate(`/app/projects/${project.id}`)} />
    </>
  );
}

export default function CoveragePage() {
  useDocumentTitle('Cobertura de monitoreo');
  return <AssetsShell description="Qué puede observar hoy un sistema de monitoreo en cada equipo de red del cliente.">{(props) => <Coverage {...props} />}</AssetsShell>;
}
