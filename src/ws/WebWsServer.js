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
import { rootLogger } from "../utils/Logger.js";
import {
    canAccessDevice,
    canSendControllerCommand,
    sanitizeSummaryForSession,
} from "../auth/AccessControl.js";

const logger = rootLogger.child("WEB_WS");

export class WebWsServer {
    constructor({ wss, sessions, devicesDb, registry }) {
        this.wss = wss;
        this.sessions = sessions;
        this.devicesDb = devicesDb;
        this.registry = registry;
        this.clients = new Set();
        this.deviceWs = null;
        this.pendingGets = new Map();
        this.pendingCmds = new Map();
        this.lastDirtySignatureByDevice = new Map();
    }

    setDeviceWs(deviceWs) {
        this.deviceWs = deviceWs;
        if (this.deviceWs?.setResultHandler) {
            this.deviceWs.setResultHandler((result) =>
                this.handleDeviceResult(result),
            );
        }
    }

    init() {
        this.wss.on("connection", (ws, req) => {
            const cookies = (req.headers.cookie || "")
                .split(";")
                .map((v) => v.trim());
            const sessionCookie = cookies.find((c) => c.startsWith("session="));
            const token = sessionCookie ? sessionCookie.split("=")[1] : null;
            const session = token ? this.sessions.get(token) : null;
            if (!session) {
                logger.warn("web auth failed");
                ws.close(4401, "auth_failed");
                return;
            }
            logger.info(
                `web connected: user: ${this.describeSessionUser(session)}`,
            );
            ws.session = session;
            ws.sessionToken = token;
            ws.subscriptions = new Set();
            this.clients.add(ws);

            ws.on("error", (err) => {
                logger.warn(
                    `web socket error: user: ${this.describeSessionUser(ws.session)} error: ${err?.message || "unknown_error"}`,
                );
            });

            ws.on("message", async (data) => {
                let msg;
                try {
                    msg = JSON.parse(data.toString());
                } catch (err) {
                    logger.warn(
                        `web invalid json: user: ${this.describeSessionUser(ws.session)}`,
                    );
                    return;
                }
                if (msg.type === "list_devices") {
                    this.logUserAction(
                        ws,
                        "list_devices",
                        `object: ${String(msg.object_name || "").trim() || "-"}`,
                    );
                    const devices = await this.registry.listOnlineDevices(
                        msg.object_name || "",
                        this.devicesDb,
                    );
                    const visibleDevices = [];
                    for (const device of devices) {
                        const summary = await this.registry.buildSummary(
                            device.device_id,
                            this.devicesDb,
                        );
                        if (!summary || !canAccessDevice(summary, ws.session))
                            continue;
                        visibleDevices.push(device);
                    }
                    this.send(ws, {
                        type: "devices_update",
                        object_name: msg.object_name,
                        devices: visibleDevices.map((d) => ({
                            device_id: d.device_id,
                            name: d.name,
                            object_name: d.object_name,
                            online: Boolean(d.online),
                            stack: d.stack || null,
                        })),
                    });
                    return;
                }
                if (msg.type === "subscribe_device") {
                    const deviceId = Number(msg.device_id);
                    this.logUserAction(
                        ws,
                        "subscribe_device",
                        `device_id: ${deviceId}`,
                    );
                    const summary = await this.registry.buildSummary(
                        deviceId,
                        this.devicesDb,
                    );
                    const sanitized = sanitizeSummaryForSession(
                        summary,
                        ws.session,
                    );
                    if (!sanitized) {
                        this.send(ws, {
                            type: "command_error",
                            error: "forbidden",
                            device_id: deviceId,
                        });
                        return;
                    }
                    ws.subscriptions.add(deviceId);
                    this.send(ws, { type: "device_update", device: sanitized });
                    return;
                }
                if (msg.type === "unsubscribe_device") {
                    this.logUserAction(
                        ws,
                        "unsubscribe_device",
                        `device_id: ${Number(msg.device_id)}`,
                    );
                    ws.subscriptions.delete(Number(msg.device_id));
                    return;
                }
                if (msg.type === "send_get") {
                    this.logUserAction(
                        ws,
                        "send_get",
                        [
                            `device_id: ${Number(msg.device_id)}`,
                            `unit: ${msg.unit || "local"}`,
                            `node_id: ${msg.node_id ?? "-"}`,
                            `what: ${Array.isArray(msg.what) ? msg.what.join(",") : "-"}`,
                        ].join(" "),
                    );
                    const summary = await this.registry.buildSummary(
                        Number(msg.device_id),
                        this.devicesDb,
                    );
                    if (!sanitizeSummaryForSession(summary, ws.session)) {
                        this.send(ws, {
                            type: "command_error",
                            error: "forbidden",
                            device_id: msg.device_id,
                        });
                        return;
                    }
                    const result = this.deviceWs?.sendGet(
                        Number(msg.device_id),
                        Array.isArray(msg.what) ? msg.what : [],
                        msg.unit || "local",
                        msg.node_id,
                    );
                    if (!result || !result.ok) {
                        this.send(ws, {
                            type: "command_error",
                            error: result?.error || "device_offline",
                            device_id: msg.device_id,
                        });
                        return;
                    }
                    this.pendingGets.set(String(result.id), {
                        ws,
                        session: ws.session,
                        device_id: Number(msg.device_id),
                        unit: msg.unit || "local",
                        node_id:
                            (msg.unit || "local") === "stack" && msg.node_id
                                ? Number(msg.node_id)
                                : null,
                    });
                    this.send(ws, {
                        type: "command_sent",
                        id: result.id,
                        device_id: msg.device_id,
                        kind: "get",
                    });
                    return;
                }
                if (msg.type === "send_cmd") {
                    this.logUserAction(
                        ws,
                        "send_cmd",
                        [
                            `device_id: ${Number(msg.device_id)}`,
                            `unit: ${msg.unit || "local"}`,
                            `node_id: ${msg.node_id ?? "-"}`,
                            `controller: ${msg.controller || "-"}`,
                            `action: ${msg.action || "-"}`,
                            `args: ${this.safeJson(msg.args || {})}`,
                        ].join(" "),
                    );
                    const summary = await this.registry.buildSummary(
                        Number(msg.device_id),
                        this.devicesDb,
                    );
                    if (
                        !summary ||
                        !canSendControllerCommand(
                            summary,
                            ws.session,
                            msg.controller,
                            msg.action,
                            msg.args || {},
                        )
                    ) {
                        this.send(ws, {
                            type: "command_error",
                            error: "forbidden",
                            device_id: msg.device_id,
                        });
                        return;
                    }
                    const actor = {
                        uid: ws.session?.uid || ws.session?.username || "",
                        username: ws.session?.username || "",
                        plc_username: ws.session?.plc_username || "",
                        source: "web",
                        session_id: ws.sessionToken || "",
                    };
                    const result = this.deviceWs?.sendCmd(
                        Number(msg.device_id),
                        msg.controller,
                        msg.action,
                        msg.args || {},
                        actor,
                        msg.unit || "local",
                        msg.node_id,
                    );
                    if (!result || !result.ok) {
                        this.send(ws, {
                            type: "command_error",
                            error: result?.error || "device_offline",
                            device_id: msg.device_id,
                        });
                        return;
                    }
                    this.pendingCmds.set(String(result.id), {
                        ws,
                        session: ws.session,
                        device_id: Number(msg.device_id),
                        controller: String(msg.controller || "").trim(),
                        action: String(msg.action || "").trim(),
                        unit: msg.unit || "local",
                        node_id:
                            (msg.unit || "local") === "stack" && msg.node_id
                                ? Number(msg.node_id)
                                : null,
                    });
                    this.send(ws, {
                        type: "command_sent",
                        id: result.id,
                        device_id: msg.device_id,
                        kind: "cmd",
                    });
                    return;
                }
            });

            ws.on("close", () => {
                logger.info(
                    `web disconnected: user: ${this.describeSessionUser(ws.session)}`,
                );
                this.clients.delete(ws);
                for (const [key, pending] of this.pendingGets.entries()) {
                    if (pending?.ws === ws) this.pendingGets.delete(key);
                }
                for (const [key, pending] of this.pendingCmds.entries()) {
                    if (pending?.ws === ws) this.pendingCmds.delete(key);
                }
            });
        });
    }

