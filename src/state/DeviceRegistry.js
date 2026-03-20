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
export class DeviceRegistry {
    constructor({ onlineTtlMs }) {
        this.onlineTtlMs = onlineTtlMs;
        this.sessions = new Map();
        this.socketToDevice = new Map();
    }

    normalizeDeviceId(deviceId) {
        const n = Number(deviceId);
        return Number.isFinite(n) ? n : deviceId;
    }

    attach(ws, { deviceId, sessionId, apiKey, hello }) {
        const normalizedId = this.normalizeDeviceId(deviceId);
        const now = Date.now();

        const existing = this.sessions.get(normalizedId);
        if (existing?.ws && existing.ws !== ws) {
            this.socketToDevice.delete(existing.ws);
            try {
                existing.ws.close();
            } catch (err) {
                // ignore socket close errors during session replacement
            }
        }

        this.sessions.set(normalizedId, {
            ws,
            sessionId,
            apiKey,
            deviceId: normalizedId,
            lastSeenMs: now,
            hello: hello || null,
            state: {},
        });
        this.socketToDevice.set(ws, normalizedId);
    }

    detachBySocket(ws) {
        const deviceId = this.socketToDevice.get(ws);
        if (!deviceId) return null;
        this.socketToDevice.delete(ws);
        this.sessions.delete(deviceId);
        return deviceId;
    }

    getDeviceIdBySocket(ws) {
        return this.socketToDevice.get(ws);
    }

    getSession(deviceId) {
        return this.sessions.get(this.normalizeDeviceId(deviceId));
    }

    markSeen(deviceId) {
        const session = this.sessions.get(this.normalizeDeviceId(deviceId));
        if (session) {
            session.lastSeenMs = Date.now();
        }
    }

    isOnline(deviceId) {
        const session = this.sessions.get(this.normalizeDeviceId(deviceId));
        if (!session) return false;
        return Date.now() - session.lastSeenMs < this.onlineTtlMs;
    }

    registerState(deviceId, patch, scope = null) {
        const session = this.sessions.get(this.normalizeDeviceId(deviceId));
        if (!session) return;
        const unit = scope?.unit === "stack" ? "stack" : "local";
        const nodeId = Number(scope?.node_id);
        if (unit === "stack" && Number.isFinite(nodeId) && nodeId > 0) {
            const key = String(nodeId);
            const stackUnits = {
                ...(session.state?.stack_units || {}),
            };
            const prev = stackUnits[key] || {};
            const normalizedPatch = this.normalizeStatePatch_(
                patch,
                prev.controllers,
                scope,
            );
            const prevSystem =
                prev.system && typeof prev.system === "object"
                    ? prev.system
                    : null;
            const patchSystem =
                normalizedPatch.system &&
                typeof normalizedPatch.system === "object"
                    ? normalizedPatch.system
                    : null;
            const prevControllers =
                prev.controllers && typeof prev.controllers === "object"
                    ? prev.controllers
                    : null;
            const patchControllers =
                normalizedPatch.controllers &&
                typeof normalizedPatch.controllers === "object"
                    ? normalizedPatch.controllers
                    : null;
            const mergedSystem = patchSystem
                ? {
                      ...(prevSystem || {}),
                      ...patchSystem,
                      plc: patchSystem.plc
                          ? {
                                ...((prevSystem && prevSystem.plc) || {}),
                                ...patchSystem.plc,
                            }
                          : (prevSystem && prevSystem.plc) || undefined,
                      rtc: patchSystem.rtc
                          ? {
                                ...((prevSystem && prevSystem.rtc) || {}),
                                ...patchSystem.rtc,
                            }
                          : (prevSystem && prevSystem.rtc) || undefined,
                      fan: patchSystem.fan
                          ? {
                                ...((prevSystem && prevSystem.fan) || {}),
                                ...patchSystem.fan,
                            }
                          : (prevSystem && prevSystem.fan) || undefined,
                      wifi: patchSystem.wifi
                          ? {
                                ...((prevSystem && prevSystem.wifi) || {}),
                                ...patchSystem.wifi,
                            }
                          : (prevSystem && prevSystem.wifi) || undefined,
                      gsm: patchSystem.gsm
                          ? {
                                ...((prevSystem && prevSystem.gsm) || {}),
                                ...patchSystem.gsm,
                            }
                          : (prevSystem && prevSystem.gsm) || undefined,
                  }
                : prevSystem || null;
            const mergedControllers = patchControllers
                ? this.mergeControllers_(prevControllers, patchControllers)
                : prevControllers || null;
            stackUnits[key] = {
                ...prev,
                ...normalizedPatch,
                system: mergedSystem,
                controllers: mergedControllers,
                last_event:
                    normalizedPatch.last_event ?? prev.last_event ?? null,
                updated_ms: Date.now(),
            };
            session.state = {
                ...session.state,
                stack_units: stackUnits,
            };
            return;
        }
        const normalizedPatch = this.normalizeStatePatch_(
            patch,
            session.state?.controllers,
            scope,
        );
        session.state = {
            ...session.state,
            ...normalizedPatch,
            controllers: this.mergeControllers_(
                session.state?.controllers,
                normalizedPatch.controllers,
            ),
        };
    }

