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
import { rootLogger } from '../utils/Logger.js';

const logger = rootLogger.child('WEB_WS');

export class WebWsServer {
  constructor({ wss, sessions, devicesDb, registry }) {
    this.wss = wss;
    this.sessions = sessions;
    this.devicesDb = devicesDb;
    this.registry = registry;
    this.clients = new Set();
    this.deviceWs = null;
  }

  setDeviceWs(deviceWs) {
    this.deviceWs = deviceWs;
  }

  init() {
    this.wss.on('connection', (ws, req) => {
      const cookies = (req.headers.cookie || '').split(';').map(v => v.trim());
      const sessionCookie = cookies.find(c => c.startsWith('session='));
      const token = sessionCookie ? sessionCookie.split('=')[1] : null;
      const session = token ? this.sessions.get(token) : null;
      if (!session) {
        logger.warn('web auth failed');
        ws.close();
        return;
      }
      logger.info('web connected');
      ws.session = session;
      ws.sessionToken = token;
      ws.subscriptions = new Set();
      this.clients.add(ws);

      ws.on('message', async data => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch (err) {
          return;
        }
        if (msg.type === 'list_devices') {
          const devices = await this.registry.listOnlineDevices(msg.object_name || '', this.devicesDb);
          this.send(ws, {
            type: 'devices_update',
            object_name: msg.object_name,
            devices: devices.map(d => ({
              device_id: d.device_id,
              name: d.name,
              object_name: d.object_name,
              online: Boolean(d.online),
              stack: d.stack || null
            }))
          });
          return;
        }
        if (msg.type === 'subscribe_device') {
          const deviceId = Number(msg.device_id);
          ws.subscriptions.add(deviceId);
          const summary = await this.registry.buildSummary(deviceId, this.devicesDb);
          if (summary) {
            this.send(ws, { type: 'device_update', device: summary });
          }
          return;
        }
        if (msg.type === 'unsubscribe_device') {
          ws.subscriptions.delete(Number(msg.device_id));
          return;
        }
        if (msg.type === 'send_get') {
          const result = this.deviceWs?.sendGet(
            Number(msg.device_id),
            Array.isArray(msg.what) ? msg.what : [],
            msg.unit || 'local',
            msg.node_id
          );
          if (!result || !result.ok) {
            this.send(ws, { type: 'command_error', error: result?.error || 'device_offline', device_id: msg.device_id });
            return;
          }
          this.send(ws, { type: 'command_sent', id: result.id, device_id: msg.device_id, kind: 'get' });
          return;
        }
        if (msg.type === 'send_cmd') {
          const actor = {
            uid: ws.session?.uid || ws.session?.username || '',
            username: ws.session?.username || '',
            plc_username: ws.session?.plc_username || '',
            source: 'web',
            session_id: ws.sessionToken || ''
          };
          const result = this.deviceWs?.sendCmd(
            Number(msg.device_id),
            msg.controller,
            msg.action,
            msg.args || {},
            actor,
            msg.unit || 'local',
            msg.node_id
          );
          if (!result || !result.ok) {
            this.send(ws, { type: 'command_error', error: result?.error || 'device_offline', device_id: msg.device_id });
            return;
          }
          this.send(ws, { type: 'command_sent', id: result.id, device_id: msg.device_id, kind: 'cmd' });
          return;
        }
      });

      ws.on('close', () => {
        logger.info('web disconnected');
        this.clients.delete(ws);
      });
    });
  }

  send(ws, payload) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    }
  }

  broadcast(payload) {
    const message = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }

  broadcastDeviceUpdate(summary) {
    const message = JSON.stringify({ type: 'device_update', device: summary });
    for (const client of this.clients) {
      if (client.readyState !== 1) continue;
      if (client.subscriptions && client.subscriptions.has(summary.device_id)) {
        client.send(message);
      }
    }
  }
}
