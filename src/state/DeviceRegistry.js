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
export class DeviceRegistry {
  constructor({ onlineTtlMs }) {
    this.onlineTtlMs = onlineTtlMs;
    this.sessions = new Map();
    this.socketToDevice = new Map();
  }

  normalizeDeviceId(deviceId) {
    const n = Number(deviceId);
    return Number.isFinite(n) ? n : deviceId;
  }

  attach(ws, { deviceId, sessionId, apiKey, hello }) {
    const normalizedId = this.normalizeDeviceId(deviceId);
    const now = Date.now();

    const existing = this.sessions.get(normalizedId);
    if (existing?.ws && existing.ws !== ws) {
      this.socketToDevice.delete(existing.ws);
      try {
        existing.ws.close();
      } catch (err) {
        // ignore socket close errors during session replacement
      }
    }

    this.sessions.set(normalizedId, {
      ws,
      sessionId,
      apiKey,
      deviceId: normalizedId,
      lastSeenMs: now,
      hello: hello || null,
      state: {}
    });
    this.socketToDevice.set(ws, normalizedId);
  }

  detachBySocket(ws) {
    const deviceId = this.socketToDevice.get(ws);
    if (!deviceId) return null;
    this.socketToDevice.delete(ws);
    this.sessions.delete(deviceId);
    return deviceId;
  }

  getDeviceIdBySocket(ws) {
    return this.socketToDevice.get(ws);
  }

  getSession(deviceId) {
    return this.sessions.get(this.normalizeDeviceId(deviceId));
  }

  markSeen(deviceId) {
    const session = this.sessions.get(this.normalizeDeviceId(deviceId));
    if (session) {
      session.lastSeenMs = Date.now();
    }
  }

  isOnline(deviceId) {
    const session = this.sessions.get(this.normalizeDeviceId(deviceId));
    if (!session) return false;
    return Date.now() - session.lastSeenMs < this.onlineTtlMs;
  }

  registerState(deviceId, patch) {
    const session = this.sessions.get(this.normalizeDeviceId(deviceId));
    if (!session) return;
    session.state = {
      ...session.state,
      ...patch
    };
  }

  async buildSummary(deviceId, devicesDb) {
    const normalizedId = this.normalizeDeviceId(deviceId);
    const session = this.sessions.get(normalizedId);
    if (!session) return null;
    const dbRow = await devicesDb.getByDeviceId(normalizedId);
    if (!dbRow) return null;
    return {
      device_id: dbRow.device_id,
      name: dbRow.name,
      api_key: dbRow.api_key,
      object_name: dbRow.object_name,
      last_seen_ms: session.lastSeenMs || dbRow.last_seen_ms || 0,
      online: this.isOnline(normalizedId),
      hello: session.hello || null,
      system: session.state?.system || null,
      controllers: session.state?.controllers || null,
      stack: session.state?.stack || null,
      last_event: session.state?.last_event || null
    };
  }

  async listOnlineDevices(objectName, devicesDb) {
    const rows = await devicesDb.listDevicesByObject(objectName);
    return rows
      .filter(row => this.isOnline(row.device_id))
      .map(row => ({
        device_id: row.device_id,
        name: row.name,
        api_key: row.api_key,
        object_name: row.object_name,
        last_seen_ms: row.last_seen_ms || 0
      }));
  }

  async listAllWithStatus(devicesDb) {
    const rows = await devicesDb.listAllDevices();
    return rows.map(row => ({
      device_id: row.device_id,
      name: row.name,
      api_key: row.api_key,
      object_name: row.object_name,
      last_seen_ms: row.last_seen_ms || 0,
      online: this.isOnline(row.device_id)
    }));
  }

  expireStale(onOffline) {
    const now = Date.now();
    for (const [deviceId, session] of this.sessions) {
      if (now - session.lastSeenMs > this.onlineTtlMs) {
        this.socketToDevice.delete(session.ws);
        this.sessions.delete(deviceId);
        try {
          session.ws?.close();
        } catch (err) {
          // ignore socket close errors during stale cleanup
        }
        if (onOffline) onOffline(deviceId);
      }
    }
  }

  disconnect(deviceId) {
    const normalizedId = this.normalizeDeviceId(deviceId);
    const session = this.sessions.get(normalizedId);
    if (!session) return false;
    this.socketToDevice.delete(session.ws);
    session.ws.close();
    this.sessions.delete(normalizedId);
    return true;
  }

  listSessions() {
    return [...this.sessions.values()];
  }
}