    normalizeStatePatch_(patch, prevControllers, scope = null) {
        const next =
            patch && typeof patch === "object"
                ? { ...patch }
                : {};
        const eventControllers = this.buildControllerPatchFromEvent_(
            prevControllers,
            next.last_event,
            scope,
        );
        if (eventControllers) {
            next.controllers = this.mergeControllers_(
                next.controllers,
                eventControllers,
            );
        }
        return next;
    }

    buildControllerPatchFromEvent_(prevControllers, eventPayload, scope = null) {
        if (!eventPayload || typeof eventPayload !== "object") return null;
        const scopeUnit = scope?.unit === "stack" ? "stack" : "local";
        const scopeNodeId = Number(scope?.node_id);
        const eventUnit = eventPayload.unit === "stack" ? "stack" : "local";
        const eventNodeId = Number(eventPayload.node_id);
        if (scopeUnit === "stack") {
            if (
                eventUnit !== "stack" ||
                !Number.isFinite(scopeNodeId) ||
                scopeNodeId <= 0 ||
                Number(eventNodeId) !== scopeNodeId
            ) {
                return null;
            }
        } else if (eventUnit === "stack") {
            return null;
        }

        const data =
            eventPayload.data && typeof eventPayload.data === "object"
                ? eventPayload.data
                : null;
        if (!data) return null;

        let controllerKey = null;
        let itemPatch = null;
        if (eventPayload.kind === "sockets.state") {
            controllerKey = "sockets";
            itemPatch = {
                state: Boolean(data.state),
                relay_on: Boolean(data.state),
            };
        } else if (eventPayload.kind === "lights.state") {
            controllerKey = "lights";
            itemPatch = {
                state: Boolean(data.state),
                relay_on: Boolean(data.state),
            };
        } else if (eventPayload.kind === "thermo.power") {
            controllerKey = "thermo";
            itemPatch = {
                power_on: Boolean(data.power_on),
            };
        }
        if (!controllerKey || !itemPatch) return null;

        const id = Number(data.id);
        const prevList = Array.isArray(prevControllers?.[controllerKey])
            ? prevControllers[controllerKey]
            : null;
        if (!prevList || !prevList.length || !Number.isFinite(id)) return null;

        let patched = false;
        const nextList = prevList.map((item) => {
            if (Number(item?.id) !== id) return item;
            patched = true;
            return {
                ...item,
                ...(data.name ? { name: data.name } : {}),
                ...itemPatch,
            };
        });
        if (!patched) return null;

        return {
            [controllerKey]: nextList,
        };
    }

    mergeControllers_(prevControllers, patchControllers) {
        const prev =
            prevControllers && typeof prevControllers === "object"
                ? prevControllers
                : null;
        const patch =
            patchControllers && typeof patchControllers === "object"
                ? patchControllers
                : null;
        if (!patch) return prev || null;
        const merged = { ...(prev || {}), ...patch };
        for (const [key, patchValue] of Object.entries(patch)) {
            const prevValue = prev?.[key];
            if (Array.isArray(prevValue) && Array.isArray(patchValue)) {
                merged[key] = this.mergeControllerArray_(prevValue, patchValue);
                continue;
            }
            if (
                prevValue &&
                typeof prevValue === "object" &&
                !Array.isArray(prevValue) &&
                patchValue &&
                typeof patchValue === "object" &&
                !Array.isArray(patchValue)
            ) {
                merged[key] = { ...prevValue, ...patchValue };
            }
        }
        return merged;
    }

