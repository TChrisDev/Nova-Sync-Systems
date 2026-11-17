import { useMemo, useState } from 'react';
import { ModuleTabs } from '../components/business/ModuleTabs';
import { ENTRY_STATUS, longDateLabel } from '../components/timesheets/timesheetUtils';
import styles from '../components/timesheets/Timesheets.module.scss';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Select, TextArea, TextField } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { EmptyState, ErrorState } from '../components/ui/StateMessage';
import { Cell, SkeletonRows, Table } from '../components/ui/Table';
import { useApiResource } from '../hooks/useApiResource';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { timesheetsService } from '../services/timesheetsService';
import { formatHours } from '../utils/format';
import formStyles from '../components/ui/Form.module.scss';
import pageStyles from './AdminPage.module.scss';

const STATUS_OPTIONS = [
  { value: 'submitted', label: 'Por aprobar' },
  { value: 'approved', label: 'Aprobadas' },
  { value: 'rejected', label: 'Rechazadas' },
  { value: '', label: 'Todas' },
];

/** Aprobaciones: horas de los proyectos que la persona lidera (o de todos, con approve_any). */
export default function TimesheetApprovalsPage() {
  useDocumentTitle('Aprobación de horas');
  const toast = useToast();
  const [filters, setFilters] = useState({ status: 'submitted', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [working, setWorking] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(null);

  const query = { scope: 'review', status: filters.status || undefined, from: filters.from || undefined, to: filters.to || undefined };
  const list = useApiResource(
    (signal) => timesheetsService.list({ ...query, page, per_page: 50 }, { signal }),
    [filters, page],
    { live: ['timesheets'] },
  );
  const summary = useApiResource((signal) => timesheetsService.summary({ scope: 'review', status: 'submitted' }, { signal }), [], { live: ['timesheets'] });

  const entries = useMemo(() => list.data?.data ?? [], [list.data]);
  const reviewable = entries.filter((e) => e.can?.review);
  const chosen = reviewable.filter((e) => selected.has(e.id));
  const chosenMinutes = chosen.reduce((t, e) => t + e.minutes, 0);
  const allChosen = reviewable.length > 0 && chosen.length === reviewable.length;

  function setFilter(key) {
    return (e) => {
      setFilters((f) => ({ ...f, [key]: e.target.value }));
      setPage(1);
      setSelected(new Set());
    };
  }

  function toggle(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function act(action) {
    setWorking(true);
    try {
      const ids = chosen.map((e) => e.id);
      const response = action === 'approve' ? await timesheetsService.approve(ids) : await timesheetsService.reject(ids, reason.trim());
      toast.success(response.message);
      setSelected(new Set());
      setRejecting(false);
      setReason('');
      list.reload();
      summary.reload();
    } catch (error) {
      if (action === 'reject' && error.code === 'validation_failed') setReasonError(error.fieldErrors.reason ?? error.message);
      else toast.error(error.message);
    } finally {
      setWorking(false);
    }
  }

  function confirmReject() {
    if (reason.trim().length < 5) {
      setReasonError('Explica el motivo (mínimo 5 caracteres) para que la persona pueda corregirlo.');
      return;
    }
    act('reject');
  }

  const columns = [
    { key: 'select', label: 'Seleccionar', hidden: true, width: '3rem' },
    { key: 'person', label: 'Persona' },
    { key: 'project', label: 'Proyecto' },
    { key: 'date', label: 'Fecha' },
    { key: 'description', label: 'Descripción' },
    { key: 'status', label: 'Estado' },
    { key: 'hours', label: 'Horas', align: 'end' },
  ];

  return (
    <>
      <PageHeader title="Registro de horas" description="Aprueba o rechaza las horas de los proyectos que lideras. Nunca se aprueban las propias." />
      <ModuleTabs module="timesheets" />

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <p className={styles.metricLabel}>Por aprobar</p>
          <p className={styles.metricValue}>{formatHours(summary.data?.submitted_minutes ?? 0)}</p>
          <p className={styles.metricDetail}>{summary.data ? `${summary.data.entries} registros` : '—'}</p>
        </div>
        <div className={styles.metric}>
          <p className={styles.metricLabel}>Fuera de horario</p>
          <p className={styles.metricValue}>{formatHours(summary.data?.after_hours_minutes ?? 0)}</p>
        </div>
        <div className={styles.metric}>
          <p className={styles.metricLabel}>Disponibilidad</p>
          <p className={styles.metricValue}>{formatHours(summary.data?.on_call_minutes ?? 0)}</p>
        </div>
      </div>

      <section className={pageStyles.panel} aria-label="Horas por aprobar">
        <div className={pageStyles.toolbar}>
          <Select label="Estado" className={pageStyles.filter} value={filters.status} onChange={setFilter('status')} options={STATUS_OPTIONS} />
          <TextField label="Desde" type="date" className={pageStyles.filter} value={filters.from} onChange={setFilter('from')} />
          <TextField label="Hasta" type="date" className={pageStyles.filter} value={filters.to} min={filters.from || undefined} onChange={setFilter('to')} />
        </div>

        {chosen.length > 0 && (
          <div className={styles.selectionBar} role="status">
            <span>
              {chosen.length === 1 ? '1 registro seleccionado' : `${chosen.length} registros seleccionados`} · {formatHours(chosenMinutes)}
            </span>
            <div className={styles.actions}>
              <Button size="sm" variant="dangerGhost" icon="x" onClick={() => { setReason(''); setReasonError(null); setRejecting(true); }} disabled={working}>
                Rechazar
              </Button>
              <Button size="sm" icon="check" onClick={() => act('approve')} loading={working && !rejecting}>
                Aprobar
              </Button>
            </div>
          </div>
        )}

        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : !list.loading && entries.length === 0 ? (
          <EmptyState
            icon="check"
            title={filters.status === 'submitted' ? 'No hay horas por aprobar' : 'Sin resultados'}
            message={filters.status === 'submitted' ? 'Cuando tu equipo envíe sus horas aparecerán aquí.' : 'Ningún registro coincide con los filtros.'}
          />
        ) : (
          <Table caption="Horas de los proyectos que puedes aprobar" columns={columns}>
            {list.loading && !list.data ? (
              <SkeletonRows columns={columns.length} />
            ) : (
              <>
                {reviewable.length > 1 && (
                  <tr>
                    <Cell label="Seleccionar">
                      <input
                        type="checkbox"
                        className={styles.check}
                        checked={allChosen}
                        onChange={() => setSelected(allChosen ? new Set() : new Set(reviewable.map((e) => e.id)))}
                        aria-label="Seleccionar todas las horas por aprobar de esta página"
                      />
                    </Cell>
                    <Cell label="">
                      <span className={pageStyles.secondary}>Seleccionar todas ({reviewable.length})</span>
                    </Cell>
                    <td colSpan={5} />
                  </tr>
                )}
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <Cell label="Seleccionar">
                      {entry.can?.review && (
                        <input
                          type="checkbox"
                          className={styles.check}
                          checked={selected.has(entry.id)}
                          onChange={() => toggle(entry.id)}
                          aria-label={`Seleccionar ${formatHours(entry.minutes)} de ${entry.user?.name}`}
                        />
                      )}
                    </Cell>
                    <Cell label="Persona">{entry.user?.name}</Cell>
                    <Cell label="Proyecto">
                      <span className={pageStyles.primaryText}>{entry.project?.code}</span>
                      <span className={pageStyles.secondary}>{entry.project?.name}</span>
                    </Cell>
                    <Cell label="Fecha">{longDateLabel(entry.work_date)}</Cell>
                    <Cell label="Descripción">
                      {entry.description}
                      <span className={pageStyles.tags}>
                        {!entry.is_billable && <Badge>No facturable</Badge>}
                        {entry.is_after_hours && <Badge tone="accent">Fuera de horario</Badge>}
                        {entry.is_on_call && <Badge tone="accent">Disponibilidad</Badge>}
                      </span>
                      {entry.status === 'rejected' && entry.rejection_reason && <span className={styles.reason}>Motivo: {entry.rejection_reason}</span>}
                    </Cell>
                    <Cell label="Estado">
                      <Badge tone={ENTRY_STATUS[entry.status]?.tone}>{ENTRY_STATUS[entry.status]?.label}</Badge>
                    </Cell>
                    <Cell label="Horas" align="end">
                      <span className="tabular">{formatHours(entry.minutes)}</span>
                    </Cell>
                  </tr>
                ))}
              </>
            )}
          </Table>
        )}

        <Pagination meta={list.data?.meta} onPageChange={(p) => { setPage(p); setSelected(new Set()); }} label="registros" />
      </section>

      <Modal
        open={rejecting}
        onClose={working ? () => {} : () => setRejecting(false)}
        dismissible={!working}
        size="sm"
        title={chosen.length === 1 ? 'Rechazar registro' : `Rechazar ${chosen.length} registros`}
        description={`${formatHours(chosenMinutes)} en total. La persona verá el motivo en su semana y podrá corregirlos.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(false)} disabled={working}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmReject} loading={working}>
              Rechazar horas
            </Button>
          </>
        }
      >
        <div className={formStyles.form}>
          <TextArea
            label="Motivo del rechazo"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(null);
            }}
            error={reasonError}
            maxLength={500}
            placeholder="Falta el número del ticket en la descripción"
            required
          />
        </div>
      </Modal>
    </>
  );
}
