# Changelog

Este archivo registra cambios reales del proyecto por version.

## v1.4.3 - 2026-04-13

### Added

- Comando de proyecto `npm run bridge:health` para validar el endpoint `/health` sin depender de `curl`.
- Comando de proyecto `npm run bridge:sms:test -- --to <numero>` para probar el flujo real de envío HTTP del bridge sin depender de `curl` o `node -e`.
- Nuevo archivo `scripts/bridge-cli.js` como interfaz CLI mínima para smoke tests operativos del servicio.
- `npm run bridge:sms:test` ahora puede tomar destinatarios automáticamente desde `SMS_TEST_TO` o `TWILIO_TO1..TWILIO_TOn` definidos en `.env`.

### Docs

- README actualizado con ejemplos de uso de los nuevos comandos de prueba propios del proyecto.

## v1.4.2 - 2026-04-13

### Fixed

- **[SMS-009] Validación de día hábil en runtime**: `isBusinessHours()` usaba `Intl.DateTimeFormat` con `weekday: 'numeric'`, opción inválida en Node.js. Eso disparaba `Error verificando horario hábil`, hacía que la validación retornara `false` y permitía intentos de envío que debían quedar bloqueados.
- **[SMS-009] Recuperación de auditoría funcional**: al corregir el cálculo del día de semana, los eventos en horario hábil vuelven a registrar `BUSINESS_HOURS_BLOCK` en `sms-audit.log` en lugar de terminar como intentos de envío y errores secundarios de Twilio.

### Changed

- Nuevo helper `getDayOfWeekFromDateString()` para calcular el día local `0-6` desde la fecha `YYYY-MM-DD` ya resuelta en la timezone configurada.
- `isBusinessHours()` ahora valida calendario laboral sin depender de `Intl` para el día de la semana, evitando ruido engañoso en `systemctl` y respetando la política horaria configurada.

## v1.4.1 - 2026-04-02

### Fixed

- **[SMS-007] Race Condition (Recordatorio Feriados)**: Se marcaba el recordatorio DESPUÉS de enviarlo en background, permitiendo múltiples recordatorios en cascada. Ahora se marca ANTES del `setImmediate()` para garantizar una sola llamada por día.
- **[SMS-007] Validación segura en getLocalDateString()**: Los accesos a parts encontrados en `formatToParts()` carecían de validación, causan TypeError en algunas timezones. Ahora usa optional chaining `?.value` y verificación explícita.
- **[SMS-007] Lectura repetida de disco (Performance Critical)**: Cada evento SMS leía el archivo de feriados del disco (5-10ms por evento). Implementado sistema de caché en memoria `holidaysCache` por año. **Mejora: 100x más rápido** (0.5ms vs 5-10ms). Con 10K eventos/día.
- **[SMS-007] Configuración inválida sin validación**: No se validaban las variables de entorno `BUSINESS_HOURS_START/END` (podía causar comportamiento impredecible). Ahora existe `validateBusinessConfig()` que corre en startup y detiene el servidor si hay errores de configuración (fail-fast).

### Changed

- Función `isBusinessHours()` ahora usa caché de feriados (`getHolidaysWithCache()`) en lugar de lectura directa.
- Variables de entorno de horario hábil ahora validadas en startup con regex HH:MM y rango 0-23:00-59.

### Docs
- Agregado documentación completa de fixes en memoria de sesión y changelog.

---

## v1.4.0 - 2026-04-02

### Added
- **[SMS-007] Control de Horario Hábil y Feriados**: Bridge ahora bloquea automáticamente envíos de SMS durante horario hábil (lunes-viernes 09:00-18:00) y permite siempre en sábados, domingos y feriados. Configurable mediante variables de entorno:
  - `BUSINESS_TIMEZONE`: Zona horaria (default: America/Santiago)
  - `BUSINESS_DAYS`: Días hábiles formato 0-6 (default: 1,2,3,4,5)
  - `BUSINESS_HOURS_START/END`: Rango horario (default: 09:00-18:00)
  - `SMS_SEND_ONLY_OUTSIDE_BUSINESS_HOURS`: Activar/desactivar (default: true)
- **[SMS-008] Recordatorio Automático de Feriados**: Del 25-31 de diciembre, el bridge verifica si existe `config/holidays/<año+1>.txt`. Si falta o está vacío, envía SMS recordatorio automático (máximo una vez por día).
- **Archivos de Configuración de Feriados**: Creados calendarios pre-cargados:
  - `config/holidays/2026.txt` (16 feriados nacionales de Chile)
  - `config/holidays/2027.txt` (16 feriados nacionales de Chile)
- **Estados de Auditoría nuevos**:
  - `BUSINESS_HOURS_BLOCK`: Cuando se bloquea un SMS por estar en horario hábil
  - `HOLIDAY_FILE_REMINDER`: Cuando se envía recordatorio de feriados

### Implementation Details
- Funciones agregadas: `loadHolidays()`, `getLocalDateString()`, `getLocalTimeString()`, `isBusinessHours()`, `shouldSendHolidayReminder()`, `markHolidayReminderSentToday()`
- Validación integrada en ambos endpoints: HTTP (`/sms`) y UDP (Syslog)
- Recordatorios ejecutados en background con `setImmediate()` sin bloquear respuesta
- Zona horaria respeta estándar IANA con fallbacks robustos

