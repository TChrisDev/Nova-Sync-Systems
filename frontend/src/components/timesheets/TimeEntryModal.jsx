import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Checkbox, Select, TextArea, TextField } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { useToast } from '../../hooks/useToast';
import { timesheetsService } from '../../services/timesheetsService';
import { formatHours } from '../../utils/format';
import formStyles from '../ui/Form.module.scss';
import { addDays, ENTRY_STATUS, longDateLabel, MAX_BACKDATE_DAYS, STEP_MINUTES } from './timesheetUtils';
import styles from './Timesheets.module.scss';

const HOURS = Array.from({ length: 25 }, (_, h) => ({ value: String(h), label: `${h} h` }));
const MINUTES = [0, 15, 30, 45].map((m) => ({ value: String(m), label: `${m} min` }));

function emptyForm(projectId, date) {
  return {
    project_id: projectId ? String(projectId) : '',
    work_date: date ?? '',
    hours: '1',
    minutes: '0',
    description: '',
    is_billable: true,
    is_after_hours: false,
    is_on_call: false,
  };
}

function formFromEntry(entry) {
  return {
    project_id: String(entry.project.id),
    work_date: entry.work_date,
    hours: String(Math.floor(entry.minutes / 60)),
    minutes: String(entry.minutes % 60),
    description: entry.description,
    is_billable: entry.is_billable,
    is_after_hours: entry.is_after_hours,
    is_on_call: entry.is_on_call,
  };
}

/**
 * Registrar o corregir horas. Abierto desde una celda muestra además los
 * registros de ese día y proyecto, con sus acciones. Las reglas de negocio
 * las vuelve a validar la API y sus mensajes se muestran tal cual.
 */
