import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Checkbox, Select, TextField } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { useToast } from '../../hooks/useToast';
import { monitoringService } from '../../services/assetsService';
import formStyles from '../ui/Form.module.scss';

const OPERATORS = [
  { value: 'gte', label: 'mayor o igual a (≥)' },
  { value: 'gt', label: 'mayor que (>)' },
  { value: 'lte', label: 'menor o igual a (≤)' },
  { value: 'lt', label: 'menor que (<)' },
  { value: 'eq', label: 'igual a (=)' },
];
const SEVERITIES = [
  { value: 'critical', label: 'Crítica' },
  { value: 'warning', label: 'Aviso' },
  { value: 'info', label: 'Informativa' },
];

/** Regla de alerta: "si la lectura de este tipo cumple X, genera una alerta". */
export function RuleFormModal({ open, rule, client, readingTypes, onClose, onSaved }) {
  const editing = Boolean(rule);
  const toast = useToast();
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
    setForm({
      name: rule?.name ?? '',
      reading_type: rule?.reading_type ?? 'TEMP',
      operator: rule?.operator.value ?? 'gte',
      threshold: rule ? String(rule.threshold).replace('.', ',') : '',
      severity: rule?.severity.value ?? 'warning',
      opens_incident: rule?.opens_incident ?? false,
      is_active: rule?.is_active ?? true,
      only_client: rule ? rule.scope === 'client' : true,
    });
  }, [open, rule]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const unit = readingTypes.find((t) => t.value === form.reading_type)?.unit;

  async function save() {
    const threshold = Number(String(form.threshold).replace(',', '.'));
    const next = {};
    if (!form.name?.trim() || form.name.trim().length < 3) next.name = 'Ponle un nombre a la regla.';
    if (form.threshold === '' || Number.isNaN(threshold)) next.threshold = 'Escribe el umbral (un número).';
    setErrors(next);
    if (Object.keys(next).length) return;

    const payload = {
      name: form.name.trim(),
      reading_type: form.reading_type,
      operator: form.operator,
      threshold,
      severity: form.severity,
      opens_incident: Boolean(form.opens_incident),
      is_active: Boolean(form.is_active),
    };
    if (!editing) payload.client_id = form.only_client ? client.id : null;

    setSaving(true);
    setFormError(null);
    try {
      const response = editing ? await monitoringService.updateRule(rule.id, payload) : await monitoringService.createRule(payload);
      toast.success(response.message);
      onSaved();
    } catch (error) {
      if (error.code === 'validation_failed') setErrors(error.fieldErrors);
      else setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      dismissible={!saving}
      title={editing ? 'Editar regla de alerta' : 'Nueva regla de alerta'}
      description="Se evalúa con cada lectura de los sensores del tipo escogido."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="rule-form" loading={saving}>
            {editing ? 'Guardar cambios' : 'Crear regla'}
          </Button>
        </>
      }
    >
      <form
        id="rule-form"
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
        <TextField label="Nombre" value={form.name ?? ''} onChange={set('name')} error={errors.name} maxLength={100} placeholder="Temperatura alta" />
        <Select label="Tipo de lectura" value={form.reading_type ?? ''} onChange={set('reading_type')} error={errors.reading_type} options={readingTypes.map((t) => ({ value: t.value, label: `${t.label}${t.unit ? ` (${t.unit})` : ''}` }))} />
        <div className={formStyles.grid}>
          <Select label="Condición" value={form.operator ?? 'gte'} onChange={set('operator')} options={OPERATORS} />
          <TextField label={`Umbral${unit ? ` (${unit})` : ''}`} value={form.threshold ?? ''} onChange={set('threshold')} error={errors.threshold} inputMode="decimal" />
        </div>
        <Select label="Severidad" value={form.severity ?? 'warning'} onChange={set('severity')} options={SEVERITIES} />
        <Checkbox checked={Boolean(form.opens_incident)} onChange={set('opens_incident')} label="Abrir un incidente" description="Las alertas de varios sensores en pocos minutos se agrupan en un mismo incidente." />
        <Checkbox checked={Boolean(form.is_active)} onChange={set('is_active')} label="Regla activa" />
        {!editing && <Checkbox checked={Boolean(form.only_client)} onChange={set('only_client')} label={`Solo para ${client.name}`} description="Si la desmarcas, aplica a los sensores de todos los clientes." />}
      </form>
    </Modal>
  );
}