    mergeControllerArray_(prevList, patchList) {
        const prev = Array.isArray(prevList) ? prevList : [];
        const patch = Array.isArray(patchList) ? patchList : [];
        if (!prev.length || !patch.length) return patch;
        const merged = [...prev];
        const indexById = new Map();
        for (let i = 0; i < prev.length; i += 1) {
            const id = Number(prev[i]?.id);
            if (Number.isFinite(id)) indexById.set(id, i);
        }
        let mergedAny = false;
        for (const item of patch) {
            const id = Number(item?.id);
            if (!Number.isFinite(id) || !indexById.has(id)) {
                return patch;
            }
            const idx = indexById.get(id);
            merged[idx] = {
                ...prev[idx],
                ...item,
            };
            mergedAny = true;
        }
        return mergedAny ? merged : patch;
    }

    async buildSummary(deviceId, devicesDb) {
        const normalizedId = this.normalizeDeviceId(deviceId);
        const session = this.sessions.get(normalizedId);
        if (!session) return null;
        const dbRow = await devicesDb.getByDeviceId(normalizedId);
        if (!dbRow) return null;
        return {
            device_id: dbRow.device_id,
            name: dbRow.name,
            api_key: dbRow.api_key,
            object_name: dbRow.object_name,
            last_seen_ms: session.lastSeenMs || dbRow.last_seen_ms || 0,
            online: this.isOnline(normalizedId),
            hello: session.hello || null,
            system: session.state?.system || null,
            controllers: session.state?.controllers || null,
            stack: session.state?.stack || null,
            stack_units: session.state?.stack_units || null,
            authz:
                session.state?.authz ||
                session.state?.acl ||
                session.state?.system?.authz ||
                session.state?.system?.acl ||
                null,
            last_event: session.state?.last_event || null,
        };
    }

    async listOnlineSummaries(devicesDb) {
        const result = [];
        for (const [deviceId] of this.sessions) {
            if (!this.isOnline(deviceId)) continue;
            const summary = await this.buildSummary(deviceId, devicesDb);
            if (summary) result.push(summary);
        }
        return result;
    }

    async listOnlineDevices(objectName, devicesDb) {
        const rows = await devicesDb.listDevicesByObject(objectName);
        return rows
            .filter((row) => this.isOnline(row.device_id))
            .map((row) => {
                const session = this.sessions.get(
                    this.normalizeDeviceId(row.device_id),
                );
                return {
                    device_id: row.device_id,
                    name: row.name,
                    api_key: row.api_key,
                    object_name: row.object_name,
                    last_seen_ms: row.last_seen_ms || 0,
                    online: this.isOnline(row.device_id),
                    stack:
                        session?.state?.stack || session?.hello?.stack || null,
                };
            });
    }

    async listAllWithStatus(devicesDb) {
        const rows = await devicesDb.listAllDevices();
        return rows.map((row) => ({
            device_id: row.device_id,
            name: row.name,
            api_key: row.api_key,
            object_name: row.object_name,
            last_seen_ms: row.last_seen_ms || 0,
            online: this.isOnline(row.device_id),
        }));
    }

    expireStale(onOffline) {
        const now = Date.now();
        for (const [deviceId, session] of this.sessions) {
            if (now - session.lastSeenMs > this.onlineTtlMs) {
                this.socketToDevice.delete(session.ws);
                this.sessions.delete(deviceId);
                try {
                    session.ws?.close();
                } catch (err) {
                    // ignore socket close errors during stale cleanup
                }
                if (onOffline) onOffline(deviceId);
            }
        }
    }

    disconnect(deviceId) {
        const normalizedId = this.normalizeDeviceId(deviceId);
        const session = this.sessions.get(normalizedId);
        if (!session) return false;
        this.socketToDevice.delete(session.ws);
        session.ws.close();
        this.sessions.delete(normalizedId);
        return true;
    }

    listSessions() {
        return [...this.sessions.values()];
    }
}
