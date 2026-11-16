import { api } from './apiClient';

export const realtimeService = {
  /** Ticket de un solo uso para abrir el canal en tiempo real (POST con CSRF). */
  ticket: () => api.post('/api/v1/realtime/ticket').then((r) => r.data),
};
