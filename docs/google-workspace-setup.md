# Inicio de sesión con Google Workspace

Nova Sync Systems acepta cuentas corporativas de **Google Workspace** además de Microsoft 365. El flujo es el mismo: OpenID Connect con Authorization Code + PKCE, cliente confidencial, `state` y `nonce`, y validación del `id_token` en el servidor. No se piden permisos sobre Gmail, Drive ni el directorio: solo `openid`, `profile` y `email`.

## 1. Crear el cliente OAuth en Google Cloud

1. En [Google Cloud Console](https://console.cloud.google.com/), crea o elige un proyecto de la organización.
2. **APIs y servicios → Pantalla de consentimiento de OAuth**:
   - Tipo de usuario: **Interno**. Así solo las cuentas de tu Workspace pueden autorizar la aplicación.
   - Alcances: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
3. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo de aplicación: **Aplicación web**.
   - **URI de redireccionamiento autorizados** (deben coincidir exactamente):
     - Desarrollo con Vite: `http://localhost:5173/auth/google/callback`
     - Docker local: `http://localhost:8080/auth/google/callback`
     - Producción: `https://erp.tuempresa.com/auth/google/callback`
4. Copia el **ID de cliente** (termina en `.apps.googleusercontent.com`) y el **secreto del cliente**.

## 2. Variables de entorno

| Variable | Descripción |
| --- | --- |
| `GOOGLE_CLIENT_ID` | ID de cliente OAuth. |
| `GOOGLE_CLIENT_SECRET` | Secreto del cliente. Solo vive en el servidor. |
| `GOOGLE_REDIRECT_URI` | Igual al URI registrado en el paso 1. |
| `GOOGLE_WORKSPACE_DOMAINS` | **Obligatoria.** Dominios de Workspace aceptados, separados por coma (p. ej. `tuempresa.com,tuempresa.co`). No se aceptan `gmail.com` ni `googlemail.com`. |

Mientras falte alguna, el botón **Ingresar con Google Workspace** no aparece y `/auth/google/redirect` devuelve `not_configured`. `GET /api/v1/auth/config` indica el estado de cada proveedor sin revelar valores.

## 3. Reglas de seguridad

El `id_token` se valida en `App\Auth\Google\GoogleIdTokenValidator`:

- Firma RS256 con las claves públicas de Google (JWKS en caché, se recargan si llega un `kid` nuevo).
- `iss` igual a `https://accounts.google.com` o `accounts.google.com`, `aud` igual al ID de cliente, vigencia (`exp`) y `nonce` de la sesión.
- **`hd` obligatorio y dentro de `GOOGLE_WORKSPACE_DOMAINS`.** Solo las cuentas administradas por Workspace traen `hd`. Una cuenta personal de Gmail nunca lo trae, aunque use un correo de la empresa, y se rechaza con `tenant_mismatch`.
- `email_verified` debe ser `true`.

Después se aplican las mismas reglas que con Microsoft (`CorporateLoginService`):

- Solo ingresan cuentas autorizadas antes, salvo que `NOVA_AUTO_PROVISION_USERS=true`.
- Se respetan `NOVA_ALLOWED_EMAIL_DOMAINS`, las cuentas desactivadas y las eliminadas.
- En el primer ingreso se vincula `google_sub`, el identificador inmutable de la cuenta. Después se busca por ese identificador, no por el correo.
- Si el correo ya está vinculado a **otra** cuenta de Google, se rechaza con `account_mismatch`.

## 4. Personas que usan Microsoft y Google

Una misma persona puede ingresar con los dos proveedores. Cada uno guarda su identificador en su propia columna (`microsoft_oid` y `google_sub`), y ambos encuentran la cuenta por el correo autorizado la primera vez. Para impedir que alguien entre por un proveedor, deja ese proveedor sin configurar o limita los dominios con `NOVA_ALLOWED_EMAIL_DOMAINS`.

La auditoría registra `auth.login` y `auth.login_rejected` con `provider: google` o `provider: microsoft`.
