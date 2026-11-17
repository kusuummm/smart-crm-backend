const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const SystemConfig = require('../models/SystemConfig');
const WhatsAppLog = require('../models/WhatsAppLog');
const Customer = require('../models/Customer');

const AUTH_DIR = path.join(__dirname, '../auth_info_baileys');
const BACKUP_KEY = 'baileys_auth_backup';

let sock = null;
let currentQr = null;
let connectionStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
let connectedPhone = '';
let connectedName = '';
let isInitializing = false;

// Sync auth files from MongoDB to local disk
async function restoreAuthFromDb() {
  try {
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    const backup = await SystemConfig.findOne({ key: BACKUP_KEY });
    if (backup && backup.value && typeof backup.value === 'object') {
      for (const [filename, content] of Object.entries(backup.value)) {
        const filePath = path.join(AUTH_DIR, filename);
        fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
      }
      console.log('[Baileys] Restored auth files from database backup');
    }
  } catch (err) {
    console.warn('[Baileys] Failed to restore auth from DB:', err.message);
  }
}

// Backup auth files from local disk to MongoDB
async function backupAuthToDb() {
  try {
    if (!fs.existsSync(AUTH_DIR)) return;
    const files = fs.readdirSync(AUTH_DIR);
    if (!files.length) return;

    const backupObj = {};
    for (const file of files) {
      const filePath = path.join(AUTH_DIR, file);
      if (fs.statSync(filePath).isFile()) {
        backupObj[file] = fs.readFileSync(filePath).toString('base64');
      }
    }

    await SystemConfig.findOneAndUpdate(
      { key: BACKUP_KEY },
      { value: backupObj },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.warn('[Baileys] Failed to backup auth to DB:', err.message);
  }
}

// Initialize the Baileys socket connection
async function initBaileys(forceRestart = false) {
  if (isInitializing) return;
  if (sock && connectionStatus === 'connected' && !forceRestart) return;

  isInitializing = true;
  connectionStatus = 'connecting';

  try {
    await restoreAuthFromDb();
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // If sock already exists, remove all listeners before replacing
    if (sock) {
      try {
        sock.ev.removeAllListeners();
        sock.end();
      } catch (_) {}
    }

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['Smart CRM', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      logger: pino({ level: 'warn' }),
    });

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      await backupAuthToDb();
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          currentQr = await qrcode.toDataURL(qr);
          connectionStatus = 'connecting';
          console.log('[Baileys] New WhatsApp Web QR code generated for pairing');
        } catch (qrErr) {
          console.error('[Baileys] Error generating QR code image:', qrErr.message);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[Baileys] Connection closed (code: ${statusCode}). Reconnect: ${shouldReconnect}`);

        currentQr = null;
        connectionStatus = 'disconnected';
        connectedPhone = '';
        connectedName = '';

        if (statusCode === DisconnectReason.loggedOut) {
          // Clear credentials
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            await SystemConfig.deleteOne({ key: BACKUP_KEY });
          } catch (_) {}
        } else if (shouldReconnect) {
          setTimeout(() => initBaileys(true), 3000);
        }
      } else if (connection === 'open') {
        connectionStatus = 'connected';
        currentQr = null;
        const jid = sock.user?.id || '';
        connectedPhone = jid.split(':')[0] || jid.split('@')[0] || '';
        connectedName = sock.user?.name || 'PeYug WhatsApp';
        console.log(`[Baileys] WhatsApp Connected successfully as +${connectedPhone}`);
        await backupAuthToDb();
      }
    });

    // Inbound messages handler
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;
        try {
          const from = msg.key.remoteJid; // e.g. 919251177886@s.whatsapp.net
          if (!from || from.includes('@g.us') || from.includes('broadcast')) continue;

          const digits = from.replace(/\D/g, '');
          const clean10 = digits.slice(-10);
          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            (msg.message.imageMessage ? '[Image]' : '[Media message]');

          if (!text) continue;

          // Find or link customer
          const customer = await Customer.findOne({
            $or: [{ mobile: new RegExp(clean10) }, { phone: new RegExp(clean10) }],
          });

          await WhatsAppLog.create({
            customerId: customer?._id || undefined,
            customerName: customer?.name || msg.pushName || `Customer (+${clean10})`,
            phone: digits,
            mobile: digits,
            message: text,
            type: 'custom',
            status: 'read',
            deliveryMode: 'real_whatsapp',
            providerMessageId: msg.key.id || `wa_in_${Date.now()}`,
            sentByName: customer?.name || msg.pushName || 'Customer (Inbound)',
          });

          console.log(`[Baileys] Inbound WhatsApp message recorded from ${digits}: ${text.slice(0, 40)}`);
        } catch (msgErr) {
          console.warn('[Baileys] Error processing inbound message:', msgErr.message);
        }
      }
    });
  } catch (err) {
    console.error('[Baileys] Initialization error:', err.message);
    connectionStatus = 'disconnected';
    currentQr = null;
  } finally {
    isInitializing = false;
  }
}

// Wait for QR code or connection with timeout
async function waitForQr(timeoutMs = 3000) {
  if (currentQr || connectionStatus === 'connected') return getStatus();
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (currentQr || connectionStatus === 'connected' || Date.now() - start >= timeoutMs) {
        clearInterval(interval);
        resolve(getStatus());
      }
    }, 250);
  });
}

// Send message directly via Baileys socket
async function sendMessage(toPhone, messageText) {
  if (!sock || connectionStatus !== 'connected') {
    return {
      success: false,
      error: 'Built-in WhatsApp client is not connected. Please scan the QR code to connect your account.',
      isConnected: false,
    };
  }

  let digits = String(toPhone).replace(/\D/g, '');
  if (digits.length === 10) digits = `91${digits}`;
  else if (digits.length === 11 && digits.startsWith('0')) digits = `91${digits.substring(1)}`;

  const jid = `${digits}@s.whatsapp.net`;

  try {
    const result = await sock.sendMessage(jid, { text: messageText });
    return {
      success: true,
      messageId: result?.key?.id,
      phone: digits,
      text: messageText,
      deliveredVia: 'real_whatsapp',
      status: 'delivered',
    };
  } catch (err) {
    console.error('[Baileys] Send error:', err.message);
    return {
      success: false,
      error: err.message || 'Failed to send WhatsApp message via built-in client',
    };
  }
}

// Disconnect & logout
async function disconnect() {
  try {
    if (sock) {
      await sock.logout();
      sock.end();
      sock = null;
    }
  } catch (_) {}
  connectionStatus = 'disconnected';
  currentQr = null;
  connectedPhone = '';
  connectedName = '';
  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    await SystemConfig.deleteOne({ key: BACKUP_KEY });
  } catch (_) {}
  return { success: true };
}

function getStatus() {
  return {
    connected: connectionStatus === 'connected',
    status: connectionStatus,
    phone: connectedPhone,
    name: connectedName,
    qrCode: currentQr,
  };
}

module.exports = {
  initBaileys,
  waitForQr,
  sendMessage,
  disconnect,
  getStatus,
  isConnected: () => connectionStatus === 'connected',
};
