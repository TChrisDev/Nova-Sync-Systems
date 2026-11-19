# Módulo de Activos y monitoreo

Inventario de los equipos de cada cliente (red, usuarios, CCTV e IoT), su mapa de red, qué tan cubiertos están por el monitoreo, las lecturas de los sensores, las alertas que generan y los incidentes que se atienden. Las horas de esa atención se registran en el módulo de Registro de horas, ligadas al incidente.

> **De dónde salen los datos.** Todo lo que muestran estas pantallas viene de los archivos de Excel importados o de lo que se registra a mano. El sistema **no** se conecta todavía a los equipos (no hay sondeo SNMP, colector Syslog ni NetFlow en vivo): la «telemetría» son las lecturas que trae el archivo de IoT, y las alertas se calculan sobre esas lecturas. Conectar un colector real es el siguiente paso natural; la tabla `telemetry_readings` y el motor de reglas ya están listos para recibir lecturas de otra fuente.

## Pantallas

Todas piden `assets.view`. Arriba de cada una hay un selector de cliente (solo aparecen los que tienen equipos); el cliente elegido se recuerda en el navegador y en la URL (`?client=`).

| Ruta | Qué muestra |
| --- | --- |
| `/app/assets` | **Panel técnico.** Activos, equipos críticos, cobertura de monitoreo e incidentes abiertos; activos por categoría; controles de monitoreo configurados; alertas en el tiempo por severidad (cada 15 minutos, cada hora o por día según lo que abarquen); activos por criticidad; gráfico de temperatura con el umbral de la regla; alertas recientes y equipos críticos. |
| `/app/assets/inventory` | **Inventario.** Búsqueda por nombre, modelo, serial, IP o MAC; filtros por grupo, categoría, criticidad y «monitoreo incompleto». Registrar, editar y eliminar equipos según permisos. IP, MAC, VLAN, gateway y serial solo con `assets.technical`. |
| `/app/assets/map` | **Mapa de red.** Topología en capas (WAN, perímetro, núcleo, acceso) dibujada con los enlaces importados; puntos únicos de falla, switch con más equipos conectados y enlaces no funcionales. |
| `/app/assets/coverage` | **Cobertura.** Matriz equipo × control (Syslog, SNMP, NTP, SSH, NetFlow), porcentaje por equipo y total, y para qué sirve cada control. Con `projects.create` ofrece crear el proyecto de *hardening y monitoreo* con la descripción ya armada. |
| `/app/assets/telemetry` | **Telemetría IoT.** Último estado de cada sensor por ubicación, gráfico en el tiempo por tipo de lectura (máximo o mínimo cada 10 minutos, hora de Colombia) con la línea del umbral, y las reglas de alerta. Si varios sensores reportan exactamente lo mismo, lo advierte. |
| `/app/assets/incidents` | **Incidentes.** Filtro por estado; abrir uno a mano (`assets.incidents`). |
| `/app/assets/incidents/{id}` | **Detalle.** Qué pasó (con advertencia cuando el mismo evento aparece a la vez en varias ubicaciones), línea de tiempo con las alertas y lo que reportaron los demás sensores dos minutos antes y después, responsable, proyecto de las horas, horas registradas y botón **Registrar horas**. Resolver o marcar falso positivo exige una explicación. |

El **Panel** principal (`/app`) muestra además dos tarjetas con gráficos: las horas de las últimas 8 semanas (del equipo, de los proyectos que lidera o las propias, según el rol) y el resumen de activos del último cliente consultado.

## Importar desde Excel

Botón **Importar desde Excel** (`assets.import`), o por consola. Primero se revisan los archivos (no se guarda nada) y luego se confirma.

Se reconocen las tablas por sus encabezados, en cualquier hoja:

| Tabla | Encabezados que la identifican | Qué crea |
| --- | --- | --- |
| Inventario | `ID`, `Nombre`, `Tipo PT`, `Categoría`, `Criticidad`, `IP(s)`, `MAC(s)`… | Equipos de red, de usuario y CCTV. |
| Monitoreo (CORE) | `Equipo`, `NetFlow`, `Syslog`, `SNMP`, `NTP`, `SSH` | Marca qué controles tiene cada equipo («Sí» / «No aparece»). |
| Enlaces | `Origen`, `Destino`, `Puerto origen`, `Funcional`… | Conexiones del mapa. |
| Dispositivos IoT | `ID Dispositivo`, `Nombre Topología`, `Tipo Lectura`, `Unidad`… | Sensores y servidores. |
| Registros IoT | `ID Registro`, `Timestamp`, `ID Dispositivo`, `Valor`… | Lecturas (las repetidas se omiten). |

Volver a importar el mismo archivo actualiza los equipos y no duplica lecturas. Las filas que no cuadran se omiten y aparecen como avisos en la vista previa. Hasta 4 archivos `.xlsx` por vez, de máximo `NOVA_ASSET_IMPORT_MAX_KB` cada uno.

**Requisito en PHP:** la extensión `zip` (en Windows, quitar el `;` de `extension=zip` en `php.ini`). Sin ella la importación responde «PHP necesita la extensión zip para leer archivos de Excel».

