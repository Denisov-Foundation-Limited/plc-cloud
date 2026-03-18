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
import fs from "node:fs/promises";
import path from "node:path";

import { generateApiKey } from "../utils/crypto.js";

export class DevicesDb {
    constructor({ dataDir, defaultObjects = [], sqliteDb }) {
        this.filePath = path.join(dataDir, "devices.json");
        this.defaultObjects = defaultObjects;
        this.defaultObjectIcon = "house";
        this.allowedIcons = new Set([
            "apartment",
            "house",
            "dacha",
            "garage",
            "garden",
        ]);
        this.sqliteDb = sqliteDb;
    }

    async init() {
        const { Device, DeviceObject } = await this.sqliteDb.init();
        await this.importLegacyIfNeeded_(Device, DeviceObject);

        for (const obj of this.defaultObjects) {
            await this.ensureObjectByName_(DeviceObject, obj, this.defaultObjectIcon);
        }
    }

    async ensureSample() {
        const { Device, DeviceObject } = await this.sqliteDb.init();
        const sample = await Device.findOne({ where: { api_key: "DEV_KEY_1" } });
        if (!sample) {
            await Device.create({
                device_id: 12345678,
                name: "PLC-ESP Demo",
                api_key: "DEV_KEY_1",
                object_name: "Квартира",
                last_seen_ms: 0,
            });
            await this.ensureObjectByName_(DeviceObject, "Квартира", "apartment");
        }
    }

    async listObjects() {
        const { DeviceObject } = await this.sqliteDb.init();
        const rows = await DeviceObject.findAll({ order: [["name", "ASC"]] });
        return rows.map((row) => ({
            name: String(row.name || "").trim(),
            icon: this.normalizeIcon(row.icon),
        }));
    }

    async listObjectNames() {
        const objects = await this.listObjects();
        return objects.map((row) => row.name);
    }

    async createObject(name, icon = this.defaultObjectIcon) {
        const objectName = String(name || "").trim();
        if (!objectName) throw new Error("object_name_required");
        const { DeviceObject } = await this.sqliteDb.init();
        const existing = await DeviceObject.findByPk(objectName);
        if (existing) throw new Error("object_exists");
        const normalizedIcon = this.normalizeIcon(icon);
        await DeviceObject.create({ name: objectName, icon: normalizedIcon });
        return { name: objectName, icon: normalizedIcon };
    }

    async deleteObject(name) {
        const objectName = String(name || "").trim();
        if (!objectName) throw new Error("object_name_required");
        const { DeviceObject, Device } = await this.sqliteDb.init();
        const existing = await DeviceObject.findByPk(objectName);
        if (!existing) throw new Error("object_not_found");
        const used = await Device.count({ where: { object_name: objectName } });
        if (used) throw new Error("object_has_devices");
        await existing.destroy();
    }

    async renameObject(currentName, nextName) {
        const from = String(currentName || "").trim();
        const to = String(nextName || "").trim();
        if (!from || !to) throw new Error("object_name_required");
        if (from === to) throw new Error("object_name_same");

        const { DeviceObject, Device, sequelize } = await this.sqliteDb.init();
        const source = await DeviceObject.findByPk(from);
        if (!source) throw new Error("object_not_found");
        const target = await DeviceObject.findByPk(to);
        if (target) throw new Error("object_exists");

        await sequelize.transaction(async (tx) => {
            await DeviceObject.create(
                { name: to, icon: this.normalizeIcon(source.icon) },
                { transaction: tx },
            );
            await Device.update(
                { object_name: to },
                { where: { object_name: from }, transaction: tx },
            );
            await source.destroy({ transaction: tx });
        });
        return to;
    }

    async setObjectIcon(name, icon) {
        const objectName = String(name || "").trim();
        if (!objectName) throw new Error("object_name_required");
        const { DeviceObject } = await this.sqliteDb.init();
        const row = await DeviceObject.findByPk(objectName);
        if (!row) throw new Error("object_not_found");
        const normalizedIcon = this.normalizeIcon(icon);
        await row.update({ icon: normalizedIcon });
        return normalizedIcon;
    }

    async listDevicesByObject(objectName) {
        const { Device } = await this.sqliteDb.init();
        const rows = await Device.findAll({
            where: { object_name: objectName },
            order: [["device_id", "ASC"]],
        });
        return rows.map((row) => this.toRow_(row));
    }

    async listAllDevices() {
        const { Device } = await this.sqliteDb.init();
        const rows = await Device.findAll({
            order: [
                ["object_name", "ASC"],
                ["device_id", "ASC"],
            ],
        });
        return rows.map((row) => this.toRow_(row));
    }

    async getByApiKey(apiKey) {
        const { Device } = await this.sqliteDb.init();
        const row = await Device.findOne({ where: { api_key: apiKey } });
        return row ? this.toRow_(row) : null;
    }

    async getByDeviceId(deviceId) {
        const { Device } = await this.sqliteDb.init();
        const row = await Device.findByPk(Number(deviceId));
        return row ? this.toRow_(row) : null;
    }

