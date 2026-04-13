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
const RAW_LOG_FILE = path.join(__dirname, 'sms-raw.log');
const RAW_LOG_ENABLED = (process.env.SMS_RAW_LOG || '').toLowerCase() === 'true';
const RAW_LOG_MAX_LINES = parseInt(process.env.SMS_RAW_LOG_MAX_LINES, 10) || 5000;

function writeRawLog(channel, rawPayload, meta) {
  if (!RAW_LOG_ENABLED) return;
  try {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const payload = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
    const metaStr = meta ? ` [${meta}]` : '';
    const newLine = `[${timestamp}] [${channel.padEnd(8)}]${metaStr} ${payload}`;

    // Leer archivo existente y aplicar límite de líneas
    let lines = [];
    try {
      const existing = fs.readFileSync(RAW_LOG_FILE, 'utf8');
      lines = existing.split('\n').filter(l => l.length > 0);
    } catch (_) {
      // Archivo no existe aún, se crea en el primer registro
    }

    if (lines.length >= RAW_LOG_MAX_LINES) {
      lines.splice(0, lines.length - (RAW_LOG_MAX_LINES - 1));
    }
    lines.push(newLine);

    fs.writeFile(RAW_LOG_FILE, lines.join('\n') + '\n', (err) => {
      if (err) console.error('Error escribiendo en sms-raw.log:', err.message);
    });
  } catch (e) {
    console.error('Error en writeRawLog:', e.message);
  }
}

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
// MANEJO DE FERIADOS Y HORARIO HÁBIL (SMS-007 y SMS-008)
// =========================================================================

// Variables de configuración por entorno (SMS-007)
const BUSINESS_TIMEZONE = (process.env.BUSINESS_TIMEZONE || 'America/Santiago').trim();
const BUSINESS_DAYS = (process.env.BUSINESS_DAYS || '1,2,3,4,5').split(',').map(Number); // 0=domingo, 6=sábado
const BUSINESS_HOURS_START = (process.env.BUSINESS_HOURS_START || '09:00').trim(); // HH:MM
const BUSINESS_HOURS_END = (process.env.BUSINESS_HOURS_END || '18:00').trim(); // HH:MM
const SMS_SEND_ONLY_OUTSIDE_BUSINESS_HOURS = (process.env.SMS_SEND_ONLY_OUTSIDE_BUSINESS_HOURS || 'true').toLowerCase() === 'true';

// Variables para recordatorio de feriados (SMS-008)
const HOLIDAY_REMINDER_ENABLED = (process.env.HOLIDAY_REMINDER_ENABLED || 'true').toLowerCase() === 'true';
const HOLIDAY_REMINDER_DAYS_AHEAD = parseInt(process.env.HOLIDAY_REMINDER_DAYS_AHEAD, 10) || 7;
const HOLIDAYS_DIR = path.join(__dirname, 'config', 'holidays');

// Estado para evitar spam en recordatorios (SMS-008)
const lastHolidayReminderDate = new Map();

// CACHÉ de feriados para evitar lectura repetida de disco (PERFORMANCE)
const holidaysCache = new Map(); // { year -> Set }

/**
 * Obtiene feriados del caché o los carga desde disco
 */
function getHolidaysWithCache(year) {
  if (holidaysCache.has(year)) {
    return holidaysCache.get(year);
  }
  const holidays = loadHolidays(year);
  holidaysCache.set(year, holidays);
  return holidays;
}

// Validación de variables de configuración (SMS-007)
function validateBusinessConfig() {
  const timeFormatRegex = /^([0-1]?\d|2[0-3]):([0-5]\d)$/;
  
  if (!timeFormatRegex.test(BUSINESS_HOURS_START)) {
    throw new Error(`BUSINESS_HOURS_START inválido: "${BUSINESS_HOURS_START}". Formato esperado: HH:MM (00:00-23:59)`);
  }
  if (!timeFormatRegex.test(BUSINESS_HOURS_END)) {
    throw new Error(`BUSINESS_HOURS_END inválido: "${BUSINESS_HOURS_END}". Formato esperado: HH:MM (00:00-23:59)`);
  }
  
  const businessDaysArray = BUSINESS_DAYS.filter(d => typeof d === 'number');
  if (businessDaysArray.some(d => d < 0 || d > 6)) {
    throw new Error(`BUSINESS_DAYS debe contener solo números 0-6 (0=domingo, 6=sábado). Actual: ${process.env.BUSINESS_DAYS}`);
  }
  
  console.log('[STARTUP] Configuración de horario hábil validada correctamente');
}

