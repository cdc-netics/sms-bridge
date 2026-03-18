
const express = require('express');
const twilio = require('twilio');
const dgram = require('dgram');

const app = express();
const port = process.env.PORT || 18180;

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID?.trim(),
  process.env.TWILIO_AUTH_TOKEN?.trim()
);

const TWILIO_FROM = (process.env.TWILIO_FROM || '').trim();
const TO_NUMBER = (process.env.TWILIO_TO || '').trim(); // Número destino por defecto

app.use(express.json({ limit: '2kb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/sms', async (req, res) => {
  try {
    const { to, body } = req.body || {};
    if (!to || !body) throw new Error('Missing to/body');
    await client.messages.create({ to, from: TWILIO_FROM, body });
    res.json({ ok: true });
  } catch (e) {
    console.error('ERR /sms ->', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Iniciar servidor HTTP/Express
app.listen(port, () => console.log(`sms-bridge listening on ${port}`));

// Crear socket UDP
const udpServer = dgram.createSocket('udp4');

udpServer.on('error', (err) => {
  console.error(`UDP server error:\n${err.stack}`);
  udpServer.close();
});

// Array de destinatarios
const TO_NUMBERS = [
  process.env.TWILIO_TO1?.trim(),
  process.env.TWILIO_TO2?.trim(),
  process.env.TWILIO_TO3?.trim(),
  process.env.TWILIO_TO4?.trim(),
  process.env.TWILIO_TO5?.trim()
].filter(Boolean); // Eliminar cualquier valor nulo o vacío

udpServer.on('message', async (msg, rinfo) => {
  try {
	//console.log('RAW LOG:', msg.toString());
    let log = msg.toString();
    if (!log) return;

    // Limpiar caracteres no imprimibles
    //log = log.replace(/[\x00-\x1F\x7F]/g, '');

    // Extraer campos clave
    //const dateMatch = log.match(/^(Aug\s+\d+\s+\d+:\d+:\d+)/);
    //const userMatch = log.match(/(\S+@\d+\.\d+\.\d+\.\d+)/);
    //const methodMatch = log.match(/Method=(\w+)/);
    //const pathMatch = log.match(/PathInfo=([^\s|]+)/);
    //const actionMatch = log.match(/\[Action\]\s*\[([^\]]+)\]/);

    // Generar mensaje SMS compacto
    //let smsBody = [
      //dateMatch?.[1] || '',
      //userMatch?.[1] || '',
      //methodMatch?.[1] || '',
      //pathMatch?.[1] || '',
      //actionMatch?.[1] || ''
    //].filter(Boolean).join(' | ');

    // Limitar a 160 caracteres
    if (log.length > 160) log = log.substring(0, 157) + '...';

    if (!log) return;

    //console.log(`UDP parsed -> ${smsBody}`);

    // Enviar SMS a cada número del array
    for (const to of TO_NUMBERS) {
      try {
        await client.messages.create({
          to,
          from: TWILIO_FROM,
          body: log
        });
        console.log(`Mensaje enviado a ${to}`);
      } catch (e) {
        console.error(`ERR al enviar a ${to} ->`, e.message);
      }
    }

  } catch (e) {
    console.error('ERR UDP ->', e.message);
  }
});



udpServer.on('listening', () => {
  const address = udpServer.address();
  console.log(`UDP server listening on ${address.address}:${address.port}`);
});

udpServer.bind(port); // Escucha en el mismo puerto 18180

