import { useCallback, useMemo, useState } from 'react';
import { ModuleTabs } from '../components/business/ModuleTabs';
import { ColumnChart, Legend } from '../components/timesheets/Charts';
import { TimeEntryFormModal } from '../components/timesheets/TimeEntryFormModal';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateMessage';
import { useApiResource } from '../hooks/useApiResource';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { timeEntriesService } from '../services/timeEntriesService';
import { cx } from '../utils/cx';
import { formatHours, todayInBogota } from '../utils/format';
import { addDays, dayLabel, formatClock, mondayOf, shortDate, STATUS_LABELS, weekDays, weekTitle } from '../utils/timesheet';
import styles from '../components/timesheets/Timesheets.module.scss';

const MAX_BACK_DAYS = 31;
const STATUS_ORDER = ['approved', 'submitted', 'draft', 'rejected'];
const LEGEND = [
  { tone: 'success', label: 'Aprobado' },
  { tone: 'primary', label: 'Enviado' },
  { tone: 'neutral', label: 'Borrador' },
  { tone: 'danger', label: 'Rechazado' },
];
const TONE = { approved: 'success', submitted: 'primary', draft: 'neutral', rejected: 'danger' };

function sumBy(entries, status) {
  return entries.filter((e) => !status || e.status.value === status).reduce((total, e) => total + e.minutes, 0);
}

