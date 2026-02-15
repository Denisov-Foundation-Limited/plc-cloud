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
import { WebSocketServer } from 'ws';
import { DeviceWsServer } from '../../ws/DeviceWsServer.js';
import { WebWsServer } from '../../ws/WebWsServer.js';
import { rootLogger } from '../../utils/Logger.js';

const logger = rootLogger.child('WS');

export class WsFactory {
  constructor({ server, proto, sessions, devicesDb, registry, onDeviceOnline, onDeviceOffline, onDeviceUpdate }) {
    this.server = server;
    this.proto = proto;
    this.sessions = sessions;
    this.devicesDb = devicesDb;
    this.registry = registry;
    this.onDeviceOnline = onDeviceOnline;
    this.onDeviceOffline = onDeviceOffline;
    this.onDeviceUpdate = onDeviceUpdate;
  }

  build() {
    const webWss = new WebSocketServer({ noServer: true });
    const deviceWss = new WebSocketServer({ noServer: true });

    const webWs = new WebWsServer({
      wss: webWss,
      sessions: this.sessions,
      devicesDb: this.devicesDb,
      registry: this.registry
    });

    const deviceWs = new DeviceWsServer({
      wss: deviceWss,
      proto: this.proto,
      devicesDb: this.devicesDb,
      registry: this.registry,
      onDeviceOnline: this.onDeviceOnline,
      onDeviceOffline: this.onDeviceOffline,
      onDeviceUpdate: this.onDeviceUpdate
    });

    webWs.setDeviceWs(deviceWs);

    this.server.on('upgrade', (req, socket, head) => {
      const { url } = req;
      if (url.startsWith('/ws/device')) {
        logger.info(`upgrade device ${req.socket.remoteAddress || 'unknown'}`);
        deviceWss.handleUpgrade(req, socket, head, ws => deviceWss.emit('connection', ws, req));
        return;
      }
      if (url.startsWith('/ws/web')) {
        logger.info(`upgrade web ${req.socket.remoteAddress || 'unknown'}`);
        webWss.handleUpgrade(req, socket, head, ws => webWss.emit('connection', ws, req));
        return;
      }
      socket.destroy();
    });

    webWs.init();
    deviceWs.init();

    return { webWs, deviceWs, webWss, deviceWss };
  }
}
