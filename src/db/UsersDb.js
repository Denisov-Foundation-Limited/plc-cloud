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
import fs from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from '../utils/crypto.js';

export class UsersDb {
  constructor({ dataDir }) {
    this.filePath = path.join(dataDir, 'users.json');
  }

  async init() {
    const data = await this.readData();
    const existing = data.users.find(row => row.username === 'admin');
    if (!existing) {
      data.users.push({
        username: 'admin',
        password_hash: sha256('')
      });
      await this.writeData(data);
    }
  }

  async findByUsername(username) {
    const data = await this.readData();
    return data.users.find(row => row.username === username) || null;
  }

  async validateCredentials(username, password) {
    const row = await this.findByUsername(username);
    if (!row) return false;
    const passHash = sha256(password || '');
    return passHash === row.password_hash;
  }

  async readData() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return { users: [] };
      }
      return {
        users: Array.isArray(parsed.users) ? parsed.users : []
      };
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { users: [] };
      }
      throw err;
    }
  }

  async writeData(data) {
    const payload = JSON.stringify(data, null, 2);
    await fs.writeFile(this.filePath, payload, 'utf8');
  }
}
