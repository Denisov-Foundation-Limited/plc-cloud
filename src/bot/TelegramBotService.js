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
import { Bot, InlineKeyboard } from "grammy";
import { rootLogger } from "../utils/Logger.js";
import {
    filterObjectsForSummaries,
    sanitizeSummaryForSession,
    resolveAccess,
} from "../auth/AccessControl.js";
import { TgSocketMenu } from "./menu/TgSocketMenu.js";
import { TgLightMenu } from "./menu/TgLightMenu.js";
import { TgQuickActionMenu } from "./menu/TgQuickActionMenu.js";
import { TgMeteoMenu } from "./menu/TgMeteoMenu.js";

const logger = rootLogger.child("TG_BOT");
const CALLBACK_PREFIX = "menu";
const CALLBACK_MAIN = `${CALLBACK_PREFIX}:main`;
const CALLBACK_HELP = `${CALLBACK_PREFIX}:help`;
const CALLBACK_OBJECTS = `${CALLBACK_PREFIX}:objects`;
const CALLBACK_DEVICES = `${CALLBACK_PREFIX}:devices`;
const CALLBACK_STATUS_HELP = `${CALLBACK_PREFIX}:status_help`;
const CALLBACK_OBJECT_PREFIX = `${CALLBACK_PREFIX}:object:`;
const CALLBACK_DEVICE_PREFIX = `${CALLBACK_PREFIX}:device:`;
const CALLBACK_OBJECTS_BACK = `${CALLBACK_PREFIX}:objects_back`;
const CALLBACK_CONTROLLER_PREFIX = `${CALLBACK_PREFIX}:controller:`;
const CALLBACK_TOGGLE_PREFIX = `${CALLBACK_PREFIX}:toggle:`;
const CALLBACK_QUICK_PREFIX = `${CALLBACK_PREFIX}:quick:`;