    async handleDeviceResult(result = {}) {
        const key = String(result.reply_to || "");
        if (!key) return;
        const pendingGet = this.pendingGets.get(key);
        if (pendingGet) {
            this.pendingGets.delete(key);
            if (!pendingGet.ws || pendingGet.ws.readyState !== 1) return;
            if (result.message_type === "error" || result.ok === false) {
                this.send(pendingGet.ws, {
                    type: "command_error",
                    error: result.error || "request_failed",
                    device_id: Number(pendingGet.device_id),
                });
                return;
            }
            const data =
                result.data && typeof result.data === "object"
                    ? result.data
                    : {};
            this.send(pendingGet.ws, {
                type: "get_result",
                device_id: Number(pendingGet.device_id),
                unit: pendingGet.unit || "local",
                node_id: pendingGet.node_id || undefined,
                data,
            });
            return;
        }

        const pendingCmd = this.pendingCmds.get(key);
        if (!pendingCmd) return;
        this.pendingCmds.delete(key);
        if (!pendingCmd.ws || pendingCmd.ws.readyState !== 1) return;
        if (result.message_type === "error" || result.ok === false) {
            this.send(pendingCmd.ws, {
                type: "command_error",
                error: result.error || "command_failed",
                device_id: Number(pendingCmd.device_id),
            });
            return;
        }
        this.send(pendingCmd.ws, {
            type: "command_ack",
            id: key,
            device_id: Number(pendingCmd.device_id),
            controller: pendingCmd.controller || undefined,
            action: pendingCmd.action || undefined,
            unit: pendingCmd.unit || "local",
            node_id: pendingCmd.node_id || undefined,
        });
    }

