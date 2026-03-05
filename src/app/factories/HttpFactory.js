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
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { ApiRouter } from '../../http/ApiRouter.js';

export class HttpFactory {
  constructor({ publicDir, usersDb, devicesDb, sessions, registry, onDeviceDisconnect }) {
    this.publicDir = publicDir;
    this.usersDb = usersDb;
    this.devicesDb = devicesDb;
    this.sessions = sessions;
    this.registry = registry;
    this.onDeviceDisconnect = onDeviceDisconnect;
  }

  build() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(express.static(this.publicDir, {
      setHeaders: (res, filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.html') res.setHeader('Content-Type', 'text/html; charset=utf-8');
        if (ext === '.js') res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        if (ext === '.css') res.setHeader('Content-Type', 'text/css; charset=utf-8');
        if (ext === '.json') res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (['.html', '.js', '.css', '.json'].includes(ext)) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    }));

    const api = new ApiRouter({
      app,
      usersDb: this.usersDb,
      devicesDb: this.devicesDb,
      sessions: this.sessions,
      registry: this.registry,
      nowMs: () => Date.now(),
      onDeviceDisconnect: this.onDeviceDisconnect
    });
    api.init();

    const server = http.createServer(app);
    return { app, server };
  }
}
