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
import { AppServer } from './AppServer.js';

export class AppContainer {
  constructor({ rootDir }) {
    this.rootDir = rootDir;
    this.dataDir = path.join(rootDir, 'data');
    this.publicDir = path.join(rootDir, 'public');
    this.protoPath = path.join(rootDir, 'proto.json');
  }

  build() {
    const app = new AppServer({
      rootDir: this.rootDir,
      dataDir: this.dataDir,
      publicDir: this.publicDir,
      protoPath: this.protoPath,
      defaultObjects: ['Квартира', 'Дача', 'Деревня'],
      onlineTtlMs: 30_000
    });
    return app;
  }
}
