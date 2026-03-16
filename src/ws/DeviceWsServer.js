/**********************************************************************/
/*                                                                    */
/* Programmable Logic Controller Cloud Service                        */
/*                                                                    */
/* Copyright (C) 2026 Denisov Foundation Limited                      */
/* License: GPLv3                                                     */
/* Written by Sergey Denisov aka LittleBuster                         */
/* Email: DenisovFoundationLtd@gmail.com                              */
/*                                                                    */
/**********************************************************************/
import crypto from 'node:crypto';
import { rootLogger } from '../utils/Logger.js';

const logger = rootLogger.child('DEVICE_WS');

export class DeviceWsServer {
  constructor({ wss, proto, devicesDb, registry, onDeviceOnline, onDeviceOffline, onDeviceUpdate }) {
    this.wss = wss;
    this.proto = proto;
    this.devicesDb = devicesDb;
    this.registry = registry;
    this.onDeviceOnline = onDeviceOnline;
    this.onDeviceOffline = onDeviceOffline;
    this.onDeviceUpdate = onDeviceUpdate;
    this.pendingScopes = new Map();
  }

  closeWithReason(ws, code, reason) {
    ws.closeReason = reason || '';
    ws.closeCode = code;
    logger.warn(`closing device socket: code: ${code} reason: ${ws.closeReason || '-'}`);
    try {
      ws.close(code, reason);
    } catch (err) {
      logger.warn(`device close failed: ${err?.message || 'unknown_error'} reason: ${ws.closeReason || '-'}`);
    }
  }

  sendErrorAndClose(ws, replyTo, code, message, closeReason = code) {
    const frame = {
      v: this.proto.version,
      type: 'error',
      id: crypto.randomUUID(),
      reply_to: replyTo || undefined,
      payload: { code, message }
    };
    if (ws.readyState !== 1) {
      this.closeWithReason(ws, 1008, closeReason);
      return;
    }
    try {
      ws.send(JSON.stringify(frame), () => this.closeWithReason(ws, 1008, closeReason));
    } catch (err) {
      logger.warn(`device error send failed: ${err?.message || 'unknown_error'} code: ${code}`);
      this.closeWithReason(ws, 1008, closeReason);
    }
  }

