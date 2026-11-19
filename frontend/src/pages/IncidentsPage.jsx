import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AssetsShell, IncidentTone, SeverityTone } from '../components/assets/AssetsShell';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Select, TextArea, TextField } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { Pagination } from '../components/ui/Pagination';
import { EmptyState, ErrorState } from '../components/ui/StateMessage';
import { Cell, SkeletonRows, Table } from '../components/ui/Table';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { monitoringService } from '../services/assetsService';
import { formatDayTime } from '../utils/assets';
import { formatHours, formatNumber } from '../utils/format';
import formStyles from '../components/ui/Form.module.scss';
import adminStyles from './AdminPage.module.scss';

const STATUS_FILTERS = [
  { value: 'open_any', label: 'Abiertos y en atención' },
  { value: '', label: 'Todos' },
  { value: 'open', label: 'Abiertos' },
  { value: 'in_progress', label: 'En atención' },
  { value: 'resolved', label: 'Resueltos' },
  { value: 'false_positive', label: 'Falsos positivos' },
];

const COLUMNS = [
  { key: 'incident', label: 'Incidente' },
  { key: 'severity', label: 'Severidad' },
  { key: 'status', label: 'Estado' },
  { key: 'opened', label: 'Abierto' },
  { key: 'alerts', label: 'Alertas', align: 'end' },
  { key: 'hours', label: 'Horas', align: 'end' },
  { key: 'assignee', label: 'Responsable' },
];

function NewIncidentModal({ open, client, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: '', severity: 'warning', description: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (form.title.trim().length < 5) return setError('Describe el incidente en el título (al menos 5 caracteres).');
    setSaving(true);
    setError(null);
    try {
      const response = await monitoringService.createIncident({ client_id: client.id, ...form, title: form.title.trim() });
      toast.success(response.message);
      onCreated(response.data);
    } catch (err) {
      setError(Object.values(err.fieldErrors ?? {})[0] ?? err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title="Abrir incidente"
      description={`${client.name}. Para algo que no vino de una alerta: una llamada del cliente, un hallazgo en sitio…`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving}>
            Abrir incidente
          </Button>
        </>
      }
    >
      <div className={formStyles.form}>
        {error && (
          <p role="alert" className={formStyles.formError}>
            {error}
          </p>
        )}
        <TextField label="Título" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={150} />
        <Select
          label="Severidad"
          value={form.severity}
          onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
          options={[
            { value: 'critical', label: 'Crítica' },
            { value: 'warning', label: 'Aviso' },
            { value: 'info', label: 'Informativa' },
          ]}
        />
        <TextArea label="Descripción" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={2000} />
      </div>
    </Modal>
  );
}

function Incidents({ client, version, creating, setCreating }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState('open_any');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApiResource((signal) => monitoringService.incidents(client.id, { status, page }, { signal }), [client.id, status, page, version]);
  const incidents = data?.data ?? [];

  return (
    <section className={adminStyles.panel} aria-label="Incidentes">
      <div className={adminStyles.toolbar}>
        <Select
          label="Estado"
          className={adminStyles.filter}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          options={STATUS_FILTERS}
        />
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !loading && incidents.length === 0 ? (
        <EmptyState icon="check" title={status === 'open_any' ? 'No hay incidentes abiertos' : 'Sin incidentes'} message="Los incidentes se abren solos con las reglas críticas o a mano desde aquí." />
      ) : (
        <Table caption="Incidentes del cliente" columns={COLUMNS}>
          {loading && !data ? (
            <SkeletonRows columns={COLUMNS.length} />
          ) : (
            incidents.map((i) => (
              <tr key={i.id}>
                <Cell label="Incidente">
                  <Link to={`/app/assets/incidents/${i.id}`} className={adminStyles.primaryLink}>
                    {i.title}
                  </Link>
                  <span className={adminStyles.secondary}>
                    {i.code}
                    {i.project ? ` · ${i.project.name}` : ' · sin proyecto'}
                  </span>
                </Cell>
                <Cell label="Severidad">
                  <Badge tone={SeverityTone(i.severity.value)}>{i.severity.label}</Badge>
                </Cell>
                <Cell label="Estado">
                  <Badge tone={IncidentTone(i.status.value)} dot>
                    {i.status.label}
                  </Badge>
                </Cell>
                <Cell label="Abierto">{formatDayTime(i.opened_at)}</Cell>
                <Cell label="Alertas" align="end">
                  {formatNumber(i.alerts_count ?? 0)}
                </Cell>
                <Cell label="Horas" align="end">
                  {formatHours(i.minutes ?? 0)}
                </Cell>
                <Cell label="Responsable">{i.assignee?.name ?? <span className={adminStyles.placeholder}>Sin asignar</span>}</Cell>
              </tr>
            ))
          )}
        </Table>
      )}
      <Pagination meta={data?.meta} onPageChange={setPage} label="incidentes" />
      <NewIncidentModal open={creating} client={client} onClose={() => setCreating(false)} onCreated={(incident) => navigate(`/app/assets/incidents/${incident.id}`)} />
    </section>
  );
}

export default function IncidentsPage() {
  useDocumentTitle('Incidentes');
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  return (
    <AssetsShell
      description="Lo que hay que atender: alertas críticas agrupadas e incidentes abiertos a mano. Las horas de la atención se registran contra el contrato del cliente."
      actions={() =>
        can('assets.incidents') && (
          <Button icon="plus" onClick={() => setCreating(true)}>
            Abrir incidente
          </Button>
        )
      }
    >
      {(props) => <Incidents {...props} creating={creating} setCreating={setCreating} />}
    </AssetsShell>
  );
}
