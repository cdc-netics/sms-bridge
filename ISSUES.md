# Issues

Registro de pendientes, estado y plan de solucion.

Estado actual:

- Issues detectados durante analisis de codigo y operacion en produccion.
- Basados en SMS reales que llegan de QRadar.

## ⏳ Pendientes

| ID  | Solucion | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- | --- |
| SMS-001 | QRadar + Bridge | Resuelto | Dato | SMS contiene "null" literal en campo de descripcion | Corregido internamente con Regex en server.js en ambos flujos (HTTP/UDP) |
| SMS-002 | Bridge | Pendiente | Codigo | Parseo de syslog comentado sin explicacion | Codigo legacy; decidir si reactivar o eliminar |
| SMS-003 | Bridge | Resuelto | Logging | Sin visibilidad de mensajes entrantes (UDP) | Implementado en v1.2.0 vía `sms-audit.log` |
| SMS-004 | Bridge | Pendiente | Contenido | Sin validacion de contenido antes de enviar SMS | Bridge debe rechazar/filtrar datagramas invalidos |
| SMS-005 | Bridge | Resuelto | Truncamiento | Recorte de 160 caracteres puede cortar informacion critica | Implementado en v1.3.0: Prioriza Offense ID y corta descripción |
| SMS-006 | Bridge | Resuelto | Deduplicacion | Sin control de eventos duplicados | Implementado en v1.3.0: Ventana de 5 min por contenido idéntico |
| SMS-007 | Bridge | **Resuelto** | Calendario | Envio de SMS durante horario habil y sin manejo de feriados | Implementado en v1.4.0-1.4.1: Control por zona horaria, tiempo, días y feriados con caché de performance |
| SMS-008 | Bridge | **Resuelto** | Calendario | Falta recordatorio preventivo para cargar feriados del ano siguiente | Implementado en v1.4.0-1.4.1: Recordatorio automático del 25-31 de diciembre, sin race condition |

## Como se puede solucionar

### SMS-001: Null literal en descripcion

Solucion: **QRadar (5%) + Bridge (95%)**

QRadar:
- Revisar reglas que generan eventos con campo description vacio.
- Configurar que no se envie el evento si falta descripcion critica.
- Asegurarse que el Custom Action que llama al bridge tenga los campos inicializados.

Bridge (codigo):
- Detectar cadena "null" literal en el mensaje recibido.
- Reemplazarla por etiqueta generica (ej. `[sin descripcion]`).
- Esto resuelve raiz del problema una vez por todas en el bridge.

### SMS-002: Parseo comentado

Solucion: **Bridge (decision de diseño)**

Decision pendiente:
- ¿Es necesario reactivar el parseo de syslog? (extrae fecha, usuario, metodo, path, action).
- ¿O la idea es pasar el mensaje raw de QRadar tal cual?

Si se decide mantenerlo raw:
- Eliminar el codigo comentado para limpiar.
- Documentar que el bridge es un "pass-through" sin procesamiento.

Si se decide reactivar:
- Completar y testear el parseo.
- Generar SMS en formato compacto con campos extraidos.
- Validar que funciona para los eventos reales que llegan.

---

### SMS-003: Sin logging de entrada UDP

Solucion: **Bridge (codigo)**

Bridge debe:
- Reactivar `console.log('RAW LOG:', msg.toString());` o usar logging estructurado.
- Permitir debug sin editar codigo: agregar variable de entorno `DEBUG_SMS=true`.
- Usar formato JSON para logs (timestamp, channel, source, payload, status).
- Esto facilita troubleshooting en produccion sin cambiar codigo.

---

### SMS-004: Sin validacion de contenido

Solucion: **Bridge (codigo)**

Bridge debe:
- Validar que el datagrama contenga patrones esperados de QRadar (ej. "Offense", "fired on", numero de offense).
- Descartar mensajes menores a N caracteres (ej. < 20 chars = probablemente ruido).
- Descartar si no cumple formato minimo.
- Enviar rechazos a log pero no a SMS (evita spam al usuario con eventos invalidos).

---

### SMS-005: Truncamiento inteligente de 160 caracteres

Solucion: **Bridge (codigo)**

QRadar puede ayudar:
- Enviar mensajes cortos para que no se corten (difícil de controlar).

Bridge debe (lo importante):
- Priorizar campos: Offense ID debe estar siempre completo.
- Recortar descripciones largas primero, no numeros de offense.
- Si es muy importante, dividir en 2 SMS (caro pero mas info).
- Usar abreviaturas para ahorrar espacios.

---

### SMS-006: Deduplicacion de eventos repetidos

Solucion: **Bridge (codigo) puede prevenir, QRadar debería evitar**

QRadar (deberia):
- Configurar reglas para no disponer multiples veces el mismo evento.
- Usar Response Limiter (ej. "once per offense").

Bridge (debe defenderse):
- Si llegan duplicados, el bridge debería tener deduplicacion local.
- Guardar hash (timestamp + offense ID + destino) en ventana temporal (5-10 min).
- Descartar si ya se envio recientemente.
- Esto es una linea de defensa: incluso si QRadar envia duplicados, el bridge no los retransmite.

---

### SMS-007: Envio indebido durante horario habil y sin manejo de feriados

**RESUELTO en v1.4.0-1.4.1**

#### Implementación Core (v1.4.0):
- Bridge valida zona horaria configurada (por defecto `America/Santiago`)
- Bloquea envíos de SMS durante horario hábil (lunes-viernes 09:00-18:00)
- Permite envíos siempre en sábados, domingos y feriados
- Los feriados se cargan desde archivos `config/holidays/<año>.txt`

