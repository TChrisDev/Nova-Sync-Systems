import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { IncidentTone, SeverityTone } from '../components/assets/AssetsShell';
import { BackLink, ModuleTabs } from '../components/business/ModuleTabs';
import { TimeEntryFormModal } from '../components/timesheets/TimeEntryFormModal';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Select, TextArea } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../components/ui/StateMessage';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { monitoringService } from '../services/assetsService';
import { projectsService } from '../services/projectsService';
import { timeEntriesService } from '../services/timeEntriesService';
import { formatDayTime, formatDecimal, formatTime, readingStatus } from '../utils/assets';
import { cx } from '../utils/cx';
import { formatCalendarDate, formatHours } from '../utils/format';
import { STATUS_LABELS } from '../utils/timesheet';
import formStyles from '../components/ui/Form.module.scss';
import styles from '../components/assets/Assets.module.scss';

/** Cerrar exige explicar cómo se resolvió (o por qué fue un falso positivo). */
function CloseModal({ open, status, onClose, onConfirm }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
    }
  }, [open]);

  async function confirm() {
    if (text.trim().length < 5) return setError('Explica en una frase qué se encontró y qué se hizo.');
    setSaving(true);
    try {
      await onConfirm(text.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={status === 'false_positive' ? 'Marcar como falso positivo' : 'Resolver incidente'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={confirm} loading={saving}>
            {status === 'false_positive' ? 'Marcar falso positivo' : 'Resolver'}
          </Button>
        </>
      }
    >
      <div className={formStyles.form}>
        <TextArea
          label={status === 'false_positive' ? '¿Por qué no fue un evento real?' : '¿Cómo se resolvió?'}
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={error}
          maxLength={2000}
          placeholder={status === 'false_positive' ? 'Prueba de alarma programada por el cliente a las 09:40.' : 'Se reemplazó el sensor de la oficina 2.'}
        />
      </div>
    </Modal>
  );
}

export default function IncidentDetailPage() {
  const { incidentId } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApiResource((signal) => monitoringService.incident(incidentId, { signal }), [incidentId]);
  useDocumentTitle(data ? `${data.code} · ${data.title}` : 'Incidente');
  const canManage = can('assets.incidents');
  const canLog = can('timesheets.create');
  const [closing, setClosing] = useState(null);
  const [logging, setLogging] = useState(false);
  const [saving, setSaving] = useState(null);

  const clientId = data?.client?.id;
  const projects = useApiResource(
    (signal) => (clientId && canManage && can('projects.view') ? projectsService.list({ client_id: clientId, open: 1, per_page: 50 }, { signal }).then((r) => r.data) : Promise.resolve([])),
    [clientId],
  );
  const myProjects = useApiResource((signal) => (canLog ? timeEntriesService.projects({ signal }) : Promise.resolve([])), [canLog]);
  const loggable = useMemo(() => (myProjects.data ?? []).filter((p) => p.contract?.client?.id === clientId || p.id === data?.project?.id), [myProjects.data, clientId, data]);
  const logPreset = useMemo(() => (data ? { project_id: data.project?.id ?? loggable[0]?.id, incident: { id: data.id, code: data.code }, description: `${data.code}: ` } : null), [data, loggable]);

  async function update(payload, message) {
    setSaving(payload.status ?? Object.keys(payload)[0]);
    try {
      await monitoringService.updateIncident(data.id, payload);
      toast.success(message);
      reload();
    } catch (err) {
      toast.error(err.message);
      throw err;
    } finally {
      setSaving(null);
    }
  }

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState label="Cargando el incidente…" />;

  const first = data.alerts[0];
  const sameMinute = data.alerts.length > 1 && data.alerts.every((a) => formatTime(a.triggered_at) === formatTime(first.triggered_at));
  const locations = [...new Set(data.alerts.map((a) => a.asset.location).filter(Boolean))];

  return (
    <>
      <BackLink to="/app/assets/incidents">Incidentes</BackLink>
      <PageHeader
        title={data.title}
        description={`${data.client.name} · abierto el ${formatDayTime(data.opened_at)}${data.alerts.length ? ' automáticamente por una regla de alerta' : ''}.`}
        actions={
          canManage && (
            <div className={styles.inlineActions}>
              {!data.is_closed && data.status.value === 'open' && (
                <Button variant="secondary" onClick={() => update({ status: 'in_progress' }, 'Incidente en atención.')} loading={saving === 'in_progress'}>
                  Tomar el incidente
                </Button>
              )}
              {!data.is_closed && (
                <>
                  <Button variant="secondary" onClick={() => setClosing('false_positive')}>
                    Falso positivo
                  </Button>
                  <Button icon="check" onClick={() => setClosing('resolved')}>
                    Resolver
                  </Button>
                </>
              )}
              {data.is_closed && (
                <Button variant="secondary" icon="refresh" onClick={() => update({ status: 'open' }, 'Incidente reabierto.')} loading={saving === 'open'}>
                  Reabrir
                </Button>
              )}
            </div>
          )
        }
      >
        <div className={styles.headerBadges}>
          <span className={styles.code}>{data.code}</span>
          <Badge tone={SeverityTone(data.severity.value)}>{data.severity.label}</Badge>
          <Badge tone={IncidentTone(data.status.value)} dot>
            {data.status.label}
          </Badge>
        </div>
      </PageHeader>
      <ModuleTabs module="assets" />

      <div className={styles.detailGrid}>
        <div className={styles.detailMain}>
          {data.alerts.length > 0 && (
            <section className={cx(styles.card, styles.analysis)} aria-labelledby="analysis">
              <div className={styles.cardHeader}>
                <h2 id="analysis">Qué pasó</h2>
              </div>
              <p>
                {data.alerts.length === 1
                  ? `${first.asset.name} registró ${formatDecimal(first.value)} ${first.unit ?? ''} a las ${formatTime(first.triggered_at)} (${first.rule}).`
                  : `${data.alerts.length} alertas de «${first.rule}» en ${new Set(data.alerts.map((a) => a.asset.id)).size} equipos${locations.length ? ` de ${locations.join(', ')}` : ''}${sameMinute ? `, todas en el mismo minuto (${formatTime(first.triggered_at)})` : ''}.`}
              </p>
              {sameMinute && locations.length > 1 && (
                <p className={styles.anomaly}>
                  <strong>Revisa antes de escalar.</strong> Un evento real rara vez aparece al mismo tiempo en {locations.length} ubicaciones distintas. Puede ser una prueba de alarma, un falso positivo o sensores que reportan desde un mismo origen.
                </p>
              )}
            </section>
          )}

          <section className={styles.card} aria-labelledby="timeline">
            <div className={styles.cardHeader}>
              <h2 id="timeline">Línea de tiempo</h2>
            </div>
            {data.alerts.length === 0 && data.context.length === 0 ? (
              <p className={styles.muted}>Incidente abierto a mano: no tiene alertas asociadas.</p>
            ) : (
              <ol className={styles.timeline}>
                {data.alerts.map((a) => (
                  <li key={`a-${a.id}`}>
                    <span className={styles.time}>{formatTime(a.triggered_at)}</span>
                    <span>
                      <strong>
                        {a.rule}: {formatDecimal(a.value)} {a.unit}
                      </strong>
                      <span className={styles.subtle}>
                        {a.asset.name}
                        {a.asset.location ? ` · ${a.asset.location}` : ''}
                        {a.note ? ` · ${a.note}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
                {data.context
                  .filter((c) => !data.alerts.some((a) => a.asset.name === c.asset && formatTime(a.triggered_at) === formatTime(c.at)))
                  .map((c, i) => {
                    const [label] = readingStatus(c.status);
                    return (
                      <li key={`c-${i}`} className={styles.contextItem}>
                        <span className={styles.time}>{formatTime(c.at)}</span>
                        <span>
                          <strong>
                            {c.asset}: {label}
                          </strong>
                          <span className={styles.subtle}>
                            {c.location ? `${c.location} · ` : ''}
                            {c.note ?? ''}
                          </span>
                        </span>
                      </li>
                    );
                  })}
              </ol>
            )}
            {data.context.length > 0 && <p className={styles.muted}>Incluye lo que reportaron los demás sensores del cliente dos minutos antes y después.</p>}
          </section>

          {data.is_closed && data.resolution && (
            <section className={styles.card} aria-labelledby="resolution">
              <div className={styles.cardHeader}>
                <h2 id="resolution">{data.status.value === 'false_positive' ? 'Por qué fue un falso positivo' : 'Resolución'}</h2>
                <span className={styles.muted}>{formatDayTime(data.resolved_at)}</span>
              </div>
              <p>{data.resolution}</p>
            </section>
          )}
        </div>

        <aside className={styles.detailSide}>
          <section className={styles.card} aria-labelledby="details">
            <div className={styles.cardHeader}>
              <h2 id="details">Detalles</h2>
            </div>
            <dl className={styles.facts}>
              <dt>Cliente</dt>
              <dd>{data.client.name}</dd>
              <dt>Responsable</dt>
              <dd>
                {canManage ? (
                  <Select
                    label="Responsable"
                    className={styles.inlineSelect}
                    value={data.assignee ? String(data.assignee.id) : ''}
                    onChange={(e) => update({ assigned_to: e.target.value ? Number(e.target.value) : null }, 'Responsable actualizado.').catch(() => {})}
                    options={[{ value: '', label: 'Sin asignar' }, ...data.assignable.map((u) => ({ value: String(u.id), label: u.name }))]}
                  />
                ) : (
                  (data.assignee?.name ?? 'Sin asignar')
                )}
              </dd>
              <dt>Proyecto de las horas</dt>
              <dd>
                {canManage && (projects.data ?? []).length > 0 ? (
                  <Select
                    label="Proyecto"
                    className={styles.inlineSelect}
                    value={data.project ? String(data.project.id) : ''}
                    onChange={(e) => update({ project_id: e.target.value ? Number(e.target.value) : null }, 'Proyecto actualizado.').catch(() => {})}
                    options={[{ value: '', label: 'Sin proyecto' }, ...projects.data.map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }))]}
                  />
                ) : (
                  (data.project ? `${data.project.code} · ${data.project.name}` : 'Sin proyecto')
                )}
              </dd>
              {data.description && (
                <>
                  <dt>Descripción</dt>
                  <dd>{data.description}</dd>
                </>
              )}
            </dl>
          </section>

          <section className={styles.card} aria-labelledby="hours">
            <div className={styles.cardHeader}>
              <h2 id="hours">Horas de la atención</h2>
            </div>
            <strong className={styles.bigNumber}>{formatHours(data.minutes ?? 0)}</strong>
            <p className={styles.muted}>Se registran en el proyecto del cliente y, una vez aprobadas, consumen la bolsa de su contrato.</p>
            {data.time_entries.length > 0 && (
              <ul className={styles.entryList}>
                {data.time_entries.map((e) => (
                  <li key={e.id}>
                    <span>
                      {formatCalendarDate(e.work_date)} · <strong>{formatHours(e.minutes)}</strong> · {e.user?.name}
                    </span>
                    <span className={styles.subtle}>
                      {STATUS_LABELS[e.status.value]} · {e.description}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canLog &&
              (loggable.length ? (
                <Button variant="secondary" icon="clock" onClick={() => setLogging(true)}>
                  Registrar horas
                </Button>
              ) : (
                <p className={styles.muted}>Para registrar horas debes estar asignado a un proyecto activo de este cliente.</p>
              ))}
          </section>
        </aside>
      </div>

      <CloseModal
        open={Boolean(closing)}
        status={closing}
        onClose={() => setClosing(null)}
        onConfirm={async (resolution) => {
          await update({ status: closing, resolution }, closing === 'false_positive' ? 'Marcado como falso positivo.' : 'Incidente resuelto.');
          setClosing(null);
        }}
      />
      {canLog && (
        <TimeEntryFormModal
          open={logging}
          preset={logPreset}
          projects={loggable}
          onClose={() => setLogging(false)}
          onSaved={() => {
            setLogging(false);
            reload();
          }}
        />
      )}
    </>
  );
}
