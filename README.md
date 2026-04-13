# sms-bridge

Servicio puente para enviar SMS con Twilio desde QRadar.

## Documentacion del proyecto

- Historial de versiones: [CHANGELOG.md](CHANGELOG.md)
- Registro de pendientes: [ISSUES.md](ISSUES.md)

## Inicio rapido

Si necesitas lo minimo para operar:

1. Configura el archivo `.env` en el host.
2. Levanta el contenedor con Podman y systemd.
3. Prueba `GET /health` y luego `POST /sms`.
4. Ajusta destinatarios UDP con `TWILIO_TO1..TWILIO_TO5` y reinicia el servicio.

Tip:

- Puedes partir desde `.env.example` y copiarlo como `.env`.

## Comandos del proyecto para probar el bridge

Si quieres probar el bridge usando comandos propios del proyecto y no herramientas externas, usa estos scripts npm:

```bash
npm run bridge:health
npm run bridge:sms:test -- --to +56912345678 --body "Prueba SMS bridge"
npm run bridge:sms:test
```

Notas:

- `bridge:health` valida que el servicio responda `status: ok`.
- `bridge:sms:test` usa el endpoint real del bridge, pero encapsulado como comando del proyecto.
- Si no envías `--body`, usa `Prueba SMS bridge` por defecto.
- Si no envías `--to`, intenta usar `SMS_TEST_TO` y luego los `TWILIO_TO1..TWILIO_TOn` definidos en `.env`.
- Si el bridge no está en `http://127.0.0.1:18180`, puedes definir `SMS_BRIDGE_URL`.
- Si quieres apuntar a otro archivo de entorno, puedes definir `SMS_BRIDGE_ENV_FILE`.

Ejemplos:

```bash
SMS_TEST_TO=+56912345678 npm run bridge:sms:test
SMS_BRIDGE_URL=http://127.0.0.1:18180 npm run bridge:health
npm run bridge:sms:test
```

Resultados esperados:

- En horario hábil con restricción activa, `npm run bridge:sms:test` devuelve resultados con `ok: false` y mensaje de bloqueo.
- Fuera de horario hábil, o con `SMS_SEND_ONLY_OUTSIDE_BUSINESS_HOURS=false`, devuelve resultados con `ok: true` si Twilio acepta el envío.

## Que hace este proyecto

- Recibe alertas por HTTP en `/sms`.
- Envia SMS usando Twilio con **truncamiento inteligente** (prioriza Offense ID).
- Expone `/health` para validacion de estado.
- Reenvía mensajes UDP con **deduplicación automática** (evita mensajes idénticos en 5 min).

## Para que lo usamos

Uso principal en produccion:

1. QRadar detecta una ofensa/evento.
2. QRadar ejecuta una Custom Action.
3. La Custom Action llama `POST http://127.0.0.1:18180/sms`.
4. El bridge envia el SMS por Twilio.

## Entorno objetivo

- QRadar 7.5.x (RHEL 8).
- Podman + systemd.
- Puerto operativo: `18180`.
- Salida habilitada a `api.twilio.com:443`.

## Importante sobre .env productivo

- El `.env` productivo contiene secretos reales.
- Ese archivo esta excluido en `.gitignore`.
- Nunca se debe subir a Git ni compartir por chat/correo.
- Permisos recomendados en host: `chmod 600 /opt/sms-bridge/.env`.

