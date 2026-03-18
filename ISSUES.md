# Issues

Registro de pendientes, estado y plan de solucion.

Estado actual:

- Issues detectados durante analisis de codigo y operacion en produccion.
- Basados en SMS reales que llegan de QRadar.

## ⏳ Pendientes

| ID  | Solucion | Estado | Seccion | Tarea | Notas |
| --- | --- | --- | --- | --- | --- |
| SMS-001 | QRadar + Bridge | Pendiente | Dato | SMS contiene "null" literal en campo de descripcion | QRadar envia null -> corregi en eventos; Bridge detecta y reemplaza "null" |
| SMS-002 | Bridge | Pendiente | Codigo | Parseo de syslog comentado sin explicacion | Codigo legacy; decidir si reactivar o eliminar |
| SMS-003 | Bridge | Pendiente | Logging | Sin visibilidad de mensajes entrantes (UDP) | Necesita logging estructurado para debuggeo |
| SMS-004 | Bridge | Pendiente | Contenido | Sin validacion de contenido antes de enviar SMS | Bridge debe rechazar/filtrar datagramas invalidos |
| SMS-005 | Bridge | Pendiente | Truncamiento | Recorte de 160 caracteres puede cortar informacion critica | Bridge debe truncar inteligentemente |
| SMS-006 | Bridge | Pendiente | Deduplicacion | Sin control de eventos duplicados | Bridge debe deduplicar dentro de ventana temporal |

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
- Sin deduplicacion.
- Sin logging que permita debuggeo facil.

## Resumen: Quien resuelve que

| Tipo    | Issues | Solucion |
| --- | --- | --- |
| **Bridge (Codigo)** | SMS-002, SMS-003, SMS-004, SMS-005, SMS-006 | Requiere cambios en `server.js` |
| **QRadar (Configuracion)** | SMS-001 | Revisar Custom Actions y reglas, no enviar campos null |
| **Ambos** | SMS-001 | Idealmente QRadar no envia null, pero el bridge deberia detectar y reemplazar |