export function TimeEntryModal({ open, today, project, date, cellEntries = [], weekEntries = [], projects = [], onClose, onChanged }) {
  const toast = useToast();
  const [form, setForm] = useState(() => emptyForm());
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Se reinicia solo al abrir: los refrescos en vivo de la semana no deben
  // borrar lo que la persona está escribiendo.
  useEffect(() => {
    if (!open) return;
    setForm(emptyForm(project?.id ?? (projects.length === 1 ? projects[0].id : ''), date ?? today));
    setEditing(null);
    setErrors({});
    setFormError(null);
    setConfirmDelete(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id, date]);

  const projectOptions = useMemo(() => {
    const list = projects.map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }));
    if (project && !list.some((o) => o.value === String(project.id))) list.unshift({ value: String(project.id), label: `${project.code} · ${project.name}` });
    return [{ value: '', label: list.length ? 'Escoge el proyecto' : 'No tienes proyectos activos' }, ...list];
  }, [projects, project]);

  const minutes = Number(form.hours) * 60 + Number(form.minutes);
  const sameDay = weekEntries.filter((e) => e.work_date === form.work_date && e.id !== editing?.id);
  const dayMinutes = sameDay.reduce((total, e) => total + e.minutes, 0);

  function set(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  }

  function validate() {
    const next = {};
    if (!form.project_id) next.project_id = 'Escoge el proyecto.';
    if (!form.work_date) next.work_date = 'Indica la fecha.';
    else if (form.work_date > today) next.work_date = 'No se registran horas en fechas futuras.';
    else if (form.work_date < addDays(today, -MAX_BACKDATE_DAYS)) next.work_date = `Solo puedes registrar hasta ${MAX_BACKDATE_DAYS} días atrás.`;
    if (minutes < STEP_MINUTES) next.hours = 'Registra al menos 15 minutos.';
    else if (minutes > 1440) next.hours = 'Un registro no puede superar 24 horas.';
    else if (dayMinutes + minutes > 1440) next.hours = `Ese día ya llevas ${formatHours(dayMinutes)}: no puede pasar de 24 h.`;
    if (form.description.trim().length < 3) next.description = 'Describe brevemente el trabajo (mínimo 3 caracteres).';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!validate()) return;
    const payload = {
      project_id: Number(form.project_id),
      work_date: form.work_date,
      minutes,
      description: form.description.trim(),
      is_billable: form.is_billable,
      is_after_hours: form.is_after_hours,
      is_on_call: form.is_on_call,
    };

    setSaving(true);
    setFormError(null);
    try {
      const response = editing ? await timesheetsService.update(editing.id, payload) : await timesheetsService.create(payload);
      toast.success(response.message);
      onChanged();
      if (editing || !project) onClose();
      else setForm((f) => ({ ...emptyForm(f.project_id, f.work_date) }));
      setEditing(null);
    } catch (error) {
      if (error.code === 'validation_failed') setErrors(error.fieldErrors);
      else setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(entry) {
    if (confirmDelete !== entry.id) {
      setConfirmDelete(entry.id);
      return;
    }
    setSaving(true);
    try {
      const response = await timesheetsService.remove(entry.id);
      toast.success(response.message);
      setConfirmDelete(null);
      if (editing?.id === entry.id) {
        setEditing(null);
        setForm(emptyForm(project?.id, date));
      }
      onChanged();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  const title = editing ? 'Corregir registro' : 'Registrar horas';
  const description = project && date ? `${project.code} · ${project.name} · ${longDateLabel(date)}` : 'Las horas quedan en borrador hasta que envíes la semana.';

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      dismissible={!saving}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={editing ? () => { setEditing(null); setForm(emptyForm(project?.id, date)); } : onClose} disabled={saving}>
            {editing ? 'Cancelar corrección' : 'Cerrar'}
          </Button>
          <Button type="submit" form="time-entry-form" loading={saving}>
            {editing ? 'Guardar corrección' : 'Guardar borrador'}
          </Button>
        </>
      }
    >
      {cellEntries.length > 0 && (
        <ul className={styles.entries} aria-label="Registros de este día">
          {cellEntries.map((entry) => (
            <li key={entry.id} className={`${styles.entry} ${editing?.id === entry.id ? styles.entrySelected : ''}`}>
              <div className={styles.entryMain}>
                <p>
                  <span className={styles.entryHours}>{formatHours(entry.minutes)}</span> · {entry.description}
                </p>
                <p className={styles.entryMeta}>
                  <Badge tone={ENTRY_STATUS[entry.status]?.tone}>{ENTRY_STATUS[entry.status]?.label ?? entry.status}</Badge>
                  {!entry.is_billable && <Badge>No facturable</Badge>}
                  {entry.is_after_hours && <Badge tone="accent">Fuera de horario</Badge>}
                  {entry.is_on_call && <Badge tone="accent">Disponibilidad</Badge>}
                </p>
                {entry.status === 'rejected' && entry.rejection_reason && <p className={styles.reason}>Motivo del rechazo: {entry.rejection_reason}</p>}
              </div>
              <div className={styles.entryActions}>
                {entry.can?.update && (
                  <Button size="sm" variant="ghost" icon="edit" disabled={saving} onClick={() => { setEditing(entry); setForm(formFromEntry(entry)); setErrors({}); }}>
                    Corregir
                  </Button>
                )}
                {entry.can?.delete && (
                  <Button size="sm" variant="dangerGhost" icon="trash" disabled={saving} onClick={() => remove(entry)}>
                    {confirmDelete === entry.id ? 'Confirmar' : 'Eliminar'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        id="time-entry-form"
        noValidate
        className={formStyles.form}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {formError && (
          <p role="alert" className={formStyles.formError}>
            {formError}
          </p>
        )}

        {!project || editing ? (
          <Select label="Proyecto" value={form.project_id} onChange={set('project_id')} options={projectOptions} error={errors.project_id} />
        ) : null}

        {(!date || editing) && (
          <TextField
            label="Fecha"
            type="date"
            value={form.work_date}
            onChange={set('work_date')}
            max={today}
            min={addDays(today, -MAX_BACKDATE_DAYS)}
            error={errors.work_date}
            required
          />
        )}

        <div className={styles.duration}>
          <Select label="Horas" value={form.hours} onChange={set('hours')} options={HOURS} error={errors.hours} />
          <Select label="Minutos" value={form.minutes} onChange={set('minutes')} options={MINUTES} hint="Bloques de 15 minutos" />
        </div>

        <TextArea
          label="Descripción"
          value={form.description}
          onChange={set('description')}
          error={errors.description}
          maxLength={500}
          placeholder="Ticket #4821: reinicio del clúster de pagos"
          required
        />

        <div className={styles.flags}>
          <Checkbox checked={form.is_billable} onChange={set('is_billable')} label="Facturable" />
          <Checkbox checked={form.is_after_hours} onChange={set('is_after_hours')} label="Fuera de horario" />
          <Checkbox checked={form.is_on_call} onChange={set('is_on_call')} label="Disponibilidad" />
        </div>

        {form.work_date && (
          <p className={styles.dayHint}>
            Ese día llevas {formatHours(dayMinutes)} de 24 h. Puedes registrar hasta {MAX_BACKDATE_DAYS} días atrás.
          </p>
        )}
      </form>
    </Modal>
  );
}