Variables clave:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM`
- `PORT` (default `18180`)
- `SMS_COOLDOWN_SECONDS` (Límite de SMS: segundos de espera entre envíos, defecto `60`)

### Variables de Control de Horario Hábil (SMS-007)

Si quieres **bloquear SMS durante horario de oficina** y permitirlos solo fuera de ese horario:

- `BUSINESS_TIMEZONE` (default `America/Santiago`): Zona horaria IANA para validar hora local
- `BUSINESS_DAYS` (default `1,2,3,4,5`): Días hábiles formato 0-6 (0=domingo, 6=sábado)
- `BUSINESS_HOURS_START` (default `09:00`): Inicio horario hábil (HH:MM)
- `BUSINESS_HOURS_END` (default `18:00`): Fin horario hábil (HH:MM)
- `SMS_SEND_ONLY_OUTSIDE_BUSINESS_HOURS` (default `true`): true=bloquear en horario hábil, false=permitir siempre

**Comportamiento:**
- Bloquea SMS lunes-viernes entre 09:00-18:00 (estado auditoría: `BUSINESS_HOURS_BLOCK`)
- Permite siempre en sábados, domingos y feriados
- Los feriados se cargan desde `config/holidays/<año>.txt` (ej: `config/holidays/2026.txt`)
- Formato de feriados: Una fecha YYYY-MM-DD por línea

### Variables de Recordatorio de Feriados (SMS-008)

Si quieres **recordatorio automático** para preparar feriados del año siguiente:

- `HOLIDAY_REMINDER_ENABLED` (default `true`): Activar recordatorio del 25-31 diciembre
- `HOLIDAY_REMINDER_DAYS_AHEAD` (default `7`): Días de anticipación (reservado para mejoras futuras)

**Comportamiento:**
- Del 25-31 de diciembre, verifica si existe `config/holidays/<año+1>.txt`
- Si el archivo falta o está vacío, envía SMS recordatorio automático (máximo una vez por día)
- Registra en auditoría con estado: `HOLIDAY_FILE_REMINDER`

Variables opcionales para UDP:

- `TWILIO_TO1` a `TWILIO_TO5`

Ejemplo de `.env` (solo referencia, no usar valores reales en Git):

```bash
# Credenciales Twilio (requerido)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM=+1XXXXXXXXXX

# Servidor y seguridad
PORT=18180
SMS_COOLDOWN_SECONDS=60

# Destinatarios UDP
TWILIO_TO1=+56XXXXXXXXX
TWILIO_TO2=+56YYYYYYYYY

# SMS-007: Control horario hábil y feriados
BUSINESS_TIMEZONE=America/Santiago
BUSINESS_DAYS=1,2,3,4,5
BUSINESS_HOURS_START=09:00
BUSINESS_HOURS_END=18:00
SMS_SEND_ONLY_OUTSIDE_BUSINESS_HOURS=true

# SMS-008: Recordatorio feriados año siguiente
HOLIDAY_REMINDER_ENABLED=true
HOLIDAY_REMINDER_DAYS_AHEAD=7
```

**Nota:** Los feriados se definen en archivos bajo `config/holidays/<año>.txt`. Ejemplo: `config/holidays/2026.txt` con formato YYYY-MM-DD (una fecha por línea).

### Bloques exactos para prueba en desarrollo

Si quieres probar el comportamiento sin cambiar la hora del sistema, puedes modificar temporalmente las variables de horario en el `.env` del ambiente de desarrollo y reiniciar el servicio.

#### Caso 1: Bloquear todo envio en dia habil

Usa este bloque si quieres verificar que el bridge **no envie SMS**. Mientras el dia actual sea lunes a viernes y no sea feriado, cualquier intento de envio debe quedar bloqueado con estado `BUSINESS_HOURS_BLOCK`.

```bash
BUSINESS_TIMEZONE=America/Santiago
BUSINESS_DAYS=1,2,3,4,5
BUSINESS_HOURS_START=00:00
BUSINESS_HOURS_END=23:59
SMS_SEND_ONLY_OUTSIDE_BUSINESS_HOURS=true
```

#### Caso 2: Permitir todo envio

Usa este bloque si quieres verificar que el bridge **si envie SMS** sin restriccion por horario habil.

```bash
BUSINESS_TIMEZONE=America/Santiago
BUSINESS_DAYS=1,2,3,4,5
BUSINESS_HOURS_START=09:00
BUSINESS_HOURS_END=18:00
SMS_SEND_ONLY_OUTSIDE_BUSINESS_HOURS=false
```

#### Caso 3: Volver a configuracion operativa recomendada

Este es el bloque recomendado para operacion normal.

```bash
BUSINESS_TIMEZONE=America/Santiago
BUSINESS_DAYS=1,2,3,4,5
BUSINESS_HOURS_START=09:00
BUSINESS_HOURS_END=18:00
SMS_SEND_ONLY_OUTSIDE_BUSINESS_HOURS=true
```

#### Como validar el resultado

- Edita el `.env` del ambiente donde corre el servicio.
- Reinicia el servicio para recargar variables.
- Genera un evento de prueba desde tu flujo normal de desarrollo o con `npm run bridge:sms:test`.
- Revisa `sms-audit.log`.

Resultado esperado:
- Si el bloqueo aplica, verás `BUSINESS_HOURS_BLOCK` y no `SENT_OK`.
- Si el envio está permitido, verás `SENT_OK`.
- Si el dia actual es sábado, domingo o feriado cargado en `config/holidays/<año>.txt`, el bridge permitirá el envio aunque el horario coincida con la ventana hábil.

## Levantar todo desde cero (QRadar + Podman + systemd)

### 1) Preparar carpeta del servicio

```bash
sudo mkdir -p /opt/sms-bridge
sudo chmod 755 /opt/sms-bridge
sudo cp server.js package.json /opt/sms-bridge/
```

### 2) Crear `.env` productivo en el host

Si estas trabajando desde el repo, puedes usar esto como base:

```bash
cp .env.example .env
```

Luego completa los valores reales y mueve ese `.env` al host (`/opt/sms-bridge/.env`) sin subirlo a Git.

```bash
sudo tee /opt/sms-bridge/.env >/dev/null <<'EOF'
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM=+1XXXXXXXXXX
PORT=18180
SMS_COOLDOWN_SECONDS=60
EOF

