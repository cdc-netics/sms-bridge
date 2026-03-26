// =========================================================================
// BRIDGE SMS PARA QRADAR - SERVIDOR PRINCIPAL (HTTP/TCP y UDP)
// Este script sirve como puente entre IBM QRadar y la API de Twilio.
// =========================================================================

// 1. Importación de módulos necesarios
const express = require('express'); // Framework web ligero para manejar peticiones HTTP
const twilio = require('twilio');   // SDK oficial de Twilio para interactuar con su API (enviar SMS)
const dgram = require('dgram');     // Módulo nativo de Node.js para crear servidores UDP (recepción Syslog)

// 2. Inicialización de la aplicación Express
const app = express();
// Definir el puerto principal del servicio. 
// Usa la variable de entorno 'PORT' si existe, o por defecto el puerto 18180.
const port = process.env.PORT || 18180;

// 3. Configuración del cliente Twilio
// Se crea una instancia del cliente con las credenciales obtenidas del archivo .env
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID?.trim(),
  process.env.TWILIO_AUTH_TOKEN?.trim()
);

// Obtenemos el número desde el cual se enviarán los SMS (número autorizado/comprado en Twilio)
const TWILIO_FROM = (process.env.TWILIO_FROM || '').trim();

// =========================================================================
// SISTEMA ANTI-SPAM (RATE LIMITING)
// Evita que un error (o 600 ofensas simultáneas) acaben con el saldo de SMS
// =========================================================================
const lastSentTimestamps = new Map(); // Guarda en memoria RAM cuándo fue el último SMS por número
// Control de tiempo en milisegundos (Por defecto 60 segundos). 
// Permite sobreescribir con variable SMS_COOLDOWN_SECONDS en .env
const COOLDOWN_MS = (parseInt(process.env.SMS_COOLDOWN_SECONDS, 10) || 60) * 1000;

function canSendSms(toNumber) {
  const now = Date.now();
  const lastTime = lastSentTimestamps.get(toNumber) || 0;
  
  if (now - lastTime < COOLDOWN_MS) {
    return false; // Está en enfriamiento, BLOQUEAMOS el SMS
  }
  
  // Si ya pasó el tiempo, actualizamos la fecha del último envío y AUTORIZAMOS
  lastSentTimestamps.set(toNumber, now);
  return true;
}


// 4. Configuración del Servidor HTTP (Express)
// Permitimos que nuestra aplicación interprete e ingrese cuerpos (body) en formato JSON.
app.use(express.json({ limit: '2kb' }));

// --- ENDPOINT DE SALUD (Healthcheck) ---
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// --- ENDPOINT PRINCIPAL (Para integraciones con "Custom Actions" de QRadar) ---
app.post('/sms', async (req, res) => {
  try {
    // Extraemos el número de destino (to) y el texto (body) desde el JSON enviado por QRadar
    let { to, body } = req.body || {};

    // --- FIX SMS-001 ---
    // Si QRadar envía un literal "null" en la descripción, lo hacemos legible
    if (typeof body === 'string') {
      body = body.replace(/\bnull\b/ig, '[sin descripción]');
    }
    
    if (!to || !body) throw new Error('Faltan parámetros requeridos en el JSON: "to" o "body"');
    
    // --- CONTROL ANTI-SPAM ---
    if (!canSendSms(to)) {
      console.warn(`[ANTI-SPAM HTTP] Bloqueado envío al número ${to}. Cientos de eventos agrupados (Enfriamiento activo)`);
      // Retornamos OK false para no caer pero evitamos enviar a Twilio
      return res.json({ ok: false, notice: 'Rate limit (Anti-spam) activo para este número.' });
    }

    // Llamada asíncrona a la API de Twilio para crear y enviar el SMS
    await client.messages.create({ 
      to: to,               
      from: TWILIO_FROM,    
      body: body            
    });
    
    res.json({ ok: true });
  } catch (e) {
    console.error('ERROR en endpoint /sms ->', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.listen(port, () => console.log(`Servidor HTTP (Express) arrancando y escuchando peticiones en el puerto ${port}`));


// =========================================================================
// 5. SERVIDOR UDP (Para recepción de logs crudos tipo Syslog desde QRadar)
// =========================================================================
const udpServer = dgram.createSocket('udp4');

udpServer.on('error', (err) => {
  console.error(`Error crítico en el socket UDP:\n${err.stack}`);
  udpServer.close();
});

// --- Array Dinámico de Destinatarios (Modo UDP) ---
// Extrae de las variables .env todas aquellas "TWILIO_TO1", "TWILIO_TO2", etc.
const TO_NUMBERS = Object.keys(process.env)
  .filter(key => key.startsWith('TWILIO_TO') && key !== 'TWILIO_TO')
  .map(key => process.env[key]?.trim()) 
  .filter(Boolean);

// Evento que se dispara cada vez que llega un "datagrama" (mensaje crudo Syslog UDP)
udpServer.on('message', async (msg, rinfo) => {
  try {
    let log = msg.toString();
    if (!log) return;

    // --- FIX SMS-001 ---
    // Si QRadar envía un literal "null" en el payload UDP, lo hacemos legible
    log = log.replace(/\bnull\b/ig, '[sin descripción]');

    // Límite celular
    if (log.length > 160) log = log.substring(0, 157) + '...';
    if (!log) return;

    // Recorremos todos los números destino encontrados
    for (const to of TO_NUMBERS) {
      // --- CONTROL ANTI-SPAM ---
      if (!canSendSms(to)) {
        console.warn(`[ANTI-SPAM UDP] Alerta retenida hacia ${to}. Límite de ráfaga alcanzado.`);
        continue; // Saltamos este número y seguimos procesando los demás
      }

      try {
        await client.messages.create({
          to: to,
          from: TWILIO_FROM,
          body: log
        });
        console.log(`Mensaje UDP reenviado exitosamente a ${to}`);
      } catch (e) {
        console.error(`ERROR al intentar enviar SMS UDP a ${to} ->`, e.message);
      }
    }

  } catch (e) {
    console.error('ERROR general al procesar mensaje entrante UDP ->', e.message);
  }
});

udpServer.on('listening', () => {
  const address = udpServer.address();
  console.log(`Servidor UDP (Syslog listener) operando en ${address.address}:${address.port}`);
});

// Finalmente, indicamos al servidor UDP que escuche en el mismo puerto que el HTTP
udpServer.bind(port);
