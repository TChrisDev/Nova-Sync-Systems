# Módulo de Registro de horas

Registro de horas 24/7 con aprobación del líder y reportes con gráficos. Las reglas de negocio (fechas permitidas, asignación, límite diario, quién aprueba qué) viven en el backend; la interfaz solo las adelanta para dar mensajes rápidos.

## Pantallas

| Ruta | Quién la ve | Qué hace |
| --- | --- | --- |
| `/app/timesheets` | `timesheets.create` | **Mis horas.** La semana (lunes a domingo) como cuadrícula de proyectos por día. Cada registro muestra su estado y se edita con un clic mientras está en borrador o rechazado. Arriba: horas de la semana contra la capacidad, enviadas, aprobadas y por corregir; los registros rechazados con su motivo. Abajo: gráfico por día y estado con la jornada diaria, y gráfico de las últimas 5 semanas contra la capacidad (descontando festivos). |
| `/app/timesheets/review` | `timesheets.approve` o `timesheets.approve_any` | **Aprobaciones.** Lo enviado, agrupado por persona y proyecto, con el detalle de cada grupo. Se aprueba o rechaza un grupo o varios a la vez; el rechazo exige un motivo. Gráfico de lo pendiente por proyecto. |
| `/app/timesheets/reports` | `timesheets.view`, `timesheets.approve` o `timesheets.approve_any` | **Reportes.** Totales, estado de las horas, horas por semana (marcando festivos), proyectos y personas con más horas, horas fuera de horario y de disponibilidad. Filtros por periodo y sede. Exportación CSV. Gerencia ve todo el equipo; un líder, sus proyectos. |

Quien entra a `/app/timesheets` sin `timesheets.create` va directo a Aprobaciones o a Reportes, según sus permisos.

## Reglas

- Bloques de 15 minutos; un registro entre 0:15 y 24:00.
- Solo fechas entre hoy y 31 días atrás (`NOVA_TIMESHEET_BACKDATE_DAYS`), nunca futuras.
- Solo en proyectos activos de contratos activos donde la persona está asignada ese día (o que lidera).
- Máximo 24 horas por persona y día, sumando todos sus registros.
- Ciclo: **borrador → enviado → aprobado o rechazado**. Corregir un rechazado lo devuelve a borrador.
- Nadie aprueba sus propias horas. Un líder aprueba solo en los proyectos que lidera; Gerencia y Subgerencia, en cualquiera.
- Al aprobar se guarda el costo de la hora de ese momento: un aumento posterior no cambia la rentabilidad de lo ya aprobado.
- Solo las horas aprobadas consumen la bolsa del contrato; las enviadas se muestran como pendientes.

## API

Todas bajo `/api/v1`, con sesión de Sanctum. `scope` puede ser `mine` (las propias), `review` (lo que la persona puede aprobar) o `all` (todo, con `timesheets.view` o `timesheets.approve_any`). Un alcance sin permiso responde 403.

| Método y ruta | Uso |
| --- | --- |
| `GET time-entries` | Listado paginado con filtros `project_id`, `user_id`, `site_id`, `status`, `from`, `to`, `is_after_hours`, `is_on_call`, `is_billable`. |
| `GET time-entries/summary` | Totales por estado y tipo de hora para los mismos filtros. |
| `GET time-entries/report` | Datos de los gráficos: `totals`, `people`, `weeks` (por estado, fuera de horario, disponibilidad, festivos, días hábiles y, solo con `scope=mine`, capacidad), `by_project` y `by_user` (los 8 primeros y el resto sumado). Sin `from`/`to` toma las últimas 8 semanas; máximo un año. |
| `GET time-entries/review-queue` | Bandeja de aprobación agrupada por persona y proyecto, con los `ids` de cada grupo. |
| `GET time-entries/export` | CSV para Excel (punto y coma, UTF-8 con BOM, celdas protegidas contra fórmulas). El costo sale solo con `projects.financials`. Cada exportación queda en la auditoría. Máximo 10 por minuto. |
| `GET time-entries/projects` | Proyectos donde la persona puede registrar hoy. |
| `POST time-entries` · `PUT time-entries/{id}` · `DELETE time-entries/{id}` | Crear, corregir o eliminar (solo las propias en borrador o rechazadas). |
| `POST time-entries/submit` · `approve` · `reject` | Lotes de hasta 200 ids, todo o nada. `reject` exige `reason`. |

Los costos (`cost`, `approved_cost`) no existen en la respuesta para quien no tiene `projects.financials`: no basta con ocultarlos en la pantalla.

## Gráficos

Están hechos en SVG dentro del proyecto (`frontend/src/components/timesheets/Charts.jsx`), sin librerías externas: no agregan dependencias a `npm install`, usan los colores del sistema y cada uno tiene una descripción en texto para lectores de pantalla.

## Pruebas

`backend/tests/Feature/Projects/TimeEntryWorkflowTest.php` (registro y aprobación) y `TimeEntryReportTest.php` (semanas con festivo y capacidad, rango por defecto y máximo, alcance por rol, costos solo con permiso, filtro por sede, bandeja agrupada y exportación con auditoría y protección contra fórmulas).
