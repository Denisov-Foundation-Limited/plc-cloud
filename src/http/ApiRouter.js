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
import {
    filterObjectsForSummaries,
    sanitizeSummaryForSession,
    canAccessDevice,
} from "../auth/AccessControl.js";
import { NOTIFICATION_CATALOG } from "../notifications/NotificationCatalog.js";
import { rootLogger } from "../utils/Logger.js";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";

const logger = rootLogger.child("API");

export class ApiRouter {
    constructor({
        app,
        publicDir,
        usersDb,
        devicesDb,
        sessions,
        registry,
        nowMs,
        onDeviceDisconnect,
        telegramBotService,
    }) {
        this.app = app;
        this.publicDir = publicDir;
        this.usersDb = usersDb;
        this.devicesDb = devicesDb;
        this.sessions = sessions;
        this.registry = registry;
        this.nowMs = nowMs;
        this.onDeviceDisconnect = onDeviceDisconnect;
        this.telegramBotService = telegramBotService;
    }

    init() {
        this.app.post(
            "/api/device/photo",
            express.raw({
                type: ["image/jpeg", "application/octet-stream"],
                limit: "4mb",
            }),
            this.requireDeviceApiKey(),
            async (req, res) => {
                const body = req.body;
                if (!Buffer.isBuffer(body) || body.length === 0) {
                    res.status(400).json({ ok: false, error: "photo_required" });
                    return;
                }
                const contentType = String(req.get("content-type") || "").toLowerCase();
                if (!contentType.includes("image/jpeg") && !contentType.includes("application/octet-stream")) {
                    res.status(415).json({ ok: false, error: "jpeg_required" });
                    return;
                }
                if (body.length > 4 * 1024 * 1024) {
                    res.status(413).json({ ok: false, error: "photo_too_large" });
                    return;
                }

                const row = req.deviceRow;
                const deviceId = Number(row?.device_id || 0);
                const cameraIdRaw = Number(req.query?.camera_id || 0);
                const cameraId = Number.isInteger(cameraIdRaw) && cameraIdRaw > 0 ? cameraIdRaw : 0;
                const now = Date.now();
                const relDir = cameraId > 0
                    ? path.posix.join("uploads", "devices", String(deviceId), `camera_${cameraId}`)
                    : path.posix.join("uploads", "devices", String(deviceId));
                const fsDir = cameraId > 0
                    ? path.join(this.publicDir, "uploads", "devices", String(deviceId), `camera_${cameraId}`)
                    : path.join(this.publicDir, "uploads", "devices", String(deviceId));
                const fileName = `${now}.jpg`;
                const latestName = "latest.jpg";
                const fsPath = path.join(fsDir, fileName);
                const latestFsPath = path.join(fsDir, latestName);
                const relUrl = `/${path.posix.join(relDir, fileName)}`;
                const latestUrl = `/${path.posix.join(relDir, latestName)}`;
                try {
                    await fs.mkdir(fsDir, { recursive: true });
                    await fs.writeFile(fsPath, body);
                    await fs.writeFile(latestFsPath, body);
                    logger.info(
                        `device photo uploaded: device_id: ${deviceId} camera_id: ${cameraId || 0} bytes: ${body.length} path: ${relUrl} latest: ${latestUrl}`,
                    );
                    res.json({
                        ok: true,
                        device_id: deviceId,
                        camera_id: cameraId || undefined,
                        size: body.length,
                        url: relUrl,
                        latest_url: latestUrl,
                    });
                } catch (err) {
                    logger.error(
                        `device photo save failed: device_id: ${deviceId} camera_id: ${cameraId || 0} error: ${err?.message || "unknown_error"}`,
                    );
                    res.status(500).json({ ok: false, error: "photo_save_failed" });
                }
            },
        );

        this.app.post("/api/login", async (req, res) => {
            const { username, password } = req.body || {};
            const ok = await this.usersDb.validateCredentials(
                username,
                password,
            );
            if (!ok) {
                logger.warn(
                    `api action: user: ${String(username || "").trim() || "-"} action: login_failed`,
                );
                res.status(401).json({
                    ok: false,
                    error: "invalid_credentials",
                });
                return;
            }
            const user = await this.usersDb.findByUsername(username);
            const token = await this.sessions.create(user || username);
            logger.info(
                `api action: user: ${this.describeSessionUser(user || username)} action: login_success`,
            );
            res.cookie("session", token, {
                httpOnly: true,
                sameSite: "lax",
                maxAge: this.sessions.sessionTtlMs,
            });
            res.json({ ok: true });
        });

        this.app.post("/api/logout", this.requireAuth(), async (req, res) => {
            const token = req.cookies?.session;
            if (token) await this.sessions.delete(token);
            this.logSessionAction(req, "logout");
            res.clearCookie("session");
            res.json({ ok: true });
        });

        this.app.get("/api/session", this.requireAuth(), (req, res) => {
            this.logSessionAction(req, "get_session");
            res.json({
                ok: true,
                session: {
                    username: String(req.session?.username || "").trim(),
                    plc_username: String(
                        req.session?.plc_username || "",
                    ).trim(),
                    telegram_username: String(
                        req.session?.telegram_username || "",
                    ).trim(),
                    allowed_objects: Array.isArray(req.session?.allowed_objects)
                        ? req.session.allowed_objects
                        : [],
                    notification_prefs: Array.isArray(
                        req.session?.notification_prefs,
                    )
                        ? req.session.notification_prefs
                        : [],
                },
            });
        });

        this.app.get("/api/objects", this.requireAuth(), async (req, res) => {
            this.logSessionAction(req, "list_objects");
            const objects = await this.devicesDb.listObjects();
            const summaries = await this.registry.listOnlineSummaries(
                this.devicesDb,
            );
            const filtered = filterObjectsForSummaries(
                objects,
                summaries,
                req.session,
            );
            res.json({ ok: true, objects: filtered });
        });

        this.app.get("/api/devices", this.requireAuth(), async (req, res) => {
            const objectName = req.query.object;
            if (!objectName) {
                res.status(400).json({ ok: false, error: "object_required" });
                return;
            }
            this.logSessionAction(
                req,
                "list_devices",
                `object: ${String(objectName).trim() || "-"}`,
            );
            const devices = await this.registry.listOnlineDevices(
                objectName,
                this.devicesDb,
            );
            const visibleDevices = [];
            for (const device of devices) {
                const summary = await this.registry.buildSummary(
                    device.device_id,
                    this.devicesDb,
                );
                if (!summary || !canAccessDevice(summary, req.session))
                    continue;
                const sanitized = sanitizeSummaryForSession(
                    summary,
                    req.session,
                );
                if (!sanitized)
                    continue;
                visibleDevices.push({
                    ...device,
                    stack: sanitized.stack || device.stack || null,
                });
            }
            res.json({
                ok: true,
                devices: visibleDevices.map((d) => ({
                    device_id: d.device_id,
                    name: d.name,
                    object_name: d.object_name,
                    stack: d.stack || null,
                })),
            });
        });

        this.app.get(
            "/api/device/:id",
            this.requireAuth(),
            async (req, res) => {
                const deviceId = Number(req.params.id);
                this.logSessionAction(req, "get_device", `device_id: ${deviceId}`);
                const summary = await this.registry.buildSummary(
                    deviceId,
                    this.devicesDb,
                );
                if (!summary) {
                    res.status(404).json({
                        ok: false,
                        error: "device_not_found",
                    });
                    return;
                }
                const sanitized = sanitizeSummaryForSession(
                    summary,
                    req.session,
                );
                if (!sanitized) {
                    res.status(403).json({ ok: false, error: "forbidden" });
                    return;
                }
                res.json({ ok: true, device: sanitized });
            },
        );

        this.app.get(
            "/api/admin/devices",
            this.requireAuth(),
            async (req, res) => {
                this.logSessionAction(req, "admin_list_devices");
                const devices = await this.registry.listAllWithStatus(
                    this.devicesDb,
                );
                res.json({ ok: true, devices });
            },
        );

        this.app.get(
            "/api/admin/users",
            this.requireAuth(),
            async (req, res) => {
                this.logSessionAction(req, "admin_list_users");
                const users = await this.usersDb.listUsers();
                const objects = await this.devicesDb.listObjects();
                res.json({
                    ok: true,
                    users,
                    objects,
                    notification_catalog: NOTIFICATION_CATALOG,
                });
            },
        );

        this.app.get(
            "/api/admin/telegram/settings",
            this.requireAuth(),
            async (req, res) => {
                this.logSessionAction(req, "admin_get_telegram_settings");
                const settings =
                    this.telegramBotService?.getSettingsSummary?.() || null;
                res.json({ ok: true, settings });
            },
        );

        this.app.put(
            "/api/admin/telegram/settings",
            this.requireAuth(),
            async (req, res) => {
                try {
                    this.logSessionAction(req, "admin_update_telegram_settings");
                    const settings =
                        await this.telegramBotService.updateSettings({
                            token: req.body?.token,
                            public_base_url: req.body?.public_base_url,
                            webhook_path: req.body?.webhook_path,
                            secret_token: req.body?.secret_token,
                        });
                    res.json({ ok: true, settings });
                } catch (err) {
                    logger.error(
                        `api action: user: ${this.describeSessionUser(req.session)} action: admin_update_telegram_settings_failed error: ${err?.message || "unknown_error"}`,
                    );
                    res.status(500).json({
                        ok: false,
                        error:
                            err?.message || "telegram_settings_update_failed",
                    });
                }
            },
        );

        this.app.post(
            "/api/admin/users",
            this.requireAuth(),
            async (req, res) => {
                const {
                    username,
                    password,
                    plc_username,
                    telegram_username,
                    chat_id,
                    telegram_notify_online,
                    telegram_notify_offline,
                    telegram_notify_events,
                    notification_prefs,
                    allowed_objects,
                } = req.body || {};
                try {
                    const user = await this.usersDb.createUser({
                        username,
                        password,
                        plc_username,
                        telegram_username,
                        chat_id,
                        telegram_notify_online,
                        telegram_notify_offline,
                        telegram_notify_events,
                        notification_prefs,
                        allowed_objects,
                    });
                    this.logSessionAction(
                        req,
                        "admin_create_user",
                        `target: ${String(username || "").trim() || "-"}`,
                    );
                    res.json({ ok: true, user });
                } catch (err) {
                    const error = err?.message || "user_create_failed";
                    const status =
                        error === "username_required" || error === "user_exists"
                            ? 400
                            : 500;
                    res.status(status).json({ ok: false, error });
                }
            },
        );

        this.app.put(
            "/api/admin/users/:username",
            this.requireAuth(),
            async (req, res) => {
                const password = Object.prototype.hasOwnProperty.call(
                    req.body || {},
                    "password",
                )
                    ? req.body.password
                    : undefined;
                const username = Object.prototype.hasOwnProperty.call(
                    req.body || {},
                    "username",
                )
                    ? req.body.username
                    : undefined;
                const plc_username = Object.prototype.hasOwnProperty.call(
                    req.body || {},
                    "plc_username",
                )
                    ? req.body.plc_username
                    : undefined;
                const telegram_username = Object.prototype.hasOwnProperty.call(
                    req.body || {},
                    "telegram_username",
                )
                    ? req.body.telegram_username
                    : undefined;
                const chat_id = Object.prototype.hasOwnProperty.call(
                    req.body || {},
                    "chat_id",
                )
                    ? req.body.chat_id
                    : undefined;
                const telegram_notify_online =
                    Object.prototype.hasOwnProperty.call(
                        req.body || {},
                        "telegram_notify_online",
                    )
                        ? req.body.telegram_notify_online
                        : undefined;
                const telegram_notify_offline =
                    Object.prototype.hasOwnProperty.call(
                        req.body || {},
                        "telegram_notify_offline",
                    )
                        ? req.body.telegram_notify_offline
                        : undefined;
                const telegram_notify_events =
                    Object.prototype.hasOwnProperty.call(
                        req.body || {},
                        "telegram_notify_events",
                    )
                        ? req.body.telegram_notify_events
                        : undefined;
                const notification_prefs =
                    Object.prototype.hasOwnProperty.call(
                        req.body || {},
                        "notification_prefs",
                    )
                        ? req.body.notification_prefs
                        : undefined;
                const allowed_objects = Object.prototype.hasOwnProperty.call(
                    req.body || {},
                    "allowed_objects",
                )
                    ? req.body.allowed_objects
                    : undefined;
                try {
                    const user = await this.usersDb.updateUser(
                        req.params.username,
                        {
                            username,
                            password,
                            plc_username,
                            telegram_username,
                            chat_id,
                            telegram_notify_online,
                            telegram_notify_offline,
                            telegram_notify_events,
                            notification_prefs,
                            allowed_objects,
                        },
                    );
                    await this.sessions.updateUser(user, req.params.username);
                    this.logSessionAction(
                        req,
                        "admin_update_user",
                        [
                            `target: ${String(req.params.username || "").trim() || "-"}`,
                            `next: ${String(username || req.params.username || "").trim() || "-"}`,
                        ].join(" "),
                    );
                    res.json({ ok: true, user });
                } catch (err) {
                    const error = err?.message || "user_update_failed";
                    const status =
                        error === "username_required" ||
                        error === "user_not_found" ||
                        error === "user_exists"
                            ? 400
                            : 500;
                    res.status(status).json({ ok: false, error });
                }
            },
        );

        this.app.delete(
            "/api/admin/users/:username",
            this.requireAuth(),
            async (req, res) => {
                try {
                    await this.usersDb.deleteUser(req.params.username);
                    this.logSessionAction(
                        req,
                        "admin_delete_user",
                        `target: ${String(req.params.username || "").trim() || "-"}`,
                    );
                    res.json({ ok: true });
                } catch (err) {
                    const error = err?.message || "user_delete_failed";
                    const status =
                        error === "username_required" ||
                        error === "user_not_found" ||
                        error === "admin_delete_forbidden"
                            ? 400
                            : 500;
                    res.status(status).json({ ok: false, error });
                }
            },
        );

        this.app.post(
            "/api/admin/objects",
            this.requireAuth(),
            async (req, res) => {
                const { name, icon } = req.body || {};
                try {
                    const objectItem = await this.devicesDb.createObject(
                        name,
                        icon,
                    );
                    this.logSessionAction(
                        req,
                        "admin_create_object",
                        `name=${String(objectItem?.name || "").trim() || "-"}`,
                    );
                    res.json({ ok: true, object: objectItem });
                } catch (err) {
                    const error = err?.message || "object_create_failed";
                    const status =
                        error === "object_exists" ||
                        error === "object_name_required"
                            ? 400
                            : 500;
                    res.status(status).json({ ok: false, error });
                }
            },
        );

        this.app.delete(
            "/api/admin/objects/:name",
            this.requireAuth(),
            async (req, res) => {
                try {
                    await this.devicesDb.deleteObject(req.params.name);
                    this.logSessionAction(
                        req,
                        "admin_delete_object",
                        `name=${String(req.params.name || "").trim() || "-"}`,
                    );
                    res.json({ ok: true });
                } catch (err) {
                    const error = err?.message || "object_delete_failed";
                    const status =
                        error === "object_not_found" ||
                        error === "object_name_required" ||
                        error === "object_has_devices"
                            ? 400
                            : 500;
                    res.status(status).json({ ok: false, error });
                }
            },
        );

        this.app.put(
            "/api/admin/objects/:name",
            this.requireAuth(),
            async (req, res) => {
                const nextName = req.body?.name;
                try {
                    const objectName = await this.devicesDb.renameObject(
                        req.params.name,
                        nextName,
                    );
                    this.logSessionAction(
                        req,
                        "admin_rename_object",
                        [
                            `from: ${String(req.params.name || "").trim() || "-"}`,
                            `to: ${String(objectName || "").trim() || "-"}`,
                        ].join(" "),
                    );
                    res.json({ ok: true, object: objectName });
                } catch (err) {
                    const error = err?.message || "object_rename_failed";
                    const status =
                        error === "object_not_found" ||
                        error === "object_name_required" ||
                        error === "object_exists" ||
                        error === "object_name_same"
                            ? 400
                            : 500;
                    res.status(status).json({ ok: false, error });
                }
            },
        );

        this.app.put(
            "/api/admin/objects/:name/icon",
            this.requireAuth(),
            async (req, res) => {
                const icon = req.body?.icon;
                try {
                    const nextIcon = await this.devicesDb.setObjectIcon(
                        req.params.name,
                        icon,
                    );
                    this.logSessionAction(
                        req,
                        "admin_set_object_icon",
                        [
                            `name=${String(req.params.name || "").trim() || "-"}`,
                            `icon: ${String(nextIcon || "").trim() || "-"}`,
                        ].join(" "),
                    );
                    res.json({ ok: true, icon: nextIcon });
                } catch (err) {
                    const error = err?.message || "object_icon_update_failed";
                    const status =
                        error === "object_not_found" ||
                        error === "object_name_required"
                            ? 400
                            : 500;
                    res.status(status).json({ ok: false, error });
                }
            },
        );

        this.app.post(
            "/api/admin/devices",
            this.requireAuth(),
            async (req, res) => {
                const { device_id, name, api_key, object_name } =
                    req.body || {};
                if (!device_id || !object_name) {
                    res.status(400).json({
                        ok: false,
                        error: "device_id_and_object_required",
                    });
                    return;
                }
                try {
                    const key = await this.devicesDb.createDevice({
                        device_id,
                        name,
                        api_key,
                        object_name,
                    });
                    this.logSessionAction(
                        req,
                        "admin_create_device",
                        [
                            `device_id: ${Number(device_id) || "-"}`,
                            `name=${String(name || "").trim() || "-"}`,
                            `object: ${String(object_name || "").trim() || "-"}`,
                        ].join(" "),
                    );
                    res.json({ ok: true, api_key: key });
                } catch (err) {
                    res.status(400).json({
                        ok: false,
                        error: "device_create_failed",
                    });
                }
            },
        );

        this.app.put(
            "/api/admin/devices/:id",
            this.requireAuth(),
            async (req, res) => {
                const deviceId = Number(req.params.id);
                const row = await this.devicesDb.getByDeviceId(deviceId);
                if (!row) {
                    res.status(404).json({
                        ok: false,
                        error: "device_not_found",
                    });
                    return;
                }
                try {
                    await this.devicesDb.updateDevice({
                        currentDeviceId: row.device_id,
                        device_id: req.body?.device_id,
                        name: req.body?.name ?? row.name,
                        object_name: req.body?.object_name ?? row.object_name,
                    });
                    this.logSessionAction(
                        req,
                        "admin_update_device",
                        [
                            `current_id: ${row.device_id}`,
                            `next_id: ${Number(req.body?.device_id || row.device_id) || row.device_id}`,
                            `name=${String(req.body?.name ?? row.name ?? "").trim() || "-"}`,
                            `object: ${String(req.body?.object_name ?? row.object_name ?? "").trim() || "-"}`,
                        ].join(" "),
                    );
                } catch (err) {
                    res.status(400).json({
                        ok: false,
                        error: "device_update_failed",
                    });
                    return;
                }
                res.json({ ok: true });
            },
        );

        this.app.post(
            "/api/admin/devices/:id/rotate_key",
            this.requireAuth(),
            async (req, res) => {
                const deviceId = Number(req.params.id);
                const row = await this.devicesDb.getByDeviceId(deviceId);
                if (!row) {
                    res.status(404).json({
                        ok: false,
                        error: "device_not_found",
                    });
                    return;
                }
                const key = await this.devicesDb.rotateKey(deviceId);
                this.logSessionAction(
                    req,
                    "admin_rotate_device_key",
                    `device_id: ${deviceId}`,
                );
                if (this.onDeviceDisconnect) {
                    this.onDeviceDisconnect(deviceId);
                }
                res.json({ ok: true, api_key: key });
            },
        );

        this.app.delete(
            "/api/admin/devices/:id",
            this.requireAuth(),
            async (req, res) => {
                const deviceId = Number(req.params.id);
                await this.devicesDb.deleteDevice(deviceId);
                this.logSessionAction(
                    req,
                    "admin_delete_device",
                    `device_id: ${deviceId}`,
                );
                if (this.onDeviceDisconnect) {
                    this.onDeviceDisconnect(deviceId);
                }
                res.json({ ok: true });
            },
        );
    }

    requireAuth() {
        return async (req, res, next) => {
            const session = await this.sessions.fromRequest(req);
            if (!session) {
                res.status(401).json({ ok: false, error: "unauthorized" });
                return;
            }
            req.session = session;
            next();
        };
    }

    requireDeviceApiKey() {
        return async (req, res, next) => {
            const apiKey = String(req.get("x-api-key") || req.query?.api_key || "").trim();
            if (!apiKey) {
                res.status(401).json({ ok: false, error: "api_key_required" });
                return;
            }
            const row = await this.devicesDb.getByApiKey(apiKey);
            if (!row) {
                res.status(403).json({ ok: false, error: "api_key_invalid" });
                return;
            }
            req.deviceRow = row;
            next();
        };
    }

    describeSessionUser(session) {
        if (!session) return "-";
        if (typeof session === "string") {
            return String(session).trim() || "-";
        }
        const username = String(session.username || "").trim() || "-";
        const plcUsername = String(session.plc_username || "").trim() || "-";
        return `${username} plc: ${plcUsername}`;
    }

    logSessionAction(req, action, details = "") {
        logger.info(
            `api action: user: ${this.describeSessionUser(req?.session)} action: ${action}${details ? ` ${details}` : ""}`,
        );
    }

}
