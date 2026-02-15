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
import { UsersDb } from '../../db/UsersDb.js';
import { DevicesDb } from '../../db/DevicesDb.js';

export class DatastoreFactory {
  constructor({ dataDir, defaultObjects }) {
    this.dataDir = dataDir;
    this.defaultObjects = defaultObjects;
  }

  async build() {
    const usersDb = new UsersDb({ dataDir: this.dataDir });
    const devicesDb = new DevicesDb({ dataDir: this.dataDir, defaultObjects: this.defaultObjects });

    await usersDb.init();
    await devicesDb.init();
    if (process.env.PLC_CLOUD_SEED_SAMPLE === '1') {
      await devicesDb.ensureSample();
    }

    return { usersDb, devicesDb };
  }
}