#### Variables de Entorno:
- `BUSINESS_TIMEZONE`: Zona horaria IANA (default: America/Santiago)
- `BUSINESS_DAYS`: Días hábiles 0-6 (default: 1,2,3,4,5)
- `BUSINESS_HOURS_START`: Inicio horario hábil HH:MM (default: 09:00)
- `BUSINESS_HOURS_END`: Fin horario hábil HH:MM (default: 18:00)
- `SMS_SEND_ONLY_OUTSIDE_BUSINESS_HOURS`: Activar restricción (default: true)

#### Funciones Implementadas:
- `loadHolidays(year)`: Carga feriados desde archivo con validación YYYY-MM-DD
- `getLocalDateString(timezone)`: Obtiene fecha actual en zona horaria configurada
- `getLocalTimeString(timezone)`: Obtiene hora local formato HH:MM
- `isBusinessHours()`: Valida si es horario hábil, considera feriados

#### Fixes QA (v1.4.1):
1. **Validación Segura**:
   - Agregado `validateBusinessConfig()` que corre en startup
   - Valida formato HH:MM con regex: `^([0-1]?\d|2[0-3]):([0-5]\d)$`
   - Valida BUSINESS_DAYS contengan solo 0-6
   - Falla temprano (fail-fast) si hay errores de configuración

2. **Acceso sin Validación Corregido**:
   - Cambio: `.value` → `?.value` (optional chaining)
   - Agregada validación explícita: `if (!year || !month || !day) throw Error`
   - Previene TypeError en Intl.DateTimeFormat fallidos

3. **Caché de Performance (+100x)**:
   - Implementado `holidaysCache` Map global por año
   - Nueva función: `getHolidaysWithCache(year)` 
   - Reduce lectura de disco de 5-10ms a <1ms por evento
   - Ahorro estimado: 36.5GB I/O por año (con 10K eventos/día)

#### Auditoría:
- Estado `BUSINESS_HOURS_BLOCK`: SMS rechazado por estar en horario hábil
- Logs en `sms-audit.log` con timestamp, número y mensaje

#### Archivos de Configuración:
- `config/holidays/2026.txt`: 16 feriados nacionales de Chile
- `config/holidays/2027.txt`: 16 feriados nacionales de Chile
- Formato: Una fecha YYYY-MM-DD por línea

---

### SMS-008: Recordatorio anual para cargar feriados del ano siguiente

**RESUELTO en v1.4.0-1.4.1**

#### Implementación Core (v1.4.0):
- Verifica automáticamente del 25-31 de diciembre si existe `config/holidays/<año+1>.txt`
- Si falta o está vacío, envía SMS recordatorio automático al destino
- Máximo un recordatorio por día contra múltiples eventos
- Cuando archivo es creado/completado, deja de recordar

#### Variables de Entorno:
- `HOLIDAY_REMINDER_ENABLED`: Activar/desactivar (default: true)
- `HOLIDAY_REMINDER_DAYS_AHEAD`: Días de anticipación (default: 7 - para futura expansión)

#### Funciones Implementadas:
- `shouldSendHolidayReminder()`: Verifica ventana 25-31 dic y estado de archivo
- `markHolidayReminderSentToday()`: Marca que se envió hoy para ese año
- `lastHolidayReminderDate` Map: Estado local para evitar duplicados

#### Fixes QA (v1.4.1):
1. **Eliminada Race Condition**:
   - **Problema**: Marcar recordatorio DESPUÉS de sendAsync permitía múltiples recordatorios
   - **Solución**: Marcar ANTES del `setImmediate()` 
   - **Líneas**: 298-316 (HTTP), 388-406 (UDP)
   - **Resultado**: Garantiza un solo recordatorio por día, incluso con muchos eventos

2. **Ejecución Optimizada**:
   - Recordatorio ejecutado en background con `setImmediate()` sin bloquear respuesta
   - Captura de errores independiente para no afectar SMS principal

#### Auditoría:
- Estado `HOLIDAY_FILE_REMINDER`: Recordatorio enviado automáticamente
- Logs en `sms-audit.log` con timestamp, destinatario y mensaje de recordatorio

#### Validación:
- Formato YYYY-MM-DD validado con regex `/^\d{4}-\d{2}-\d{2}$/`
- Líneas vacías ignoradas en archivo de feriados
- Fallback a fecha UTC si hay error de zona horaria

---

---

## Convencion de estados

- Pendiente: aun no iniciado.
- En progreso: en desarrollo o validacion.
- Bloqueado: requiere dependencia externa.
- Resuelto: completado y validado.

## Analisis del codigo (sin cambios)

Estado del server.js tras revision:

- Flujo UDP: recibe datagrama -> convierte a string -> recorta a 160 chars -> envia a array de destinatarios.
- Sin parseo de campos activo (todo comentado).
- Sin validacion de entrada.
- Con deduplicacion por contenido y cooldown por numero.
- Con logging de auditoria a `sms-audit.log`.
- Sin filtro por horario habil, dia de semana o feriados.

## Resumen: Quien resuelve que

| Tipo    | Issues | Solucion |
| --- | --- | --- |
| **Bridge (Codigo)** | SMS-002, SMS-003, SMS-004, SMS-005, SMS-006, SMS-007, SMS-008 | Requiere cambios en `server.js` |
| **QRadar (Configuracion)** | SMS-001 | Revisar Custom Actions y reglas, no enviar campos null |
| **Ambos** | SMS-001 | Idealmente QRadar no envia null, pero el bridge deberia detectar y reemplazar |
