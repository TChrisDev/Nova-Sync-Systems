// Mensajes para los códigos que el backend envía en /login?error=...
export const AUTH_ERROR_MESSAGES = {
  not_configured:
    'Ese método de inicio de sesión aún no está configurado en el servidor. El administrador debe completar sus variables de configuración.',
  access_denied: 'Cancelaste el inicio de sesión. Puedes intentarlo de nuevo cuando quieras.',
  invalid_state: 'La solicitud de inicio de sesión expiró o no es válida. Vuelve a intentarlo desde esta página.',
  invalid_token: 'No fue posible verificar tu identidad. Vuelve a intentarlo.',
  tenant_mismatch:
    'Tu cuenta pertenece a otra organización o no es una cuenta corporativa. Usa tu cuenta corporativa autorizada.',
  not_authorized: 'Tu cuenta corporativa no está autorizada para ingresar. Solicita acceso al administrador del sistema.',
  account_inactive: 'Tu cuenta está desactivada. Contacta al administrador del sistema.',
  account_mismatch:
    'Este correo ya está vinculado a otra cuenta del mismo proveedor. Contacta al administrador del sistema.',
  provider_error: 'El proveedor de identidad no respondió como se esperaba. Intenta de nuevo en unos minutos.',
  session_expired: 'Tu sesión expiró. Ingresa nuevamente para continuar.',
};

export function authErrorMessage(code) {
  return code ? AUTH_ERROR_MESSAGES[code] ?? 'No fue posible iniciar sesión. Vuelve a intentarlo.' : null;
}
