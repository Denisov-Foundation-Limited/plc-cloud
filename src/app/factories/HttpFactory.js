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
    app.use(express.static(this.publicDir));

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