    async updateLastSeen(deviceId, ts) {
        const { Device } = await this.sqliteDb.init();
        const row = await Device.findByPk(Number(deviceId));
        if (!row) throw new Error("device_not_found");
        await row.update({ last_seen_ms: Number(ts) || 0 });
    }

    async upsertByApiKey({ deviceId, name, apiKey, lastSeenMs }) {
        const { Device } = await this.sqliteDb.init();
        const row = await Device.findOne({ where: { api_key: apiKey } });
        if (!row) throw new Error("device_not_found");
        await row.update({
            device_id: Number(deviceId),
            name: name || null,
            last_seen_ms: Number(lastSeenMs) || 0,
        });
    }

    async createDevice({ device_id, name, api_key, object_name }) {
        const { Device, DeviceObject } = await this.sqliteDb.init();
        const deviceId = Number(device_id);
        const key =
            api_key && String(api_key).trim() ? api_key : generateApiKey();
        if (await Device.findByPk(deviceId)) throw new Error("device_id_exists");
        if (await Device.findOne({ where: { api_key: key } }))
            throw new Error("api_key_exists");

        await Device.create({
            device_id: deviceId,
            name: name || null,
            api_key: key,
            object_name,
            last_seen_ms: 0,
        });
        if (object_name) {
            await this.ensureObjectByName_(
                DeviceObject,
                object_name,
                this.defaultObjectIcon,
            );
        }
        return key;
    }

    async updateDevice({ currentDeviceId, device_id, name, object_name }) {
        const { Device, DeviceObject } = await this.sqliteDb.init();
        const row = await Device.findByPk(Number(currentDeviceId));
        if (!row) throw new Error("device_not_found");

        const nextDeviceId = device_id ? Number(device_id) : Number(currentDeviceId);
        if (nextDeviceId !== Number(currentDeviceId)) {
            const existing = await Device.findByPk(nextDeviceId);
            if (existing) throw new Error("device_id_exists");
        }

        await row.update({
            device_id: nextDeviceId,
            name: name ?? null,
            object_name: object_name ?? null,
        });
        if (row.object_name) {
            await this.ensureObjectByName_(
                DeviceObject,
                row.object_name,
                this.defaultObjectIcon,
            );
        }
    }

    async rotateKey(deviceId) {
        const { Device } = await this.sqliteDb.init();
        const row = await Device.findByPk(Number(deviceId));
        if (!row) throw new Error("device_not_found");
        let key = generateApiKey();
        while (await Device.findOne({ where: { api_key: key } })) {
            key = generateApiKey();
        }
        await row.update({ api_key: key });
        return key;
    }

    async deleteDevice(deviceId) {
        const { Device } = await this.sqliteDb.init();
        const deleted = await Device.destroy({ where: { device_id: Number(deviceId) } });
        if (!deleted) throw new Error("device_not_found");
    }

    normalizeIcon(icon) {
        const value = String(icon || "")
            .trim()
            .toLowerCase();
        return this.allowedIcons.has(value) ? value : this.defaultObjectIcon;
    }

    normalizeObjectEntry(value) {
        if (typeof value === "string") {
            return {
                name: value.trim(),
                icon: this.defaultObjectIcon,
            };
        }
        const name = String(value?.name || "").trim();
        return {
            name,
            icon: this.normalizeIcon(value?.icon),
        };
    }

    async ensureObjectByName_(DeviceObject, name, icon = this.defaultObjectIcon) {
        const objectName = String(name || "").trim();
        if (!objectName) return;
        const existing = await DeviceObject.findByPk(objectName);
        if (existing) return;
        await DeviceObject.create({
            name: objectName,
            icon: this.normalizeIcon(icon),
        });
    }

    toRow_(row) {
        return {
            device_id: Number(row.device_id),
            name: row.name || null,
            api_key: row.api_key,
            object_name: row.object_name || null,
            last_seen_ms: Number(row.last_seen_ms) || 0,
        };
    }

    async importLegacyIfNeeded_(Device, DeviceObject) {
        const count = await Device.count();
        const objectCount = await DeviceObject.count();
        if (count > 0 || objectCount > 0) return;

        let parsed = null;
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            parsed = JSON.parse(raw);
        } catch (err) {
            if (err?.code === "ENOENT") return;
            throw err;
        }

        const objects = Array.isArray(parsed?.objects) ? parsed.objects : [];
        for (const raw of objects) {
            const row = this.normalizeObjectEntry(raw);
            if (!row.name) continue;
            await this.ensureObjectByName_(DeviceObject, row.name, row.icon);
        }

        const devices = Array.isArray(parsed?.devices) ? parsed.devices : [];
        for (const row of devices) {
            const deviceId = Number(row?.device_id);
            if (!Number.isFinite(deviceId)) continue;
            await Device.create({
                device_id: deviceId,
                name: row?.name || null,
                api_key: String(row?.api_key || "").trim(),
                object_name: row?.object_name || null,
                last_seen_ms: Number(row?.last_seen_ms) || 0,
            });
            if (row?.object_name) {
                await this.ensureObjectByName_(
                    DeviceObject,
                    row.object_name,
                    this.defaultObjectIcon,
                );
            }
        }
    }
}
