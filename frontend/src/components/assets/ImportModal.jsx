import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { useToast } from '../../hooks/useToast';
import { assetsService } from '../../services/assetsService';
import { formatNumber } from '../../utils/format';
import formStyles from '../ui/Form.module.scss';
import styles from './Assets.module.scss';

const KIND_LABELS = {
  inventory: 'Inventario de equipos',
  monitoring: 'Controles de monitoreo',
  links: 'Enlaces entre equipos',
  iot_devices: 'Dispositivos IoT',
  iot_readings: 'Lecturas de sensores',
};

const COUNT_LABELS = [
  ['assets_created', 'Equipos nuevos'],
  ['assets_updated', 'Equipos actualizados'],
  ['links_created', 'Enlaces nuevos'],
  ['links_updated', 'Enlaces actualizados'],
  ['readings_created', 'Lecturas nuevas'],
  ['readings_existing', 'Lecturas que ya estaban'],
  ['rules_created', 'Reglas de alerta iniciales'],
  ['alerts', 'Alertas'],
  ['incidents', 'Incidentes'],
];

/**
 * Importar desde Excel en dos pasos: primero una vista previa (no guarda
 * nada) y luego la confirmación. Volver a importar el mismo archivo
 * actualiza los equipos en lugar de duplicarlos.
 */
export function ImportModal({ open, clients, defaultClientId, onClose, onImported }) {
  const toast = useToast();
  const input = useRef(null);
  const [clientId, setClientId] = useState('');
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!open) return;
    setClientId(defaultClientId ? String(defaultClientId) : '');
    setFiles([]);
    setPreview(null);
    setError(null);
  }, [open, defaultClientId]);

  async function run(dryRun) {
    if (!clientId) return setError('Escoge el cliente dueño de los equipos.');
    if (!files.length) return setError('Escoge al menos un archivo de Excel (.xlsx).');
    setBusy(dryRun ? 'preview' : 'import');
    setError(null);
    try {
      const response = await assetsService.importFiles(Number(clientId), files, dryRun);
      if (dryRun) {
        setPreview(response.data);
      } else {
        toast.success(`Importación completada: ${formatNumber(response.data.counts.assets_created + response.data.counts.assets_updated)} equipos y ${formatNumber(response.data.counts.readings_created)} lecturas nuevas.`);
        onImported(Number(clientId));
      }
    } catch (err) {
      setError(Object.values(err.fieldErrors ?? {})[0] ?? err.message);
    } finally {
      setBusy(null);
    }
  }

  const nothing = preview && Object.values(preview.counts).every((v) => v === 0);

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      dismissible={!busy}
      size="lg"
      title="Importar desde Excel"
      description="Inventario de red (equipos, enlaces y controles de monitoreo) y archivos de IoT (dispositivos y lecturas). Primero verás un resumen; nada se guarda hasta confirmar."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={Boolean(busy)}>
            Cancelar
          </Button>
          {preview ? (
            <Button icon="check" onClick={() => run(false)} loading={busy === 'import'} disabled={nothing}>
              Confirmar importación
            </Button>
          ) : (
            <Button icon="search" onClick={() => run(true)} loading={busy === 'preview'}>
              Revisar archivos
            </Button>
          )}
        </>
      }
    >
      <div className={formStyles.form}>
        {error && (
          <p role="alert" className={formStyles.formError}>
            {error}
          </p>
        )}

        <Select
          label="Cliente"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setPreview(null);
          }}
          options={[{ value: '', label: 'Escoge el cliente' }, ...clients.map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` }))]}
          hint="Los equipos quedan asociados a este cliente."
        />

        <div className={styles.fileField}>
          <span className={styles.fileLabel}>Archivos</span>
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            multiple
            className="visually-hidden"
            id="assets-import-files"
            onChange={(e) => {
              setFiles([...e.target.files].slice(0, 4));
              setPreview(null);
            }}
          />
          <label htmlFor="assets-import-files" className={styles.fileDrop}>
            <strong>{files.length ? 'Cambiar archivos' : 'Escoger archivos .xlsx'}</strong>
            <span>Hasta 4 archivos de 10 MB. Puedes subir el inventario y el de IoT juntos.</span>
          </label>
          {files.length > 0 && (
            <ul className={styles.fileList}>
              {files.map((f) => (
                <li key={f.name}>
                  {f.name} <span>{formatNumber(Math.round(f.size / 1024))} KB</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {preview && (
          <section className={styles.preview} aria-label="Resumen de la importación">
            <h3>Resumen para {preview.client.name}</h3>
            <ul className={styles.recognized}>
              {preview.files.map((f) => (
                <li key={f.file}>
                  <strong>{f.file}</strong>
                  <span>{f.kinds.length ? f.kinds.map((k) => KIND_LABELS[k] ?? k).join(' · ') : 'Sin hojas reconocidas'}</span>
                </li>
              ))}
            </ul>
            <dl className={styles.previewCounts}>
              {COUNT_LABELS.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{formatNumber(preview.counts[key] ?? 0)}</dd>
                </div>
              ))}
            </dl>
            {preview.warnings.length > 0 && (
              <details className={styles.warnings}>
                <summary>{preview.warnings.length === 1 ? '1 aviso' : `${preview.warnings.length} avisos`} (filas omitidas o datos que no cuadran)</summary>
                <ul>
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            {nothing && <p className={styles.muted}>Estos archivos no traen nada nuevo para importar.</p>}
          </section>
        )}
      </div>
    </Modal>
  );
}
