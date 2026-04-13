#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = process.env.SMS_BRIDGE_URL || 'http://127.0.0.1:18180';
const DEFAULT_TEST_BODY = process.env.SMS_TEST_BODY || 'Prueba SMS bridge';
const DEFAULT_ENV_FILE = process.env.SMS_BRIDGE_ENV_FILE || path.join(process.cwd(), '.env');

function sanitizePhone(rawValue) {
  return (rawValue || '').split(/[\s#]/)[0].replace(/[^+\d]/g, '');
}

function loadEnvFile(filePath = DEFAULT_ENV_FILE) {
  const values = {};

  try {
    if (!fs.existsSync(filePath)) return values;
    const content = fs.readFileSync(filePath, 'utf-8');

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (key) values[key] = value;
    }
  } catch (error) {
    console.error(`No se pudo leer el archivo de entorno ${filePath}: ${error.message}`);
  }

  return values;
}

function getConfiguredRecipients(envValues) {
  return Object.keys(envValues)
    .filter((key) => key.startsWith('TWILIO_TO') && key !== 'TWILIO_TO')
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((key) => sanitizePhone(envValues[key]))
    .filter(Boolean);
}

function printHelp() {
  console.log(`sms-bridge CLI

Uso:
  npm run bridge:health
  npm run bridge:sms:test -- --to +56912345678
  npm run bridge:sms:test -- --to +56912345678 --body "Prueba horario habil"
  npm run bridge:sms:test

Opciones:
  --url   URL base del bridge (default: ${DEFAULT_BASE_URL})
  --to    Número destino para prueba de envío
  --body  Mensaje de prueba

Sin --to:
  intenta usar SMS_TEST_TO y luego TWILIO_TO1..TWILIO_TOn desde ${DEFAULT_ENV_FILE}
`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const current = rest[index];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) {
      options[key] = true;
      continue;
    }
    options[key] = value;
    index += 1;
  }

  return { command, options };
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();

  let parsedBody;
  try {
    parsedBody = text ? JSON.parse(text) : null;
  } catch {
    parsedBody = text;
  }

  return {
    status: response.status,
    ok: response.ok,
    body: parsedBody
  };
}

async function runHealthCheck(options) {
  const baseUrl = options.url || DEFAULT_BASE_URL;
  const result = await requestJson(`${baseUrl}/health`);
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) process.exit(1);
  if (!result.body || result.body.status !== 'ok') process.exit(2);
}

async function runSendTest(options) {
  const baseUrl = options.url || DEFAULT_BASE_URL;
  const body = options.body || DEFAULT_TEST_BODY;
  const envFileValues = loadEnvFile();
  const explicitRecipient = sanitizePhone(options.to || process.env.SMS_TEST_TO || envFileValues.SMS_TEST_TO);
  const recipients = explicitRecipient ? [explicitRecipient] : getConfiguredRecipients({ ...envFileValues, ...process.env });

  if (!recipients.length) {
    console.error('Falta --to, SMS_TEST_TO o destinatarios TWILIO_TO* en .env para la prueba de envío.');
    process.exit(1);
  }

  const results = [];
  let hasTransportError = false;
  let hasBusinessFailure = false;

  for (const to of recipients) {
    const result = await requestJson(`${baseUrl}/sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, body })
    });

    results.push({ to, ...result });

    if (!result.ok) {
      hasTransportError = true;
      continue;
    }

    if (!result.body || result.body.ok !== true) {
      hasBusinessFailure = true;
    }
  }

  console.log(JSON.stringify(results, null, 2));

  if (hasTransportError) process.exit(1);
  if (hasBusinessFailure) process.exit(2);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  if (command === 'health') {
    await runHealthCheck(options);
    return;
  }

  if (command === 'send-test') {
    await runSendTest(options);
    return;
  }

  console.error(`Comando no soportado: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((error) => {
  console.error('Error ejecutando bridge-cli:', error.message);
  process.exit(1);
});