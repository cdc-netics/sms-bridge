// =========================================================================
// BRIDGE SMS PARA QRADAR - SERVIDOR PRINCIPAL (HTTP/TCP y UDP)
// Este script sirve como puente entre IBM QRadar y la API de Twilio.
// =========================================================================

// 1. Importación de módulos necesarios
const express = require('express'); // Framework web ligero para manejar peticiones HTTP
const twilio = require('twilio');   // SDK oficial de Twilio para interactuar con su API (enviar SMS)
const dgram = require('dgram');     // Módulo nativo de Node.js para crear servidores UDP (recepción Syslog)
const fs = require('fs');           // Módulo nativo para manejo de archivos (Auditoría)
const path = require('path');       // Módulo nativo para manejo de rutas de archivos
const crypto = require('crypto');   // Módulo nativo para generación de hashes (Deduplicación)

// 2. Inicialización de la aplicación Express
const app = express();
const port = process.env.PORT || 18180;

// 3. Configuración del cliente Twilio
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID?.trim(),
  process.env.TWILIO_AUTH_TOKEN?.trim()
);

const TWILIO_FROM = (process.env.TWILIO_FROM || '').trim();

// =========================================================================
// SISTEMA DE AUDITORÍA (LOG EN ARCHIVO)
// =========================================================================
const LOG_FILE = path.join(__dirname, 'sms-audit.log');

function writeAuditLog(status, to, body) {
  try {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const cleanBody = (body || '').replace(/\n|\r/g, ' ').substring(0, 50);
    const logLine = `[${timestamp}] [${status.padEnd(12)}] [TO: ${to.padEnd(15)}] [MSG: ${cleanBody}...]\n`;
    fs.appendFile(LOG_FILE, logLine, (err) => {
      if (err) console.error('Error escribiendo en sms-audit.log:', err.message);
    });
  } catch (e) {
    console.error('Error en el sistema de auditoría:', e.message);
  }
}

// =========================================================================
// SISTEMA ANTI-SPAM Y DEDUPLICACIÓN (SMS-006)
// =========================================================================
const lastSentTimestamps = new Map(); 
const recentMessages = new Map(); // Mapa para detectar duplicados por contenido
const COOLDOWN_MS = (parseInt(process.env.SMS_COOLDOWN_SECONDS, 10) || 60) * 1000;
const DEDUPLICATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutos para el mismo mensaje

function canSendSms(toNumber, content) {
  const now = Date.now();
  
  // 1. Límite de ráfaga (Anti-Spam general por número)
  const lastTime = lastSentTimestamps.get(toNumber) || 0;
  if (now - lastTime < COOLDOWN_MS) return { allowed: false, reason: 'RATE_LIMIT' };

  // 2. Deduplicación por contenido (SMS-006)
  // Normalizamos el contenido (quitamos espacios extra) para el hash
  const normalizedContent = (content || '').trim().toLowerCase();
  const msgHash = crypto.createHash('md5').update(toNumber + normalizedContent).digest('hex');
  const lastMsgTime = recentMessages.get(msgHash) || 0;
  
  if (now - lastMsgTime < DEDUPLICATION_WINDOW_MS) {
    return { allowed: false, reason: 'DUPLICATE' };
  }
  
  // Si pasa ambos filtros, actualizamos tiempos y autorizamos
  lastSentTimestamps.set(toNumber, now);
  recentMessages.set(msgHash, now);
  
  // Limpieza periódica automática del mapa de duplicados para no saturar la RAM
  if (recentMessages.size > 1000) recentMessages.clear();

  return { allowed: true };
}