    describeSessionUser(session) {
        if (!session) return "-";
        const username = String(session.username || "").trim() || "-";
        const plcUsername = String(session.plc_username || "").trim() || "-";
        return `${username} plc: ${plcUsername}`;
    }

    logUserAction(ws, action, details = "") {
        logger.info(
            `web action: user: ${this.describeSessionUser(ws?.session)} action: ${action}${details ? ` ${details}` : ""}`,
        );
    }

    safeJson(value) {
        try {
            return JSON.stringify(value);
        } catch (err) {
            return "\"<unserializable>\"";
        }
    }

    send(ws, payload) {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify(payload));
        }
    }

    broadcast(payload) {
        const message = JSON.stringify(payload);
        for (const client of this.clients) {
            if (client.readyState === 1) {
                client.send(message);
            }
        }
    }

    broadcastDeviceUpdate(summary) {
        for (const client of this.clients) {
            if (client.readyState !== 1) continue;
            if (
                client.subscriptions &&
                client.subscriptions.has(summary.device_id)
            ) {
                const sanitized = sanitizeSummaryForSession(
                    summary,
                    client.session,
                );
                if (!sanitized) continue;
                client.send(
                    JSON.stringify({
                        type: "device_update",
                        device: sanitized,
                    }),
                );
            }
        }
        const lastEvent = summary?.last_event;
        const dirtySignature = this.getDevicesDirtySignature_(
            summary?.device_id,
            lastEvent,
        );
        if (dirtySignature) {
            this.broadcast({
                type: "devices_dirty",
                object_name: summary?.object_name || "",
                device_id: summary?.device_id,
            });
        }
    }

    clearDeviceTransientState(deviceId) {
        const key = String(Number(deviceId));
        this.lastDirtySignatureByDevice.delete(key);
    }

    getDevicesDirtySignature_(deviceId, eventPayload) {
        if (String(eventPayload?.kind || "") !== "stack.node") return "";
        const key = String(Number(deviceId));
        let signature = "";
        try {
            signature = JSON.stringify(eventPayload || {});
        } catch (err) {
            signature = String(eventPayload?.reason || "");
        }
        if (!signature) return "";
        if (this.lastDirtySignatureByDevice.get(key) === signature) {
            return "";
        }
        this.lastDirtySignatureByDevice.set(key, signature);
        return signature;
    }
}
