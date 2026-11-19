import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { Checkbox, Select, TextArea, TextField } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { useToast } from '../../hooks/useToast';
import { timeEntriesService } from '../../services/timeEntriesService';
import { formatCalendarDate, todayInBogota } from '../../utils/format';
import { addDays, formatClock, parseDuration } from '../../utils/timesheet';
import formStyles from '../ui/Form.module.scss';
import styles from './Timesheets.module.scss';

const STEP = 15;
const MAX_BACK_DAYS = 31;
const QUICK = [30, 60, 120, 240, 480];

/**
 * Registrar o corregir horas. El servidor vuelve a validar todo (asignación,
 * fechas, 24 h por día); aquí se adelantan los errores más comunes para no
 * hacer esperar a la persona.
 */
export function TimeEntryFormModal({ open, entry, preset, projects, minutesOnDay, onClose, onSaved }) {
  const editing = Boolean(entry);
  const toast = useToast();
  const today = todayInBogota();
  const minDate = addDays(today, -MAX_BACK_DAYS);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
    setConfirmDelete(false);
    setForm(
      editing
        ? {
            project_id: String(entry.project.id),
            work_date: entry.work_date,
            duration: formatClock(entry.minutes),
            description: entry.description,
            is_billable: entry.is_billable,
            is_after_hours: entry.is_after_hours,
            is_on_call: entry.is_on_call,
          }
        : {
            project_id: preset?.project_id ? String(preset.project_id) : projects.length === 1 ? String(projects[0].id) : '',
            work_date: preset?.work_date ?? today,
            duration: '',
            description: preset?.description ?? '',
            is_billable: true,
            is_after_hours: false,
            is_on_call: false,
          },
    );
  }, [open, editing, entry, preset, projects, today]);

  // Al corregir, el proyecto del registro siempre aparece aunque ya no
  // esté en la lista de hoy (por ejemplo, si la asignación terminó).
  const projectOptions = useMemo(() => {
    const list = projects.map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }));
    if (editing && !list.some((o) => o.value === String(entry.project.id))) {
      list.unshift({ value: String(entry.project.id), label: `${entry.project.code} · ${entry.project.name}` });
    }
    return [{ value: '', label: list.length ? 'Escoge un proyecto' : 'No tienes proyectos activos asignados' }, ...list];
  }, [projects, editing, entry]);

  const minutes = parseDuration(form.duration);
  const others = form.work_date ? minutesOnDay?.(form.work_date, entry?.id) : null;

  function set(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  }

  function validate() {
    const next = {};
    if (!form.project_id) next.project_id = 'Escoge el proyecto.';
    if (!form.work_date) next.work_date = 'Indica la fecha.';
    else if (form.work_date > today) next.work_date = 'No se pueden registrar horas en fechas futuras.';
    else if (form.work_date < minDate) next.work_date = `Solo se pueden registrar los últimos ${MAX_BACK_DAYS} días. Para fechas anteriores, habla con tu líder.`;
    if (minutes === null || minutes <= 0) next.duration = 'Escribe la duración, por ejemplo 2:30.';
    else if (minutes % STEP !== 0) next.duration = 'Las horas se registran en bloques de 15 minutos (0:15, 0:30, 0:45…).';
    else if (minutes > 1440) next.duration = 'Un registro no puede superar 24 horas.';
    if (!form.description?.trim() || form.description.trim().length < 3) next.description = 'Describe qué hiciste.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save(andSubmit) {
    if (!validate()) return;
    const payload = {
      project_id: Number(form.project_id),
      work_date: form.work_date,
      minutes,
      description: form.description.trim(),
      is_billable: Boolean(form.is_billable),
      is_after_hours: Boolean(form.is_after_hours),
      is_on_call: Boolean(form.is_on_call),
    };
    // Horas de la atención de un incidente: quedan enlazadas a él.
    const incidentId = editing ? entry.incident_id : preset?.incident?.id;
    if (incidentId) payload.incident_id = incidentId;

    setSaving(andSubmit ? 'submit' : 'draft');
    setFormError(null);
    try {
      const response = editing ? await timeEntriesService.update(entry.id, payload) : await timeEntriesService.create(payload);
      if (andSubmit) {
        await timeEntriesService.submit([response.data.id]);
        toast.success('Horas guardadas y enviadas a aprobación.');
      } else {
        toast.success(editing ? 'Registro actualizado. Queda en borrador hasta que lo envíes.' : 'Horas registradas en borrador.');
      }
      onSaved();
    } catch (error) {
      if (error.code === 'validation_failed') {
        const fields = error.fieldErrors;
        setErrors({ ...fields, duration: fields.minutes });
      } else {
        setFormError(error.message);
      }
    } finally {
      setSaving(null);
    }
  }

  async function remove() {
    setSaving('delete');
    setFormError(null);
    try {
      const response = await timeEntriesService.remove(entry.id);
      toast.success(response.message);
      onSaved();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(null);
    }
  }

  const busy = saving !== null;
  const rejected = editing && entry.status.value === 'rejected';

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      dismissible={!busy}
      title={editing ? (rejected ? 'Corregir registro' : 'Editar registro') : 'Registrar horas'}
      description={editing ? `${formatCalendarDate(entry.work_date)} · ${entry.status.label}` : 'En bloques de 15 minutos, en los proyectos donde estás asignado.'}
      footer={
        <div className={styles.modalFooter}>
          {editing && entry.can?.delete && (
            <Button variant={confirmDelete ? 'danger' : 'dangerGhost'} onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))} loading={saving === 'delete'} disabled={busy && saving !== 'delete'}>
              {confirmDelete ? 'Confirmar: eliminar' : 'Eliminar'}
            </Button>
          )}
          <span className={styles.footerSpacer} />
          <Button variant="secondary" onClick={() => save(false)} loading={saving === 'draft'} disabled={busy && saving !== 'draft'}>
            Guardar borrador
          </Button>
          <Button type="submit" form="time-entry-form" loading={saving === 'submit'} disabled={busy && saving !== 'submit'}>
            Guardar y enviar
          </Button>
        </div>
      }
    >
      <form
        id="time-entry-form"
        noValidate
        className={formStyles.form}
        onSubmit={(e) => {
          e.preventDefault();
          save(true);
        }}
      >
        {formError && (
          <p role="alert" className={formStyles.formError}>
            {formError}
          </p>
        )}

        {(preset?.incident || entry?.incident) && (
          <p className={styles.dayHint}>
            Horas de la atención del incidente <strong>{(preset?.incident ?? entry.incident).code}</strong>.
          </p>
        )}

        {rejected && entry.rejection_reason && (
          <div className={styles.rejection}>
            <strong>Motivo del rechazo{entry.reviewer ? ` · ${entry.reviewer.name}` : ''}</strong>
            <span>{entry.rejection_reason}</span>
          </div>
        )}

        <Select label="Proyecto" value={form.project_id ?? ''} onChange={set('project_id')} error={errors.project_id} options={projectOptions} hint="Solo aparecen los proyectos activos donde estás asignado." />

        <div className={formStyles.grid}>
          <TextField
            label="Fecha"
            type="date"
            value={form.work_date ?? ''}
            min={minDate}
            max={today}
            onChange={set('work_date')}
            error={errors.work_date}
            hint={`Desde el ${formatCalendarDate(minDate)} hasta hoy`}
          />
          <TextField
            label="Duración"
            value={form.duration ?? ''}
            onChange={set('duration')}
            error={errors.duration}
            inputMode="decimal"
            placeholder="2:30"
            hint="Horas y minutos, por ejemplo 2:30"
          />
        </div>

        <div className={styles.quick} role="group" aria-label="Duraciones rápidas">
          {QUICK.map((value) => (
            <button key={value} type="button" className={styles.quickChip} aria-pressed={minutes === value} onClick={() => setForm((f) => ({ ...f, duration: formatClock(value) }))}>
              {formatClock(value)}
            </button>
          ))}
        </div>

        <TextArea label="Descripción" value={form.description ?? ''} onChange={set('description')} error={errors.description} maxLength={500} placeholder="Qué hiciste y, si aplica, el número del ticket." />

        <fieldset className={formStyles.fieldset}>
          <legend className={formStyles.legend}>Tipo de trabajo</legend>
          <Checkbox checked={Boolean(form.is_billable)} onChange={set('is_billable')} label="Facturable al cliente" />
          <Checkbox checked={Boolean(form.is_after_hours)} onChange={set('is_after_hours')} label="Fuera del horario laboral" description="Noches, fines de semana o festivos." />
          <Checkbox checked={Boolean(form.is_on_call)} onChange={set('is_on_call')} label="Turno de disponibilidad 24/7" />
        </fieldset>

        {typeof others === 'number' && minutes > 0 && (
          <p className={styles.dayHint}>
            {others > 0 ? `Ese día llevas ${formatClock(others)} en otros registros. ` : ''}
            Con este registro sumas {formatClock(others + minutes)} de un máximo de 24 h.
          </p>
        )}
      </form>
    </Modal>
  );
}
