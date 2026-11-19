import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Checkbox, Select, TextArea, TextField } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { assetsService } from '../../services/assetsService';
import formStyles from '../ui/Form.module.scss';
import styles from './Assets.module.scss';

const NETWORK = ['router', 'firewall', 'switch_l3', 'switch_access'];
const split = (text) =>
  String(text ?? '')
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);

/**
 * Registrar o editar un equipo. IP, MAC y serial solo aparecen (y solo se
 * envían) para quien tiene permiso de ver datos técnicos; la API lo exige igual.
 */
export function AssetFormModal({ open, asset, client, meta, onClose, onSaved }) {
  const editing = Boolean(asset);
  const { can } = useAuth();
  const toast = useToast();
  const technical = can('assets.technical');
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
    setForm({
      name: asset?.name ?? '',
      category: asset?.category.value ?? '',
      criticality: asset?.criticality.value ?? 'medium',
      model: asset?.model ?? '',
      role: asset?.role ?? '',
      location: asset?.location ?? '',
      vlan: asset?.vlan ?? '',
      reading_type: asset?.reading_type ?? '',
      notes: asset?.notes ?? '',
      is_active: asset?.is_active ?? true,
      serial: asset?.serial ?? '',
      ip_addresses: (asset?.ip_addresses ?? []).join(', '),
      mac_addresses: (asset?.mac_addresses ?? []).join(', '),
      gateway: asset?.gateway ?? '',
      monitoring: { ...(asset?.monitoring ?? {}) },
    });
  }, [open, asset]);

  const isNetwork = NETWORK.includes(form.category);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save() {
    const next = {};
    if (!form.name?.trim()) next.name = 'Escribe el nombre del equipo.';
    if (!form.category) next.category = 'Escoge la categoría.';
    setErrors(next);
    if (Object.keys(next).length) return;

    const payload = {
      name: form.name.trim(),
      category: form.category,
      criticality: form.criticality,
      model: form.model || null,
      role: form.role || null,
      location: form.location || null,
      vlan: form.vlan || null,
      reading_type: form.reading_type || null,
      notes: form.notes || null,
      is_active: Boolean(form.is_active),
      ...(isNetwork ? { monitoring: form.monitoring } : {}),
      ...(technical
        ? { serial: form.serial || null, ip_addresses: split(form.ip_addresses), mac_addresses: split(form.mac_addresses), gateway: form.gateway || null }
        : {}),
    };
    if (!editing) payload.client_id = client.id;

    setSaving('save');
    setFormError(null);
    try {
      const response = editing ? await assetsService.update(asset.id, payload) : await assetsService.create(payload);
      toast.success(response.message);
      onSaved();
    } catch (error) {
      if (error.code === 'validation_failed') {
        const fields = error.fieldErrors;
        const ip = Object.entries(fields).find(([k]) => k.startsWith('ip_addresses'));
        const mac = Object.entries(fields).find(([k]) => k.startsWith('mac_addresses'));
        setErrors({ ...fields, ...(ip ? { ip_addresses: ip[1] } : {}), ...(mac ? { mac_addresses: mac[1] } : {}) });
      } else setFormError(error.message);
    } finally {
      setSaving(null);
    }
  }

  async function remove() {
    setSaving('delete');
    try {
      const response = await assetsService.remove(asset.id);
      toast.success(response.message);
      onSaved();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(null);
    }
  }

  const options = (list, empty) => [...(empty ? [{ value: '', label: empty }] : []), ...(list ?? []).map((o) => ({ value: o.value, label: o.label }))];

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      dismissible={!saving}
      size="lg"
      title={editing ? `Editar ${asset.name}` : 'Registrar equipo'}
      description={client?.name}
      footer={
        <div className={styles.modalFooter}>
          {editing && asset.can?.delete && (
            <Button variant={confirmDelete ? 'danger' : 'dangerGhost'} onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))} loading={saving === 'delete'}>
              {confirmDelete ? 'Confirmar: eliminar con sus lecturas' : 'Eliminar'}
            </Button>
          )}
          <span className={styles.spacer} />
          <Button variant="secondary" onClick={onClose} disabled={Boolean(saving)}>
            Cancelar
          </Button>
          <Button type="submit" form="asset-form" loading={saving === 'save'}>
            {editing ? 'Guardar cambios' : 'Registrar'}
          </Button>
        </div>
      }
    >
      <form
        id="asset-form"
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
        <div className={formStyles.grid}>
          <TextField label="Nombre" value={form.name ?? ''} onChange={set('name')} error={errors.name} maxLength={120} />
          <Select label="Categoría" value={form.category ?? ''} onChange={set('category')} error={errors.category} options={options(meta?.categories, 'Escoge la categoría')} />
          <TextField label="Modelo" value={form.model ?? ''} onChange={set('model')} error={errors.model} maxLength={80} />
          <TextField label="Rol en la red" value={form.role ?? ''} onChange={set('role')} error={errors.role} maxLength={80} placeholder="Core, acceso, perímetro…" />
          <TextField label="Ubicación" value={form.location ?? ''} onChange={set('location')} error={errors.location} maxLength={120} placeholder="Cuarto técnico, oficina…" />
          <TextField label="VLAN" value={form.vlan ?? ''} onChange={set('vlan')} error={errors.vlan} maxLength={40} />
        </div>

        <fieldset className={formStyles.fieldset}>
          <legend className={formStyles.legend}>Criticidad</legend>
          <div className={styles.pills} role="radiogroup">
            {(meta?.criticalities ?? []).map((c) => (
              <label key={c.value} className={styles.pill} data-checked={form.criticality === c.value}>
                <input type="radio" name="criticality" value={c.value} checked={form.criticality === c.value} onChange={set('criticality')} />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>

        {technical && (
          <div className={formStyles.grid}>
            <TextField label="Serial" value={form.serial ?? ''} onChange={set('serial')} error={errors.serial} maxLength={80} />
            <TextField label="Gateway" value={form.gateway ?? ''} onChange={set('gateway')} error={errors.gateway} placeholder="192.168.10.1" />
            <TextField label="Direcciones IP" value={form.ip_addresses ?? ''} onChange={set('ip_addresses')} error={errors.ip_addresses} hint="Separadas por coma" />
            <TextField label="Direcciones MAC" value={form.mac_addresses ?? ''} onChange={set('mac_addresses')} error={errors.mac_addresses} hint="00:1A:2B:3C:4D:5E o 001A.2B3C.4D5E" />
          </div>
        )}

        {isNetwork && (
          <fieldset className={formStyles.fieldset}>
            <legend className={formStyles.legend}>
              Controles de monitoreo configurados
              <span className={formStyles.legendHint}>Solo se registra qué está configurado; nunca contraseñas ni comunidades SNMP.</span>
            </legend>
            <div className={styles.checkGrid}>
              {(meta?.controls ?? []).map((c) => (
                <Checkbox
                  key={c.value}
                  label={c.label}
                  description={c.transport}
                  checked={Boolean(form.monitoring?.[c.value])}
                  onChange={(e) => setForm((f) => ({ ...f, monitoring: { ...f.monitoring, [c.value]: e.target.checked } }))}
                />
              ))}
            </div>
          </fieldset>
        )}

        {(form.category === 'iot' || form.category === 'cctv' || form.reading_type) && (
          <Select label="Tipo de lectura" value={form.reading_type ?? ''} onChange={set('reading_type')} options={[{ value: '', label: 'No reporta lecturas' }, ...(meta?.reading_types ?? []).map((t) => ({ value: t.value, label: `${t.label}${t.unit ? ` (${t.unit})` : ''}` }))]} />
        )}

        <TextArea label="Notas" value={form.notes ?? ''} onChange={set('notes')} maxLength={1000} rows={2} />
        <Checkbox checked={Boolean(form.is_active)} onChange={set('is_active')} label="Equipo en servicio" description="Los equipos fuera de servicio no cuentan en el panel ni en el mapa." />
      </form>
    </Modal>
  );
}
