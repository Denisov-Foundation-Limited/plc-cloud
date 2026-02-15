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
export class ApiRouter {
  constructor({ app, usersDb, devicesDb, sessions, registry, nowMs, onDeviceDisconnect }) {
    this.app = app;
    this.usersDb = usersDb;
    this.devicesDb = devicesDb;
    this.sessions = sessions;
    this.registry = registry;
    this.nowMs = nowMs;
    this.onDeviceDisconnect = onDeviceDisconnect;
  }

  init() {
    this.app.post('/api/login', async (req, res) => {
      const { username, password } = req.body || {};
      const ok = await this.usersDb.validateCredentials(username, password);
      if (!ok) {
        res.status(401).json({ ok: false, error: 'invalid_credentials' });
        return;
      }
      const token = this.sessions.create(username, this.nowMs);
      res.cookie('session', token, { httpOnly: true, sameSite: 'lax' });
      res.json({ ok: true });
    });

    this.app.post('/api/logout', this.requireAuth(), (req, res) => {
      const token = req.cookies?.session;
      if (token) this.sessions.delete(token);
      res.clearCookie('session');
      res.json({ ok: true });
    });

    this.app.get('/api/objects', this.requireAuth(), async (req, res) => {
      const objects = await this.devicesDb.listObjects();
      res.json({ ok: true, objects });
    });

    this.app.get('/api/devices', this.requireAuth(), async (req, res) => {
      const objectName = req.query.object;
      if (!objectName) {
        res.status(400).json({ ok: false, error: 'object_required' });
        return;
      }
      const devices = await this.registry.listOnlineDevices(objectName, this.devicesDb);
      res.json({
        ok: true,
        devices: devices.map(d => ({
          device_id: d.device_id,
          name: d.name,
          object_name: d.object_name
        }))
      });
    });

    this.app.get('/api/device/:id', this.requireAuth(), async (req, res) => {
      const deviceId = Number(req.params.id);
      const summary = await this.registry.buildSummary(deviceId, this.devicesDb);
      if (!summary) {
        res.status(404).json({ ok: false, error: 'device_not_found' });
        return;
      }
      res.json({ ok: true, device: summary });
    });

    this.app.get('/api/admin/devices', this.requireAuth(), async (req, res) => {
      const devices = await this.registry.listAllWithStatus(this.devicesDb);
      res.json({ ok: true, devices });
    });

    this.app.post('/api/admin/objects', this.requireAuth(), async (req, res) => {
      const { name, icon } = req.body || {};
      try {
        const objectItem = await this.devicesDb.createObject(name, icon);
        res.json({ ok: true, object: objectItem });
      } catch (err) {
        const error = err?.message || 'object_create_failed';
        const status = error === 'object_exists' || error === 'object_name_required' ? 400 : 500;
        res.status(status).json({ ok: false, error });
      }
    });

    this.app.delete('/api/admin/objects/:name', this.requireAuth(), async (req, res) => {
      try {
        await this.devicesDb.deleteObject(req.params.name);
        res.json({ ok: true });
      } catch (err) {
        const error = err?.message || 'object_delete_failed';
        const status = error === 'object_not_found' || error === 'object_name_required' || error === 'object_has_devices' ? 400 : 500;
        res.status(status).json({ ok: false, error });
      }
    });

    this.app.put('/api/admin/objects/:name', this.requireAuth(), async (req, res) => {
      const nextName = req.body?.name;
      try {
        const objectName = await this.devicesDb.renameObject(req.params.name, nextName);
        res.json({ ok: true, object: objectName });
      } catch (err) {
        const error = err?.message || 'object_rename_failed';
        const status = error === 'object_not_found' || error === 'object_name_required' || error === 'object_exists' || error === 'object_name_same' ? 400 : 500;
        res.status(status).json({ ok: false, error });
      }
    });

    this.app.put('/api/admin/objects/:name/icon', this.requireAuth(), async (req, res) => {
      const icon = req.body?.icon;
      try {
        const nextIcon = await this.devicesDb.setObjectIcon(req.params.name, icon);
        res.json({ ok: true, icon: nextIcon });
      } catch (err) {
        const error = err?.message || 'object_icon_update_failed';
        const status = error === 'object_not_found' || error === 'object_name_required' ? 400 : 500;
        res.status(status).json({ ok: false, error });
      }
    });

    this.app.post('/api/admin/devices', this.requireAuth(), async (req, res) => {
      const { device_id, name, api_key, object_name } = req.body || {};
      if (!device_id || !object_name) {
        res.status(400).json({ ok: false, error: 'device_id_and_object_required' });
        return;
      }
      try {
        const key = await this.devicesDb.createDevice({ device_id, name, api_key, object_name });
        res.json({ ok: true, api_key: key });
      } catch (err) {
        res.status(400).json({ ok: false, error: 'device_create_failed' });
      }
    });

    this.app.put('/api/admin/devices/:id', this.requireAuth(), async (req, res) => {
      const deviceId = Number(req.params.id);
      const row = await this.devicesDb.getByDeviceId(deviceId);
      if (!row) {
        res.status(404).json({ ok: false, error: 'device_not_found' });
        return;
      }
      try {
        await this.devicesDb.updateDevice({
          currentDeviceId: row.device_id,
          device_id: req.body?.device_id,
          name: req.body?.name ?? row.name,
          object_name: req.body?.object_name ?? row.object_name
        });
      } catch (err) {
        res.status(400).json({ ok: false, error: 'device_update_failed' });
        return;
      }
      res.json({ ok: true });
    });

    this.app.post('/api/admin/devices/:id/rotate_key', this.requireAuth(), async (req, res) => {
      const deviceId = Number(req.params.id);
      const row = await this.devicesDb.getByDeviceId(deviceId);
      if (!row) {
        res.status(404).json({ ok: false, error: 'device_not_found' });
        return;
      }
      const key = await this.devicesDb.rotateKey(deviceId);
      if (this.onDeviceDisconnect) {
        this.onDeviceDisconnect(deviceId);
      }
      res.json({ ok: true, api_key: key });
    });

    this.app.delete('/api/admin/devices/:id', this.requireAuth(), async (req, res) => {
      const deviceId = Number(req.params.id);
      await this.devicesDb.deleteDevice(deviceId);
      if (this.onDeviceDisconnect) {
        this.onDeviceDisconnect(deviceId);
      }
      res.json({ ok: true });
    });
  }

  requireAuth() {
    return (req, res, next) => {
      const session = this.sessions.fromRequest(req);
      if (!session) {
        res.status(401).json({ ok: false, error: 'unauthorized' });
        return;
      }
      req.session = session;
      next();
    };
  }
}