sudo chmod 600 /opt/sms-bridge/.env
sudo sed -i 's/\r$//' /opt/sms-bridge/.env
```

### 3) Instalar dependencias con contenedor auxiliar

```bash
sudo podman pull docker.io/library/node:22-alpine
sudo podman run --rm -it --user 0 \
  -v /opt/sms-bridge:/app:Z -w /app \
  docker.io/library/node:22-alpine \
  sh -lc 'test -f package.json || npm init -y; npm install'
```

### 4) Crear contenedor + unidad systemd

```bash
sudo podman create --name sms-bridge \
  --restart=always \
  --label "io.containers.autoupdate=registry" \
  --env-file /opt/sms-bridge/.env \
  -v /opt/sms-bridge:/app:Z -w /app \
  --network host \
  docker.io/library/node:22-alpine \
  node server.js

sudo podman generate systemd --name sms-bridge --files --new
sudo mv container-sms-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now container-sms-bridge.service
```

### 5) Verificar

```bash
curl -fsS http://127.0.0.1:18180/health
curl -sS -X POST http://127.0.0.1:18180/sms \
  -H 'Content-Type: application/json' \
  -d '{"to":"+56XXXXXXXXX","body":"Prueba SMS bridge"}'
```

## Deploy y actualizaciones

### Caso A: actualizar solo configuracion (`.env`)

1. Editar `/opt/sms-bridge/.env`.
2. Reiniciar servicio.

```bash
sudo systemctl restart container-sms-bridge.service
```

### Caso B: actualizar tu servidor QRadar desde Git (Recomendado)

Si tienes tu proyecto enlazado a un repositorio remoto, simplemente usa Git para traer los cambios al servidor (`git pull`) y reinicia el contenedor (Podman se encargará de montar los archivos modificados instantáneamente).

> **Nota:** Como el archivo `.env` que tiene cosas reales está ignorado y excluido por seguridad en el `.gitignore`, un `git pull` **no** va a actualizar tus contraseñas y teléfonos dinámicos. Si agregaste nuevas variables (ej. `SMS_COOLDOWN_SECONDS`), deberás agregarlas a mano en `/opt/sms-bridge/.env` antes de reiniciar.

```bash
cd /opt/sms-bridge
git pull  o   git pull origin main
sudo systemctl restart container-sms-bridge.service
```

### Caso C: actualizar codigo manualmente (`server.js`, `package.json`)

1. Copiar archivos nuevos a `/opt/sms-bridge/`.
2. Reinstalar dependencias (si cambió `package.json`).
3. Reiniciar servicio.

```bash
sudo cp server.js package.json /opt/sms-bridge/
sudo podman run --rm -it --user 0 \
  -v /opt/sms-bridge:/app:Z -w /app \
  docker.io/library/node:22-alpine \
  sh -lc 'npm install'
