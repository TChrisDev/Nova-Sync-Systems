import { api, downloadFile } from './apiClient';

// Registro de horas. Las reglas (fechas permitidas, asignación, límite de
// 24 h, quién aprueba qué) las aplica la API; aquí solo se arman las llamadas.
export const timeEntriesService = {
  list: (params, options) => api.get('/api/v1/time-entries', { ...options, query: params }),
  summary: (params, options) => api.get('/api/v1/time-entries/summary', { ...options, query: params }).then((r) => r.data),
  report: (params, options) => api.get('/api/v1/time-entries/report', { ...options, query: params }).then((r) => r.data),
  reviewQueue: (params, options) => api.get('/api/v1/time-entries/review-queue', { ...options, query: params }).then((r) => r.data),
  projects: (options) => api.get('/api/v1/time-entries/projects', options).then((r) => r.data),

  create: (payload) => api.post('/api/v1/time-entries', payload),
  update: (id, payload) => api.put(`/api/v1/time-entries/${id}`, payload),
  remove: (id) => api.delete(`/api/v1/time-entries/${id}`),

  submit: (ids) => api.post('/api/v1/time-entries/submit', { ids }),
  approve: (ids) => api.post('/api/v1/time-entries/approve', { ids }),
  reject: (ids, reason) => api.post('/api/v1/time-entries/reject', { ids, reason }),

  exportCsv: (params) => downloadFile('/api/v1/time-entries/export', { query: params, fallbackName: 'registro-de-horas.csv' }),
};

/** La API acepta lotes de hasta 200 registros: los grupos grandes se parten. */
export async function inBatches(ids, action, size = 200) {
  let count = 0;
  for (let i = 0; i < ids.length; i += size) {
    const response = await action(ids.slice(i, i + size));
    count += response?.data?.count ?? 0;
  }
  return count;
}
