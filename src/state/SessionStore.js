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

export class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  create(user, nowMs) {
    const username = typeof user === 'string' ? user : (user?.username || '');
    const token = crypto.randomUUID();
    this.sessions.set(token, {
      uid: username,
      username,
      plc_username: typeof user === 'string' ? '' : (user?.plc_username || ''),
      createdAt: nowMs()
    });
    return token;
  }

  get(token) {
    return this.sessions.get(token) || null;
  }

  delete(token) {
    this.sessions.delete(token);
  }

  fromRequest(req) {
    const token = req.cookies?.session;
    if (!token) return null;
    return this.get(token);
  }

  has(token) {
    return this.sessions.has(token);
  }
}