sudo systemctl restart container-sms-bridge.service
```

### Caso D: recrear contenedor por cambio base

```bash
sudo systemctl stop container-sms-bridge.service
sudo podman rm -f sms-bridge

sudo podman create --name sms-bridge \
  --restart=always \
  --env-file /opt/sms-bridge/.env \
  -v /opt/sms-bridge:/app:Z -w /app \
  --network host \
  docker.io/library/node:22-alpine \
  node server.js

sudo podman generate systemd --name sms-bridge --files --new
sudo mv container-sms-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now container-sms-bridge.service
```

## Como agregar o quitar numeros

Hay dos tipos de numeros:

1. Numero origen de Twilio (`TWILIO_FROM`): el numero que envía SMS.
2. Destinatarios UDP (`TWILIO_TO1..TWILIO_TO5`): a quienes se envía cuando entra un datagrama UDP.

### Cambiar numero origen (`TWILIO_FROM`)

```bash
sudo sed -i 's/^TWILIO_FROM=.*/TWILIO_FROM=+1XXXXXXXXXX/' /opt/sms-bridge/.env
sudo systemctl restart container-sms-bridge.service
```

### Agregar destinatario UDP

Ejemplo para `TWILIO_TO3`:

```bash
sudo sed -i 's/^TWILIO_TO3=.*/TWILIO_TO3=+56ZZZZZZZZZ/' /opt/sms-bridge/.env
sudo systemctl restart container-sms-bridge.service
```

Si la variable no existe, agrégala:

```bash
echo 'TWILIO_TO3=+56ZZZZZZZZZ' | sudo tee -a /opt/sms-bridge/.env
sudo systemctl restart container-sms-bridge.service
```

### Quitar destinatario UDP

```bash
sudo sed -i 's/^TWILIO_TO3=.*/TWILIO_TO3=/' /opt/sms-bridge/.env
sudo systemctl restart container-sms-bridge.service
```

### Verificar numeros de Twilio disponibles en la cuenta

```bash
source /opt/sms-bridge/.env
curl -s -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers.json" \
  | grep '"phone_number"'
```

## API simple

### GET /health

Respuesta esperada:

```json
{ "status": "ok" }
```

### POST /sms

Request:

```json
{ "to": "+569XXXXXXXX", "body": "Mensaje" }
```

Respuesta OK:

```json
{ "ok": true }
```

Respuesta con error:

```json
{ "ok": false, "error": "detalle" }
```

## Flujo UDP (resumen)

- Escucha en el mismo `PORT`.
- Convierte el datagrama a texto.
- Si supera 160 caracteres, recorta a 157 + `...`.
- Envia el contenido a `TWILIO_TO1..TWILIO_TO5`.

## Operacion diaria

Estado y reinicio:

```bash
sudo systemctl status container-sms-bridge.service --no-pager
sudo systemctl restart container-sms-bridge.service
```

Logs:

```bash
sudo journalctl -u container-sms-bridge.service -n 100 --no-pager
sudo journalctl -u container-sms-bridge.service -f
sudo podman logs -f sms-bridge
```

Checks rapidos:

```bash
ss -ltnp | grep 18180
curl -fsS http://127.0.0.1:18180/health || echo down
```

Checklist de salud:

1. Servicio activo en systemd.
2. Puerto `18180` escuchando.
3. `/health` responde `status: ok`.
4. Envio de prueba `POST /sms` con respuesta `ok: true`.

## Apertura de puerto en QRadar (persistente)

En Linux genérico se suele abrir puerto con `firewall-cmd` o reglas manuales de `iptables`.
En QRadar eso no basta para persistencia: las reglas manuales se pueden perder al reiniciar.

Si necesitas abrir, por ejemplo, `10050/tcp` (caso Zabbix Agent), usa este procedimiento:

### 1) Editar reglas persistentes

```bash
sudo nano /opt/qradar/conf/iptables.pre
```

Agregar la regla:

```bash
-A INPUT -p tcp --dport 10050 -j ACCEPT
```

Importante:

- Debe ir antes de una regla de `DROP`, si existe.

### 2) Aplicar cambios

```bash
sudo /opt/qradar/bin/iptables_update.pl
```

Este comando regenera las reglas activas usando `iptables.pre` y `iptables.post`.

### 3) Ejemplo de estructura del archivo

```text
# BEGIN /opt/qradar/conf/iptables.pre FILE
# Add any commands you wish to be inserted in the iptables rules
# prior to other rules in this file. This file will be included
# as-is directly in the /etc/sysconfig/iptables file at the
# line indicated.