export default function TimesheetPage() {
  useDocumentTitle('Mis horas');
  const toast = useToast();
  const today = todayInBogota();
  const minDate = addDays(today, -MAX_BACK_DAYS);
  const [monday, setMonday] = useState(() => mondayOf(today));
  const [modal, setModal] = useState(null); // { entry } o { preset }
  const [submitting, setSubmitting] = useState(false);
  const days = useMemo(() => weekDays(monday), [monday]);
  const sunday = days[6];

  const week = useApiResource((signal) => timeEntriesService.list({ scope: 'mine', from: monday, to: sunday, per_page: 100 }, { signal }), [monday]);
  const rejected = useApiResource((signal) => timeEntriesService.list({ scope: 'mine', status: 'rejected', per_page: 20 }, { signal }), []);
  const projects = useApiResource((signal) => timeEntriesService.projects({ signal }), []);
  const report = useApiResource((signal) => timeEntriesService.report({ scope: 'mine', from: addDays(monday, -28), to: sunday }, { signal }), [monday]);

  const entries = useMemo(() => week.data?.data ?? [], [week.data]);
  const assignable = useMemo(() => projects.data ?? [], [projects.data]);
  const thisWeek = report.data?.weeks?.at(-1);
  const holidays = useMemo(() => new Map((thisWeek?.holidays ?? []).map((h) => [h.date, h.name])), [thisWeek]);
  const dailyCapacity = thisWeek?.working_days ? thisWeek.capacity_minutes / thisWeek.working_days : null;

  // Filas: los proyectos donde puedo registrar hoy más los que ya tienen horas esta semana.
  const rows = useMemo(() => {
    const map = new Map(assignable.map((p) => [p.id, { id: p.id, code: p.code, name: p.name, assignable: true }]));
    entries.forEach((e) => {
      if (!map.has(e.project.id)) map.set(e.project.id, { ...e.project, assignable: false });
    });
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [assignable, entries]);

  const reloadAll = useCallback(() => {
    week.reload();
    rejected.reload();
    report.reload();
  }, [week, rejected, report]);

  const minutesOnDay = useCallback(
    (date, ignoreId) => (date >= monday && date <= sunday ? entries.filter((e) => e.work_date === date && e.id !== ignoreId).reduce((t, e) => t + e.minutes, 0) : null),
    [entries, monday, sunday],
  );

  const drafts = entries.filter((e) => e.status.value === 'draft');
  const total = sumBy(entries);
  const capacity = thisWeek?.capacity_minutes ?? null;
  const pendingRejected = rejected.data?.data ?? [];

  async function submitDrafts() {
    setSubmitting(true);
    try {
      const response = await timeEntriesService.submit(drafts.map((e) => e.id));
      toast.success(response.message);
      reloadAll();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  const canLogOn = (date) => date >= minDate && date <= today;
  // Al registrar desde el encabezado: hoy si se está viendo esta semana; si
  // no, el último día permitido de la semana que se está viendo.
  const defaultDate = days.filter(canLogOn).includes(today) ? today : (days.filter(canLogOn).at(-1) ?? today);

  const dayColumns = days.map((date, index) => {
    const dayEntries = entries.filter((e) => e.work_date === date);
    const working = index < 5 && !holidays.has(date);
    return {
      key: date,
      label: dayLabel(date).split(' ')[0],
      note: holidays.has(date) ? 'festivo' : undefined,
      reference: working && dailyCapacity ? dailyCapacity : 0,
      segments: STATUS_ORDER.map((status) => ({ tone: TONE[status], value: sumBy(dayEntries, status) })),
      tooltip: `${dayLabel(date)}: ${formatClock(sumBy(dayEntries))}`,
    };
  });

  const weekColumns = (report.data?.weeks ?? []).map((w) => ({
    key: w.week_start,
    label: shortDate(w.week_start),
    note: w.holidays.length ? 'festivo' : undefined,
    reference: w.capacity_minutes ?? 0,
    segments: STATUS_ORDER.map((status) => ({ tone: TONE[status], value: w.by_status[status] ?? 0 })),
    tooltip: `Semana del ${shortDate(w.week_start)}: ${formatHours(w.total_minutes)} de ${formatHours(w.capacity_minutes ?? 0)}`,
  }));

  return (
    <>
      <PageHeader
        title="Registro de horas"
        description="Registra en bloques de 15 minutos en los proyectos donde estás asignado. Puedes registrar hasta 31 días atrás, nunca fechas futuras."
        actions={
          <>
            {drafts.length > 0 && (
              <Button variant="secondary" icon="check" onClick={submitDrafts} loading={submitting}>
                Enviar a aprobación ({drafts.length})
              </Button>
            )}
            <Button icon="plus" onClick={() => setModal({ preset: { work_date: defaultDate } })} disabled={!assignable.length}>
              Registrar horas
            </Button>
          </>
        }
      />
      <ModuleTabs module="timesheets" />

      <div className={styles.weekNav}>
        <div className={styles.weekNavButtons}>
          <Button variant="secondary" size="sm" icon="arrow" className={styles.prev} aria-label="Semana anterior" onClick={() => setMonday((m) => addDays(m, -7))} />
          <h2 className={styles.weekTitle}>{weekTitle(monday)}</h2>
          <Button variant="secondary" size="sm" icon="arrow" aria-label="Semana siguiente" onClick={() => setMonday((m) => addDays(m, 7))} disabled={addDays(monday, 7) > today} />
        </div>
        {monday !== mondayOf(today) && (
          <Button variant="ghost" size="sm" onClick={() => setMonday(mondayOf(today))}>
            Ir a esta semana
          </Button>
        )}
      </div>

      <dl className={styles.kpis}>
        <div className={styles.kpi}>
          <dt>Registradas</dt>
          <dd>
            {formatHours(total)}
            {capacity ? <span className={styles.kpiOf}> de {formatHours(capacity)}</span> : null}
          </dd>
          {capacity ? (
            <span className={styles.kpiTrack} aria-hidden="true">
              <span style={{ width: `${Math.min(100, (total / capacity) * 100)}%` }} />
            </span>
          ) : null}
        </div>
        <div className={styles.kpi}>
          <dt>Enviadas, esperando aprobación</dt>
          <dd className={styles.toneprimary}>{formatHours(sumBy(entries, 'submitted'))}</dd>
          <span className={styles.kpiDetail}>{entries.filter((e) => e.status.value === 'submitted').length} registros</span>
        </div>
        <div className={styles.kpi}>
          <dt>Aprobadas</dt>
          <dd className={styles.tonesuccess}>{formatHours(sumBy(entries, 'approved'))}</dd>
          <span className={styles.kpiDetail}>{entries.filter((e) => e.status.value === 'approved').length} registros</span>
        </div>
        <div className={styles.kpi}>
          <dt>Borrador y rechazadas</dt>
          <dd className={sumBy(entries, 'rejected') ? styles.tonedanger : undefined}>{formatHours(sumBy(entries, 'draft') + sumBy(entries, 'rejected'))}</dd>
          <span className={styles.kpiDetail}>sin enviar o por corregir</span>
        </div>
      </dl>

      {pendingRejected.length > 0 && (
        <section className={styles.rejectedBanner} aria-labelledby="rejected-title">
          <div className={styles.rejectedHeader}>
            <h2 id="rejected-title">
              {pendingRejected.length === 1 ? 'Tienes 1 registro rechazado' : `Tienes ${pendingRejected.length} registros rechazados`}
            </h2>
            <span>Corrígelos y vuelve a enviarlos</span>
          </div>
          <ul className={styles.rejectedList}>
            {pendingRejected.map((e) => (
              <li key={e.id}>
                <button type="button" className={styles.rejectedItem} onClick={() => setModal({ entry: e })}>
                  <span className={styles.rejectedMeta}>
                    {dayLabel(e.work_date).split(' ')[0]} {shortDate(e.work_date)} · {formatClock(e.minutes)} · {e.project.code}
                  </span>
                  <span>{e.rejection_reason}</span>
                  {e.reviewer && <span className={styles.rejectedBy}>{e.reviewer.name}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.panel} aria-label="Horas de la semana">
        {week.error ? (
          <ErrorState error={week.error} onRetry={week.reload} />
        ) : week.loading && !week.data ? (
          <LoadingState label="Cargando la semana…" />
        ) : rows.length === 0 ? (
          <EmptyState icon="clock" title="No tienes proyectos donde registrar horas" message="Cuando tu líder te asigne a un proyecto activo, aparecerá aquí." />
        ) : (
          <div className={styles.gridWrap}>
            <table className={styles.grid}>
              <caption className="visually-hidden">Horas por proyecto y día de la semana</caption>
              <thead>
                <tr>
                  <th scope="col" className={styles.projectCol}>
                    Proyecto
                  </th>
                  {days.map((date) => (
                    <th key={date} scope="col" className={cx(date === today && styles.today, holidays.has(date) && styles.holidayHead)}>
                      {dayLabel(date)}
                      {holidays.has(date) && <span className={styles.holidayName}>Festivo</span>}
                    </th>
                  ))}
                  <th scope="col" className={styles.totalCol}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((project) => {
                  const projectEntries = entries.filter((e) => e.project.id === project.id);
                  return (
                    <tr key={project.id}>
                      <th scope="row" className={styles.projectCol}>
                        <span className={styles.projectName}>{project.name}</span>
                        <span className={styles.projectCode}>{project.code}</span>
                      </th>
                      {days.map((date) => {
                        const cellEntries = projectEntries.filter((e) => e.work_date === date);
                        return (
                          <td key={date} className={cx(styles.cell, holidays.has(date) && styles.holidayCell)}>
                            {cellEntries.map((e) => {
                              const content = (
                                <>
                                  <span className={styles.chipTime}>{formatClock(e.minutes)}</span>
                                  <span className={styles.chipStatus}>
                                    {STATUS_LABELS[e.status.value]}
                                    {(e.is_after_hours || e.is_on_call) && (
                                      <>
                                        <Icon name="clock" size={11} />
                                        <span className="visually-hidden">{e.is_on_call ? ', disponibilidad 24/7' : ', fuera de horario'}</span>
                                      </>
                                    )}
                                  </span>
                                </>
                              );
                              const title = `${e.description}${e.rejection_reason ? `\nRechazado: ${e.rejection_reason}` : ''}`;
                              return e.can?.update ? (
                                <button key={e.id} type="button" className={cx(styles.chip, styles[`chip-${e.status.value}`])} title={title} onClick={() => setModal({ entry: e })} aria-label={`${formatClock(e.minutes)} ${STATUS_LABELS[e.status.value]}, ${dayLabel(date)}. Editar`}>
                                  {content}
                                </button>
                              ) : (
                                <span key={e.id} className={cx(styles.chip, styles[`chip-${e.status.value}`])} title={title}>
                                  {content}
                                </span>
                              );
                            })}
                            {project.assignable && canLogOn(date) && cellEntries.length === 0 && (
                              <button type="button" className={styles.add} onClick={() => setModal({ preset: { project_id: project.id, work_date: date } })} aria-label={`Registrar horas en ${project.name} el ${dayLabel(date)}`}>
                                <Icon name="plus" size={16} />
                              </button>
                            )}
                          </td>
                        );
                      })}
                      <td className={styles.totalCol}>{formatClock(sumBy(projectEntries))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className={styles.projectCol}>
                    Total del día
                  </th>
                  {days.map((date) => (
                    <td key={date}>{formatClock(sumBy(entries.filter((e) => e.work_date === date)))}</td>
                  ))}
                  <td className={styles.totalCol}>{formatClock(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <div className={styles.charts}>
        <section className={styles.chartCard} aria-labelledby="chart-days">
          <div className={styles.chartHeader}>
            <h2 id="chart-days">Horas por día y estado</h2>
            <p>{dailyCapacity ? `La marca punteada es tu jornada diaria: ${formatHours(dailyCapacity)}.` : 'Esta semana, día por día.'}</p>
          </div>
          <Legend items={LEGEND} />
          <ColumnChart
            columns={dayColumns}
            formatValue={(m) => formatHours(m, { unit: false })}
            formatTick={(m) => `${formatHours(m, { unit: false })} h`}
            unit={60}
            ariaLabel={`Horas por día de la ${weekTitle(monday).toLowerCase()}: ${days.map((d) => `${dayLabel(d)} ${formatHours(sumBy(entries.filter((e) => e.work_date === d)))}`).join(', ')}`}
          />
        </section>
        <section className={styles.chartCard} aria-labelledby="chart-weeks">
          <div className={styles.chartHeader}>
            <h2 id="chart-weeks">Tus últimas 5 semanas</h2>
            <p>Contra tu capacidad semanal, descontando festivos.</p>
          </div>
          <Legend items={LEGEND} />
          {report.error ? (
            <ErrorState compact error={report.error} onRetry={report.reload} />
          ) : (
            <ColumnChart
              columns={weekColumns}
              formatValue={(m) => formatHours(m, { unit: false })}
              formatTick={(m) => `${formatHours(m, { unit: false })} h`}
              unit={60}
              ariaLabel={`Horas por semana: ${weekColumns.map((c) => c.tooltip).join('; ')}`}
            />
          )}
        </section>
      </div>

      <TimeEntryFormModal
        open={Boolean(modal)}
        entry={modal?.entry}
        preset={modal?.preset}
        projects={assignable}
        minutesOnDay={minutesOnDay}
        onClose={() => setModal(null)}
        onSaved={() => {
          setModal(null);
          reloadAll();
        }}
      />
    </>
  );
}