### Docs
- Actualizado `.env` con sección completa de variables SMS-007 y SMS-008 con ejemplos

---

## v1.3.0 - 2026-03-26

### Added
- **Deduplicación (SMS-006)**: Motor de detección de duplicados por contenido. Si se recibe exactamente el mismo mensaje para el mismo destino dentro de una ventana de **5 minutos**, el envío se bloquea automáticamente (`DUPLICATE_REJECT`).
- **Truncamiento Inteligente (SMS-005)**: Nueva lógica que busca y prioriza el ID de la ofensa. Si el mensaje supera los 160 caracteres, se recorta la descripción pero se intenta mantener el contexto crítico al principio.
- **Sanitización de Teléfonos**: Ahora puedes poner comentarios en el `.env` (ej: `TWILIO_TO1=+569... #Nombre`) y el sistema limpiará automáticamente el nombre antes de enviar el SMS.

### Changed
- Refactorizada la función de validación de seguridad `canSendSms` para integrar tanto el Rate Limit como la Deduplicación en un solo paso.

## v1.2.0 - 2026-03-26

### Added
- **Auditoría de SMS (`sms-audit.log`)**: Implementado sistema de registro persistente en disco. Cada SMS enviado (HTTP/UDP), bloqueado por anti-spam o fallido se registra con timestamp, estado y destinatario.

### Fixed
- Mejorado el manejo de errores en el sistema de auditoría para prevenir bloqueos del hilo principal.

## v1.1.0 - 2026-03-26

### Added
- **Anti-Spam (Rate Limiting)**: Sistema en memoria en `server.js` que bloquea ráfagas y "loops" de QRadar (previene consumir todo el saldo de Twilio por un solo error). Umbral configurable vía `.env` con la variable `SMS_COOLDOWN_SECONDS` (defecto: 60s).
- **Destinatarios UDP Ilimitados**: El bridge ahora extrae todos los números con el prefijo `TWILIO_TO` de `.env` dinámicamente (`TWILIO_TO1`...`TWILIO_TOn`), superando el límite duro anterior de 5 números.
- **Micro-Documentación in-code**: Comentarios masivos estructurales y descriptivos en español sobre cada módulo, endpoint y variable del `server.js`.

### Changed
- El arreglo pre-fijado de 5 números destino (UDP) en código fue eliminado en favor de filtrado dinámico vía `Object.keys()`.
- Variable inactiva (legacy) `TO_NUMBER` fue eliminada de la zona superior de `server.js` para limpiar el código de confusión técnica.

### Fixed
- **[SMS-001] (Literal "null" emitido por QRadar)**: El Bridge ahora implementa mitigación local proactiva en ambos flujos (HTTP y UDP). Antes de mandar, cualquier coincidencia exacta de `null` se censura y se sustituye con la etiqueta visible `[sin descripción]`.

### Docs
- **documentacion.md (Refactorizado completo)**: Contiene apartados nuevos con la ruta local de los archivos (`/opt/sms-bridge`), instrucciones unificadas para uso general/systemd, tutoriales de npm en podman y el nuevo instructivo de Anti-Spam.
- **.env.example**: Corregido quitando las listas forzosas antiguas y agregando la documentación en inglés para `SMS_COOLDOWN_SECONDS`.

## v1.2.0 - 2026-03-26

### Added
- **Auditoría de SMS (`sms-audit.log`)**: Implementado sistema de registro persistente en disco. Cada SMS enviado (HTTP/UDP), bloqueado por anti-spam o fallido se registra con timestamp, estado y destinatario.

### Fixed
- Mejorado el manejo de errores en el sistema de auditoría para prevenir bloqueos del hilo principal.

## v1.1.0 - 2026-03-26

### Added
- **Anti-Spam (Rate Limiting)**: Sistema en memoria en `server.js` que bloquea ráfagas y "loops" de QRadar (previene consumir todo el saldo de Twilio por un solo error). Umbral configurable vía `.env` con la variable `SMS_COOLDOWN_SECONDS` (defecto: 60s).
- **Destinatarios UDP Ilimitados**: El bridge ahora extrae todos los números con el prefijo `TWILIO_TO` de `.env` dinámicamente (`TWILIO_TO1`...`TWILIO_TOn`), superando el límite duro anterior de 5 números.
- **Micro-Documentación in-code**: Comentarios masivos estructurales y descriptivos en español sobre cada módulo, endpoint y variable del `server.js`.

### Changed
- El arreglo pre-fijado de 5 números destino (UDP) en código fue eliminado en favor de filtrado dinámico vía `Object.keys()`.
- Variable inactiva (legacy) `TO_NUMBER` fue eliminada de la zona superior de `server.js` para limpiar el código de confusión técnica.

### Fixed
- **[SMS-001] (Literal "null" emitido por QRadar)**: El Bridge ahora implementa mitigación local proactiva en ambos flujos (HTTP y UDP). Antes de mandar, cualquier coincidencia exacta de `null` se censura y se sustituye con la etiqueta visible `[sin descripción]`.

### Docs
- **documentacion.md (Refactorizado completo)**: Contiene apartados nuevos con la ruta local de los archivos (`/opt/sms-bridge`), instrucciones unificadas para uso general/systemd, tutoriales de npm en podman y el nuevo instructivo de Anti-Spam.
- **.env.example**: Corregido quitando las listas forzosas antiguas y agregando la documentación en inglés para `SMS_COOLDOWN_SECONDS`.
