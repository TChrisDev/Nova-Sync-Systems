import { api } from './apiClient';

// Configuración de la propia cuenta y notificaciones de la campana.
export const accountService = {
  uploadAvatar: (file) => {
    const form = new FormData();
    form.append('avatar', file);
    return api.post('/api/v1/account/avatar', form);
  },
  removeAvatar: () => api.delete('/api/v1/account/avatar'),
  updatePreferences: (payload) => api.put('/api/v1/account/preferences', payload),
};

export const notificationsService = {
  list: (params, options) => api.get('/api/v1/notifications', { ...options, query: params }),
  read: (id) => api.post(`/api/v1/notifications/${id}/read`),
  readAll: () => api.post('/api/v1/notifications/read-all'),
};
