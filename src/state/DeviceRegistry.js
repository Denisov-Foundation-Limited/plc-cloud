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
        this.meteoHistoryMaxPoints = 360;
        this.meteoHistoryMinSampleMs = 60000;
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
            meteoHistory: {
                local: {},
                stack: {},
            },
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
                null,
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
            this.captureMeteoHistory_(session, mergedControllers, {
                unit: "stack",
                nodeId,
            });
            return;
        }
        const normalizedPatch = this.normalizeStatePatch_(
            patch,
            session.state?.controllers,
            scope,
            session.state?.stack || session.hello?.stack || null,
        );
        session.state = {
            ...session.state,
            ...normalizedPatch,
            controllers: this.mergeControllers_(
                session.state?.controllers,
                normalizedPatch.controllers,
            ),
        };
        this.captureMeteoHistory_(session, session.state.controllers, {
            unit: "local",
            nodeId: null,
        });
    }

    getMeteoHistory(deviceId, sensorId, scope = {}) {
        const session = this.sessions.get(this.normalizeDeviceId(deviceId));
        if (!session) return [];
        const normalizedSensorId = Number(sensorId);
        if (!Number.isFinite(normalizedSensorId) || normalizedSensorId <= 0) {
            return [];
        }
        const nodeId = Number(scope?.nodeId);
        if (Number.isFinite(nodeId) && nodeId > 0) {
            const bucket =
                session.meteoHistory?.stack?.[String(nodeId)]?.[
                    String(normalizedSensorId)
                ];
            return Array.isArray(bucket) ? [...bucket] : [];
        }
        const bucket =
            session.meteoHistory?.local?.[String(normalizedSensorId)];
        return Array.isArray(bucket) ? [...bucket] : [];
    }

    normalizeStatePatch_(patch, prevControllers, scope = null, prevStack = null) {
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
        const eventStack = this.buildStackPatchFromEvent_(
            prevStack,
            next.last_event,
            scope,
        );
        if (eventStack) {
            next.stack =
                next.stack && typeof next.stack === "object"
                    ? { ...eventStack, ...next.stack }
                    : eventStack;
        }
        return next;
    }

    buildStackPatchFromEvent_(prevStack, eventPayload, scope = null) {
        if (!eventPayload || typeof eventPayload !== "object") return null;
        if (String(eventPayload.kind || "") !== "stack.node") return null;

        const scopeUnit = scope?.unit === "stack" ? "stack" : "local";
        if (scopeUnit !== "local") return null;

        const nodeId = Number(eventPayload.node_id);
        if (!Number.isFinite(nodeId) || nodeId <= 0) return null;

        const data =
            eventPayload.data && typeof eventPayload.data === "object"
                ? eventPayload.data
                : {};
        const online =
            typeof data.online === "boolean"
                ? Boolean(data.online)
                : String(eventPayload.reason || "") === "online";
        const base =
            prevStack && typeof prevStack === "object" ? prevStack : {};
        const nodes = Array.isArray(base.nodes) ? [...base.nodes] : [];
        const nextNodes = [];
        let replaced = false;

        for (const raw of nodes) {
            const currentId = Number(raw?.node_id);
            if (currentId !== nodeId) {
                nextNodes.push(raw);
                continue;
            }
            replaced = true;
            if (!online) continue;
            nextNodes.push({
                ...raw,
                node_id: nodeId,
                name: String(data.unit_name || raw?.name || "").trim(),
                ip: String(data.ip || raw?.ip || "").trim(),
                fw: Number.isFinite(Number(data.fw))
                    ? Number(data.fw)
                    : Number(raw?.fw || 0),
                online: true,
            });
        }

        if (online && !replaced) {
            nextNodes.push({
                node_id: nodeId,
                name: String(data.unit_name || "").trim(),
                ip: String(data.ip || "").trim(),
                fw: Number.isFinite(Number(data.fw)) ? Number(data.fw) : 0,
                online: true,
            });
        }

        nextNodes.sort(
            (a, b) => Number(a?.node_id || 0) - Number(b?.node_id || 0),
        );
        return {
            ...base,
            nodes: nextNodes,
        };
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
            stack: session.state?.stack || session.hello?.stack || null,
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

    captureMeteoHistory_(session, controllers, scope = {}) {
        const list = Array.isArray(controllers?.meteo) ? controllers.meteo : [];
        if (!list.length) return;
        if (!session.meteoHistory || typeof session.meteoHistory !== "object") {
            session.meteoHistory = { local: {}, stack: {} };
        }
        const unit = scope?.unit === "stack" ? "stack" : "local";
        const nodeId = Number(scope?.nodeId);
        let store = session.meteoHistory.local;
        if (unit === "stack" && Number.isFinite(nodeId) && nodeId > 0) {
            if (!session.meteoHistory.stack[String(nodeId)]) {
                session.meteoHistory.stack[String(nodeId)] = {};
            }
            store = session.meteoHistory.stack[String(nodeId)];
        }

        const now = Date.now();
        for (const sensor of list) {
            const sensorId = Number(sensor?.id);
            if (!Number.isFinite(sensorId) || sensorId <= 0) continue;
            const temp = Number(
                sensor?.temperature_c ?? sensor?.temp_c ?? sensor?.temperature,
            );
            const humidity = Number(
                sensor?.humidity ?? sensor?.humidity_pct ?? sensor?.hum,
            );
            const hasTemp = Number.isFinite(temp);
            const hasHumidity = Number.isFinite(humidity);
            if (!hasTemp && !hasHumidity) continue;

            const key = String(sensorId);
            const series = Array.isArray(store[key]) ? store[key] : [];
            const nextPoint = {
                ts: now,
                ...(hasTemp ? { temp_c: temp } : {}),
                ...(hasHumidity ? { humidity } : {}),
                ok: sensor?.ok !== false,
                enabled: sensor?.enabled !== false,
            };
            const last = series.length ? series[series.length - 1] : null;
            const shouldReplace =
                last &&
                (now - Number(last.ts || 0)) < this.meteoHistoryMinSampleMs;
            if (shouldReplace) {
                series[series.length - 1] = nextPoint;
            } else {
                series.push(nextPoint);
                if (series.length > this.meteoHistoryMaxPoints) {
                    series.splice(0, series.length - this.meteoHistoryMaxPoints);
                }
            }
            store[key] = series;
        }
    }
}
