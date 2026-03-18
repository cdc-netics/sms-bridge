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

## Que hace este proyecto

- Recibe alertas por HTTP en `/sms`.
- Envia SMS usando Twilio.
- Expone `/health` para validacion de estado.
- Tambien puede reenviar mensajes recibidos por UDP a una lista fija de numeros.

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

Variables opcionales para UDP:

- `TWILIO_TO1` a `TWILIO_TO5`

Ejemplo de `.env` (solo referencia, no usar valores reales en Git):

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM=+1XXXXXXXXXX
PORT=18180
TWILIO_TO1=+56XXXXXXXXX
TWILIO_TO2=+56YYYYYYYYY
```

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

### Caso B: actualizar codigo (`server.js`, `package.json`)

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

### Caso C: recrear contenedor por cambio base

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

## Resumen final

- Estado actual: funcional y operativo para QRadar.
- Punto critico: proteger el acceso a `/sms`.
- Buena practica ya aplicada: `.env` productivo fuera de Git.
