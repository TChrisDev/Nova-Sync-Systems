import { Fragment, useMemo, useState } from 'react';
import { ModuleTabs } from '../components/business/ModuleTabs';
import { BarList } from '../components/timesheets/Charts';
import { RejectModal } from '../components/timesheets/RejectModal';
import { Button } from '../components/ui/Button';
import { Checkbox, Select } from '../components/ui/Field';
import { PageHeader } from '../components/ui/PageHeader';
import { SearchInput } from '../components/ui/SearchInput';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateMessage';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { inBatches, timeEntriesService } from '../services/timeEntriesService';
import { cx } from '../utils/cx';
import { formatHours, formatNumber } from '../utils/format';
import { dayLabel, formatClock, shortDate } from '../utils/timesheet';
import adminStyles from './AdminPage.module.scss';
import styles from '../components/timesheets/Timesheets.module.scss';

function range(from, to) {
  return from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`;
}

/** Detalle de un grupo: los registros enviados de esa persona en ese proyecto. */
function GroupEntries({ group }) {
  const { data, error, loading, reload } = useApiResource(
    (signal) => timeEntriesService.list({ scope: 'review', status: 'submitted', user_id: group.user.id, project_id: group.project.id, per_page: 100 }, { signal }),
    [group.key],
  );

  if (error) return <ErrorState compact error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState label="Cargando registros…" />;

  return (
    <ul className={styles.entryList}>
      {(data?.data ?? []).map((e) => (
        <li key={e.id}>
          <span className={styles.entryDate}>{dayLabel(e.work_date)}</span>
          <span className={styles.entryTime}>{formatClock(e.minutes)}</span>
          <span className={styles.entryText}>
            {e.description}
            {(e.is_after_hours || e.is_on_call) && (
              <span className={styles.entryFlags}>
                {[e.is_after_hours && 'Fuera de horario', e.is_on_call && 'Disponibilidad 24/7'].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function TimesheetReviewPage() {
  useDocumentTitle('Aprobar horas');
  const toast = useToast();
  const { can } = useAuth();
  const [projectId, setProjectId] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());
  const [rejecting, setRejecting] = useState(null); // lista de grupos
  const [approving, setApproving] = useState(null); // clave del grupo o 'selected'

  const queue = useApiResource((signal) => timeEntriesService.reviewQueue({}, { signal }), []);
  const allGroups = useMemo(() => queue.data?.groups ?? [], [queue.data]);

  const projects = useMemo(() => {
    const map = new Map();
    allGroups.forEach((g) => map.set(g.project.id, g.project));
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [allGroups]);

  const groups = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return allGroups.filter((g) => (!projectId || String(g.project.id) === projectId) && (!term || g.user.name.toLocaleLowerCase('es').includes(term)));
  }, [allGroups, projectId, search]);

  const totals = useMemo(
    () => ({
      minutes: groups.reduce((t, g) => t + g.minutes, 0),
      entries: groups.reduce((t, g) => t + g.entries, 0),
      people: new Set(groups.map((g) => g.user.id)).size,
      projects: new Set(groups.map((g) => g.project.id)).size,
      oldest: groups.reduce((min, g) => (!min || g.from < min.from ? g : min), null),
    }),
    [groups],
  );

  const byProject = useMemo(() => {
    const map = new Map();
    groups.forEach((g) => {
      const item = map.get(g.project.id) ?? { key: String(g.project.id), label: g.project.name, detail: g.project.code, value: 0 };
      item.value += g.minutes;
      map.set(g.project.id, item);
    });
    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [groups]);

  const chosen = groups.filter((g) => selected.has(g.key));
  const chosenMinutes = chosen.reduce((t, g) => t + g.minutes, 0);
  const allChecked = groups.length > 0 && chosen.length === groups.length;

  function toggle(set, key) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  function done(message) {
    toast.success(message);
    setSelected(new Set());
    setExpanded(new Set());
    queue.reload();
  }

  async function approve(list, marker) {
    setApproving(marker);
    try {
      const count = await inBatches(
        list.flatMap((g) => g.ids),
        (ids) => timeEntriesService.approve(ids),
      );
      done(count === 1 ? 'Registro aprobado.' : `${formatNumber(count)} registros aprobados.`);
    } catch (error) {
      toast.error(error.message);
      queue.reload();
    } finally {
      setApproving(null);
    }
  }

  async function reject(reason) {
    const count = await inBatches(
      rejecting.flatMap((g) => g.ids),
      (ids) => timeEntriesService.reject(ids, reason),
    );
    setRejecting(null);
    done(count === 1 ? 'Registro rechazado.' : `${formatNumber(count)} registros rechazados.`);
  }

  return (
    <>
      <PageHeader
        title="Registro de horas"
        description={
          can('timesheets.approve_any')
            ? 'Horas enviadas por el equipo. Al aprobarlas pasan de pendientes a consumidas en la bolsa del contrato.'
            : 'Horas enviadas en los proyectos que lideras. Al aprobarlas pasan de pendientes a consumidas en la bolsa del contrato.'
        }
      />
      <ModuleTabs module="timesheets" />

      {queue.error ? (
        <ErrorState error={queue.error} onRetry={queue.reload} />
      ) : queue.loading && !queue.data ? (
        <LoadingState label="Cargando horas por aprobar…" />
      ) : allGroups.length === 0 ? (
        <section className={adminStyles.panel}>
          <EmptyState icon="check" title="No hay horas por aprobar" message="Cuando alguien envíe horas en tus proyectos aparecerán aquí." />
        </section>
      ) : (
        <>
          <div className={styles.reviewTop}>
            <dl className={styles.kpis}>
              <div className={styles.kpi}>
                <dt>Por aprobar</dt>
                <dd className={styles.toneprimary}>{formatHours(totals.minutes)}</dd>
                <span className={styles.kpiDetail}>{formatNumber(totals.entries)} registros</span>
              </div>
              <div className={styles.kpi}>
                <dt>Personas</dt>
                <dd>{formatNumber(totals.people)}</dd>
                <span className={styles.kpiDetail}>en {totals.projects === 1 ? '1 proyecto' : `${totals.projects} proyectos`}</span>
              </div>
              <div className={styles.kpi}>
                <dt>Lo más antiguo</dt>
                <dd className={styles.tonewarning}>{totals.oldest ? shortDate(totals.oldest.from) : '—'}</dd>
                <span className={styles.kpiDetail}>{totals.oldest?.user.name}</span>
              </div>
            </dl>
            <section className={styles.chartCard} aria-labelledby="pending-by-project">
              <div className={styles.chartHeader}>
                <h2 id="pending-by-project">Pendiente por proyecto</h2>
              </div>
              <BarList items={byProject.slice(0, 5)} formatValue={(m) => formatHours(m)} />
            </section>
          </div>

          <section className={adminStyles.panel} aria-label="Horas por aprobar">
            <div className={cx(adminStyles.toolbar, styles.reviewToolbar)}>
              <SearchInput label="Buscar persona" value={search} onChange={setSearch} placeholder="Buscar por nombre" />
              <Select
                label="Proyecto"
                className={adminStyles.filter}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                options={[{ value: '', label: 'Todos los proyectos' }, ...projects.map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }))]}
              />
              {chosen.length > 0 && (
                <div className={styles.selectionBar} role="status">
                  <span>
                    {chosen.length === 1 ? '1 grupo' : `${chosen.length} grupos`} · {formatHours(chosenMinutes)}
                  </span>
                  <Button variant="dangerGhost" size="sm" onClick={() => setRejecting(chosen)} disabled={approving !== null}>
                    Rechazar
                  </Button>
                  <Button size="sm" icon="check" onClick={() => approve(chosen, 'selected')} loading={approving === 'selected'} disabled={approving !== null && approving !== 'selected'}>
                    Aprobar
                  </Button>
                </div>
              )}
            </div>

            {groups.length === 0 ? (
              <EmptyState icon="search" title="Sin resultados" message="Nadie coincide con la búsqueda o el proyecto escogido." />
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.reviewTable}>
                  <caption className="visually-hidden">Horas enviadas por persona y proyecto</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={styles.checkCol}>
                        <Checkbox checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(groups.map((g) => g.key)))} aria-label="Seleccionar todo" />
                      </th>
                      <th scope="col">Persona</th>
                      <th scope="col">Proyecto</th>
                      <th scope="col">Periodo</th>
                      <th scope="col" className={styles.num}>
                        Registros
                      </th>
                      <th scope="col" className={styles.num}>
                        Horas
                      </th>
                      <th scope="col" className={styles.num}>
                        <span className="visually-hidden">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => {
                      const open = expanded.has(g.key);
                      return (
                        <Fragment key={g.key}>
                          <tr className={cx(selected.has(g.key) && styles.rowSelected)}>
                            <td className={styles.checkCol}>
                              <Checkbox checked={selected.has(g.key)} onChange={() => setSelected((s) => toggle(s, g.key))} aria-label={`Seleccionar ${g.user.name} en ${g.project.name}`} />
                            </td>
                            <td>
                              <span className={styles.strong}>{g.user.name}</span>
                            </td>
                            <td>
                              {g.project.name}
                              <span className={styles.subtle}>{g.project.code}</span>
                            </td>
                            <td className={styles.nowrap}>{range(g.from, g.to)}</td>
                            <td className={styles.num}>{g.entries}</td>
                            <td className={cx(styles.num, styles.strong)}>
                              {formatHours(g.minutes)}
                              {g.after_hours_minutes > 0 && <span className={styles.subtle}>{formatHours(g.after_hours_minutes)} fuera de horario</span>}
                            </td>
                            <td className={styles.rowButtons}>
                              <Button variant="ghost" size="sm" onClick={() => setExpanded((s) => toggle(s, g.key))} aria-expanded={open}>
                                {open ? 'Ocultar' : 'Ver registros'}
                              </Button>
                              <Button variant="dangerGhost" size="sm" onClick={() => setRejecting([g])} disabled={approving !== null}>
                                Rechazar
                              </Button>
                              <Button variant="secondary" size="sm" onClick={() => approve([g], g.key)} loading={approving === g.key} disabled={approving !== null && approving !== g.key}>
                                Aprobar
                              </Button>
                            </td>
                          </tr>
                          {open && (
                            <tr className={styles.detailRow}>
                              <td colSpan={7}>
                                <GroupEntries group={g} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <RejectModal
        open={Boolean(rejecting)}
        count={rejecting?.reduce((t, g) => t + g.entries, 0) ?? 0}
        hours={formatHours(rejecting?.reduce((t, g) => t + g.minutes, 0) ?? 0)}
        onClose={() => setRejecting(null)}
        onConfirm={reject}
      />
    </>
  );
}
