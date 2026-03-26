# Changelog

Este archivo registra cambios reales del proyecto por version.

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