Con los archivos del caso (Data_para_Proveedor_ERP.xlsx y Datos_PacketTracer.xlsx) sobre Clínica Dental Sonrisa Plena quedan 101 equipos, 74 enlaces, 4.200 lecturas, 42 alertas y 1 incidente.

## Alertas e incidentes

Al importar se crean, si no existen, cuatro reglas de partida (se editan en Telemetría):

| Regla | Condición | Severidad | Abre incidente |
| --- | --- | --- | --- |
| Humo detectado | Humo ≥ 1 PPM | Crítica | Sí |
| Temperatura alta | Temperatura ≥ 24 °C | Aviso | No |
| Humedad alta | Humedad ≥ 60 % | Aviso | No |
| Video degradado | Video < 15 FPS | Aviso | No |

- Una regla puede ser de un cliente o de todos. **Evaluar reglas** la aplica a las lecturas ya guardadas; una lectura nunca genera dos alertas de la misma regla.
- Las alertas de varios sensores dentro de `NOVA_INCIDENT_WINDOW_MINUTES` (10 por defecto) se agrupan en **un** incidente.
- El incidente se liga solo al proyecto de soporte del cliente cuando hay exactamente un servicio continuo activo; si no, se escoge a mano. Debe ser un proyecto del mismo cliente.
- Estados: abierto → en atención → resuelto o falso positivo (con explicación). Se puede reabrir.
- Las horas registradas desde el incidente guardan `incident_id`; la API rechaza ligar horas a un incidente de otro cliente (`incident_other_client`). Siguen el flujo normal de aprobación y solo al aprobarse consumen la bolsa del contrato.
- Una regla que ya originó incidentes no se elimina (se desactiva) para conservar el historial.

## Permisos

| Acción | Código | Gerencia | Subgerencia | Comercial | Líder | Consultor |
| --- | --- | :-: | :-: | :-: | :-: | :-: |
| Consultar | `assets.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Crear / actualizar equipos | `assets.create` · `assets.update` | ✓ | ✓ | | | |
| Eliminar equipos | `assets.delete` | ✓ | | | | |
| Importar Excel | `assets.import` | ✓ | ✓ | | | |
| Ver datos técnicos (IP, MAC, serial) | `assets.technical` | ✓ | ✓ | | ✓ | ✓ |
| Gestionar reglas | `assets.monitor` | ✓ | ✓ | | ✓ | |
| Atender incidentes | `assets.incidents` | ✓ | ✓ | | ✓ | ✓ |

Es la plantilla de `php artisan nova:setup-assets`; el Super Admin la ajusta en Roles y permisos. Cada permiso se vuelve a comprobar en la API: ocultar un botón en React no es la protección.

## API

Bajo `/api/v1`, con sesión de Sanctum y `permission:assets.view`; cada acción revisa además su permiso propio.

| Método y ruta | Uso |
| --- | --- |
| `GET assets/clients` | Clientes con equipos, catálogos (categorías, criticidades, tipos de lectura, controles). |
| `GET assets?client_id=` | Inventario paginado con filtros `search`, `group`, `category`, `criticality`, `location`, `unmonitored`. |
| `POST assets` · `PUT assets/{id}` · `DELETE assets/{id}` | CRUD de equipos con auditoría. |
| `GET assets/dashboard` · `map` · `coverage` | Datos del panel, del mapa y de la cobertura (`client_id`). |
| `POST assets/import` | `client_id`, `files[]`, `dry_run`. Máximo 20 por minuto. |
| `GET telemetry/sensors` · `telemetry/series` | Último estado de cada sensor; series con promedio, mínimo y máximo por intervalo (`asset_ids[]` hasta 12, `bucket` en minutos, `from`, `to`; máximo 400 puntos). |
| `GET alerts` | Alertas del cliente. |
| `GET/POST alert-rules` · `PUT/DELETE alert-rules/{id}` · `POST alert-rules/evaluate` | Reglas. |
| `GET/POST incidents` · `GET/PATCH incidents/{id}` | Incidentes; el detalle trae alertas, contexto, horas y personas asignables. |

## Comandos

```bash
php artisan migrate
php artisan nova:sync-permissions
php artisan nova:setup-assets                    # permisos de la plantilla de roles
php artisan nova:import-assets 117 inventario.xlsx iot.xlsx --dry-run   # revisar
php artisan nova:import-assets 117 inventario.xlsx iot.xlsx             # guardar
```

## Variables de entorno

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `NOVA_ASSET_IMPORT_MAX_KB` | `10240` | Tamaño máximo de cada Excel. También debe caber en `upload_max_filesize` y `post_max_size` de PHP. |
| `NOVA_INCIDENT_WINDOW_MINUTES` | `10` | Ventana para agrupar alertas en un incidente. |

## Lo que se observó en los datos del caso

- Las lecturas de las tres oficinas son **idénticas** minuto a minuto (incluido el humo de 1,2 PPM a las 09:40 en las tres). Lo más probable es que vengan de una simulación o de sensores mal identificados; las pantallas lo advierten en lugar de presentarlo como tres eventos reales.
- De 50 controles posibles en los 10 equipos de red solo hay 5 configurados (10 %): ningún equipo tiene Syslog, SNMP ni NTP. Es la base del proyecto de hardening que propone la pantalla de cobertura.
- El firewall ASA0 es un punto único de falla del perímetro.