-A INPUT -m udp -p udp --dport 514 -j ACCEPT
-A INPUT -m state --state NEW -m tcp -p tcp --dport 514 -j ACCEPT
-A INPUT -p tcp --dport 10050 -j ACCEPT
# END /opt/qradar/conf/iptables.pre FILE
```

### 4) Verificar

```bash
sudo iptables -S INPUT | grep 10050
```

Resumen:

- En QRadar, las reglas persistentes se manejan en `/opt/qradar/conf/iptables.pre` y `/opt/qradar/conf/iptables.post`.
- Aplicar siempre con `/opt/qradar/bin/iptables_update.pl`.
- No depender de reglas manuales temporales si necesitas persistencia.

## Analisis tecnico (facil de leer)

### Fortalezas

- Solucion compacta y facil de operar.
- Integracion directa con SDK oficial de Twilio.
- Muy util para alertamiento rapido desde QRadar.

### Riesgos actuales

- `/sms` no tiene autenticacion propia.
- No hay reintentos ni cola de fallos.
- UDP puede perder/duplicar mensajes.

### Impacto practico

- Puede existir envio no autorizado si el servicio queda expuesto.
- En caidas transitorias de Twilio se pueden perder alertas.
- Eventos repetidos pueden aumentar costo SMS.

### Recomendaciones priorizadas

1. Seguridad: proteger acceso a `/sms` y restringir origen.
2. Confiabilidad: agregar reintentos y trazabilidad de errores.
3. Costos: deduplicar alertas repetitivas.

## Troubleshooting rapido

### Invalid username (Twilio)

- Revisar SID/token.
- Verificar que SID empiece con `AC` y no tenga espacios ocultos.

```bash
grep -nE '^(TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|TWILIO_FROM|PORT)=' /opt/sms-bridge/.env | cat -A
```

### Invalid From Number

- `TWILIO_FROM` no pertenece a tu cuenta Twilio.

```bash
source /opt/sms-bridge/.env
curl -s -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers.json" \
  | grep '"phone_number"'
```

### Connection refused

- Verificar que el servicio este arriba y escuchando puerto.

```bash
sudo podman logs -f sms-bridge
ss -ltnp | grep 18180
```

## Comandos Técnicos de Podman (Diagnóstico)

Para revisar el estado interno del contenedor en QRadar:

```bash
# Ver estado y puertos activos
sudo podman ps -a --filter name=sms-bridge

# Ver logs en tiempo real
sudo podman logs -f sms-bridge

# Verificar variables de entorno cargadas
sudo podman inspect sms-bridge --format '{{.Config.Env}}' | tr ' ' '\n' | grep TWILIO
```

## Verificación Post-Actualización

Sigue estos pasos tras cada `git pull` y reinicio:

1. **Check Status**: `sudo systemctl status container-sms-bridge.service`
2. **Check Health**: `curl -s http://127.0.0.1:18180/health`
3. **Check Logs**: Busca el mensaje `[ANTI-SPAM]` en los logs de Podman si intentas enviar más de un SMS al mismo número en menos de un minuto.
4. **Audit Log**: Verifica que se esté escribiendo el archivo `tail -f /opt/sms-bridge/sms-audit.log`.

---

## Registro de Auditoría Local

El archivo **`sms-audit.log`** es tu fuente de verdad para saber qué salió del bridge. A diferencia de `podman logs`, este archivo persiste aunque borres el contenedor y sólo contiene el historial de envíos.

```bash
# Ver últimos 20 envíos de la historia
tail -n 20 /opt/sms-bridge/sms-audit.log
```


## Resumen final

- Estado actual: funcional y operativo para QRadar.
- Punto critico: proteger el acceso a `/sms`.
- Buena practica ya aplicada: `.env` productivo fuera de Git.