function normalizePath(value, fallback = "/telegram/webhook") {
    const raw = String(value || fallback).trim() || fallback;
    return raw.startsWith("/") ? raw : `/${raw}`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function objectLabel(objectItem) {
    if (typeof objectItem === "string") return objectItem;
    return String(objectItem?.name || "").trim();
}

function objectIcon(objectItem) {
    const kind = String(
        typeof objectItem === "string" ? "house" : objectItem?.icon || "house",
    ).toLowerCase();
    if (kind === "apartment") return "🏢";
    if (kind === "dacha") return "🏡";
    if (kind === "garage") return "🚗";
    if (kind === "garden") return "🌿";
    return "🏠";
}

function onlineIcon(flag) {
    return flag ? "🟢" : "⚪";
}

function controllerIcon(title) {
    const key = String(title || "").toLowerCase();
    if (key.includes("розет")) return "🔌";
    if (key.includes("осве")) return "💡";
    if (key.includes("метео")) return "🌤";
    if (key.includes("термо")) return "🌡";
    if (key.includes("бак")) return "🛢";
    if (key.includes("септик")) return "🚰";
    if (key.includes("полив")) return "💧";
    if (key.includes("охран")) return "🛡";
    if (key.includes("звон")) return "🔔";
    if (key.includes("авр")) return "⚙";
    if (key.includes("протеч")) return "🚨";
    return "▫️";
}

function safeText(value, fallback = "-") {
    const raw = String(value ?? "").trim();
    return raw || fallback;
}

export class TelegramBotService {
    constructor({ telegramConfigDb, usersDb, devicesDb, registry }) {
        this.telegramConfigDb = telegramConfigDb;
        this.usersDb = usersDb;
        this.devicesDb = devicesDb;
        this.registry = registry;
        this.settings = {
            token: "",
            public_base_url: "",
            webhook_path: "/telegram/webhook",
            secret_token: "",
        };
        this.bot = null;
        this.botInfo = null;
        this.deviceWs = null;
        this.socketMenu = new TgSocketMenu({ registry, devicesDb });
        this.lightMenu = new TgLightMenu({ registry, devicesDb });
        this.quickActionMenu = new TgQuickActionMenu({ registry, devicesDb });
        this.meteoMenu = new TgMeteoMenu({ registry, devicesDb });
        this.lastSummaryByDevice = new Map();
        this.lastEventSignatureByDevice = new Map();
    }

    setDeviceWs(deviceWs) {
        this.deviceWs = deviceWs;
        this.socketMenu.setDeviceWs(deviceWs);
        this.lightMenu.setDeviceWs(deviceWs);
        this.quickActionMenu.setDeviceWs(deviceWs);
    }

    isEnabled() {
        return Boolean(this.bot);
    }

    install() {}

    async init() {
        const settings = await this.telegramConfigDb.getSettings();
        await this.applySettings(settings, { source: "init" });
    }

    async updateSettings(patch = {}) {
        const settings = await this.telegramConfigDb.updateSettings(patch);
        await this.applySettings(settings, { source: "update" });
        return this.getSettingsSummary();
    }

    getSettingsSummary() {
        return {
            enabled: this.isEnabled(),
            transport: "long_polling",
            token: this.settings.token,
            token_configured: Boolean(this.settings.token),
            bot_username: this.botInfo?.username || "",
            bot_name: this.botInfo?.first_name || "",
            commands: ["/start", "/help", "/objects", "/devices", "/status"],
            menu_ready: true,
            menu_buttons: [
                "Список объектов",
                "Устройства объекта",
                "Контроллеры устройства",
            ],
            notifications_ready: true,
        };
    }

    async notifyDeviceOnline(deviceId, summary = null) {
        if (!this.isEnabled()) return;
        const effectiveSummary =
            summary ||
            (await this.registry.buildSummary(deviceId, this.devicesDb));
        if (!effectiveSummary) return;
        this.lastSummaryByDevice.set(Number(deviceId), effectiveSummary);
        await this.broadcastNotification(effectiveSummary, (sanitized) =>
            [
                `Устройство <b>${escapeHtml(sanitized.name || `#${sanitized.device_id}`)}</b> онлайн`,
                `Объект: <b>${escapeHtml(sanitized.object_name || "-")}</b>`,
                `ID: <code>${escapeHtml(sanitized.device_id)}</code>`,
            ].join("\n"),
        );
    }

    async notifyDeviceOffline(deviceId) {
        if (!this.isEnabled()) return;
        const cached = this.lastSummaryByDevice.get(Number(deviceId));
        const row = await this.devicesDb.getByDeviceId(Number(deviceId));
        const summary =
            cached ||
            (row
                ? {
                      device_id: row.device_id,
                      name: row.name,
                      object_name: row.object_name,
                      online: false,
                      system: null,
                      controllers: null,
                      stack: null,
                      stack_units: null,
                      authz: null,
                      last_event: null,
                  }
                : null);
        if (!summary) return;
        await this.broadcastNotification(summary, (sanitized) =>
            [
                `Устройство <b>${escapeHtml(sanitized.name || `#${sanitized.device_id}`)}</b> оффлайн`,
                `Объект: <b>${escapeHtml(sanitized.object_name || "-")}</b>`,
                `ID: <code>${escapeHtml(sanitized.device_id)}</code>`,
            ].join("\n"),
        );
    }

    async notifyDeviceUpdate(summary) {
        if (!this.isEnabled() || !summary) return;
        const deviceId = Number(summary.device_id);
        this.lastSummaryByDevice.set(deviceId, summary);
        const eventPayload = summary.last_event;
        if (!eventPayload || typeof eventPayload !== "object") return;
        const reason = String(eventPayload.reason || "")
            .trim()
            .toLowerCase();
        if (reason === "periodic") return;
        const signature = JSON.stringify({
            kind: eventPayload.kind || "",
            reason: eventPayload.reason || "",
            data: eventPayload.data || null,
            ts: eventPayload.ts || eventPayload.time || "",
        });
        if (this.lastEventSignatureByDevice.get(deviceId) === signature) return;
        this.lastEventSignatureByDevice.set(deviceId, signature);
        await this.broadcastNotification(summary, (sanitized) =>
            this.buildEventNotificationText(sanitized),
        );
    }

    async broadcastNotification(summary, textBuilder) {
        if (!this.bot) return;
        const users = await this.usersDb.listUsers();
        const recipients = users.filter((user) => {
            if (!String(user?.chat_id || "").trim()) return false;
            if (!String(user?.plc_username || "").trim()) return false;
            return Boolean(
                sanitizeSummaryForSession(summary, {
                    plc_username: user.plc_username,
                }),
            );
        });
        for (const user of recipients) {
            const sanitized = sanitizeSummaryForSession(summary, {
                plc_username: user.plc_username,
            });
            if (!sanitized) continue;
            const text =
                typeof textBuilder === "function"
                    ? textBuilder(sanitized, user)
                    : "";
            if (!text) continue;
            await this.bot.api
                .sendMessage(String(user.chat_id), text, { parse_mode: "HTML" })
                .catch((err) => {
                    logger.warn(
                        `telegram notify failed for ${user.username || user.chat_id}: ${err?.message || "unknown_error"}`,
                    );
                });
        }
    }

    buildEventNotificationText(summary) {
        const eventPayload = summary?.last_event || {};
        const kind = String(eventPayload.kind || "event").trim() || "event";
        const reason = String(eventPayload.reason || "").trim();
        const data =
            eventPayload.data && typeof eventPayload.data === "object"
                ? eventPayload.data
                : {};
        const lines = [
            `Событие на <b>${escapeHtml(summary.name || `#${summary.device_id}`)}</b>`,
            `Объект: <b>${escapeHtml(summary.object_name || "-")}</b>`,
            `Тип: <b>${escapeHtml(kind)}</b>`,
        ];
        if (reason) {
            lines.push(`Причина: <b>${escapeHtml(reason)}</b>`);
        }
        const details = [];
        for (const [key, value] of Object.entries(data).slice(0, 6)) {
            if (value && typeof value === "object") continue;
            details.push(`${escapeHtml(key)}: <b>${escapeHtml(value)}</b>`);
        }
        if (details.length) {
            lines.push("");
            lines.push(...details);
        }
        return lines.join("\n");
    }

    async applySettings(settings, { source = "update" } = {}) {
        const previousBot = this.bot;
        const previousToken = this.settings.token;

        this.settings = {
            token: String(settings?.token || "").trim(),
            public_base_url: String(settings?.public_base_url || "")
                .trim()
                .replace(/\/+$/, ""),
            webhook_path: normalizePath(settings?.webhook_path),
            secret_token: String(settings?.secret_token || "").trim(),
        };

        if (
            previousBot &&
            (previousToken !== this.settings.token || !this.settings.token)
        ) {
            previousBot.stop();
        }

        this.bot = null;
        this.botInfo = null;

        if (!this.settings.token) {
            logger.info("telegram bot disabled: token is not set");
            return;
        }

        this.bot = new Bot(this.settings.token);
        this.installHandlers();
        this.bot.catch((err) => {
            const message =
                err?.error instanceof Error
                    ? err.error.message
                    : err?.message || "unknown_error";
            logger.error(`telegram update failed: ${message}`);
        });

        try {
            await this.bot.api.setMyCommands([
                { command: "start", description: "Краткая справка" },
                { command: "help", description: "Список команд" },
                { command: "objects", description: "Список объектов" },
                {
                    command: "devices",
                    description: "Устройства по объекту или все",
                },
                { command: "status", description: "Статус устройства по id" },
            ]);
            this.botInfo = await this.bot.api.getMe();
            await this.bot.api
                .deleteWebhook({ drop_pending_updates: true })
                .catch(() => {});
            void this.bot.start({
                allowed_updates: ["message", "callback_query"],
                drop_pending_updates: true,
                onStart: (botInfo) => {
                    logger.info(
                        `telegram bot polling started: @${botInfo.username || "unknown"}`,
                    );
                },
            });
        } catch (err) {
            logger.error(
                `telegram bot ${source} failed: ${err?.message || "unknown_error"}`,
            );
        }
    }

    installHandlers() {
        this.bot.command("start", async (ctx) => {
            const user = await this.requireLinkedUser(ctx);
            if (!user) return;
            this.logTelegramAction(ctx, user, "command_start");
            await this.sendObjectsList(ctx, "", user);
        });

        this.bot.command("help", async (ctx) => {
            const user = await this.requireLinkedUser(ctx);
            if (!user) return;
            this.logTelegramAction(ctx, user, "command_help");
            await this.sendObjectsList(
                ctx,
                `${this.helpText(user)}\n\nВыбери объект.`,
                user,
            );
        });

        this.bot.command("objects", async (ctx) => {
            const user = await this.requireLinkedUser(ctx);
            if (!user) return;
            this.logTelegramAction(ctx, user, "command_objects");
            await this.sendObjectsList(ctx, "", user);
        });

        this.bot.command("devices", async (ctx) => {
            const user = await this.requireLinkedUser(ctx);
            if (!user) return;
            const objectName = this.commandArgs(ctx);
            this.logTelegramAction(
                ctx,
                user,
                "command_devices",
                `object=${objectName || "-"}`,
            );
            if (!objectName) {
                await this.sendObjectsList(
                    ctx,
                    "Выбери объект, чтобы открыть список устройств.",
                    user,
                );
                return;
            }
            await this.sendDevicesList(ctx, objectName, user);
        });

        this.bot.command("status", async (ctx) => {
            const args = this.commandArgs(ctx);
            const deviceId = Number(args);
            const user = await this.requireLinkedUser(ctx);
            if (!user) return;
            this.logTelegramAction(
                ctx,
                user,
                "command_status",
                `device_id=${Number.isFinite(deviceId) ? deviceId : "-"}`,
            );
            if (!Number.isFinite(deviceId)) {
                await this.replyMenu(
                    ctx,
                    "Использование: /status <device_id>",
                    this.buildStatusHelpKeyboard(),
                );
                return;
            }
            await this.sendDeviceStatus(ctx, deviceId, user);
        });

        this.bot.on("message:text", async (ctx) => {
            const text = String(ctx.message?.text || "").trim();
            if (!text || text.startsWith("/")) return;
            const user = await this.requireLinkedUser(ctx);
            if (!user) return;
            this.logTelegramAction(
                ctx,
                user,
                "message_text",
                `text=${this.truncateForLog(text)}`,
            );

            const normalized = text.toLowerCase();
            if (normalized === "объекты" || normalized === "objects") {
                await this.sendObjectsList(ctx, "", user);
                return;
            }
            if (normalized === "помощь" || normalized === "help") {
                await this.sendObjectsList(
                    ctx,
                    `${this.helpText(user)}\n\nВыбери объект.`,
                    user,
                );
                return;
            }
            if (normalized === "устройства" || normalized === "devices") {
                await this.sendObjectsList(
                    ctx,
                    "Выбери объект, чтобы открыть список устройств.",
                    user,
                );
                return;
            }

            await this.replyMenu(
                ctx,
                [
                    "Сообщение получено.",
                    "",
                    "Используй меню ниже или команды:",
                    "<code>/start</code>, <code>/help</code>, <code>/objects</code>, <code>/devices</code>, <code>/status &lt;device_id&gt;</code>",
                ].join("\n"),
                this.buildObjectsKeyboard(await this.listTelegramObjects(user)),
            );
        });

        this.bot.callbackQuery(CALLBACK_MAIN, async (ctx) => {
            await ctx.answerCallbackQuery();
            const user = await this.requireLinkedUser(ctx);
            if (!user) return;
            this.logTelegramAction(ctx, user, "callback_main");
            await this.sendObjectsList(ctx, "", user);
        });

        this.bot.callbackQuery(CALLBACK_HELP, async (ctx) => {
            await ctx.answerCallbackQuery();
            const user = await this.requireLinkedUser(ctx);
            if (!user) return;
            this.logTelegramAction(ctx, user, "callback_help");
            await this.replyMenu(
                ctx,
                this.helpText(user),
                this.buildMainMenuKeyboard(),
            );
        });

        this.bot.callbackQuery(CALLBACK_OBJECTS, async (ctx) => {
            await ctx.answerCallbackQuery();
            const user = await this.requireLinkedUser(ctx);
            if (!user) return;
            this.logTelegramAction(ctx, user, "callback_objects");
            await this.sendObjectsList(ctx, "", user);
        });

        this.bot.callbackQuery(CALLBACK_DEVICES, async (ctx) => {
            await ctx.answerCallbackQuery();
            const user = await this.requireLinkedUser(ctx);
            if (!user) return;
            this.logTelegramAction(ctx, user, "callback_devices");
            await this.sendObjectsList(ctx, "Сначала выбери объект.", user);
        });

        this.bot.callbackQuery(CALLBACK_STATUS_HELP, async (ctx) => {
            const user = await this.requireLinkedUser(ctx);
            if (!user) return;
            this.logTelegramAction(ctx, user, "callback_status_help");
            await ctx.answerCallbackQuery({
                text: "Используй команду /status <device_id>",
                show_alert: false,
            });
        });

        this.bot.callbackQuery(
            new RegExp(`^${CALLBACK_OBJECT_PREFIX}(\\d+)$`),
            async (ctx) => {
                await ctx.answerCallbackQuery();
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const objectIndex = Number(
                    Array.isArray(ctx.match) ? ctx.match[1] : "",
                );
                const objects = await this.listTelegramObjects(user);
                const selected = objects[objectIndex];
                const objectName = objectLabel(selected);
                this.logTelegramAction(
                    ctx,
                    user,
                    "select_object",
                    `index=${objectIndex} object=${objectName || "-"}`,
                );
                if (!objectName) {
                    await this.replyMenu(
                        ctx,
                        "Объект не найден.",
                        this.buildMainMenuKeyboard(),
                    );
                    return;
                }
                await this.sendDevicesList(ctx, objectName, user);
            },
        );

        this.bot.callbackQuery(CALLBACK_OBJECTS_BACK, async (ctx) => {
            await ctx.answerCallbackQuery();
            const user = await this.requireLinkedUser(ctx);
            if (!user) return;
            this.logTelegramAction(ctx, user, "callback_objects_back");
            await this.sendObjectsList(ctx, "", user);
        });

        this.bot.callbackQuery(
            new RegExp(`^${CALLBACK_DEVICE_PREFIX}(\\d+):(\\d+)$`),
            async (ctx) => {
                await ctx.answerCallbackQuery();
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const deviceId = Number(
                    Array.isArray(ctx.match) ? ctx.match[1] : "",
                );
                const nodeId = Number(
                    Array.isArray(ctx.match) ? ctx.match[2] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "select_device",
                    `device_id=${deviceId} node_id=${nodeId || 0}`,
                );
                await this.sendControllersList(
                    ctx,
                    deviceId,
                    nodeId > 0 ? nodeId : null,
                    user,
                );
            },
        );

        this.bot.callbackQuery("menu:noop", async (ctx) => {
            const user = await this.requireLinkedUser(ctx);
            if (user) {
                this.logTelegramAction(ctx, user, "callback_noop");
            }
            await ctx.answerCallbackQuery();
        });

        this.bot.callbackQuery(
            new RegExp(
                `^${CALLBACK_CONTROLLER_PREFIX}(\\d+):(\\d+):(sockets|lights|meteo)$`,
            ),
            async (ctx) => {
                await ctx.answerCallbackQuery();
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const deviceId = Number(
                    Array.isArray(ctx.match) ? ctx.match[1] : "",
                );
                const nodeId = Number(
                    Array.isArray(ctx.match) ? ctx.match[2] : "",
                );
                const controller = String(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "open_controller",
                    `device_id=${deviceId} node_id=${nodeId || 0} controller=${controller}`,
                );
                if (controller === "sockets") {
                    await this.socketMenu.open(ctx, {
                        deviceId,
                        nodeId: nodeId > 0 ? nodeId : null,
                        user,
                        getScopedDetail:
                            this.getScopedTelegramDetail.bind(this),
                        replyMenu: this.replyMenu.bind(this),
                        mainMenuCallbackData: CALLBACK_MAIN,
                        controllersCallbackData: (nextDeviceId, nextNodeId) =>
                            `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
                    });
                    return;
                }
                if (controller === "meteo") {
                    await this.meteoMenu.open(ctx, {
                        deviceId,
                        nodeId: nodeId > 0 ? nodeId : null,
                        user,
                        getScopedDetail:
                            this.getScopedTelegramDetail.bind(this),
                        replyMenu: this.replyMenu.bind(this),
                        mainMenuCallbackData: CALLBACK_MAIN,
                        controllersCallbackData: (nextDeviceId, nextNodeId) =>
                            `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
                    });
                    return;
                }
                await this.lightMenu.open(ctx, {
                    deviceId,
                    nodeId: nodeId > 0 ? nodeId : null,
                    user,
                    getScopedDetail: this.getScopedTelegramDetail.bind(this),
                    replyMenu: this.replyMenu.bind(this),
                    mainMenuCallbackData: CALLBACK_MAIN,
                    controllersCallbackData: (nextDeviceId, nextNodeId) =>
                        `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
                });
            },
        );

        this.bot.callbackQuery(
            new RegExp(
                `^${CALLBACK_TOGGLE_PREFIX}(\\d+):(\\d+):(sockets|lights):(\\d+)$`,
            ),
            async (ctx) => {
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const deviceId = Number(
                    Array.isArray(ctx.match) ? ctx.match[1] : "",
                );
                const nodeId = Number(
                    Array.isArray(ctx.match) ? ctx.match[2] : "",
                );
                const controller = String(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[4] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "toggle_item",
                    `device_id=${deviceId} node_id=${nodeId || 0} controller=${controller} id=${itemId}`,
                );
                if (controller === "sockets") {
                    await this.socketMenu.toggle(ctx, {
                        deviceId,
                        nodeId: nodeId > 0 ? nodeId : null,
                        itemId,
                        user,
                        getScopedDetail:
                            this.getScopedTelegramDetail.bind(this),
                        replyMenu: this.replyMenu.bind(this),
                        mainMenuCallbackData: CALLBACK_MAIN,
                        controllersCallbackData: (nextDeviceId, nextNodeId) =>
                            `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
                    });
                    return;
                }
                await this.lightMenu.toggle(ctx, {
                    deviceId,
                    nodeId: nodeId > 0 ? nodeId : null,
                    itemId,
                    user,
                    getScopedDetail: this.getScopedTelegramDetail.bind(this),
                    replyMenu: this.replyMenu.bind(this),
                    mainMenuCallbackData: CALLBACK_MAIN,
                    controllersCallbackData: (nextDeviceId, nextNodeId) =>
                        `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
                });
            },
        );

        this.bot.callbackQuery(
            new RegExp(`^menu:setall:(\\d+):(\\d+):(sockets|lights):(on|off)$`),
            async (ctx) => {
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const deviceId = Number(
                    Array.isArray(ctx.match) ? ctx.match[1] : "",
                );
                const nodeId = Number(
                    Array.isArray(ctx.match) ? ctx.match[2] : "",
                );
                const controller = String(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                const state = String(
                    Array.isArray(ctx.match) ? ctx.match[4] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "set_all",
                    `device_id=${deviceId} node_id=${nodeId || 0} controller=${controller} state=${state}`,
                );
                if (controller === "sockets") {
                    await this.socketMenu.setAll(ctx, {
                        deviceId,
                        nodeId: nodeId > 0 ? nodeId : null,
                        state,
                        user,
                        getScopedDetail:
                            this.getScopedTelegramDetail.bind(this),
                        replyMenu: this.replyMenu.bind(this),
                        mainMenuCallbackData: CALLBACK_MAIN,
                        controllersCallbackData: (nextDeviceId, nextNodeId) =>
                            `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
                    });
                    return;
                }
                await this.lightMenu.setAll(ctx, {
                    deviceId,
                    nodeId: nodeId > 0 ? nodeId : null,
                    state,
                    user,
                    getScopedDetail: this.getScopedTelegramDetail.bind(this),
                    replyMenu: this.replyMenu.bind(this),
                    mainMenuCallbackData: CALLBACK_MAIN,
                    controllersCallbackData: (nextDeviceId, nextNodeId) =>
                        `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
                });
            },
        );

        this.bot.callbackQuery(
            new RegExp(
                `^${CALLBACK_QUICK_PREFIX}(\\d+):(\\d+):(home|prepare|away)$`,
            ),
            async (ctx) => {
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const deviceId = Number(
                    Array.isArray(ctx.match) ? ctx.match[1] : "",
                );
                const nodeId = Number(
                    Array.isArray(ctx.match) ? ctx.match[2] : "",
                );
                const preset = String(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "quick_action",
                    `device_id=${deviceId} node_id=${nodeId || 0} preset=${preset}`,
                );
                await this.quickActionMenu.run(ctx, {
                    deviceId,
                    nodeId: nodeId > 0 ? nodeId : null,
                    preset,
                    user,
                    refreshControllers: async () => {
                        await this.sendControllersList(
                            ctx,
                            deviceId,
                            nodeId > 0 ? nodeId : null,
                            user,
                        );
                    },
                });
            },
        );
    }

    async requireLinkedUser(ctx) {
        const chatId = String(ctx.from?.id || "").trim();
        const telegramUsername = String(ctx.from?.username || "").trim();
        const user = await this.usersDb.findByTelegramIdentity({
            chatId,
            telegramUsername,
        });
        if (user) return user;
        logger.warn(
            `telegram access denied: tg=${telegramUsername || "-"} chat_id=${chatId || "-"}`,
        );
        await this.replyMenu(
            ctx,
            "Доступ запрещен.",
            this.buildMainMenuKeyboard(),
        );
        return null;
    }

    async listTelegramObjects(user) {
        const objects = await this.devicesDb.listObjects();
        const summaries = await this.registry.listOnlineSummaries(
            this.devicesDb,
        );
        return filterObjectsForSummaries(objects, summaries, user);
    }

    async sendObjectsList(ctx, leadText = "", user = null) {
        const objects = await this.listTelegramObjects(user || {});
        if (!objects.length) {
            await this.replyMenu(ctx, "Объекты не найдены.");
            return;
        }
        const lines = objects.map((item, index) => {
            const label = objectLabel(item);
            return `${index + 1}. ${objectIcon(item)} ${label}`;
        });
        const intro = leadText ? `${escapeHtml(leadText)}\n\n` : "";
        await this.replyMenu(
            ctx,
            [
                intro.trimEnd(),
                this.panelTitle(
                    "🏘 Объекты",
                    `${objects.length} ${this.pluralize(objects.length, ["объект", "объекта", "объектов"])}`,
                ),
                lines.map(escapeHtml).join("\n"),
            ]
                .filter(Boolean)
                .join("\n\n"),
            this.buildObjectsKeyboard(objects),
        );
    }

    async sendDevicesList(ctx, objectName = "", user = null) {
        const args = String(objectName || "").trim();
        const devices = await this.listTelegramDevices(args, user || {});
        if (!devices.length) {
            const text = args
                ? `Для объекта "${escapeHtml(args)}" устройства не найдены.`
                : "Устройства не найдены.";
            await this.replyMenu(ctx, text, this.buildMainMenuKeyboard());
            return;
        }
        const lines = devices.map((item) => {
            return `${onlineIcon(item.online)} ${item.label}`;
        });
        await this.replyMenu(
            ctx,
            [
                this.panelTitle(
                    args ? `📟 ${safeText(args)}` : "📟 Устройства",
                    `${devices.length} ${this.pluralize(devices.length, ["устройство", "устройства", "устройств"])}`,
                ),
                lines.map(escapeHtml).join("\n"),
            ].join("\n\n"),
            this.buildDevicesKeyboard(devices, args),
        );
    }

    async sendDeviceStatus(ctx, deviceId, user = null) {
        const summary = await this.registry.buildSummary(
            deviceId,
            this.devicesDb,
        );
        const row = await this.devicesDb.getByDeviceId(deviceId);
        if (!summary && !row) {
            await this.replyMenu(
                ctx,
                `Устройство #${deviceId} не найдено.`,
                this.buildStatusHelpKeyboard(),
            );
            return;
        }

        const visibleSummary = summary
            ? sanitizeSummaryForSession(summary, user || {})
            : null;
        if (summary && !visibleSummary) {
            await this.replyMenu(
                ctx,
                `Нет доступа к устройству #${deviceId}.`,
                this.buildMainMenuKeyboard(),
            );
            return;
        }

        const data = visibleSummary || {
            device_id: row.device_id,
            name: row.name,
            object_name: row.object_name,
            online: false,
            last_seen_ms: row.last_seen_ms || 0,
            system: null,
            controllers: null,
        };

        const rtcDate = data.system?.rtc?.date || "-";
        const rtcTime = data.system?.rtc?.time || "-";
        const controllers = data.controllers || {};
        const socketCount = Array.isArray(controllers.sockets)
            ? controllers.sockets.length
            : 0;
        const lightCount = Array.isArray(controllers.lights)
            ? controllers.lights.length
            : 0;
        const meteoCount = Array.isArray(controllers.meteo)
            ? controllers.meteo.length
            : 0;
        const lines = [
            this.panelTitle(
                data.name || `Устройство #${data.device_id}`,
                `#${data.device_id}`,
            ),
            [
                `🏠 Объект: <b>${escapeHtml(data.object_name || "-")}</b>`,
                `${onlineIcon(data.online)} Статус: <b>${data.online ? "ON" : "OFF"}</b>`,
                `🕒 RTC: <b>${escapeHtml(`${rtcDate} ${rtcTime}`.trim())}</b>`,
            ].join("\n"),
            [
                `<b>🧩 Контроллеры</b>`,
                `🔌 Розетки: <b>${socketCount}</b>`,
                `💡 Свет: <b>${lightCount}</b>`,
                `🌤 Метео: <b>${meteoCount}</b>`,
            ].join("\n"),
        ];
        await this.replyMenu(
            ctx,
            lines.join("\n\n"),
            this.buildStatusResultKeyboard(),
        );
    }

    async replyMenu(ctx, text, keyboard = null, extraOptions = {}) {
        const options = { parse_mode: "HTML", ...extraOptions };
        if (keyboard) options.reply_markup = keyboard;
        const canEdit =
            Boolean(ctx?.callbackQuery?.message) &&
            typeof ctx.editMessageText === "function";
        if (canEdit) {
            try {
                await ctx.editMessageText(text, options);
                return;
            } catch (err) {
                const message = String(err?.message || "");
                if (message.toLowerCase().includes("message is not modified")) {
                    return;
                }
                logger.warn(
                    `telegram message edit failed, fallback to reply: ${message || "unknown_error"}`,
                );
            }
        }
        await ctx.reply(text, options);
    }

    buildMainMenuKeyboard() {
        return new InlineKeyboard()
            .text("🏘 К началу", CALLBACK_MAIN)
            .text("📟 Все устройства", CALLBACK_DEVICES);
    }

    buildObjectsKeyboard(objects) {
        const keyboard = new InlineKeyboard();
        objects.forEach((item, index) => {
            keyboard
                .text(
                    `${objectIcon(item)} ${objectLabel(item)}`,
                    `${CALLBACK_OBJECT_PREFIX}${index}`,
                )
                .row();
        });
        keyboard
            .text("📟 Все устройства", CALLBACK_DEVICES)
            .text("🏘 К началу", CALLBACK_MAIN);
        return keyboard;
    }

    buildDevicesKeyboard(devices, currentObject = "") {
        const keyboard = new InlineKeyboard();
        for (const device of devices) {
            keyboard
                .text(
                    device.button_label,
                    `${CALLBACK_DEVICE_PREFIX}${device.device_id}:${device.node_id || 0}`,
                )
                .row();
        }
        if (currentObject) {
            keyboard.text("🏘 К объектам", CALLBACK_OBJECTS_BACK).row();
        }
        keyboard.text("🏘 К началу", CALLBACK_MAIN);
        return keyboard;
    }

    buildControllersKeyboard(detail) {
        const keyboard = new InlineKeyboard();
        const deviceId = Number(detail?.device_id);
        const nodeId = Number(detail?.node_id || 0);
        const quickActionPolicy =
            detail?.access?.controllers?.quick_actions || null;
        const quickActionEnabled =
            !detail?.access || Boolean(quickActionPolicy?.write);
        if (quickActionEnabled) {
            const items = this.quickActionMenu.items();
            keyboard
                .text(
                    items[0].label,
                    this.quickActionMenu.callbackData(
                        deviceId,
                        nodeId,
                        items[0].key,
                    ),
                )
                .text(
                    items[1].label,
                    this.quickActionMenu.callbackData(
                        deviceId,
                        nodeId,
                        items[1].key,
                    ),
                )
                .text(
                    items[2].label,
                    this.quickActionMenu.callbackData(
                        deviceId,
                        nodeId,
                        items[2].key,
                    ),
                )
                .row();
        }
        const controllerButtons = [];
        const hasSockets =
            Array.isArray(detail?.controllers?.sockets) &&
            detail.controllers.sockets.length > 0;
        const hasLights =
            Array.isArray(detail?.controllers?.lights) &&
            detail.controllers.lights.length > 0;
        const hasMeteo =
            Array.isArray(detail?.controllers?.meteo) &&
            detail.controllers.meteo.length > 0;
        const hasThermo =
            Array.isArray(detail?.controllers?.thermo) &&
            detail.controllers.thermo.length > 0;
        const hasTanks =
            Array.isArray(detail?.controllers?.tanks) &&
            detail.controllers.tanks.length > 0;
        const hasSeptic =
            Array.isArray(detail?.controllers?.septic) &&
            detail.controllers.septic.length > 0;
        const hasWatering =
            Array.isArray(detail?.controllers?.watering) &&
            detail.controllers.watering.length > 0;
        const hasSecurity = Boolean(detail?.controllers?.security);
        const hasRing = Boolean(detail?.controllers?.ring);
        const hasAvr = Boolean(detail?.controllers?.avr);
        const hasLeak =
            Array.isArray(detail?.controllers?.leak) &&
            detail.controllers.leak.length > 0;

        if (hasSockets)
            controllerButtons.push({
                label: "🔌 Розетки",
                data: this.socketMenu.controllerCallbackData(deviceId, nodeId),
            });
        if (hasLights)
            controllerButtons.push({
                label: "💡 Освещение",
                data: this.lightMenu.controllerCallbackData(deviceId, nodeId),
            });
        if (hasMeteo)
            controllerButtons.push({
                label: "🌤 Метео",
                data: this.meteoMenu.controllerCallbackData(deviceId, nodeId),
            });
        if (hasThermo)
            controllerButtons.push({
                label: "🌡 Термостаты",
                data: `${CALLBACK_DEVICE_PREFIX}${deviceId}:${nodeId}`,
            });
        if (hasTanks)
            controllerButtons.push({
                label: "🛢 Баки",
                data: `${CALLBACK_DEVICE_PREFIX}${deviceId}:${nodeId}`,
            });
        if (hasSeptic)
            controllerButtons.push({
                label: "🚰 Септик",
                data: `${CALLBACK_DEVICE_PREFIX}${deviceId}:${nodeId}`,
            });
        if (hasWatering)
            controllerButtons.push({
                label: "💧 Полив",
                data: `${CALLBACK_DEVICE_PREFIX}${deviceId}:${nodeId}`,
            });
        if (hasSecurity)
            controllerButtons.push({
                label: "🛡 Охрана",
                data: `${CALLBACK_DEVICE_PREFIX}${deviceId}:${nodeId}`,
            });
        if (hasRing)
            controllerButtons.push({
                label: "🔔 Звонок",
                data: `${CALLBACK_DEVICE_PREFIX}${deviceId}:${nodeId}`,
            });
        if (hasAvr)
            controllerButtons.push({
                label: "⚙ АВР",
                data: `${CALLBACK_DEVICE_PREFIX}${deviceId}:${nodeId}`,
            });
        if (hasLeak)
            controllerButtons.push({
                label: "🚨 Протечки",
                data: `${CALLBACK_DEVICE_PREFIX}${deviceId}:${nodeId}`,
            });

        for (let i = 0; i < controllerButtons.length; i += 2) {
            const left = controllerButtons[i];
            const right = controllerButtons[i + 1];
            keyboard.text(left.label, left.data);
            if (right) keyboard.text(right.label, right.data);
            keyboard.row();
        }
        keyboard.text("🏘 К объектам", CALLBACK_OBJECTS_BACK).row();
        keyboard.text("🏘 К началу", CALLBACK_MAIN);
        return keyboard;
    }

    buildStatusHelpKeyboard() {
        return new InlineKeyboard()
            .text("📟 Все устройства", CALLBACK_DEVICES)
            .text("🏘 К началу", CALLBACK_MAIN);
    }

    buildStatusResultKeyboard() {
        return new InlineKeyboard()
            .text("📟 Все устройства", CALLBACK_DEVICES)
            .text("🏘 К началу", CALLBACK_MAIN);
    }

    commandArgs(ctx) {
        const text = String(ctx.message?.text || "").trim();
        const parts = text.split(/\s+/);
        if (parts.length < 2) return "";
        return parts.slice(1).join(" ").trim();
    }

    async listTelegramDevices(objectName, user = {}) {
        const rows = await this.registry.listOnlineDevices(
            objectName,
            this.devicesDb,
        );
        const result = [];
        for (const device of rows) {
            const summary = await this.registry.buildSummary(
                device.device_id,
                this.devicesDb,
            );
            const sanitized = sanitizeSummaryForSession(summary, user);
            if (!sanitized) continue;
            const masterName = device.name || `#${Number(device.device_id)}`;
            result.push({
                device_id: Number(device.device_id),
                node_id: null,
                online: Boolean(device.online),
                object_name: device.object_name || "",
                name: masterName,
                label: `#${Number(device.device_id)} ${masterName}`,
                button_label: `${onlineIcon(device.online)} 📟 ${masterName}`,
            });
            const nodes = Array.isArray(sanitized?.stack?.nodes)
                ? sanitized.stack.nodes
                : [];
            for (const node of nodes) {
                const nodeId = Number(node?.node_id);
                if (!Number.isFinite(nodeId) || nodeId <= 0) continue;
                const nodeName = String(
                    node?.name || `Stack #${nodeId}`,
                ).trim();
                const masterShort =
                    masterName.length > 18
                        ? `${masterName.slice(0, 18)}…`
                        : masterName;
                result.push({
                    device_id: Number(device.device_id),
                    node_id: nodeId,
                    online:
                        typeof node?.online === "boolean"
                            ? Boolean(node.online)
                            : true,
                    object_name: device.object_name || "",
                    name: nodeName,
                    label: `#${Number(device.device_id)}:${nodeId} ${nodeName}`,
                    button_label: `${onlineIcon(typeof node?.online === "boolean" ? Boolean(node.online) : true)} 🧩 ${masterShort} / ${nodeName}`,
                });
            }
        }
        return result;
    }

    buildControllerCards(detail) {
        const controllers = detail?.controllers || {};
        const sockets = Array.isArray(controllers.sockets)
            ? controllers.sockets
            : [];
        const lights = Array.isArray(controllers.lights)
            ? controllers.lights
            : [];
        const meteo = Array.isArray(controllers.meteo) ? controllers.meteo : [];
        const thermo = Array.isArray(controllers.thermo)
            ? controllers.thermo
            : [];
        const tanks = Array.isArray(controllers.tanks) ? controllers.tanks : [];
        const septic = Array.isArray(controllers.septic)
            ? controllers.septic
            : [];
        const watering = Array.isArray(controllers.watering)
            ? controllers.watering
            : [];
        const leak = Array.isArray(controllers.leak) ? controllers.leak : [];
        return [
            {
                title: "Розетки",
                status: `${sockets.filter((x) => x?.state).length}/${sockets.length}`,
                visible: sockets.length > 0,
            },
            {
                title: "Освещение",
                status: `${lights.filter((x) => x?.state).length}/${lights.length}`,
                visible: lights.length > 0,
            },
            {
                title: "Метео",
                status: `${meteo.filter((x) => x?.ok).length}/${meteo.length}`,
                visible: meteo.length > 0,
            },
            {
                title: "Термостаты",
                status: `${thermo.filter((x) => x?.heat_on || x?.cool_on).length}/${thermo.length}`,
                visible: thermo.length > 0,
            },
            {
                title: "Баки",
                status: `${tanks.filter((x) => x?.pump_on || x?.alarm_on).length}/${tanks.length}`,
                visible: tanks.length > 0,
            },
            {
                title: "Септик",
                status: `${septic.filter((x) => x?.warning || x?.alarm).length}/${septic.length}`,
                visible: septic.length > 0,
            },
            {
                title: "Полив",
                status: `${watering.filter((x) => x?.active).length}/${watering.length}`,
                visible: watering.length > 0,
            },
            {
                title: "Охрана",
                status: controllers.security
                    ? controllers.security.alarm
                        ? "Тревога"
                        : controllers.security.armed
                          ? "На охране"
                          : "Снято"
                    : "-",
                visible: Boolean(controllers.security),
            },
            {
                title: "Звонок",
                status: controllers.ring
                    ? controllers.ring.relay_on
                        ? "Вкл"
                        : "Выкл"
                    : "-",
                visible: Boolean(controllers.ring),
            },
            {
                title: "АВР",
                status: controllers.avr
                    ? `${controllers.avr.active_source || "-"}${controllers.avr.fault && controllers.avr.fault !== "none" ? ` / ${controllers.avr.fault}` : ""}`
                    : "-",
                visible: Boolean(controllers.avr),
            },
            {
                title: "Протечки",
                status: `${leak.filter((x) => x?.wet || x?.alarm_latched).length}/${leak.length}`,
                visible: leak.length > 0,
            },
        ].filter((item) => item.visible);
    }

    diagnoseControllers(summary, sanitized, nodeId = null, session = {}) {
        const baseControllers =
            summary?.controllers && typeof summary.controllers === "object"
                ? summary.controllers
                : {};
        const rawKeys = Object.keys(baseControllers);
        const visibleKeys = Object.keys(
            sanitized?.controllers && typeof sanitized.controllers === "object"
                ? sanitized.controllers
                : {},
        );
        const notes = [];
        const access = summary ? resolveAccess(summary, session) : null;

        if (!summary) {
            notes.push("summary не построен");
        }
        if (access) {
            notes.push(
                `acl: restricted=${access.restricted ? "yes" : "no"}, matched=${access.matched ? "yes" : "no"}, object=${access.objectAllowed ? "yes" : "no"}, device=${access.deviceAllowed ? "yes" : "no"}`,
            );
            const readableControllers = Object.entries(access.controllers || {})
                .filter(([, policy]) => Boolean(policy?.read))
                .map(([key]) => key);
            notes.push(
                `acl readable controllers: ${readableControllers.length ? readableControllers.join(", ") : "none"}`,
            );
        }
        if (summary && !sanitized) {
            notes.push(
                "summary есть, но sanitizeSummaryForSession вернул null",
            );
            notes.push("скорее всего ACL запретил доступ к устройству");
        }
        if (nodeId) {
            const unitKey = String(Number(nodeId));
            const hasStackUnit = Boolean(
                summary?.stack_units &&
                typeof summary.stack_units === "object" &&
                summary.stack_units[unitKey],
            );
            if (!hasStackUnit) {
                notes.push(`stack_units[${unitKey}] не найден`);
            }
        }
        if (!rawKeys.length) {
            notes.push("в summary.controllers нет ключей");
        } else {
            notes.push(`raw controllers: ${rawKeys.join(", ")}`);
        }
        if (sanitized && !visibleKeys.length) {
            notes.push("после sanitize не осталось доступных controllers");
        } else if (visibleKeys.length) {
            notes.push(`visible controllers: ${visibleKeys.join(", ")}`);
        }

        return notes;
    }

    async sendControllersList(ctx, deviceId, nodeId = null, user = null) {
        const summary = await this.refreshTelegramSummary(deviceId, nodeId, [
            "controllers",
            "stack",
            "authz",
        ]);
        const sanitized = sanitizeSummaryForSession(summary, user || {});
        if (!sanitized) {
            const notes = this.diagnoseControllers(
                summary,
                sanitized,
                nodeId,
                user || {},
            );
            logger.warn(
                `telegram controllers unavailable for device ${deviceId}${nodeId ? `:${nodeId}` : ""}: ${notes.join(" | ")}`,
            );
            await this.replyMenu(
                ctx,
                [
                    `Устройство #${deviceId} недоступно.`,
                    "",
                    "<b>Диагностика</b>",
                    ...notes.map((line) => `• ${escapeHtml(line)}`),
                ].join("\n"),
                this.buildMainMenuKeyboard(),
            );
            return;
        }
        const scoped = nodeId
            ? this.resolveScopedDetail(sanitized, nodeId)
            : sanitized;
        scoped.device_id = Number(deviceId);
        scoped.node_id = nodeId ? Number(nodeId) : 0;
        const controllerCards = this.buildControllerCards(scoped);
        const deviceLabel = nodeId
            ? `${scoped.name || `Stack #${nodeId}`} (#${deviceId}:${nodeId})`
            : `${scoped.name || `Устройство #${deviceId}`} (#${deviceId})`;
        if (!controllerCards.length) {
            const notes = this.diagnoseControllers(
                summary,
                sanitized,
                nodeId,
                user || {},
            );
            logger.warn(
                `telegram controllers empty for device ${deviceId}${nodeId ? `:${nodeId}` : ""}: ${notes.join(" | ")}`,
            );
            await this.replyMenu(
                ctx,
                [
                    this.panelTitle(`🧩 ${deviceLabel}`, "Контроллеры"),
                    "Контроллеры не обнаружены.",
                    "",
                    "<b>Диагностика</b>",
                    ...notes.map((line) => `• ${escapeHtml(line)}`),
                ].join("\n"),
                new InlineKeyboard()
                    .text("🏘 К объектам", CALLBACK_OBJECTS_BACK)
                    .row()
                    .text("🏘 К началу", CALLBACK_MAIN),
            );
            return;
        }
        const lines = controllerCards.map(
            (item) =>
                `${controllerIcon(item.title)} ${item.title}: <b>${escapeHtml(item.status)}</b>`,
        );
        await this.replyMenu(
            ctx,
            [
                this.panelTitle(`🧩 ${deviceLabel}`, "Контроллеры"),
                lines.join("\n"),
            ].join("\n\n"),
            this.buildControllersKeyboard(scoped),
        );
    }

    async getScopedTelegramDetail(deviceId, nodeId = null, user = null) {
        const summary = await this.refreshTelegramSummary(deviceId, nodeId, [
            "controllers",
        ]);
        const sanitized = sanitizeSummaryForSession(summary, user || {});
        if (!sanitized) return null;
        const scoped = nodeId
            ? this.resolveScopedDetail(sanitized, nodeId)
            : sanitized;
        scoped.device_id = Number(deviceId);
        scoped.node_id = nodeId ? Number(nodeId) : 0;
        return scoped;
    }

    async refreshTelegramSummary(
        deviceId,
        nodeId = null,
        what = ["controllers"],
    ) {
        const initial = await this.registry.buildSummary(
            deviceId,
            this.devicesDb,
        );
        const initialScoped = nodeId
            ? this.resolveScopedDetail(initial, nodeId)
            : initial;
        const hasControllers =
            Object.keys(initialScoped?.controllers || {}).length > 0;
        if (hasControllers || !this.deviceWs) {
            return initial;
        }

        const unit = nodeId ? "stack" : "local";
        this.deviceWs.sendGet(
            Number(deviceId),
            what,
            unit,
            nodeId || undefined,
        );

        const startedAt = Date.now();
        while (Date.now() - startedAt < 1200) {
            await this.delay(120);
            const current = await this.registry.buildSummary(
                deviceId,
                this.devicesDb,
            );
            const scoped = nodeId
                ? this.resolveScopedDetail(current, nodeId)
                : current;
            if (Object.keys(scoped?.controllers || {}).length > 0) {
                return current;
            }
        }

        return this.registry.buildSummary(deviceId, this.devicesDb);
    }

    resolveScopedDetail(detail, nodeId) {
        const key = String(Number(nodeId));
        const scoped =
            detail?.stack_units && typeof detail.stack_units === "object"
                ? detail.stack_units[key]
                : null;
        const node = Array.isArray(detail?.stack?.nodes)
            ? detail.stack.nodes.find(
                  (item) => Number(item?.node_id) === Number(nodeId),
              )
            : null;
        if (!scoped || typeof scoped !== "object") {
            return {
                ...detail,
                name: node?.name || detail.name,
                online:
                    typeof node?.online === "boolean"
                        ? Boolean(node.online)
                        : detail.online,
                system: {},
                controllers: {},
            };
        }
        return {
            ...detail,
            name: node?.name || scoped.name || detail.name,
            online:
                typeof node?.online === "boolean"
                    ? Boolean(node.online)
                    : detail.online,
            system: scoped.system || {},
            controllers: scoped.controllers || {},
            last_event: scoped.last_event ?? detail.last_event,
        };
    }

    helpText(user = null) {
        const username = user?.username
            ? `Пользователь: <b>${escapeHtml(user.username)}</b>\n\n`
            : "";
        return [
            "<b>🤖 PLC Cloud Bot</b>",
            "",
            username.trimEnd(),
            "Навигация как в веб-морде: объект -> устройство -> контроллеры.",
            "",
            "🏘 /objects - список объектов",
            "📟 /devices &lt;объект&gt; - устройства объекта",
            "ℹ️ /status &lt;device_id&gt; - краткий статус устройства",
        ]
            .filter(Boolean)
            .join("\n");
    }

    panelTitle(title, subtitle = "") {
        return [
            `<b>${escapeHtml(title)}</b>`,
            subtitle ? `<code>${escapeHtml(subtitle)}</code>` : "",
        ]
            .filter(Boolean)
            .join("\n");
    }

    describeTelegramUser(user, ctx = null) {
        const username = String(user?.username || "").trim() || "-";
        const plcUsername = String(user?.plc_username || "").trim() || "-";
        const tgUsername =
            String(user?.telegram_username || ctx?.from?.username || "").trim() ||
            "-";
        const chatId =
            String(user?.chat_id || ctx?.from?.id || "").trim() || "-";
        return `${username} plc=${plcUsername} tg=${tgUsername} chat_id=${chatId}`;
    }

    logTelegramAction(ctx, user, action, details = "") {
        logger.info(
            `telegram action: user=${this.describeTelegramUser(user, ctx)} action=${action}${details ? ` ${details}` : ""}`,
        );
    }

    truncateForLog(value, max = 80) {
        const raw = String(value || "").replace(/\s+/g, " ").trim();
        if (raw.length <= max) return raw;
        return `${raw.slice(0, max)}...`;
    }

    pluralize(value, forms) {
        const count = Math.abs(Number(value) || 0) % 100;
        const tail = count % 10;
        if (count > 10 && count < 20) return forms[2];
        if (tail > 1 && tail < 5) return forms[1];
        if (tail === 1) return forms[0];
        return forms[2];
    }

    delay(ms) {
        return new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, Number(ms) || 0)),
        );
    }
}
