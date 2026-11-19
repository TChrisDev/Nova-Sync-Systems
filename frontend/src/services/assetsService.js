import { api, uploadFiles } from './apiClient';

// Activos y monitoreo. Cada operación se vuelve a autorizar en la API.
export const assetsService = {
  clients: (options) => api.get('/api/v1/assets/clients', options).then((r) => r.data),
  list: (params, options) => api.get('/api/v1/assets', { ...options, query: params }),
  get: (id, options) => api.get(`/api/v1/assets/${id}`, options).then((r) => r.data),
  create: (payload) => api.post('/api/v1/assets', payload),
  update: (id, payload) => api.put(`/api/v1/assets/${id}`, payload),
  remove: (id) => api.delete(`/api/v1/assets/${id}`),

  dashboard: (clientId, options) => api.get('/api/v1/assets/dashboard', { ...options, query: { client_id: clientId } }).then((r) => r.data),
  map: (clientId, options) => api.get('/api/v1/assets/map', { ...options, query: { client_id: clientId } }).then((r) => r.data),
  coverage: (clientId, options) => api.get('/api/v1/assets/coverage', { ...options, query: { client_id: clientId } }).then((r) => r.data),

  /** Con dryRun=true solo devuelve el resumen; con false guarda. */
  importFiles: (clientId, files, dryRun) => {
    const form = new FormData();
    form.append('client_id', String(clientId));
    form.append('dry_run', dryRun ? '1' : '0');
    files.forEach((file) => form.append('files[]', file));
    return uploadFiles('/api/v1/assets/import', form);
  },
};

export const monitoringService = {
  sensors: (clientId, options) => api.get('/api/v1/telemetry/sensors', { ...options, query: { client_id: clientId } }).then((r) => r.data),
  series: (clientId, assetIds, params, options) => {
    // asset_ids[] se arma a mano: buildUrl solo maneja valores simples.
    const query = new URLSearchParams({ client_id: String(clientId), ...params });
    assetIds.forEach((id) => query.append('asset_ids[]', String(id)));
    return api.get(`/api/v1/telemetry/series?${query.toString()}`, options).then((r) => r.data);
  },
  alerts: (clientId, params, options) => api.get('/api/v1/alerts', { ...options, query: { client_id: clientId, ...params } }).then((r) => r.data),

  rules: (clientId, options) => api.get('/api/v1/alert-rules', { ...options, query: { client_id: clientId } }).then((r) => r.data),
  createRule: (payload) => api.post('/api/v1/alert-rules', payload),
  updateRule: (id, payload) => api.put(`/api/v1/alert-rules/${id}`, payload),
  removeRule: (id) => api.delete(`/api/v1/alert-rules/${id}`),
  evaluate: (clientId) => api.post('/api/v1/alert-rules/evaluate', { client_id: clientId }),

  incidents: (clientId, params, options) => api.get('/api/v1/incidents', { ...options, query: { client_id: clientId, ...params } }),
  incident: (id, options) => api.get(`/api/v1/incidents/${id}`, options).then((r) => r.data),
  createIncident: (payload) => api.post('/api/v1/incidents', payload),
  updateIncident: (id, payload) => api.patch(`/api/v1/incidents/${id}`, payload),
};
