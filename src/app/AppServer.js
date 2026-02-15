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
import path from 'node:path';
import fs from 'node:fs';

import { SessionStore } from '../state/SessionStore.js';
import { DeviceRegistry } from '../state/DeviceRegistry.js';
import { DatastoreFactory } from './factories/DatastoreFactory.js';
import { HttpFactory } from './factories/HttpFactory.js';
import { WsFactory } from './factories/WsFactory.js';
import { rootLogger } from '../utils/Logger.js';

const logger = rootLogger.child('APP');

export class AppServer {
  constructor({ rootDir, dataDir, publicDir, protoPath, defaultObjects, onlineTtlMs }) {
    this.rootDir = rootDir;
    this.dataDir = dataDir;
    this.publicDir = publicDir;
    this.protoPath = protoPath;
    this.defaultObjects = defaultObjects;
    this.onlineTtlMs = onlineTtlMs;

    this.proto = JSON.parse(fs.readFileSync(this.protoPath, 'utf8'));

    this.sessions = new SessionStore();
    this.registry = new DeviceRegistry({ onlineTtlMs: this.onlineTtlMs });

    this.usersDb = null;
    this.devicesDb = null;
    this.app = null;
    this.server = null;
    this.webWs = null;
    this.deviceWs = null;
    this.offlineTimer = null;
    this.devicePingTimer = null;
  }

  async init() {
    this.ensureDir(this.dataDir);

    const datastores = await new DatastoreFactory({
      dataDir: this.dataDir,
      defaultObjects: this.defaultObjects
    }).build();
    this.usersDb = datastores.usersDb;
    this.devicesDb = datastores.devicesDb;

    const http = new HttpFactory({
      publicDir: this.publicDir,
      usersDb: this.usersDb,
      devicesDb: this.devicesDb,
      sessions: this.sessions,
      registry: this.registry,
      onDeviceDisconnect: (deviceId) => {
        const disconnected = this.registry.disconnect(deviceId);
        if (disconnected && this.webWs) {
          this.webWs.broadcast({ type: 'device_offline', device_id: deviceId });
        }
      }
    }).build();
    this.app = http.app;
    this.server = http.server;

    const ws = new WsFactory({
      server: this.server,
      proto: this.proto,
      sessions: this.sessions,
      devicesDb: this.devicesDb,
      registry: this.registry,
      onDeviceOnline: (deviceId) => this.webWs?.broadcast({ type: 'device_online', device_id: deviceId }),
      onDeviceOffline: (deviceId) => this.webWs?.broadcast({ type: 'device_offline', device_id: deviceId }),
      onDeviceUpdate: (summary) => this.webWs?.broadcastDeviceUpdate(summary)
    }).build();

    this.webWs = ws.webWs;
    this.deviceWs = ws.deviceWs;

    this.offlineTimer = setInterval(() => {
      this.registry.expireStale((deviceId) => {
        this.webWs?.broadcast({ type: 'device_offline', device_id: deviceId });
      });
    }, 5_000);

    this.devicePingTimer = setInterval(() => {
      this.deviceWs?.pingAll();
    }, 10_000);
  }

  async close() {
    if (this.offlineTimer) clearInterval(this.offlineTimer);
    if (this.devicePingTimer) clearInterval(this.devicePingTimer);
  }

  listen(port, host = '127.0.0.1') {
    this.server.listen(port, host, () => {
      logger.info(`plc-cloud listening on http://${host}:${port}`);
    });
  }

  ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