  init() {
    this.wss.on('connection', ws => {
      logger.info('device connected');
      ws.helloTimeout = setTimeout(() => {
        const deviceId = this.registry.getDeviceIdBySocket(ws);
        if (!deviceId) {
          this.closeWithReason(ws, 1008, 'hello_timeout');
        }
      }, 10_000);

      ws.on('pong', () => {
        const deviceId = this.registry.getDeviceIdBySocket(ws);
        if (!deviceId) return;
        this.registry.markSeen(deviceId);
      });

      ws.on('message', async data => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch (err) {
          logger.warn('device invalid json');
          this.send(ws, {
            v: this.proto.version,
            type: 'error',
            id: crypto.randomUUID(),
            payload: { code: 'invalid_json', message: 'JSON parse failed' }
          });
          return;
        }
        try {
          await this.handleMessage(ws, msg);
        } catch (err) {
          logger.error(`handle message failed: ${err?.message || 'unknown_error'}`);
          this.send(ws, {
            v: this.proto.version,
            type: 'error',
            id: crypto.randomUUID(),
            payload: { code: 'server_error', message: 'Server error' }
          });
        }
      });

      ws.on('close', (code, reasonBuffer) => {
        const reason = Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString() : String(reasonBuffer || '');
        logger.info(
          `device disconnected: code: ${code || 0} reason: ${reason || '-'} server_reason: ${ws.closeReason || '-'}`
        );
        if (ws.helloTimeout) {
          clearTimeout(ws.helloTimeout);
          ws.helloTimeout = null;
        }
        const deviceId = this.registry.detachBySocket(ws);
        if (deviceId && this.onDeviceOffline) {
          this.onDeviceOffline(deviceId);
        }
      });
    });
  }

  send(ws, msg) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }

  validateEnvelope(message) {
    if (!message || typeof message !== 'object') return 'invalid_json';
    if (message.v !== this.proto.version) return 'invalid_version';
    if (typeof message.type !== 'string') return 'invalid_type';
    if (!message.id) return 'missing_id';
    return null;
  }

  async handleHello(ws, message) {
    const apiKey = message.auth?.api_key;
    if (!apiKey) {
      logger.warn('device auth missing api_key');
      this.sendErrorAndClose(ws, message.id, 'auth_missing', 'api_key required');
      return;
    }
    const deviceRow = await this.devicesDb.getByApiKey(apiKey);
    if (!deviceRow) {
      logger.warn('device auth invalid api_key');
      this.sendErrorAndClose(ws, message.id, 'auth_invalid', 'api_key invalid');
      return;
    }

    const deviceId = Number(message.payload?.device_id ?? deviceRow.device_id);
    const sessionId = crypto.randomUUID();
    const now = Date.now();

    await this.devicesDb.upsertByApiKey({
      deviceId,
      name: message.payload?.device_name || deviceRow.name,
      apiKey,
      lastSeenMs: now
    });

    this.registry.attach(ws, {
      deviceId,
      sessionId,
      apiKey,
      hello: message.payload || null
    });
    if (ws.helloTimeout) {
      clearTimeout(ws.helloTimeout);
      ws.helloTimeout = null;
    }

    this.send(ws, {
      v: this.proto.version,
      type: 'hello_ack',
      id: crypto.randomUUID(),
      reply_to: message.id,
      session_id: sessionId,
      payload: {
        session_id: sessionId,
        server_time_ms: now,
        request_initial: ['system', 'controllers', 'stack']
      }
    });

    if (this.onDeviceOnline) {
      this.onDeviceOnline(deviceId);
    }
  }

  async handleMessage(ws, message) {
    const error = this.validateEnvelope(message);
    if (error) {
      this.send(ws, {
        v: this.proto.version,
        type: 'error',
        id: crypto.randomUUID(),
        reply_to: message.id || undefined,
        payload: { code: error, message: 'Invalid envelope' }
      });
      return;
    }

    if (message.type === 'hello') {
      await this.handleHello(ws, message);
      return;
    }

    const deviceId = this.registry.getDeviceIdBySocket(ws);
    if (!deviceId) {
      this.sendErrorAndClose(ws, message.id, 'session_missing', 'hello required');
      return;
    }

    const session = this.registry.getSession(deviceId);
    if (!message.session_id || message.session_id !== session?.sessionId) {
      this.sendErrorAndClose(ws, message.id, 'session_invalid', 'session_id invalid');
      return;
    }

    this.registry.markSeen(deviceId);
    await this.devicesDb.updateLastSeen(deviceId, Date.now());

    if (message.type === 'ping') {
      this.send(ws, {
        v: this.proto.version,
        type: 'pong',
        id: crypto.randomUUID(),
        reply_to: message.id,
        session_id: session.sessionId,
        payload: { nonce: message.payload?.nonce || '' }
      });
      return;
    }

    if (message.type === 'result' || message.type === 'ack') {
      const data = message.payload?.data;
      if (data && typeof data === 'object') {
        const replyKey = message.reply_to || null;
        const pendingScope = replyKey ? this.pendingScopes.get(String(replyKey)) : null;
        const scopeUnit = message.unit || pendingScope?.unit;
        const scopeNodeId = message.node_id ?? pendingScope?.node_id;
        this.registry.registerState(deviceId, { ...data }, {
          unit: scopeUnit,
          node_id: scopeNodeId
        });
      }
      if (message.reply_to) {
        this.pendingScopes.delete(String(message.reply_to));
      }
    }

    if (message.type === 'event') {
      const patch = { last_event: message.payload || null };
      const eventData = message.payload?.data;
      if (eventData && typeof eventData === 'object') {
        Object.assign(patch, eventData);
      }
      this.registry.registerState(deviceId, patch);
    }

    if (message.type === 'pong') {
      return;
    }

    const summary = await this.registry.buildSummary(deviceId, this.devicesDb);
    if (summary && this.onDeviceUpdate) {
      this.onDeviceUpdate(summary);
    }
  }

  pingAll() {
    for (const session of this.registry.listSessions()) {
      try {
        session.ws?.ping();
      } catch (err) {
        // ignore low-level ping transport errors
      }
      this.send(session.ws, {
        v: this.proto.version,
        type: 'ping',
        id: crypto.randomUUID(),
        session_id: session.sessionId,
        payload: { nonce: crypto.randomUUID() }
      });
    }
  }

  sendGet(deviceId, what, unit = 'local', nodeId) {
    const session = this.registry.getSession(deviceId);
    if (!session) return { ok: false, error: 'device_offline' };
    const id = crypto.randomUUID();
    const msg = {
      v: this.proto.version,
      type: 'get',
      id,
      session_id: session.sessionId,
      unit,
      payload: { what }
    };
    if (unit === 'stack' && nodeId) {
      msg.node_id = Number(nodeId);
    }
    this.pendingScopes.set(String(id), {
      deviceId: Number(deviceId),
      unit,
      node_id: unit === 'stack' && nodeId ? Number(nodeId) : null
    });
    this.send(session.ws, msg);
    return { ok: true, id };
  }

  sendCmd(deviceId, controller, action, args = {}, unit = 'local', nodeId) {
    const session = this.registry.getSession(deviceId);
    if (!session) return { ok: false, error: 'device_offline' };
    const id = crypto.randomUUID();
    const msg = {
      v: this.proto.version,
      type: 'cmd',
      id,
      session_id: session.sessionId,
      unit,
      payload: {
        controller,
        action,
        args
      }
    };
    if (unit === 'stack' && nodeId) {
      msg.node_id = Number(nodeId);
    }
    this.pendingScopes.set(String(id), {
      deviceId: Number(deviceId),
      unit,
      node_id: unit === 'stack' && nodeId ? Number(nodeId) : null
    });
    this.send(session.ws, msg);
    return { ok: true, id };
  }
}
