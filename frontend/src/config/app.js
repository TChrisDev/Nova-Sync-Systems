export const APP_NAME = 'Nova Sync Systems';

// Proveedores de inicio de sesión (OAuth 2.0 / OpenID Connect). Cada inicio
// es una navegación completa (no una llamada fetch): el navegador va a
// Laravel y de ahí a la página oficial del proveedor. El backend indica en
// /api/v1/auth/config cuáles están configurados.
export const LOGIN_PROVIDERS = [
  { id: 'microsoft', name: 'Microsoft 365', icon: 'microsoft', path: '/auth/microsoft/redirect' },
  { id: 'google', name: 'Google Workspace', icon: 'google', path: '/auth/google/redirect' },
];

// Clave para recordar la ruta solicitada antes de ir al proveedor.
export const NEXT_PATH_KEY = 'nova:next-path';

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
