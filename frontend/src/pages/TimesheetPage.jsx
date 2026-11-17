import { useMemo, useState } from 'react';
import { ModuleTabs } from '../components/business/ModuleTabs';
import { TimeEntryModal } from '../components/timesheets/TimeEntryModal';
import { addDays, cellStatus, dayNumber, isLoggable, mondayOf, sumMinutes, weekdayLabel, weekRangeLabel } from '../components/timesheets/timesheetUtils';
import styles from '../components/timesheets/Timesheets.module.scss';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Field';
import { Icon } from '../components/ui/Icon';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateMessage';
import { useApiResource } from '../hooks/useApiResource';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { timesheetsService } from '../services/timesheetsService';
import { cx } from '../utils/cx';
import { formatHours, todayInBogota } from '../utils/format';
import pageStyles from './AdminPage.module.scss';

const STATUS_CLASS = { draft: styles.draft, submitted: styles.submitted, approved: styles.approved, rejected: styles.rejected };

/** Mis horas: semana de lunes a domingo, una fila por proyecto. */
export default function TimesheetPage() {
  useDocumentTitle('Mis horas');
  const toast = useToast();
  const today = todayInBogota();
  const currentWeek = mondayOf(today);
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [extraRows, setExtraRows] = useState([]);
  const [adding, setAdding] = useState('');
  const [modal, setModal] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = days[6];

  const week = useApiResource(
    (signal) => timesheetsService.list({ scope: 'mine', from: weekStart, to: weekEnd, per_page: 100 }, { signal }),
    [weekStart],
    { live: ['timesheets'] },
  );
  const available = useApiResource((signal) => timesheetsService.projects({ signal }), [], { live: ['projects'] });

  const entries = useMemo(() => week.data?.data ?? [], [week.data]);
  const projects = useMemo(() => available.data ?? [], [available.data]);

  // Filas: proyectos con horas esta semana más los que la persona agregó.
  const rows = useMemo(() => {
    const byId = new Map();
    entries.forEach((e) => byId.set(e.project.id, { id: e.project.id, code: e.project.code, name: e.project.name }));
    extraRows.forEach((id) => {
      const p = projects.find((item) => item.id === id);
      if (p && !byId.has(id)) byId.set(id, { id: p.id, code: p.code, name: p.name, client: p.contract?.client?.name });
    });
    projects.forEach((p) => byId.has(p.id) && (byId.get(p.id).client = p.contract?.client?.name));
    return [...byId.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [entries, extraRows, projects]);

  const addable = projects.filter((p) => !rows.some((r) => r.id === p.id));
  const drafts = entries.filter((e) => e.status === 'draft');
  const rejected = entries.filter((e) => e.status === 'rejected');
  const totals = {
    week: sumMinutes(entries),
    draft: sumMinutes(drafts),
    submitted: sumMinutes(entries.filter((e) => e.status === 'submitted')),
    approved: sumMinutes(entries.filter((e) => e.status === 'approved')),
  };

  const cellEntries = (projectId, day) => entries.filter((e) => e.project.id === projectId && e.work_date === day);

  async function submitWeek() {
    setSubmitting(true);
    try {
      const response = await timesheetsService.submit(drafts.map((e) => e.id));
      toast.success(response.message);
      week.reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  function addRow() {
    if (!adding) return;
    setExtraRows((list) => [...list, Number(adding)]);
    setAdding('');
  }

  const loading = (week.loading && !week.data) || (available.loading && !available.data);

  return (
    <>
      <PageHeader
        title="Registro de horas"
        description="Registra tus horas en bloques de 15 minutos y envíalas a aprobación al terminar la semana."
        actions={
          <Button icon="plus" onClick={() => setModal({})} disabled={!projects.length}>
            Registrar horas
          </Button>
        }
      />
      <ModuleTabs module="timesheets" />

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <p className={styles.metricLabel}>Esta semana</p>
          <p className={styles.metricValue}>{formatHours(totals.week)}</p>
        </div>
        <div className={styles.metric}>
          <p className={styles.metricLabel}>En borrador</p>
          <p className={styles.metricValue}>{formatHours(totals.draft)}</p>
          <p className={styles.metricDetail}>Aún no se han enviado</p>
        </div>
        <div className={styles.metric}>
          <p className={styles.metricLabel}>Por aprobar</p>
          <p className={styles.metricValue}>{formatHours(totals.submitted)}</p>
        </div>
        <div className={styles.metric}>
          <p className={styles.metricLabel}>Aprobadas</p>
          <p className={styles.metricValue}>{formatHours(totals.approved)}</p>
        </div>
      </div>

      <section className={pageStyles.panel} aria-label="Semana de horas">
        <div className={styles.weekBar}>
          <div className={styles.weekNav}>
            <button type="button" className={styles.iconButton} onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Semana anterior">
              <Icon name="chevron-left" size={18} />
            </button>
            <span className={styles.weekLabel} aria-live="polite">
              {weekRangeLabel(weekStart)}
            </span>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              disabled={weekStart >= currentWeek}
              aria-label="Semana siguiente"
            >
              <Icon name="chevron-right" size={18} />
            </button>
            {weekStart !== currentWeek && (
              <Button size="sm" variant="ghost" onClick={() => setWeekStart(currentWeek)}>
                Esta semana
              </Button>
            )}
          </div>
          {addable.length > 0 && (
            <div className={styles.addRow}>
              <Select
                label="Agregar proyecto a la semana"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                options={[{ value: '', label: 'Agregar proyecto…' }, ...addable.map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }))]}
              />
              <Button size="sm" variant="secondary" icon="plus" onClick={addRow} disabled={!adding}>
                Agregar
              </Button>
            </div>
          )}
        </div>

        {rejected.length > 0 && (
          <div className={styles.notice} role="status">
            <Icon name="alert" size={18} />
            <p>
              Tienes {rejected.length === 1 ? 'un registro rechazado' : `${rejected.length} registros rechazados`} esta semana
              {rejected[0]?.rejection_reason ? ` (“${rejected[0].rejection_reason}”)` : ''}. Ábrelos en la tabla, corrígelos y vuelve a enviarlos.
            </p>
          </div>
        )}

        {week.error ? (
          <ErrorState error={week.error} onRetry={week.reload} />
        ) : loading ? (
          <LoadingState label="Cargando tu semana…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="clock"
            title={projects.length ? 'Registra tus primeras horas de la semana' : 'No tienes proyectos donde registrar horas'}
            message={
              projects.length
                ? 'Agrega un proyecto a la semana o usa “Registrar horas”.'
                : 'Puedes registrar horas en los proyectos en curso donde estás asignado o que lideras. Pide a tu líder que te asigne.'
            }
            action={
              projects.length > 0 && (
                <Button icon="plus" onClick={() => setModal({})}>
                  Registrar horas
                </Button>
              )
            }
          />
        ) : (
          <div className={styles.gridWrap}>
            <table className={styles.grid}>
              <caption className="visually-hidden">Horas por proyecto y día de la semana</caption>
              <thead>
                <tr>
                  <th scope="col">Proyecto</th>
                  {days.map((day) => (
                    <th key={day} scope="col" className={cx(day === today && styles.today)}>
                      {weekdayLabel(day)} {dayNumber(day)}
                    </th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" style={{ textAlign: 'left' }}>
                      <span className={styles.projectCode}>{row.code}</span>
                      <span className={styles.projectName}>
                        {row.name}
                        {row.client ? ` · ${row.client}` : ''}
                      </span>
                    </th>
                    {days.map((day) => {
                      const items = cellEntries(row.id, day);
                      const minutes = sumMinutes(items);
                      const status = cellStatus(items);
                      const loggable = isLoggable(day, today);
                      return (
                        <td key={day}>
                          <button
                            type="button"
                            className={cx(styles.cell, status && STATUS_CLASS[status])}
                            disabled={!items.length && !loggable}
                            onClick={() => setModal({ project: row, date: day })}
                            aria-label={`${row.code}, ${weekdayLabel(day)} ${dayNumber(day)}: ${minutes ? formatHours(minutes) : 'sin horas'}`}
                          >
                            {minutes ? formatHours(minutes, { unit: false }) : loggable ? '+' : '–'}
                          </button>
                        </td>
                      );
                    })}
                    <td className={styles.total}>{formatHours(sumMinutes(entries.filter((e) => e.project.id === row.id)), { unit: false })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total del día</td>
                  {days.map((day) => (
                    <td key={day}>{formatHours(sumMinutes(entries.filter((e) => e.work_date === day)), { unit: false })}</td>
                  ))}
                  <td>{formatHours(totals.week, { unit: false })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className={styles.footer}>
          <div className={styles.legend} aria-label="Estados">
            <span>
              <span className={cx(styles.swatch, styles.draft)} /> Borrador
            </span>
            <span>
              <span className={cx(styles.swatch, styles.submitted)} /> Enviada
            </span>
            <span>
              <span className={cx(styles.swatch, styles.approved)} /> Aprobada
            </span>
            <span>
              <span className={cx(styles.swatch, styles.rejected)} /> Rechazada
            </span>
          </div>
          <div className={styles.actions}>
            <Button icon="send" onClick={submitWeek} loading={submitting} disabled={!drafts.length}>
              {drafts.length ? `Enviar a aprobación (${formatHours(totals.draft)})` : 'Nada por enviar'}
            </Button>
          </div>
        </div>
      </section>

      <TimeEntryModal
        open={Boolean(modal)}
        today={today}
        project={modal?.project}
        date={modal?.date}
        cellEntries={modal?.project ? cellEntries(modal.project.id, modal.date) : []}
        weekEntries={entries}
        projects={projects}
        onClose={() => setModal(null)}
        onChanged={week.reload}
      />
    </>
  );
}
