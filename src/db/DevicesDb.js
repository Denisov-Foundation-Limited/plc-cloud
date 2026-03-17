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
    constructor({ dataDir, defaultObjects = [] }) {
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
    }

    async init() {
        const fileExists = await this.hasStorageFile();
        const data = await this.readData();
        if (!fileExists) {
            for (const obj of this.defaultObjects) {
                this.ensureObject(data, obj, this.defaultObjectIcon);
            }
        }
        data.objects = this.uniqueSortedObjects(data.objects);
        await this.writeData(data);
    }

    async ensureSample() {
        const data = await this.readData();
        const sample = data.devices.find((row) => row.api_key === "DEV_KEY_1");
        if (!sample) {
            data.devices.push({
                device_id: 12345678,
                name: "PLC-ESP Demo",
                api_key: "DEV_KEY_1",
                object_name: "Квартира",
                last_seen_ms: 0,
            });
            this.ensureObject(data, "Квартира", "apartment");
            await this.writeData(data);
        }
    }

    async listObjects() {
        const data = await this.readData();
        return this.uniqueSortedObjects(data.objects);
    }

    async listObjectNames() {
        const objects = await this.listObjects();
        return objects.map((row) => row.name);
    }

    async createObject(name, icon = this.defaultObjectIcon) {
        const objectName = String(name || "").trim();
        if (!objectName) {
            throw new Error("object_name_required");
        }
        const data = await this.readData();
        if (
            data.objects.some((row) => String(row?.name || row) === objectName)
        ) {
            throw new Error("object_exists");
        }
        const normalizedIcon = this.normalizeIcon(icon);
        data.objects.push({ name: objectName, icon: normalizedIcon });
        data.objects = this.uniqueSortedObjects(data.objects);
        await this.writeData(data);
        return { name: objectName, icon: normalizedIcon };
    }

    async deleteObject(name) {
        const objectName = String(name || "").trim();
        if (!objectName) {
            throw new Error("object_name_required");
        }
        const data = await this.readData();
        if (
            !data.objects.some((row) => String(row?.name || row) === objectName)
        ) {
            throw new Error("object_not_found");
        }
        if (
            data.devices.some(
                (row) => String(row.object_name || "") === objectName,
            )
        ) {
            throw new Error("object_has_devices");
        }
        data.objects = data.objects.filter(
            (row) => String(row?.name || row) !== objectName,
        );
        await this.writeData(data);
    }

    async renameObject(currentName, nextName) {
        const from = String(currentName || "").trim();
        const to = String(nextName || "").trim();
        if (!from || !to) {
            throw new Error("object_name_required");
        }
        if (from === to) {
            throw new Error("object_name_same");
        }
        const data = await this.readData();
        if (!data.objects.some((row) => String(row?.name || row) === from)) {
            throw new Error("object_not_found");
        }
        if (data.objects.some((row) => String(row?.name || row) === to)) {
            throw new Error("object_exists");
        }

        data.objects = data.objects.map((row) => {
            const obj = this.normalizeObjectEntry(row);
            return obj.name === from ? { ...obj, name: to } : obj;
        });
        for (const device of data.devices) {
            if (String(device.object_name || "") === from) {
                device.object_name = to;
            }
        }
        data.objects = this.uniqueSortedObjects(data.objects);
        await this.writeData(data);
        return to;
    }

    async setObjectIcon(name, icon) {
        const objectName = String(name || "").trim();
        if (!objectName) {
            throw new Error("object_name_required");
        }
        const data = await this.readData();
        const index = data.objects.findIndex(
            (row) => String(row?.name || row) === objectName,
        );
        if (index < 0) {
            throw new Error("object_not_found");
        }
        const normalizedIcon = this.normalizeIcon(icon);
        data.objects[index] = { name: objectName, icon: normalizedIcon };
        data.objects = this.uniqueSortedObjects(data.objects);
        await this.writeData(data);
        return normalizedIcon;
    }

    async listDevicesByObject(objectName) {
        const data = await this.readData();
        return data.devices
            .filter((row) => row.object_name === objectName)
            .sort((a, b) => a.device_id - b.device_id);
    }

    async listAllDevices() {
        const data = await this.readData();
        return [...data.devices].sort((a, b) => {
            const obj = String(a.object_name || "").localeCompare(
                String(b.object_name || ""),
            );
            if (obj !== 0) return obj;
            return a.device_id - b.device_id;
        });
    }

    async getByApiKey(apiKey) {
        const data = await this.readData();
        return data.devices.find((row) => row.api_key === apiKey) || null;
    }

    async getByDeviceId(deviceId) {
        const data = await this.readData();
        return data.devices.find((row) => row.device_id === deviceId) || null;
    }

    async updateLastSeen(deviceId, ts) {
        const data = await this.readData();
        const row = data.devices.find((r) => r.device_id === deviceId);
        if (!row) {
            throw new Error("device_not_found");
        }
        row.last_seen_ms = ts;
        await this.writeData(data);
    }

    async upsertByApiKey({ deviceId, name, apiKey, lastSeenMs }) {
        const data = await this.readData();
        const row = data.devices.find((r) => r.api_key === apiKey);
        if (!row) {
            throw new Error("device_not_found");
        }
        row.device_id = Number(deviceId);
        row.name = name || null;
        row.last_seen_ms = lastSeenMs;
        await this.writeData(data);
    }

    async createDevice({ device_id, name, api_key, object_name }) {
        const data = await this.readData();
        const key =
            api_key && String(api_key).trim() ? api_key : generateApiKey();

        if (data.devices.some((row) => row.device_id === Number(device_id))) {
            throw new Error("device_id_exists");
        }
        if (data.devices.some((row) => row.api_key === key)) {
            throw new Error("api_key_exists");
        }

        data.devices.push({
            device_id: Number(device_id),
            name: name || null,
            api_key: key,
            object_name,
            last_seen_ms: 0,
        });
        this.ensureObject(data, object_name, this.defaultObjectIcon);
        await this.writeData(data);
        return key;
    }

    async updateDevice({ currentDeviceId, device_id, name, object_name }) {
        const data = await this.readData();
        const row = data.devices.find((r) => r.device_id === currentDeviceId);
        if (!row) {
            throw new Error("device_not_found");
        }

        const nextDeviceId = device_id ? Number(device_id) : currentDeviceId;
        if (
            nextDeviceId !== currentDeviceId &&
            data.devices.some((r) => r.device_id === nextDeviceId)
        ) {
            throw new Error("device_id_exists");
        }

        row.device_id = nextDeviceId;
        row.name = name ?? null;
        row.object_name = object_name ?? null;
        if (row.object_name) {
            this.ensureObject(data, row.object_name, this.defaultObjectIcon);
        }
        await this.writeData(data);
    }

    async rotateKey(deviceId) {
        const data = await this.readData();
        const row = data.devices.find((r) => r.device_id === deviceId);
        if (!row) {
            throw new Error("device_not_found");
        }
        let key = generateApiKey();
        while (data.devices.some((r) => r.api_key === key)) {
            key = generateApiKey();
        }
        row.api_key = key;
        await this.writeData(data);
        return key;
    }

    async deleteDevice(deviceId) {
        const data = await this.readData();
        const next = data.devices.filter((r) => r.device_id !== deviceId);
        if (next.length === data.devices.length) {
            throw new Error("device_not_found");
        }
        data.devices = next;
        await this.writeData(data);
    }

    async readData() {
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") {
                return { objects: [], devices: [] };
            }
            const parsedObjects = Array.isArray(parsed.objects)
                ? parsed.objects
                : [];
            return {
                objects: this.uniqueSortedObjects(parsedObjects),
                devices: Array.isArray(parsed.devices) ? parsed.devices : [],
            };
        } catch (err) {
            if (err.code === "ENOENT") {
                return { objects: [], devices: [] };
            }
            throw err;
        }
    }

    async writeData(data) {
        const normalized = {
            ...data,
            objects: this.uniqueSortedObjects(data.objects),
        };
        const payload = JSON.stringify(normalized, null, 2);
        await fs.writeFile(this.filePath, payload, "utf8");
    }

    uniqueSorted(values) {
        return [
            ...new Set(
                values.filter(
                    (v) =>
                        v !== null &&
                        v !== undefined &&
                        String(v).trim() !== "",
                ),
            ),
        ].sort((a, b) => String(a).localeCompare(String(b)));
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

    uniqueSortedObjects(values) {
        const items = Array.isArray(values) ? values : [];
        const map = new Map();
        for (const raw of items) {
            const row = this.normalizeObjectEntry(raw);
            if (!row.name) continue;
            map.set(row.name, row);
        }
        return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    ensureObject(data, name, icon = this.defaultObjectIcon) {
        const objectName = String(name || "").trim();
        if (!objectName) return;
        const existing = data.objects.find(
            (row) => String(row?.name || row) === objectName,
        );
        if (existing) {
            if (typeof existing !== "string" && !existing.icon) {
                existing.icon = this.normalizeIcon(icon);
            }
            data.objects = this.uniqueSortedObjects(data.objects);
            return;
        }
        data.objects.push({
            name: objectName,
            icon: this.normalizeIcon(icon),
        });
        data.objects = this.uniqueSortedObjects(data.objects);
    }

    async hasStorageFile() {
        try {
            await fs.access(this.filePath);
            return true;
        } catch {
            return false;
        }
    }
}
