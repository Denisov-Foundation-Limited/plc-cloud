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
import crypto from "node:crypto";
import { rootLogger } from "../utils/Logger.js";

const logger = rootLogger.child("DEVICE_WS");

export class DeviceWsServer {
    constructor({
        wss,
        proto,
        devicesDb,
        registry,
        onDeviceOnline,
        onDeviceOffline,
        onDeviceUpdate,
    }) {
        this.wss = wss;
        this.proto = proto;
        this.devicesDb = devicesDb;
        this.registry = registry;
        this.onDeviceOnline = onDeviceOnline;
        this.onDeviceOffline = onDeviceOffline;
        this.onDeviceUpdate = onDeviceUpdate;
        this.pendingScopes = new Map();
        this.resultHandler = null;
    }

    init() {
        this.wss.on("connection", (ws) => {
            logger.info("device connected");
            ws.helloTimeout = setTimeout(() => {
                const deviceId = this.registry.getDeviceIdBySocket(ws);
                if (!deviceId) {
                    try {
                        ws.close();
                    } catch (err) {
                        // ignore socket close errors on hello timeout
                    }
                }
            }, 10_000);

            ws.on("error", (err) => {
                const deviceId = this.registry.getDeviceIdBySocket(ws) || "-";
                logger.warn(
                    `device socket error: device_id: ${deviceId} error: ${err?.message || "unknown_error"}`,
                );
            });

            ws.on("pong", () => {
                const deviceId = this.registry.getDeviceIdBySocket(ws);
                if (!deviceId) return;
                this.registry.markSeen(deviceId);
            });

            ws.on("message", async (data) => {
                let msg;
                try {
                    msg = JSON.parse(data.toString());
                } catch (err) {
                    logger.warn("device invalid json");
                    this.send(ws, {
                        v: this.proto.version,
                        type: "error",
                        id: crypto.randomUUID(),
                        payload: {
                            code: "invalid_json",
                            message: "JSON parse failed",
                        },
                    });
                    return;
                }
                try {
                    await this.handleMessage(ws, msg);
                } catch (err) {
                    const details = {
                        type: msg?.type || "-",
                        id: msg?.id || "-",
                        reply_to: msg?.reply_to || "-",
                        session_id: msg?.session_id || "-",
                        device_id: this.registry.getDeviceIdBySocket(ws) || "-",
                    };
                    logger.error(
                        `handle message failed: type=${details.type} id=${details.id} reply_to=${details.reply_to} session=${details.session_id} device=${details.device_id} error=${err?.message || "unknown_error"}`,
                    );
                    if (err?.stack) {
                        logger.error(err.stack);
                    }
                    this.send(ws, {
                        v: this.proto.version,
                        type: "error",
                        id: crypto.randomUUID(),
                        payload: {
                            code: "server_error",
                            message: "Server error",
                        },
                    });
                }
            });

            ws.on("close", () => {
                logger.info("device disconnected");
                if (ws.helloTimeout) {
                    clearTimeout(ws.helloTimeout);
                    ws.helloTimeout = null;
                }
                const deviceId = this.registry.detachBySocket(ws);
                if (deviceId && this.onDeviceOffline) {
                    this.onDeviceOffline(deviceId);
                }
            });
        });
    }