// Ejecutar validación al iniciar
try {
  validateBusinessConfig();
} catch (err) {
  console.error('[STARTUP ERROR]', err.message);
  process.exit(1);
}

/**
 * Carga los feriados para un año específico desde archivo config/holidays/<año>.txt
 */
function loadHolidays(year) {
  const holidayFile = path.join(HOLIDAYS_DIR, `${year}.txt`);
  const holidays = new Set();
  try {
    if (fs.existsSync(holidayFile)) {
      const content = fs.readFileSync(holidayFile, 'utf-8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) holidays.add(trimmed);
      });
    }
  } catch (err) {
    console.error(`Error cargando feriados para ${year}:`, err.message);
  }
  return holidays;
}

/**
 * Obtiene la fecha actual en la zona horaria configurada (YYYY-MM-DD)
 */
function getLocalDateString(timezone = BUSINESS_TIMEZONE) {
  try {
    const formatter = new Intl.DateTimeFormat('es-CL', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    if (!year || !month || !day) {
      throw new Error('formatToParts falló - partes faltantes');
    }
    return `${year}-${month}-${day}`;
  } catch (err) {
    console.error('Error al obtener fecha local:', err.message);
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Obtiene hora local en formato HH:MM
 */
function getLocalTimeString(timezone = BUSINESS_TIMEZONE) {
  try {
    const formatter = new Intl.DateTimeFormat('es-CL', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone
    });
    return formatter.format(new Date());
  } catch (err) {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
}

/**
 * Obtiene el día de la semana local (0=domingo, 6=sábado) desde una fecha YYYY-MM-DD
 */
function getDayOfWeekFromDateString(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error(`Fecha inválida para calcular día de semana: ${dateStr}`);
  }
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Verifica si la hora actual es horario hábil (SMS-007)
 * Retorna true si es horario hábil (bloquear), false si está fuera (permitir)
 */
function isBusinessHours() {
  if (!SMS_SEND_ONLY_OUTSIDE_BUSINESS_HOURS) return false;
  try {
    const dateStr = getLocalDateString();
    const dayOfWeek = getDayOfWeekFromDateString(dateStr);
    const currentYear = parseInt(dateStr.split('-')[0]);
    const holidays = getHolidaysWithCache(currentYear); // ← Usa caché
    if (holidays.has(dateStr)) return false;
    if (!BUSINESS_DAYS.includes(dayOfWeek)) return false;
    const currentTime = getLocalTimeString();
    const [currentHH, currentMM] = currentTime.split(':').map(Number);
    const [startHH, startMM] = BUSINESS_HOURS_START.split(':').map(Number);
    const [endHH, endMM] = BUSINESS_HOURS_END.split(':').map(Number);
    const currentMinutes = currentHH * 60 + currentMM;
    const startMinutes = startHH * 60 + startMM;
    const endMinutes = endHH * 60 + endMM;
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } catch (err) {
    console.error('Error verificando horario hábil:', err.message);
    return false;
  }
}

/**
 * Verifica si debe enviar recordatorio de feriados (SMS-008)
 */
function shouldSendHolidayReminder() {
  if (!HOLIDAY_REMINDER_ENABLED) return false;
  try {
    const today = getLocalDateString();
    const [year, month, day] = today.split('-').map(Number);
    if (month !== 12 || day < 25) return false;
    const nextYear = year + 1;
    const holidayFile = path.join(HOLIDAYS_DIR, `${nextYear}.txt`);
    const reminderKey = `${nextYear}-reminder`;
    if (lastHolidayReminderDate.get(reminderKey) === today) return false;
    if (!fs.existsSync(holidayFile)) return true;
    const content = fs.readFileSync(holidayFile, 'utf-8').trim();
    return !content || content.split('\n').every(line => !line.trim());
  } catch (err) {
    console.error('Error verificando recordatorio:', err.message);
    return false;
  }
}

/**
 * Marca que se envió recordatorio hoy
 */
function markHolidayReminderSentToday() {
  try {
    const today = getLocalDateString();
    const [year] = today.split('-').map(Number);
    lastHolidayReminderDate.set(`${year + 1}-reminder`, today);
    return true;
  } catch (err) {
    console.error('Error marcando recordatorio:', err.message);
    return false;
  }
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
    writeRawLog('HTTP', req.body || {}, `from=${req.ip}`);
    let { to, body } = req.body || {};

    // Fix SMS-001 (Null strings)
    if (typeof body === 'string') {
      body = body.replace(/\bnull\b/ig, '[sin descripción]');
    }
    
    if (!to || !body) throw new Error('Faltan parámetros requeridos');
    
    // Sanitizamos el número (quitamos comentarios tipo #Nombre o espacios)
    if (typeof to === 'string') {
      to = to.split(/[\s#]/)[0].replace(/[^+\d]/g, '');
    }
    
    // --- VALIDACIÓN DE HORARIO HÁBIL (SMS-007) ---
    if (isBusinessHours()) {
      console.warn(`[HORARIO HÁBIL] Bloqueado envío a ${to}. Hora actual es horario hábil.`);
      writeAuditLog('BUSINESS_HOURS_BLOCK', to, body);
      return res.json({ ok: false, error: 'SMS bloqueado: está dentro del horario hábil' });
    }

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
    
    // --- RECORDATORIO DE FERIADOS (SMS-008) ---
    // Ejecutar en background sin bloquear la respuesta
    if (shouldSendHolidayReminder()) {
      markHolidayReminderSentToday(); // Marcar ANTES para evitar race condition
      setImmediate(async () => {
        try {
          const nextYear = parseInt(getLocalDateString().split('-')[0]) + 1;
          const reminderMsg = `[RECORDATORIO] Faltan feriados para ${nextYear}. Por favor, cargar config/holidays/${nextYear}.txt`;
          await client.messages.create({ 
            to: to,               
            from: TWILIO_FROM,    
            body: reminderMsg            
          });
          writeAuditLog('HOLIDAY_FILE_REMINDER', to, reminderMsg);
          console.log(`Recordatorio de feriados enviado a ${to}`);
        } catch (err) {
          console.error('Error enviando recordatorio de feriados:', err.message);
        }
      });
    }
    
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
  .map(key => {
    const val = process.env[key]?.trim() || '';
    // Tomamos solo la parte antes de un espacio o # y limpiamos caracteres extra
    return val.split(/[\s#]/)[0].replace(/[^+\d]/g, '');
  }) 
  .filter(Boolean);

udpServer.on('message', async (msg, rinfo) => {
  try {
    let log = msg.toString();
    if (!log) return;
    writeRawLog('UDP', log, `from=${rinfo.address}:${rinfo.port}`);

    // Fix SMS-001
    log = log.replace(/\bnull\b/ig, '[sin descripción]');

    // Recorremos destinatarios
    for (const to of TO_NUMBERS) {
      // --- VALIDACIÓN DE HORARIO HÁBIL (SMS-007) ---
      if (isBusinessHours()) {
        console.warn(`[HORARIO HÁBIL] Bloqueado envío UDP a ${to}. Hora actual es horario hábil.`);
        writeAuditLog('BUSINESS_HOURS_BLOCK', to, log);
        continue;
      }

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
        
        // --- RECORDATORIO DE FERIADOS (SMS-008) ---
        // Ejecutar en background sin bloquear otros envíos
        if (shouldSendHolidayReminder()) {
          markHolidayReminderSentToday(); // Marcar ANTES para evitar race condition
          setImmediate(async () => {
            try {
              const nextYear = parseInt(getLocalDateString().split('-')[0]) + 1;
              const reminderMsg = `[RECORDATORIO] Faltan feriados para ${nextYear}. Por favor, cargar config/holidays/${nextYear}.txt`;
              await client.messages.create({ 
                to,               
                from: TWILIO_FROM,    
                body: reminderMsg            
              });
              writeAuditLog('HOLIDAY_FILE_REMINDER', to, reminderMsg);
              console.log(`Recordatorio de feriados enviado a ${to}`);
            } catch (err) {
              console.error('Error enviando recordatorio de feriados:', err.message);
            }
          });
        }
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
