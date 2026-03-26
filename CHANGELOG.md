# Changelog

Este archivo registra cambios reales del proyecto por version.

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
