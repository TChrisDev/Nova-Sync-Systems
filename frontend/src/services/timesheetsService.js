import { api } from './apiClient';

// Registro de horas. La API vuelve a validar cada regla (fechas, asignación,
// límite diario, quién aprueba): aquí no se decide quién puede hacer qué.
// La API entrega el estado como { value, label }; las pantallas trabajan con el código.
function normalize(entry) {
  return entry && typeof entry.status === 'object' && entry.status !== null ? { ...entry, status: entry.status.value, status_label: entry.status.label } : entry;
}

export const timesheetsService = {
  list: (params, options) => api.get('/api/v1/time-entries', { ...options, query: params }).then((r) => ({ ...r, data: r.data.map(normalize) })),
  summary: (params, options) => api.get('/api/v1/time-entries/summary', { ...options, query: params }).then((r) => r.data),
  projects: (options) => api.get('/api/v1/time-entries/projects', options).then((r) => r.data),
  create: (payload) => api.post('/api/v1/time-entries', payload),
  update: (id, payload) => api.put(`/api/v1/time-entries/${id}`, payload),
  remove: (id) => api.delete(`/api/v1/time-entries/${id}`),
  submit: (ids) => api.post('/api/v1/time-entries/submit', { ids }),
  approve: (ids) => api.post('/api/v1/time-entries/approve', { ids }),
  reject: (ids, reason) => api.post('/api/v1/time-entries/reject', { ids, reason }),
};
