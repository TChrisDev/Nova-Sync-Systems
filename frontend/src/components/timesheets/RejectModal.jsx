import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { TextArea } from '../ui/Field';
import { Modal } from '../ui/Modal';
import formStyles from '../ui/Form.module.scss';
import styles from './Timesheets.module.scss';

const COMMON = ['Falta el número del ticket en la descripción.', 'Detalla qué se hizo: la descripción es muy general.', 'Este trabajo corresponde a otro proyecto; regístralo allí.', 'Las horas no coinciden con el reporte enviado al cliente.'];

/** El motivo es obligatorio: es lo que la persona lee para corregir. */
export function RejectModal({ open, count, hours, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);

  async function submit() {
    const text = reason.trim();
    if (text.length < 5) {
      setError('Explica el motivo del rechazo para que la persona pueda corregirlo.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(text);
    } catch (err) {
      setError(err.fieldErrors?.reason ?? err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      dismissible={!saving}
      title={`Rechazar ${count === 1 ? '1 registro' : `${count} registros`}`}
      description={`${hours} en total. Cada persona recibe el motivo y puede corregir y volver a enviar.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={submit} loading={saving}>
            Rechazar
          </Button>
        </>
      }
    >
      <div className={formStyles.form}>
        <div className={styles.quick} role="group" aria-label="Motivos frecuentes">
          {COMMON.map((text) => (
            <button key={text} type="button" className={styles.quickChip} aria-pressed={reason === text} onClick={() => setReason(text)}>
              {text}
            </button>
          ))}
        </div>
        <TextArea label="Motivo" required value={reason} onChange={(e) => setReason(e.target.value)} error={error} maxLength={500} placeholder="Explica qué debe corregir" />
      </div>
    </Modal>
  );
}