// =========================================================================
// TRUNCAMIENTO INTELIGENTE (SMS-005)
// Prioriza la información crítica de QRadar (ID de Ofensa)
// =========================================================================
function smartTruncate(text, maxLength = 160) {
  if (!text || text.length <= maxLength) return text;

  // Intentamos detectar el ID de la ofensa (ej: "Offense 123" o "ID:123")
  const offenseMatch = text.match(/(Offense\s*(ID:)?\s*\d+)/i);
  const offenseInfo = offenseMatch ? offenseMatch[0] : "";
  
  // Reservamos espacio para el ID de la ofensa al principio si existe
  let result = "";
  if (offenseInfo && !text.startsWith(offenseInfo)) {
     result = offenseInfo + " | ";
  }

  // Rellenamos con el inicio del texto original hasta completar el límite
  const remainingSpace = maxLength - result.length - 3; // -3 para los puntos suspensivos
  result += text.substring(0, remainingSpace);
  
  return result.trim() + "...";
}


// 4. Configuración del Servidor HTTP (Express)
app.use(express.json({ limit: '2kb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/sms', async (req, res) => {
  try {
    let { to, body } = req.body || {};

    // Fix SMS-001 (Null strings)
    if (typeof body === 'string') {
      body = body.replace(/\bnull\b/ig, '[sin descripción]');
    }
    
    if (!to || !body) throw new Error('Faltan parámetros requeridos');
    
    // --- CONTROL DE SEGURIDAD (Anti-Spam & Deduplicación) ---
    const check = canSendSms(to, body);
    if (!check.allowed) {
      console.warn(`[SEGURIDAD HTTP] Bloqueado envío a ${to}. Razón: ${check.reason}`);
      writeAuditLog(check.reason === 'DUPLICATE' ? 'DUPLICATE' : 'SPAM_BLOCK', to, body);
      return res.json({ ok: false, error: `Control de seguridad activo: ${check.reason}` });
    }

    // --- TRUNCAMIENTO INTELIGENTE (SMS-005) ---
    const finalBody = smartTruncate(body);

    await client.messages.create({ 
      to: to,               
      from: TWILIO_FROM,    
      body: finalBody            
    });
    
    writeAuditLog('SENT_OK', to, finalBody);
    res.json({ ok: true });
  } catch (e) {
    console.error('ERROR en endpoint /sms ->', e.message);
    writeAuditLog('ERROR_HTTP', req.body?.to || 'unknown', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.listen(port, () => console.log(`Servidor escuchando en puerto ${port}`));


// =========================================================================
// 5. SERVIDOR UDP (Syslog QRadar)
// =========================================================================
const udpServer = dgram.createSocket('udp4');

udpServer.on('error', (err) => {
  console.error(`Error UDP:\n${err.stack}`);
  udpServer.close();
});

const TO_NUMBERS = Object.keys(process.env)
  .filter(key => key.startsWith('TWILIO_TO') && key !== 'TWILIO_TO')
  .map(key => process.env[key]?.trim()) 
  .filter(Boolean);

udpServer.on('message', async (msg, rinfo) => {
  try {
    let log = msg.toString();
    if (!log) return;

    // Fix SMS-001
    log = log.replace(/\bnull\b/ig, '[sin descripción]');

    // Recorremos destinatarios
    for (const to of TO_NUMBERS) {
      // --- CONTROL DE SEGURIDAD (Anti-Spam & Deduplicación) ---
      const check = canSendSms(to, log);
      if (!check.allowed) {
        console.warn(`[SEGURIDAD UDP] Bloqueado envío a ${to}. Razón: ${check.reason}`);
        writeAuditLog(check.reason === 'DUPLICATE' ? 'DUPLICATE' : 'SPAM_BLOCK', to, log);
        continue; 
      }

      // --- TRUNCAMIENTO INTELIGENTE (SMS-005) ---
      const finalLog = smartTruncate(log);

      try {
        await client.messages.create({
          to,
          from: TWILIO_FROM,
          body: finalLog
        });
        console.log(`Mensaje UDP OK a ${to}`);
        writeAuditLog('SENT_UDP', to, finalLog);
      } catch (e) {
        console.error(`ERROR UDP a ${to} ->`, e.message);
        writeAuditLog('ERROR_UDP', to, e.message);
      }
    }

  } catch (e) {
    console.error('ERROR UDP general ->', e.message);
  }
});

udpServer.on('listening', () => {
  const address = udpServer.address();
  console.log(`Escuchando UDP en ${address.address}:${address.port}`);
});

udpServer.bind(port);