    send(ws, msg) {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify(msg));
            return true;
        }
        return false;
    }

    setResultHandler(handler) {
        this.resultHandler = typeof handler === "function" ? handler : null;
    }

    validateEnvelope(message) {
        if (!message || typeof message !== "object") return "invalid_json";
        if (message.v !== this.proto.version) return "invalid_version";
        if (typeof message.type !== "string") return "invalid_type";
        if (!message.id) return "missing_id";
        return null;
    }

    async handleHello(ws, message) {
        const apiKey = message.auth?.api_key;
        if (!apiKey) {
            logger.warn("device auth missing api_key");
            this.send(ws, {
                v: this.proto.version,
                type: "error",
                id: crypto.randomUUID(),
                reply_to: message.id,
                payload: { code: "auth_missing", message: "api_key required" },
            });
            ws.close();
            return;
        }
        const deviceRow = await this.devicesDb.getByApiKey(apiKey);
        if (!deviceRow) {
            logger.warn("device auth invalid api_key");
            this.send(ws, {
                v: this.proto.version,
                type: "error",
                id: crypto.randomUUID(),
                reply_to: message.id,
                payload: { code: "auth_invalid", message: "api_key invalid" },
            });
            ws.close();
            return;
        }

        const deviceId = Number(
            message.payload?.device_id ?? deviceRow.device_id,
        );
        const sessionId = crypto.randomUUID();
        const now = Date.now();

        await this.devicesDb.upsertByApiKey({
            deviceId,
            name: message.payload?.device_name || deviceRow.name,
            apiKey,
            lastSeenMs: now,
        });

        this.registry.attach(ws, {
            deviceId,
            sessionId,
            apiKey,
            hello: message.payload || null,
        });
        if (ws.helloTimeout) {
            clearTimeout(ws.helloTimeout);
            ws.helloTimeout = null;
        }

        this.send(ws, {
            v: this.proto.version,
            type: "hello_ack",
            id: crypto.randomUUID(),
            reply_to: message.id,
            session_id: sessionId,
            payload: {
                session_id: sessionId,
                server_time_ms: now,
                request_initial: ["system", "controllers", "stack", "authz"],
            },
        });

        if (this.onDeviceOnline) {
            this.onDeviceOnline(deviceId);
        }
    }

    async handleMessage(ws, message) {
        const error = this.validateEnvelope(message);
        if (error) {
            this.send(ws, {
                v: this.proto.version,
                type: "error",
                id: crypto.randomUUID(),
                reply_to: message.id || undefined,
                payload: { code: error, message: "Invalid envelope" },
            });
            return;
        }

        if (message.type === "hello") {
            await this.handleHello(ws, message);
            return;
        }

        const deviceId = this.registry.getDeviceIdBySocket(ws);
        if (!deviceId) {
            this.send(ws, {
                v: this.proto.version,
                type: "error",
                id: crypto.randomUUID(),
                reply_to: message.id,
                payload: { code: "session_missing", message: "hello required" },
            });
            ws.close();
            return;
        }

        const session = this.registry.getSession(deviceId);
        if (!message.session_id || message.session_id !== session?.sessionId) {
            this.send(ws, {
                v: this.proto.version,
                type: "error",
                id: crypto.randomUUID(),
                reply_to: message.id,
                payload: {
                    code: "session_invalid",
                    message: "session_id invalid",
                },
            });
            ws.close();
            return;
        }

        this.registry.markSeen(deviceId);
        try {
            await this.devicesDb.updateLastSeen(deviceId, Date.now());
        } catch (err) {
            if (err?.message === "device_not_found") {
                logger.warn(
                    `device session invalid: type=${message.type} session=${message.session_id || "-"} device=${deviceId} reason=device_not_found`,
                );
                if (message.type !== "pong") {
                    this.send(ws, {
                        v: this.proto.version,
                        type: "error",
                        id: crypto.randomUUID(),
                        reply_to: message.id || undefined,
                        payload: {
                            code: "device_not_found",
                            message: "Device removed",
                        },
                    });
                }
                ws.close();
                return;
            }
            throw err;
        }

        if (message.type === "ping") {
            this.send(ws, {
                v: this.proto.version,
                type: "pong",
                id: crypto.randomUUID(),
                reply_to: message.id,
                session_id: session.sessionId,
                payload: { nonce: message.payload?.nonce || "" },
            });
            return;
        }

        if (message.type === "result" || message.type === "ack") {
            const data = message.payload?.data;
            const replyKey = message.reply_to || null;
            const pendingScope = replyKey
                ? this.pendingScopes.get(String(replyKey))
                : null;
            const scopeUnit = message.unit || pendingScope?.unit;
            const scopeNodeId = message.node_id ?? pendingScope?.node_id;
            if (scopeUnit === "stack" && scopeNodeId && data && typeof data === "object") {
            }
            if (data && typeof data === "object") {
                try {
                    this.registry.registerState(
                        deviceId,
                        { ...data },
                        {
                            unit: scopeUnit,
                            node_id: scopeNodeId,
                        },
                    );
                } catch (err) {
                    logger.error(
                        `registerState failed: type=${message.type} reply_to=${message.reply_to || "-"} unit=${scopeUnit || "-"} node_id=${scopeNodeId ?? "-"} error=${err?.message || "unknown_error"}`,
                    );
                    throw err;
                }
            }
            if (this.resultHandler && replyKey) {
                try {
                    this.resultHandler({
                        message_type: message.type,
                        reply_to: String(replyKey),
                        device_id: Number(deviceId),
                        unit: scopeUnit || "local",
                        node_id:
                            scopeUnit === "stack" && scopeNodeId
                                ? Number(scopeNodeId)
                                : null,
                        data:
                            data && typeof data === "object"
                                ? { ...data }
                                : null,
                        ok:
                            message.type === "ack"
                                ? Boolean(message.payload?.ok)
                                : true,
                        error:
                            message.type === "ack" && message.payload?.ok === false
                                ? String(message.payload?.error || "failed")
                                : "",
                    });
                } catch (err) {
                    logger.error(
                        `resultHandler failed: reply_to=${replyKey} device=${deviceId} error=${err?.message || "unknown_error"}`,
                    );
                }
            }
            if (message.reply_to) {
                this.pendingScopes.delete(String(message.reply_to));
            }
        }

        if (message.type === "error") {
            const replyKey = message.reply_to || null;
            if (this.resultHandler && replyKey) {
                try {
                    this.resultHandler({
                        message_type: "error",
                        reply_to: String(replyKey),
                        device_id: Number(deviceId),
                        unit: "local",
                        node_id: null,
                        data: null,
                        ok: false,
                        error: String(
                            message.payload?.message ||
                                message.payload?.code ||
                                "device_error",
                        ),
                    });
                } catch (err) {
                    logger.error(
                        `resultHandler failed: reply_to=${replyKey} device=${deviceId} error=${err?.message || "unknown_error"}`,
                    );
                }
            }
        }

        if (message.type === "event") {
            const scopeUnit = message.unit || null;
            const scopeNodeId =
                message.node_id !== undefined && message.node_id !== null
                    ? Number(message.node_id)
                    : null;
            const eventPayload =
                message.payload && typeof message.payload === "object"
                    ? {
                          ...message.payload,
                          ...(scopeUnit ? { unit: scopeUnit } : {}),
                          ...(scopeNodeId ? { node_id: scopeNodeId } : {}),
                      }
                    : null;
            const eventData = eventPayload?.data;
            const patch = { last_event: eventPayload };
            if (
                (!scopeUnit || scopeUnit === "local") &&
                eventData &&
                typeof eventData === "object"
            ) {
                Object.assign(patch, eventData);
            } else if (
                scopeUnit === "stack" &&
                scopeNodeId &&
                eventData &&
                typeof eventData === "object"
            ) {
                if (eventData.system && typeof eventData.system === "object") {
                    patch.system = eventData.system;
                }
                if (
                    eventData.summary &&
                    typeof eventData.summary === "object"
                ) {
                    patch.summary = eventData.summary;
                }
                if (
                    eventData.controllers &&
                    typeof eventData.controllers === "object"
                ) {
                    patch.controllers = eventData.controllers;
                }
                if (
                    Object.prototype.hasOwnProperty.call(
                        eventData,
                        "device_name",
                    )
                ) {
                    patch.name = eventData.device_name;
                } else if (
                    Object.prototype.hasOwnProperty.call(eventData, "name")
                ) {
                    patch.name = eventData.name;
                }
                if (
                    Object.prototype.hasOwnProperty.call(eventData, "online")
                ) {
                    patch.online = Boolean(eventData.online);
                }
            }
            try {
                if (scopeUnit && scopeUnit === "stack" && scopeNodeId) {
                    this.registry.registerState(deviceId, patch, {
                        unit: scopeUnit,
                        node_id: scopeNodeId,
                    });
                    this.registry.registerState(deviceId, patch);
                } else {
                    this.registry.registerState(deviceId, patch);
                }
            } catch (err) {
                logger.error(
                    `registerState failed: type=event kind=${message.payload?.kind || "-"} reason=${message.payload?.reason || "-"} unit=${scopeUnit || "-"} node_id=${scopeNodeId ?? "-"} error=${err?.message || "unknown_error"}`,
                );
                throw err;
            }
        }

        if (message.type === "pong") {
            return;
        }

        let summary = null;
        try {
            summary = await this.registry.buildSummary(
                deviceId,
                this.devicesDb,
            );
        } catch (err) {
            logger.error(
                `buildSummary failed: device=${deviceId} type=${message.type} error=${err?.message || "unknown_error"}`,
            );
            throw err;
        }
        if (summary && this.onDeviceUpdate) {
            try {
                this.onDeviceUpdate(summary);
            } catch (err) {
                logger.error(
                    `onDeviceUpdate failed: device=${deviceId} type=${message.type} error=${err?.message || "unknown_error"}`,
                );
                throw err;
            }
        }
    }

    pingAll() {
        for (const session of this.registry.listSessions()) {
            try {
                session.ws?.ping();
            } catch (err) {
                // ignore low-level ping transport errors
            }
            this.send(session.ws, {
                v: this.proto.version,
                type: "ping",
                id: crypto.randomUUID(),
                session_id: session.sessionId,
                payload: { nonce: crypto.randomUUID() },
            });
        }
    }

    sendGet(deviceId, what, unit = "local", nodeId) {
        const session = this.registry.getSession(deviceId);
        if (!session) return { ok: false, error: "device_offline" };
        const id = crypto.randomUUID();
        const msg = {
            v: this.proto.version,
            type: "get",
            id,
            session_id: session.sessionId,
            unit,
            payload: { what },
        };
        if (unit === "stack" && nodeId) {
            msg.node_id = Number(nodeId);
        }
        if (!this.send(session.ws, msg)) {
            return { ok: false, error: "device_socket_not_ready" };
        }
        this.pendingScopes.set(String(id), {
            deviceId: Number(deviceId),
            unit,
            node_id: unit === "stack" && nodeId ? Number(nodeId) : null,
        });
        return { ok: true, id };
    }

    sendCmd(
        deviceId,
        controller,
        action,
        args = {},
        actor = null,
        unit = "local",
        nodeId,
    ) {
        const session = this.registry.getSession(deviceId);
        if (!session) return { ok: false, error: "device_offline" };
        const id = crypto.randomUUID();
        const msg = {
            v: this.proto.version,
            type: "cmd",
            id,
            session_id: session.sessionId,
            unit,
            payload: {
                controller,
                action,
                args,
                actor: actor || undefined,
            },
        };
        if (unit === "stack" && nodeId) {
            msg.node_id = Number(nodeId);
        }
        if (!this.send(session.ws, msg)) {
            return { ok: false, error: "device_socket_not_ready" };
        }
        this.pendingScopes.set(String(id), {
            deviceId: Number(deviceId),
            unit,
            node_id: unit === "stack" && nodeId ? Number(nodeId) : null,
        });
        return { ok: true, id };
    }
}
