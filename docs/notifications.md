# Notificaciones, campana y configuración de cuenta

## 1. Proyectos por vencer

Todos los días a las 7:00 a. m. (hora de Bogotá), el programador de tareas ejecuta `php artisan nova:notify-project-deadlines`. El comando revisa los proyectos **planeados, en curso o pausados** que tienen fecha de fin y avisa cuando faltan **15, 7, 1 y 0 días**. Los umbrales se cambian con `NOVA_PROJECT_DEADLINE_DAYS` (por defecto `15,7,1,0`).

**Quién recibe el aviso**
- El líder del proyecto, si su cuenta está activa.
- Las personas con permiso `projects.update` (las plantillas de Gerencia y Subgerencia, y el Super Admin).

**Cómo llega**
- **Campana** (siempre): queda en la tabla `notifications` (canal `database` de Laravel). Al abrirla, lleva al proyecto y se marca como leída.
- **Correo:** se envía a menos que la persona lo haya desactivado en *Configuración de cuenta* (`notify_by_email`). Si un correo falla, el error queda en el log y los demás avisos se envían igual.
- **Tiempo real:** cada notificación nueva publica `notification.created` en el tópico `nova.notifications`, solo para su destinatario. La campana se actualiza sin recargar la página.

**Sin repeticiones:** cada umbral se avisa una sola vez por proyecto y fecha de fin (tabla `project_deadline_alerts`, con índice único). Ejecutar el comando varias veces el mismo día no repite avisos. Si alguien extiende la fecha de fin, los avisos empiezan de nuevo para la fecha nueva.

### Configurar el correo

| Variable | Ejemplo |
| --- | --- |
| `MAIL_MAILER` | `smtp` (o `log` para que los correos queden en el registro) |
| `MAIL_HOST` / `MAIL_PORT` | Microsoft 365: `smtp.office365.com` / `587` · Google Workspace: `smtp.gmail.com` o `smtp-relay.gmail.com` / `587` |
| `MAIL_USERNAME` / `MAIL_PASSWORD` | Cuenta de servicio del correo (en Google, una contraseña de aplicación o el relay SMTP de Workspace) |
| `MAIL_FROM_ADDRESS` | `erp@tuempresa.com` |

Para probarlo a mano:

```bash
php artisan nova:notify-project-deadlines
```

## 2. API

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/v1/notifications` | Las notificaciones de la propia cuenta (`unread`, `per_page`). `meta.unread_count` trae cuántas hay sin leer. |
| POST | `/api/v1/notifications/{id}/read` | Marcar una como leída (solo las propias; las de otra persona responden 404). |
| POST | `/api/v1/notifications/read-all` | Marcar todas como leídas. |
| PUT | `/api/v1/account/preferences` | `notify_by_email` (true/false). |
| POST | `/api/v1/account/avatar` | Subir la foto de perfil (`multipart/form-data`, campo `avatar`). Máximo 10 por minuto. |
| DELETE | `/api/v1/account/avatar` | Quitar la foto. |
| GET | `/api/v1/users/{id}/avatar` | Foto de una persona, solo con sesión. |

## 3. Foto de perfil

- Formatos JPG, PNG o WebP, de hasta 2 MB (`NOVA_AVATAR_MAX_KB`) y entre 64 y 4096 píxeles por lado. **No se aceptan SVG**, porque pueden llevar scripts. El tipo se valida por el contenido del archivo, no por su nombre.
- Se guarda en el disco privado (`storage/app/private/avatars`), nunca en una carpeta pública. La API la entrega solo a usuarios con sesión, con `X-Content-Type-Options: nosniff` y una CSP que no permite ejecutar nada.
- Al cambiarla se borra la anterior. La URL incluye la versión (`?v=`), para que el navegador muestre la nueva de inmediato.
- Los cambios quedan en la auditoría: `account.avatar_updated`, `account.avatar_removed` y `account.preferences_updated`.

El nombre y el correo no se editan en el ERP: vienen de Microsoft 365 o de Google Workspace y se actualizan en cada ingreso.

En Docker, las fotos viven en el volumen `storage`, así que se conservan entre reinicios.
