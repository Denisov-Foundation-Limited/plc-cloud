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
import { Bot, InlineKeyboard, Keyboard } from "grammy";
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
import { TgThermoMenu } from "./menu/TgThermoMenu.js";
import { TgTankMenu } from "./menu/TgTankMenu.js";
import { TgSepticMenu } from "./menu/TgSepticMenu.js";
import { TgWateringMenu } from "./menu/TgWateringMenu.js";
import { TgCameraMenu } from "./menu/TgCameraMenu.js";
import {
    eventPolicyKey,
    isEventAllowedByPrefs,
} from "../notifications/NotificationCatalog.js";

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
const CALLBACK_DEVICES_BACK_PREFIX = `${CALLBACK_PREFIX}:devices_back:`;
const CALLBACK_CONTROLLER_PREFIX = `${CALLBACK_PREFIX}:controller:`;
const CALLBACK_TOGGLE_PREFIX = `${CALLBACK_PREFIX}:toggle:`;
const CALLBACK_QUICK_PREFIX = `${CALLBACK_PREFIX}:quick:`;
const STACK_SUMMARY_REFRESH_COOLDOWN_MS = 5000;

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
    if (key.includes("камер")) return "📷";
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

function boolLabel(value, yes = "да", no = "нет") {
    return value ? yes : no;
}

function deviceTitle(summary) {
    return escapeHtml(summary?.name || `#${summary?.device_id}`);
}

function objectTitle(summary) {
    return escapeHtml(summary?.object_name || "-");
}

function eventScopeLabel(eventPayload, data) {
    const unit = String(eventPayload?.unit || "").trim().toLowerCase();
    if (unit !== "stack") return "";
    const unitName = String(data?.unit_name || "").trim();
    const nodeId = Number(eventPayload?.node_id || 0);
    return unitName || (nodeId ? `#${nodeId}` : "stack");
}

function eventSourceLabel(summary, eventPayload, data) {
    const sourceName = String(data?.source_name || "").trim();
    if (sourceName) return sourceName;
    const scope = eventScopeLabel(eventPayload, data);
    if (scope) return scope;
    return String(summary?.name || "").trim();
}

function eventItemLabel(data, fallback) {
    const name = String(data?.name || "").trim();
    if (name) return name;
    const id = Number(data?.id || data?.sensor_id || 0);
    if (id > 0 && fallback) return `${fallback} #${id}`;
    return fallback || "элемент";
}

function formatHexId(value) {
    const num = Number(value || 0) >>> 0;
    return `0x${num.toString(16).toUpperCase().padStart(8, "0")}`;
}

function normalizeMenuSelection(value) {
    return String(value || "")
        .replace(/^[^\p{L}\p{N}]+/u, "")
        .replace(/[()]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function menuSelectionIncludes(left, right) {
    const a = normalizeMenuSelection(left);
    const b = normalizeMenuSelection(right);
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a);
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
        this.thermoMenu = new TgThermoMenu({ registry, devicesDb });
        this.tankMenu = new TgTankMenu({ registry, devicesDb });
        this.septicMenu = new TgSepticMenu({ registry, devicesDb });
        this.wateringMenu = new TgWateringMenu({ registry, devicesDb });
        this.cameraMenu = new TgCameraMenu({ registry, devicesDb });
        this.lastSummaryByDevice = new Map();
        this.lastEventSignatureByDevice = new Map();
        this.lastStackSummaryRefreshByScope = new Map();
        this.replyMenuStateByChat = new Map();
        this.replyActionMapByChat = new Map();
        this.lastDeviceScopeByChat = new Map();
        this.lastChat = {
            chat_id: "",
            telegram_username: "",
            seen_at: "",
        };
    }

    setDeviceWs(deviceWs) {
        this.deviceWs = deviceWs;
        this.socketMenu.setDeviceWs(deviceWs);
        this.lightMenu.setDeviceWs(deviceWs);
        this.quickActionMenu.setDeviceWs(deviceWs);
        this.thermoMenu.setDeviceWs(deviceWs);
        this.tankMenu.setDeviceWs(deviceWs);
        this.septicMenu.setDeviceWs(deviceWs);
        this.wateringMenu.setDeviceWs(deviceWs);
        this.cameraMenu.setDeviceWs(deviceWs);
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
            last_chat_id: this.lastChat.chat_id || "",
            last_chat_username: this.lastChat.telegram_username || "",
            last_chat_seen_at: this.lastChat.seen_at || "",
        };
    }

    async notifyDeviceOnline(deviceId, summary = null) {
        if (!this.isEnabled()) return;
        const effectiveSummary =
            summary ||
            (await this.registry.buildSummary(deviceId, this.devicesDb));
        if (!effectiveSummary) return;
        this.lastSummaryByDevice.set(Number(deviceId), effectiveSummary);
        await this.broadcastNotification("online", effectiveSummary, (sanitized) =>
            [
                `📟 Устройство <b>${escapeHtml(sanitized.name || `#${sanitized.device_id}`)}</b> онлайн 🟢`,
                `🏠 Объект: <b>${escapeHtml(sanitized.object_name || "-")}</b>`,
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
        await this.broadcastNotification("offline", summary, (sanitized) =>
            [
                `📟 Устройство <b>${escapeHtml(sanitized.name || `#${sanitized.device_id}`)}</b> оффлайн 🔴`,
                `🏠 Объект: <b>${escapeHtml(sanitized.object_name || "-")}</b>`,
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
        await this.broadcastNotification("event", summary, (sanitized) =>
            this.buildEventNotificationText(sanitized),
        );
    }

    async broadcastNotification(type, summary, textBuilder) {
        if (!this.bot) return;
        const users = await this.usersDb.listUsers();
        const recipients = users.filter((user) => {
            if (!String(user?.chat_id || "").trim()) return false;
            if (!String(user?.plc_username || "").trim()) return false;
            if (type === "online" && !Boolean(user?.telegram_notify_online))
                return false;
            if (type === "offline" && !Boolean(user?.telegram_notify_offline))
                return false;
            if (type === "event" && !Boolean(user?.telegram_notify_events))
                return false;
            if (
                type === "event" &&
                !isEventAllowedByPrefs(summary?.last_event, user?.notification_prefs)
            ) {
                return false;
            }
            return Boolean(
                sanitizeSummaryForSession(summary, {
                    plc_username: user.plc_username,
                }),
            );
        });
        const eventDetails = this.describeNotificationEvent(summary, type);
        logger.info(
            [
                "telegram notification:",
                `type: ${type}`,
                `device_id: ${Number(summary?.device_id || 0) || "-"}`,
                `device: ${safeText(summary?.name || `#${summary?.device_id}`)}`,
                `object: ${safeText(summary?.object_name)}`,
                `recipients: ${recipients.length}`,
                ...eventDetails,
            ].join(" "),
        );
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
                .then(() => {
                    logger.info(
                        `telegram notification sent: type: ${type} recipient: ${this.describeTelegramUser(user)} device_id: ${Number(summary?.device_id || 0) || "-"}`,
                    );
                })
                .catch((err) => {
                    logger.warn(
                        `telegram notification failed: type: ${type} recipient: ${this.describeTelegramUser(user)} error: ${err?.message || "unknown_error"}`,
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
        const header = [
            `📟 Устройство: <b>${deviceTitle(summary)}</b>`,
            `🏠 Объект: <b>${objectTitle(summary)}</b>`,
        ];

        let title = "";

        if (kind === "sockets.state" || kind === "lights.state") {
            const item = eventItemLabel(
                data,
                kind === "lights.state" ? "Свет" : "Розетка",
            );
            const state = data.state ? "включен" : "выключен";
            const icon = kind === "lights.state"
                ? data.state ? "💡" : "🌑"
                : data.state ? "🔌" : "🔌";
            title = `${icon} <b>${escapeHtml(item)}</b> ${state}`;
        } else if (kind === "meteo.sensor") {
            const item = eventItemLabel(data, "Датчик");
            title =
                reason === "alarm"
                    ? `⚠️ Ошибка датчика <b>${escapeHtml(item)}</b>`
                    : `✅ Датчик <b>${escapeHtml(item)}</b> восстановлен`;
        } else if (kind === "thermo.power") {
            const item = eventItemLabel(data, "Термостат");
            title = `${data.power_on ? "🌡️" : "⏹️"} Термостат <b>${escapeHtml(item)}</b> ${data.power_on ? "включен" : "выключен"}`;
        } else if (kind === "tanks.level") {
            const item = eventItemLabel(data, "Бак");
            title =
                reason === "empty" || data.empty
                    ? `🛢️ Бак <b>${escapeHtml(item)}</b> пуст`
                    : `🛢️ Состояние бака <b>${escapeHtml(item)}</b> изменилось`;
        } else if (kind === "septic.level") {
            const item = eventItemLabel(data, "Септик");
            title =
                reason === "alarm" || data.alarm
                    ? `🚨 Тревога септика <b>${escapeHtml(item)}</b>`
                    : `🚰 Предупреждение септика <b>${escapeHtml(item)}</b>`;
        } else if (kind === "security.arm") {
            title = `${data.armed ? "🔐" : "🔓"} Охрана ${data.armed ? "включена" : "снята"}`;
        } else if (kind === "security.alarm") {
            title =
                reason === "alarm" || data.alarm_on
                    ? "🚨 Охранная тревога"
                    : "✅ Охранная тревога сброшена";
        } else if (kind === "security.detect") {
            const item = eventItemLabel(data, "Датчик");
            if (reason === "clear") {
                title = "✅ Сработки охраны очищены";
            } else if (reason === "silent" || data.silent) {
                title = `🕵️ Тихое срабатывание <b>${escapeHtml(item)}</b>`;
            } else {
                title = `🚨 Сработка охраны: <b>${escapeHtml(item)}</b>`;
            }
        } else if (kind === "watering.rule") {
            const item = eventItemLabel(data, "Правило");
            const actions = {
                start: "запущен",
                pause_empty: "поставлен на паузу из-за пустого бака",
                resume: "возобновлен",
                stop: "остановлен",
                stop_empty: "остановлен из-за пустого бака",
                stop_done: "завершён",
            };
            const icon =
                reason === "start" ? "💧"
                : reason === "resume" ? "▶️"
                : reason === "pause_empty" ? "⏸️"
                : reason === "stop_done" ? "✅"
                : reason === "stop_empty" ? "🛑"
                : "🚿";
            title = `${icon} Полив <b>${escapeHtml(item)}</b> ${actions[reason] || "изменился"}`;
        } else if (kind === "ring.hold") {
            title = `${reason === "start" || data.hold_on ? "🔔" : "🔕"} Звонок ${reason === "start" || data.hold_on ? "включен" : "выключен"}`;
        } else if (kind === "avr.main") {
            title =
                reason === "lost"
                    ? "🔴 Основной ввод пропал"
                    : reason === "restored"
                      ? "🟢 Основной ввод восстановлен"
                      : "⚙️ Состояние основного ввода изменилось";
        } else if (kind === "avr.source") {
            const source = String(data.active_source || "").trim();
            title = source
                ? `🔀 АВР переключен на <b>${escapeHtml(source)}</b>`
                : "🔀 АВР переключил источник";
        } else if (kind === "avr.fault") {
            const fault = String(data.fault || "").trim();
            title = fault && fault !== "none"
                ? `🚨 Ошибка АВР: <b>${escapeHtml(fault)}</b>`
                : "✅ Ошибка АВР очищена";
        } else if (kind === "leak.zone") {
            const item = eventItemLabel(data, "Зона");
            title =
                reason === "detect" || data.wet
                    ? `💦 Протечка: <b>${escapeHtml(item)}</b>`
                    : `✅ Протечка подтверждена: <b>${escapeHtml(item)}</b>`;
        } else if (kind === "rules.trigger") {
            const ruleName = String(data.rule_name || "").trim();
            title = ruleName
                ? `📜 Сработало правило <b>${escapeHtml(ruleName)}</b>`
                : "📜 Сработало правило";
        } else if (kind === "stack.node") {
            const unitName = String(data.unit_name || "").trim();
            title = `🧩 Узел <b>${escapeHtml(unitName || "stack")}</b> ${data.online ? "онлайн 🟢" : "оффлайн 🔴"}`;
        }

        if (title) {
            const lines = [title, ...header];
            const extras = [];
            if (kind === "avr.source") {
                if (data.main_ok !== undefined)
                    extras.push(`🔌 Основной ввод: <b>${escapeHtml(boolLabel(data.main_ok, "OK", "нет"))}</b>`);
                if (data.reserve_ok !== undefined)
                    extras.push(`🔋 Резервный ввод: <b>${escapeHtml(boolLabel(data.reserve_ok, "OK", "нет"))}</b>`);
            } else if (kind === "security.detect" && data.silent !== undefined) {
                extras.push(`🕵️ Тихий режим: <b>${escapeHtml(boolLabel(data.silent, "да", "нет"))}</b>`);
            }
            if (extras.length) {
                lines.push("");
                lines.push(...extras);
            }
            return lines.join("\n");
        }

        const lines = [
            `🔔 Событие на <b>${deviceTitle(summary)}</b>`,
            `🏠 Объект: <b>${objectTitle(summary)}</b>`,
            `🏷️ Тип: <b>${escapeHtml(kind)}</b>`,
        ];
        if (reason) lines.push(`📌 Причина: <b>${escapeHtml(reason)}</b>`);
        const details = [];
        for (const [key, value] of Object.entries(data).slice(0, 6)) {
            if (value && typeof value === "object") continue;
            details.push(`▫️ ${escapeHtml(key)}: <b>${escapeHtml(value)}</b>`);
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
        this.bot.use(async (ctx, next) => {
            this.rememberLastChat(ctx);
            await next();
        });

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
                `object: ${objectName || "-"}`,
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
                `device_id: ${Number.isFinite(deviceId) ? deviceId : "-"}`,
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

            if (await this.handleReplyKeyboardSelection(ctx, text, user)) {
                return;
            }
            if (await this.handleGlobalTextSelection(ctx, text, user)) {
                return;
            }

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
                    "<b>Future City PLC</b>",
                    "",
                    "Это Telegram-бот PLC Cloud для просмотра объектов, устройств и управления контроллерами.",
                    "",
                    "Здесь можно открыть нужный объект, перейти к устройствам и дальше управлять розетками, светом, термостатами, баками, септиком и другими модулями.",
                    "",
                    "Выбери объект ниже.",
                ].join("\n"),
                this.buildObjectsReplyKeyboard(
                    await this.listTelegramObjects(user),
                ),
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
                    `index: ${objectIndex} object: ${objectName || "-"}`,
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
            new RegExp(`^${CALLBACK_DEVICES_BACK_PREFIX}(.+)$`),
            async (ctx) => {
                await ctx.answerCallbackQuery();
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const objectName = decodeURIComponent(
                    String(Array.isArray(ctx.match) ? ctx.match[1] : ""),
                ).trim();
                this.logTelegramAction(
                    ctx,
                    user,
                    "callback_devices_back",
                    `object: ${objectName || "-"}`,
                );
                if (!objectName) {
                    await this.sendObjectsList(ctx, "", user);
                    return;
                }
                await this.sendDevicesList(ctx, objectName, user);
            },
        );

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
                    `device_id: ${deviceId} node_id: ${nodeId || 0}`,
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
                `^${CALLBACK_CONTROLLER_PREFIX}(\\d+):(\\d+):(sockets|lights|meteo|thermo|tanks|septic|watering|cameras)$`,
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
                    `device_id: ${deviceId} node_id: ${nodeId || 0} controller: ${controller}`,
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
                if (controller === "thermo") {
                    await this.thermoMenu.open(ctx, {
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
                if (controller === "tanks") {
                    await this.tankMenu.open(ctx, {
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
                if (controller === "septic") {
                    await this.septicMenu.open(ctx, {
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
                if (controller === "watering") {
                    await this.wateringMenu.open(ctx, {
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
                if (controller === "cameras") {
                    await this.cameraMenu.open(ctx, {
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
            new RegExp(`^menu:camera:snapshot:(\\d+):(\\d+):(\\d+)$`),
            async (ctx) => {
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const deviceId = Number(
                    Array.isArray(ctx.match) ? ctx.match[1] : "",
                );
                const nodeId = Number(
                    Array.isArray(ctx.match) ? ctx.match[2] : "",
                );
                const cameraId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "camera_snapshot",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} camera_id: ${cameraId}`,
                );
                await this.cameraMenu.snapshot(ctx, {
                    deviceId,
                    nodeId: nodeId > 0 ? nodeId : null,
                    cameraId,
                    user,
                    getScopedDetail: this.getScopedTelegramDetail.bind(this),
                    replyMenu: this.replyMenu.bind(this),
                    mainMenuCallbackData: CALLBACK_MAIN,
                    controllersCallbackData: (nextDeviceId, nextNodeId) =>
                        `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
                    buildPublicUrl: this.buildPublicUrl.bind(this),
                });
            },
        );

        this.bot.callbackQuery(
            new RegExp(`^menu:watering:view:(\\d+):(\\d+):(\\d+)$`),
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
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "open_watering_item",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} id: ${itemId}`,
                );
                await this.wateringMenu.openItem(ctx, {
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
            new RegExp(`^menu:watering:slot:(\\d+):(\\d+):(\\d+):(\\d+)$`),
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
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                const slot = Number(
                    Array.isArray(ctx.match) ? ctx.match[4] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "open_watering_slot",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} id: ${itemId} slot: ${slot}`,
                );
                await this.wateringMenu.openSlotEditor(ctx, {
                    deviceId,
                    nodeId: nodeId > 0 ? nodeId : null,
                    itemId,
                    slot,
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
            new RegExp(`^menu:watering:status:(\\d+):(\\d+):(\\d+)$`),
            async (ctx) => {
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const deviceId = Number(
                    Array.isArray(ctx.match) ? ctx.match[1] : "",
                );
                const nodeId = Number(
                    Array.isArray(ctx.match) ? ctx.match[2] : "",
                );
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "watering_status_toggle",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} id: ${itemId}`,
                );
                await this.wateringMenu.toggleStatus(ctx, {
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
            new RegExp(`^menu:watering:day:(\\d+):(\\d+):(\\d+):(\\d+)$`),
            async (ctx) => {
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const deviceId = Number(
                    Array.isArray(ctx.match) ? ctx.match[1] : "",
                );
                const nodeId = Number(
                    Array.isArray(ctx.match) ? ctx.match[2] : "",
                );
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                const bit = Number(
                    Array.isArray(ctx.match) ? ctx.match[4] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "watering_weekday_toggle",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} id: ${itemId} bit: ${bit}`,
                );
                await this.wateringMenu.toggleWeekday(ctx, {
                    deviceId,
                    nodeId: nodeId > 0 ? nodeId : null,
                    itemId,
                    bit,
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
                `^menu:watering:time:(\\d+):(\\d+):(\\d+):(\\d+):(-?\\d+):(-?\\d+)$`,
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
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                const slot = Number(
                    Array.isArray(ctx.match) ? ctx.match[4] : "",
                );
                const hourDelta = Number(
                    Array.isArray(ctx.match) ? ctx.match[5] : "",
                );
                const minuteDelta = Number(
                    Array.isArray(ctx.match) ? ctx.match[6] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "watering_time_adjust",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} id: ${itemId} slot: ${slot} dh: ${hourDelta} dm: ${minuteDelta}`,
                );
                await this.wateringMenu.adjustTime(ctx, {
                    deviceId,
                    nodeId: nodeId > 0 ? nodeId : null,
                    itemId,
                    slot,
                    hourDelta,
                    minuteDelta,
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
                `^menu:watering:duration:(\\d+):(\\d+):(\\d+):(\\d+):(-?\\d+)$`,
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
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                const slot = Number(
                    Array.isArray(ctx.match) ? ctx.match[4] : "",
                );
                const deltaMinutes = Number(
                    Array.isArray(ctx.match) ? ctx.match[5] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "watering_duration_adjust",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} id: ${itemId} slot: ${slot} delta: ${deltaMinutes}`,
                );
                await this.wateringMenu.adjustDuration(ctx, {
                    deviceId,
                    nodeId: nodeId > 0 ? nodeId : null,
                    itemId,
                    slot,
                    deltaMinutes,
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
            new RegExp(`^menu:septic:view:(\\d+):(\\d+):(\\d+)$`),
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
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "open_septic_item",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} id: ${itemId}`,
                );
                await this.septicMenu.openItem(ctx, {
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
            new RegExp(`^menu:septic:monitor:(\\d+):(\\d+):(\\d+)$`),
            async (ctx) => {
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const deviceId = Number(
                    Array.isArray(ctx.match) ? ctx.match[1] : "",
                );
                const nodeId = Number(
                    Array.isArray(ctx.match) ? ctx.match[2] : "",
                );
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "septic_monitor_toggle",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} id: ${itemId}`,
                );
                await this.septicMenu.toggleMonitor(ctx, {
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
            new RegExp(`^menu:tanks:view:(\\d+):(\\d+):(\\d+)$`),
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
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "open_tank_item",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} id: ${itemId}`,
                );
                await this.tankMenu.openItem(ctx, {
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
            new RegExp(`^menu:tanks:power:(\\d+):(\\d+):(\\d+)$`),
            async (ctx) => {
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const deviceId = Number(
                    Array.isArray(ctx.match) ? ctx.match[1] : "",
                );
                const nodeId = Number(
                    Array.isArray(ctx.match) ? ctx.match[2] : "",
                );
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "tank_power_toggle",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} id: ${itemId}`,
                );
                await this.tankMenu.togglePower(ctx, {
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
            new RegExp(`^menu:thermo:view:(\\d+):(\\d+):(\\d+)$`),
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
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "open_thermo_item",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} id: ${itemId}`,
                );
                await this.thermoMenu.openItem(ctx, {
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
            new RegExp(`^menu:thermo:power:(\\d+):(\\d+):(\\d+)$`),
            async (ctx) => {
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const deviceId = Number(
                    Array.isArray(ctx.match) ? ctx.match[1] : "",
                );
                const nodeId = Number(
                    Array.isArray(ctx.match) ? ctx.match[2] : "",
                );
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "thermo_power_toggle",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} id: ${itemId}`,
                );
                await this.thermoMenu.togglePower(ctx, {
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
            new RegExp(`^menu:thermo:mode:(\\d+):(\\d+):(\\d+)$`),
            async (ctx) => {
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const deviceId = Number(
                    Array.isArray(ctx.match) ? ctx.match[1] : "",
                );
                const nodeId = Number(
                    Array.isArray(ctx.match) ? ctx.match[2] : "",
                );
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "thermo_mode_cycle",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} id: ${itemId}`,
                );
                await this.thermoMenu.cycleMode(ctx, {
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
            new RegExp(`^menu:thermo:target:(\\d+):(\\d+):(\\d+):(-?\\d+)$`),
            async (ctx) => {
                const user = await this.requireLinkedUser(ctx);
                if (!user) return;
                const deviceId = Number(
                    Array.isArray(ctx.match) ? ctx.match[1] : "",
                );
                const nodeId = Number(
                    Array.isArray(ctx.match) ? ctx.match[2] : "",
                );
                const itemId = Number(
                    Array.isArray(ctx.match) ? ctx.match[3] : "",
                );
                const deltaTenths = Number(
                    Array.isArray(ctx.match) ? ctx.match[4] : "",
                );
                this.logTelegramAction(
                    ctx,
                    user,
                    "thermo_target_adjust",
                    `device_id: ${deviceId} node_id: ${nodeId || 0} id: ${itemId} delta: ${deltaTenths}`,
                );
                await this.thermoMenu.adjustTarget(ctx, {
                    deviceId,
                    nodeId: nodeId > 0 ? nodeId : null,
                    itemId,
                    delta: deltaTenths / 10,
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
                    `device_id: ${deviceId} node_id: ${nodeId || 0} controller: ${controller} id: ${itemId}`,
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
                    `device_id: ${deviceId} node_id: ${nodeId || 0} controller: ${controller} state: ${state}`,
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
                    `device_id: ${deviceId} node_id: ${nodeId || 0} preset: ${preset}`,
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
            `telegram access denied: tg: ${telegramUsername || "-"} chat_id: ${chatId || "-"}`,
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
            this.setReplyMenuState(ctx, null);
            await this.replyMenu(ctx, "Объекты не найдены.");
            return;
        }
        this.setReplyMenuState(ctx, {
            kind: "objects",
            items: objects.map((item) => ({
                label: `${objectIcon(item)} ${objectLabel(item)}`,
                object_name: objectLabel(item),
                match_key: normalizeMenuSelection(objectLabel(item)),
            })),
        });
        const lines = objects.map((item) => {
            const label = objectLabel(item);
            return `${objectIcon(item)} ${label}`;
        });
        const intro = leadText ? `${escapeHtml(leadText)}\n\n` : "";
        await this.replyMenu(
            ctx,
            [
                intro.trimEnd(),
                this.panelTitle("🏘 Объекты"),
                lines.map(escapeHtml).join("\n"),
                `━━━━━━━━━━━━━━━━━\nВсего: ${objects.length}`,
            ]
                .filter(Boolean)
                .join("\n\n"),
            this.buildObjectsReplyKeyboard(objects),
        );
    }

    async sendDevicesList(ctx, objectName = "", user = null) {
        const args = String(objectName || "").trim();
        const devices = await this.listTelegramDevices(args, user || {});
        if (!devices.length) {
            this.setReplyMenuState(ctx, null);
            const text = args
                ? `Для объекта "${escapeHtml(args)}" устройства не найдены.`
                : "Устройства не найдены.";
            await this.replyMenu(
                ctx,
                text,
                this.buildReplyKeyboard([["⬅️ Назад"]]),
            );
            return;
        }
        this.setReplyMenuState(ctx, {
            kind: "devices",
            object_name: args,
            device_id: devices.length === 1 ? Number(devices[0].device_id) : NaN,
            node_id: devices.length === 1 ? Number(devices[0].node_id || 0) : 0,
            items: devices.map((item) => ({
                label: item.button_label,
                device_id: Number(item.device_id),
                node_id: Number(item.node_id || 0),
                match_key: normalizeMenuSelection(item.button_label),
            })),
        });
        const lines = devices.map((item) => {
            return item.label;
        });
        await this.replyMenu(
            ctx,
            [
                this.panelTitle(args ? `📟 ${safeText(args)}` : "📟 Устройства"),
                lines.map(escapeHtml).join("\n"),
                `━━━━━━━━━━━━━━━━━\nВсего: ${devices.length}`,
            ].join("\n\n"),
            this.buildDevicesReplyKeyboard(devices),
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
        const replyActionMap = this.extractReplyActionMap(keyboard);
        if (replyActionMap) {
            keyboard = this.buildReplyKeyboardFromActionMap(replyActionMap);
            this.setReplyActionMap(ctx, replyActionMap);
        } else {
            this.setReplyActionMap(ctx, null);
        }
        const options = { parse_mode: "HTML", ...extraOptions };
        if (keyboard) options.reply_markup = keyboard;
        const callbackMessage = ctx?.callbackQuery?.message || null;
        const canEdit =
            Boolean(callbackMessage?.chat?.id) &&
            Number.isFinite(Number(callbackMessage?.message_id));
        if (canEdit && !replyActionMap) {
            try {
                await ctx.api.editMessageText(
                    callbackMessage.chat.id,
                    callbackMessage.message_id,
                    text,
                    options,
                );
                return;
            } catch (err) {
                const message = String(err?.message || "").toLowerCase();
                const harmless =
                    message.includes("message is not modified") ||
                    message.includes("there is no text in the message to edit");
                if (!harmless) {
                    logger.warn(
                        `telegram edit menu failed: ${err?.message || "unknown_error"}`,
                    );
                }
            }
        }
        await ctx.reply(text, options);
    }

    getChatId(ctx) {
        const directId = ctx?.chat?.id;
        if (Number.isFinite(Number(directId))) {
            return String(directId);
        }
        const callbackId = ctx?.callbackQuery?.message?.chat?.id;
        if (Number.isFinite(Number(callbackId))) {
            return String(callbackId);
        }
        return "";
    }

    setReplyMenuState(ctx, state = null) {
        const chatId = this.getChatId(ctx);
        if (!chatId) return;
        if (!state) {
            this.replyMenuStateByChat.delete(chatId);
            return;
        }
        this.replyMenuStateByChat.set(chatId, state);
        if (
            Number.isFinite(Number(state.device_id)) &&
            (state.kind === "controllers" || state.kind === "devices")
        ) {
            this.lastDeviceScopeByChat.set(chatId, {
                device_id: Number(state.device_id),
                node_id: Number(state.node_id || 0),
                object_name: String(state.object_name || "").trim(),
            });
        }
    }

    getReplyMenuState(ctx) {
        const chatId = this.getChatId(ctx);
        if (!chatId) return null;
        return this.replyMenuStateByChat.get(chatId) || null;
    }

    setReplyActionMap(ctx, actionMap = null) {
        const chatId = this.getChatId(ctx);
        if (!chatId) return;
        if (!actionMap || !actionMap.length) {
            this.replyActionMapByChat.delete(chatId);
            return;
        }
        this.replyActionMapByChat.set(chatId, actionMap);
    }

    getReplyActionMap(ctx) {
        const chatId = this.getChatId(ctx);
        if (!chatId) return [];
        return this.replyActionMapByChat.get(chatId) || [];
    }

    getLastDeviceScope(ctx) {
        const chatId = this.getChatId(ctx);
        if (!chatId) return null;
        return this.lastDeviceScopeByChat.get(chatId) || null;
    }

    buildReplyKeyboard(rows = []) {
        const keyboard = new Keyboard().resized();
        rows.forEach((row) => {
            if (!Array.isArray(row) || !row.length) return;
            keyboard.row(...row.filter(Boolean).map((value) => String(value)));
        });
        return keyboard;
    }

    extractReplyActionMap(keyboard) {
        const rows = Array.isArray(keyboard?.inline_keyboard)
            ? keyboard.inline_keyboard
            : null;
        if (!rows?.length) return null;
        const actionRows = rows
            .map((row) =>
                Array.isArray(row)
                    ? row
                          .map((button) => ({
                              label: String(button?.text || "").trim(),
                              data: String(button?.callback_data || "").trim(),
                          }))
                          .filter((button) => button.label && button.data)
                    : [],
            )
            .filter((row) => row.length > 0);
        return actionRows.length ? actionRows : null;
    }

    buildReplyKeyboardFromActionMap(actionMap = []) {
        return this.buildReplyKeyboard(
            actionMap.map((row) => row.map((button) => button.label)),
        );
    }

    buildDevicesBackCallbackData(objectName = "") {
        return `${CALLBACK_DEVICES_BACK_PREFIX}${encodeURIComponent(
            String(objectName || "").trim(),
        )}`;
    }

    buildMainMenuKeyboard() {
        return new InlineKeyboard()
            .text("🏘 К началу", CALLBACK_MAIN)
            .text("📟 Все устройства", CALLBACK_DEVICES);
    }

    buildObjectsReplyKeyboard(objects) {
        return this.buildReplyKeyboard(
            objects.map((item) => [`${objectIcon(item)} ${objectLabel(item)}`]),
        );
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
        return keyboard;
    }

    buildDevicesReplyKeyboard(devices) {
        const rows = devices.map((device) => [device.button_label]);
        rows.push(["⬅️ Назад"]);
        return this.buildReplyKeyboard(rows);
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
            keyboard.text("⬅️ Назад", CALLBACK_OBJECTS_BACK);
            return keyboard;
        }
        return keyboard;
    }

    buildControllersReplyKeyboard(detail, controllerCards = []) {
        const rows = [];
        for (let index = 0; index < controllerCards.length; index += 2) {
            const left = controllerCards[index];
            const right = controllerCards[index + 1] || null;
            rows.push(
                [
                    left ? `${controllerIcon(left.title)} ${left.title}` : "",
                    right ? `${controllerIcon(right.title)} ${right.title}` : "",
                ].filter(Boolean),
            );
        }
        if (
            detail?.access?.controllers?.quick_actions?.write !== false &&
            this.quickActionMenu.items().length >= 3
        ) {
            const quickItems = this.quickActionMenu.items();
            rows.unshift(quickItems.map((item) => item.label));
        }
        rows.push(["⬅️ Назад"]);
        return this.buildReplyKeyboard(rows);
    }

    controllerKeyByTitle(title) {
        const normalized = String(title || "").trim().toLowerCase();
        if (normalized === "розетки") return "sockets";
        if (normalized === "освещение") return "lights";
        if (normalized === "метео") return "meteo";
        if (normalized === "термостаты") return "thermo";
        if (normalized === "баки") return "tanks";
        if (normalized === "септик") return "septic";
        if (normalized === "полив") return "watering";
        if (normalized === "камеры") return "cameras";
        return "";
    }

    async openControllerByKey(ctx, controller, deviceId, nodeId, user) {
        const effectiveNodeId = nodeId > 0 ? nodeId : null;
        if (controller === "sockets") {
            await this.socketMenu.open(ctx, {
                deviceId,
                nodeId: effectiveNodeId,
                user,
                getScopedDetail: this.getScopedTelegramDetail.bind(this),
                replyMenu: this.replyMenu.bind(this),
                mainMenuCallbackData: CALLBACK_MAIN,
                controllersCallbackData: (nextDeviceId, nextNodeId) =>
                    `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
            });
            return true;
        }
        if (controller === "lights") {
            await this.lightMenu.open(ctx, {
                deviceId,
                nodeId: effectiveNodeId,
                user,
                getScopedDetail: this.getScopedTelegramDetail.bind(this),
                replyMenu: this.replyMenu.bind(this),
                mainMenuCallbackData: CALLBACK_MAIN,
                controllersCallbackData: (nextDeviceId, nextNodeId) =>
                    `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
            });
            return true;
        }
        if (controller === "meteo") {
            await this.meteoMenu.open(ctx, {
                deviceId,
                nodeId: effectiveNodeId,
                user,
                getScopedDetail: this.getScopedTelegramDetail.bind(this),
                replyMenu: this.replyMenu.bind(this),
                mainMenuCallbackData: CALLBACK_MAIN,
                controllersCallbackData: (nextDeviceId, nextNodeId) =>
                    `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
            });
            return true;
        }
        if (controller === "thermo") {
            await this.thermoMenu.open(ctx, {
                deviceId,
                nodeId: effectiveNodeId,
                user,
                getScopedDetail: this.getScopedTelegramDetail.bind(this),
                replyMenu: this.replyMenu.bind(this),
                mainMenuCallbackData: CALLBACK_MAIN,
                controllersCallbackData: (nextDeviceId, nextNodeId) =>
                    `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
            });
            return true;
        }
        if (controller === "tanks") {
            await this.tankMenu.open(ctx, {
                deviceId,
                nodeId: effectiveNodeId,
                user,
                getScopedDetail: this.getScopedTelegramDetail.bind(this),
                replyMenu: this.replyMenu.bind(this),
                mainMenuCallbackData: CALLBACK_MAIN,
                controllersCallbackData: (nextDeviceId, nextNodeId) =>
                    `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
            });
            return true;
        }
        if (controller === "septic") {
            await this.septicMenu.open(ctx, {
                deviceId,
                nodeId: effectiveNodeId,
                user,
                getScopedDetail: this.getScopedTelegramDetail.bind(this),
                replyMenu: this.replyMenu.bind(this),
                mainMenuCallbackData: CALLBACK_MAIN,
                controllersCallbackData: (nextDeviceId, nextNodeId) =>
                    `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
            });
            return true;
        }
        if (controller === "watering") {
            await this.wateringMenu.open(ctx, {
                deviceId,
                nodeId: effectiveNodeId,
                user,
                getScopedDetail: this.getScopedTelegramDetail.bind(this),
                replyMenu: this.replyMenu.bind(this),
                mainMenuCallbackData: CALLBACK_MAIN,
                controllersCallbackData: (nextDeviceId, nextNodeId) =>
                    `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
            });
            return true;
        }
        if (controller === "cameras") {
            await this.cameraMenu.open(ctx, {
                deviceId,
                nodeId: effectiveNodeId,
                user,
                getScopedDetail: this.getScopedTelegramDetail.bind(this),
                replyMenu: this.replyMenu.bind(this),
                mainMenuCallbackData: CALLBACK_MAIN,
                controllersCallbackData: (nextDeviceId, nextNodeId) =>
                    `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
            });
            return true;
        }
        return false;
    }

    withTextActionContext(ctx) {
        if (typeof ctx?.answerCallbackQuery === "function") {
            return ctx;
        }
        return {
            ...ctx,
            answerCallbackQuery: async () => {},
        };
    }

    controllerMenuOptions(user) {
        return {
            getScopedDetail: this.getScopedTelegramDetail.bind(this),
            replyMenu: this.replyMenu.bind(this),
            mainMenuCallbackData: CALLBACK_MAIN,
            controllersCallbackData: (nextDeviceId, nextNodeId) =>
                `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
            user,
        };
    }

    async dispatchReplyAction(ctx, data, user) {
        const actionCtx = this.withTextActionContext(ctx);
        const value = String(data || "").trim();
        if (!value) return false;

        if (value === CALLBACK_MAIN) {
            await this.sendObjectsList(actionCtx, "", user);
            return true;
        }
        if (value === CALLBACK_OBJECTS || value === CALLBACK_OBJECTS_BACK) {
            await this.sendObjectsList(actionCtx, "", user);
            return true;
        }
        if (value === CALLBACK_DEVICES) {
            await this.sendObjectsList(
                actionCtx,
                "Выбери объект, чтобы открыть список устройств.",
                user,
            );
            return true;
        }
        {
            const match = value.match(
                new RegExp(`^${CALLBACK_DEVICES_BACK_PREFIX}(.+)$`),
            );
            if (match) {
                const objectName = decodeURIComponent(String(match[1] || "")).trim();
                if (!objectName) {
                    await this.sendObjectsList(actionCtx, "", user);
                    return true;
                }
                await this.sendDevicesList(actionCtx, objectName, user);
                return true;
            }
        }
        {
            const match = value.match(
                new RegExp(`^${CALLBACK_DEVICE_PREFIX}(\\d+):(\\d+)$`),
            );
            if (match) {
                const deviceId = Number(match[1]);
                const nodeId = Number(match[2]);
                await this.sendControllersList(
                    actionCtx,
                    deviceId,
                    nodeId > 0 ? nodeId : null,
                    user,
                );
                return true;
            }
        }
        {
            const match = value.match(
                new RegExp(
                    `^${CALLBACK_CONTROLLER_PREFIX}(\\d+):(\\d+):(sockets|lights|meteo|thermo|tanks|septic|watering|cameras)$`,
                ),
            );
            if (match) {
                return await this.openControllerByKey(
                    actionCtx,
                    String(match[3]),
                    Number(match[1]),
                    Number(match[2]),
                    user,
                );
            }
        }
        {
            const match = value.match(/^menu:camera:snapshot:(\d+):(\d+):(\d+)$/);
            if (match) {
                await this.cameraMenu.snapshot(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    cameraId: Number(match[3]),
                    user,
                    getScopedDetail: this.getScopedTelegramDetail.bind(this),
                    replyMenu: this.replyMenu.bind(this),
                    mainMenuCallbackData: CALLBACK_MAIN,
                    controllersCallbackData: (nextDeviceId, nextNodeId) =>
                        `${CALLBACK_DEVICE_PREFIX}${Number(nextDeviceId)}:${Number(nextNodeId || 0)}`,
                    buildPublicUrl: this.buildPublicUrl.bind(this),
                });
                return true;
            }
        }
        {
            const match = value.match(
                new RegExp(`^${CALLBACK_TOGGLE_PREFIX}(\\d+):(\\d+):(sockets|lights):(\\d+)$`),
            );
            if (match) {
                const deviceId = Number(match[1]);
                const nodeId = Number(match[2]);
                const controller = String(match[3]);
                const itemId = Number(match[4]);
                const options = this.controllerMenuOptions(user);
                if (controller === "sockets") {
                    await this.socketMenu.toggle(actionCtx, {
                        deviceId,
                        nodeId: nodeId > 0 ? nodeId : null,
                        itemId,
                        ...options,
                    });
                    return true;
                }
                await this.lightMenu.toggle(actionCtx, {
                    deviceId,
                    nodeId: nodeId > 0 ? nodeId : null,
                    itemId,
                    ...options,
                });
                return true;
            }
        }
        {
            const match = value.match(
                /^menu:setall:(\d+):(\d+):(sockets|lights):(on|off)$/,
            );
            if (match) {
                const deviceId = Number(match[1]);
                const nodeId = Number(match[2]);
                const controller = String(match[3]);
                const state = String(match[4]);
                const options = this.controllerMenuOptions(user);
                if (controller === "sockets") {
                    await this.socketMenu.setAll(actionCtx, {
                        deviceId,
                        nodeId: nodeId > 0 ? nodeId : null,
                        state,
                        ...options,
                    });
                    return true;
                }
                await this.lightMenu.setAll(actionCtx, {
                    deviceId,
                    nodeId: nodeId > 0 ? nodeId : null,
                    state,
                    ...options,
                });
                return true;
            }
        }
        {
            const match = value.match(
                new RegExp(`^${CALLBACK_QUICK_PREFIX}(\\d+):(\\d+):(home|prepare|away)$`),
            );
            if (match) {
                await this.quickActionMenu.run(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    actionKey: String(match[3]),
                    user,
                    replyMenu: this.replyMenu.bind(this),
                    refreshControllers: async () => {
                        await this.sendControllersList(
                            actionCtx,
                            Number(match[1]),
                            Number(match[2]) > 0 ? Number(match[2]) : null,
                            user,
                        );
                    },
                });
                return true;
            }
        }
        {
            const match = value.match(/^menu:thermo:view:(\d+):(\d+):(\d+)$/);
            if (match) {
                await this.thermoMenu.openItem(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    itemId: Number(match[3]),
                    ...this.controllerMenuOptions(user),
                });
                return true;
            }
        }
        {
            const match = value.match(/^menu:thermo:power:(\d+):(\d+):(\d+)$/);
            if (match) {
                await this.thermoMenu.togglePower(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    itemId: Number(match[3]),
                    ...this.controllerMenuOptions(user),
                });
                return true;
            }
        }
        {
            const match = value.match(/^menu:thermo:mode:(\d+):(\d+):(\d+)$/);
            if (match) {
                await this.thermoMenu.cycleMode(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    itemId: Number(match[3]),
                    ...this.controllerMenuOptions(user),
                });
                return true;
            }
        }
        {
            const match = value.match(/^menu:thermo:target:(\d+):(\d+):(\d+):(-?\d+)$/);
            if (match) {
                await this.thermoMenu.adjustTarget(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    itemId: Number(match[3]),
                    delta: Number(match[4]) / 10,
                    ...this.controllerMenuOptions(user),
                });
                return true;
            }
        }
        {
            const match = value.match(/^menu:tanks:view:(\d+):(\d+):(\d+)$/);
            if (match) {
                await this.tankMenu.openItem(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    itemId: Number(match[3]),
                    ...this.controllerMenuOptions(user),
                });
                return true;
            }
        }
        {
            const match = value.match(/^menu:tanks:power:(\d+):(\d+):(\d+)$/);
            if (match) {
                await this.tankMenu.togglePower(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    itemId: Number(match[3]),
                    ...this.controllerMenuOptions(user),
                });
                return true;
            }
        }
        {
            const match = value.match(/^menu:septic:view:(\d+):(\d+):(\d+)$/);
            if (match) {
                await this.septicMenu.openItem(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    itemId: Number(match[3]),
                    ...this.controllerMenuOptions(user),
                });
                return true;
            }
        }
        {
            const match = value.match(/^menu:septic:monitor:(\d+):(\d+):(\d+)$/);
            if (match) {
                await this.septicMenu.toggleMonitor(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    itemId: Number(match[3]),
                    ...this.controllerMenuOptions(user),
                });
                return true;
            }
        }
        {
            const match = value.match(/^menu:watering:view:(\d+):(\d+):(\d+)$/);
            if (match) {
                await this.wateringMenu.openItem(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    itemId: Number(match[3]),
                    ...this.controllerMenuOptions(user),
                });
                return true;
            }
        }
        {
            const match = value.match(/^menu:watering:status:(\d+):(\d+):(\d+)$/);
            if (match) {
                await this.wateringMenu.toggleStatus(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    itemId: Number(match[3]),
                    ...this.controllerMenuOptions(user),
                });
                return true;
            }
        }
        {
            const match = value.match(/^menu:watering:day:(\d+):(\d+):(\d+):(\d+)$/);
            if (match) {
                await this.wateringMenu.toggleWeekday(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    itemId: Number(match[3]),
                    bit: Number(match[4]),
                    ...this.controllerMenuOptions(user),
                });
                return true;
            }
        }
        {
            const match = value.match(/^menu:watering:slot:(\d+):(\d+):(\d+):(\d+)$/);
            if (match) {
                await this.wateringMenu.openSlotEditor(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    itemId: Number(match[3]),
                    slot: Number(match[4]),
                    ...this.controllerMenuOptions(user),
                });
                return true;
            }
        }
        {
            const match = value.match(/^menu:watering:time:(\d+):(\d+):(\d+):(\d+):(-?\d+):(-?\d+)$/);
            if (match) {
                await this.wateringMenu.adjustTime(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    itemId: Number(match[3]),
                    slot: Number(match[4]),
                    hourDelta: Number(match[5]),
                    minuteDelta: Number(match[6]),
                    ...this.controllerMenuOptions(user),
                });
                return true;
            }
        }
        {
            const match = value.match(/^menu:watering:duration:(\d+):(\d+):(\d+):(\d+):(-?\d+)$/);
            if (match) {
                await this.wateringMenu.adjustDuration(actionCtx, {
                    deviceId: Number(match[1]),
                    nodeId: Number(match[2]) > 0 ? Number(match[2]) : null,
                    itemId: Number(match[3]),
                    slot: Number(match[4]),
                    deltaMinutes: Number(match[5]),
                    ...this.controllerMenuOptions(user),
                });
                return true;
            }
        }

        return false;
    }

    async handleReplyKeyboardSelection(ctx, text, user) {
        const actionMap = this.getReplyActionMap(ctx);
        const directAction = actionMap
            .flatMap((row) => row)
            .find(
                (button) =>
                    button.label === String(text || "").trim() ||
                    menuSelectionIncludes(text, button.label),
            );
        if (directAction?.data) {
            return await this.dispatchReplyAction(ctx, directAction.data, user);
        }

        const state = this.getReplyMenuState(ctx);
        if (!state) return false;

        const value = String(text || "").trim();
        const matchKey = normalizeMenuSelection(value);
        if (!value) return false;

        if (value === "⬅️ Назад") {
            if (state.kind === "devices" || state.kind === "objects") {
                await this.sendObjectsList(ctx, "", user);
                return true;
            }
            if (state.kind === "controllers") {
                await this.sendDevicesList(ctx, state.object_name || "", user);
                return true;
            }
        }

        if (state.kind === "objects") {
            const objects = await this.listTelegramObjects(user || {});
            const selected = objects
                .map((item) => ({
                    label: `${objectIcon(item)} ${objectLabel(item)}`,
                    object_name: objectLabel(item),
                }))
                .find(
                    (item) =>
                        item.label === value ||
                        normalizeMenuSelection(item.object_name) === matchKey ||
                        menuSelectionIncludes(value, item.label) ||
                        menuSelectionIncludes(value, item.object_name),
                );
            if (!selected?.object_name) {
                return false;
            }
            await this.sendDevicesList(ctx, selected.object_name, user);
            return true;
        }

        if (state.kind === "devices") {
            const devices = await this.listTelegramDevices(
                state.object_name || "",
                user || {},
            );
            const selected =
                devices.find(
                    (item) =>
                        item.label === value ||
                        normalizeMenuSelection(item.button_label) ===
                            matchKey ||
                        normalizeMenuSelection(item.name) === matchKey,
                ) ||
                devices.find(
                    (item) =>
                        menuSelectionIncludes(value, item.label) ||
                        menuSelectionIncludes(value, item.button_label),
                );
            if (!selected) return false;
            await this.sendControllersList(
                ctx,
                Number(selected.device_id),
                Number(selected.node_id || 0) || null,
                user,
            );
            return true;
        }

        if (state.kind === "controllers") {
            const quickItem = this.quickActionMenu
                .items()
                .find((item) => item.label === value);
            if (quickItem) {
                await this.quickActionMenu.run(ctx, {
                    deviceId: Number(state.device_id),
                    nodeId: Number(state.node_id || 0) || null,
                    actionKey: quickItem.key,
                    user,
                    replyMenu: this.replyMenu.bind(this),
                });
                return true;
            }
            const selected = (state.items || []).find(
                (item) =>
                    item.label === value ||
                    item.match_key === matchKey ||
                    menuSelectionIncludes(value, item.label),
            );
            if (!selected?.controller) return false;
            return await this.openControllerByKey(
                ctx,
                selected.controller,
                Number(state.device_id),
                Number(state.node_id || 0),
                user,
            );
        }

        return false;
    }

    async handleGlobalTextSelection(ctx, text, user) {
        const value = String(text || "").trim();
        const matchKey = normalizeMenuSelection(value);
        if (!matchKey) return false;

        const controllerKey = this.controllerKeyByTitle(value);
        const lastScope = this.getLastDeviceScope(ctx);
        if (
            controllerKey &&
            lastScope &&
            Number.isFinite(Number(lastScope.device_id))
        ) {
            return await this.openControllerByKey(
                ctx,
                controllerKey,
                Number(lastScope.device_id),
                Number(lastScope.node_id || 0),
                user,
            );
        }

        const objects = await this.listTelegramObjects(user || {});
        const selectedObject = objects
            .map((item) => ({
                object_name: objectLabel(item),
                label: `${objectIcon(item)} ${objectLabel(item)}`,
            }))
            .find(
                (item) =>
                    normalizeMenuSelection(item.object_name) === matchKey ||
                    menuSelectionIncludes(value, item.object_name) ||
                    menuSelectionIncludes(value, item.label),
            );
        if (selectedObject?.object_name) {
            await this.sendDevicesList(ctx, selectedObject.object_name, user);
            return true;
        }

        for (const objectItem of objects) {
            const objectName = objectLabel(objectItem);
            const devices = await this.listTelegramDevices(objectName, user || {});
            const selectedDevice =
                devices.find(
                    (item) =>
                        normalizeMenuSelection(item.button_label) ===
                            matchKey ||
                        normalizeMenuSelection(item.name) === matchKey,
                ) ||
                devices.find(
                    (item) =>
                        menuSelectionIncludes(value, item.button_label),
                );
            if (!selectedDevice) continue;
            await this.sendControllersList(
                ctx,
                Number(selectedDevice.device_id),
                Number(selectedDevice.node_id || 0) || null,
                user,
            );
            return true;
        }

        return false;
    }

    buildControllersKeyboard(detail) {
        const keyboard = new InlineKeyboard();
        const deviceId = Number(detail?.device_id);
        const nodeId = Number(detail?.node_id || 0);
        const objectName = String(detail?.object_name || "").trim();
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
        const hasCameras =
            Array.isArray(detail?.controllers?.cameras) &&
            detail.controllers.cameras.some((camera) => camera?.enabled);
        const hasSecurity = Boolean(detail?.controllers?.security?.enabled);
        const hasRing = Boolean(detail?.controllers?.ring?.enabled);
        const hasAvr = Boolean(detail?.controllers?.avr?.enabled);
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
                data: this.thermoMenu.controllerCallbackData(deviceId, nodeId),
            });
        if (hasTanks)
            controllerButtons.push({
                label: "🛢 Баки",
                data: this.tankMenu.controllerCallbackData(deviceId, nodeId),
            });
        if (hasSeptic)
            controllerButtons.push({
                label: "🚰 Септик",
                data: this.septicMenu.controllerCallbackData(deviceId, nodeId),
            });
        if (hasWatering)
            controllerButtons.push({
                label: "💧 Полив",
                data: this.wateringMenu.controllerCallbackData(deviceId, nodeId),
            });
        if (hasCameras)
            controllerButtons.push({
                label: "📷 Камеры",
                data: this.cameraMenu.controllerCallbackData(deviceId, nodeId),
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
        keyboard.text(
            "⬅️ Назад",
            objectName.length()
                ? this.buildDevicesBackCallbackData(objectName)
                : CALLBACK_OBJECTS_BACK,
        );
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

    rememberLastChat(ctx) {
        const chatId = String(ctx?.from?.id || "").trim();
        if (!chatId) return;
        this.lastChat = {
            chat_id: chatId,
            telegram_username: String(ctx?.from?.username || "").trim(),
            seen_at: new Date().toISOString(),
        };
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
            const masterIcon = objectIcon({
                icon: device.object_icon || device.object_type || "house",
            });
            result.push({
                device_id: Number(device.device_id),
                node_id: null,
                online: Boolean(device.online),
                object_name: device.object_name || "",
                name: masterName,
                label: `${masterIcon} ${masterName} (мастер)`,
                button_label: `${masterIcon} ${masterName} (мастер)`,
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
                    label: `🧩 ${nodeName} (${masterShort})`,
                    button_label: `🧩 ${nodeName} (${masterShort})`,
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
        const cameras = Array.isArray(controllers.cameras)
            ? controllers.cameras
            : [];
        const leak = Array.isArray(controllers.leak) ? controllers.leak : [];
        const socketsSummary =
            !Array.isArray(controllers.sockets) &&
            controllers.sockets &&
            typeof controllers.sockets === "object"
                ? controllers.sockets
                : null;
        const lightsSummary =
            !Array.isArray(controllers.lights) &&
            controllers.lights &&
            typeof controllers.lights === "object"
                ? controllers.lights
                : null;
        const meteoSummary =
            !Array.isArray(controllers.meteo) &&
            controllers.meteo &&
            typeof controllers.meteo === "object"
                ? controllers.meteo
                : null;
        const thermoSummary =
            !Array.isArray(controllers.thermo) &&
            controllers.thermo &&
            typeof controllers.thermo === "object"
                ? controllers.thermo
                : null;
        const tanksSummary =
            !Array.isArray(controllers.tanks) &&
            controllers.tanks &&
            typeof controllers.tanks === "object"
                ? controllers.tanks
                : null;
        const septicSummary =
            !Array.isArray(controllers.septic) &&
            controllers.septic &&
            typeof controllers.septic === "object"
                ? controllers.septic
                : null;
        const wateringSummary =
            !Array.isArray(controllers.watering) &&
            controllers.watering &&
            typeof controllers.watering === "object"
                ? controllers.watering
                : null;
        const camerasSummary =
            !Array.isArray(controllers.cameras) &&
            controllers.cameras &&
            typeof controllers.cameras === "object"
                ? controllers.cameras
                : null;
        const leakSummary =
            !Array.isArray(controllers.leak) &&
            controllers.leak &&
            typeof controllers.leak === "object"
                ? controllers.leak
                : null;
        const cards = [
            {
                title: "Розетки",
                status:
                    sockets.length > 0
                        ? `${sockets.filter((x) => x?.state).length}/${sockets.length}`
                        : `${Number(socketsSummary?.on_count || 0)}/${Number(socketsSummary?.enabled_count || 0)}`,
                visible:
                    sockets.length > 0 ||
                    Number(socketsSummary?.enabled_count || 0) > 0,
            },
            {
                title: "Освещение",
                status:
                    lights.length > 0
                        ? `${lights.filter((x) => x?.state).length}/${lights.length}`
                        : `${Number(lightsSummary?.on_count || 0)}/${Number(lightsSummary?.enabled_count || 0)}`,
                visible:
                    lights.length > 0 ||
                    Number(lightsSummary?.enabled_count || 0) > 0,
            },
            {
                title: "Метео",
                status:
                    meteo.length > 0
                        ? `${meteo.filter((x) => x?.ok).length}/${meteo.length}`
                        : `${Number(meteoSummary?.ok_count || 0)}/${Number(meteoSummary?.enabled_count || 0)}`,
                visible:
                    meteo.length > 0 ||
                    Number(meteoSummary?.enabled_count || 0) > 0,
            },
            {
                title: "Термостаты",
                status:
                    thermo.length > 0
                        ? `${thermo.filter((x) => x?.heat_on || x?.cool_on).length}/${thermo.length}`
                        : `${Number(thermoSummary?.active_count || 0)}/${Number(thermoSummary?.enabled_count || 0)}`,
                visible:
                    thermo.length > 0 ||
                    Number(thermoSummary?.enabled_count || 0) > 0,
            },
            {
                title: "Баки",
                status:
                    tanks.length > 0
                        ? `${tanks.filter((x) => x?.pump_on || x?.alarm_on).length}/${tanks.length}`
                        : `${Number(tanksSummary?.alert_count || 0)}/${Number(tanksSummary?.enabled_count || 0)}`,
                visible:
                    tanks.length > 0 ||
                    Number(tanksSummary?.enabled_count || 0) > 0,
            },
            {
                title: "Септик",
                status:
                    septic.length > 0
                        ? `${septic.filter((x) => x?.warning || x?.alarm).length}/${septic.length}`
                        : `${Number(septicSummary?.alert_count || 0)}/${Number(septicSummary?.enabled_count || 0)}`,
                visible:
                    septic.length > 0 ||
                    Number(septicSummary?.enabled_count || 0) > 0,
            },
            {
                title: "Полив",
                status:
                    watering.length > 0
                        ? `${watering.filter((x) => x?.active).length}/${watering.length}`
                        : `${Number(wateringSummary?.active_count || 0)}/${Number(wateringSummary?.enabled_count || 0)}`,
                visible:
                    watering.length > 0 ||
                    Number(wateringSummary?.enabled_count || 0) > 0,
            },
            {
                title: "Камеры",
                status:
                    cameras.length > 0
                        ? `${cameras.filter((x) => x?.enabled).length}/${cameras.length}`
                        : `${Number(camerasSummary?.enabled_count || 0)}/${Number(camerasSummary?.count || 0)}`,
                visible:
                    cameras.some((x) => x?.enabled) ||
                    Number(camerasSummary?.enabled_count || 0) > 0,
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
                visible: Boolean(controllers.security?.enabled),
            },
            {
                title: "Звонок",
                status: controllers.ring
                    ? controllers.ring.relay_on
                        ? "Вкл"
                        : "Выкл"
                    : "-",
                visible: Boolean(controllers.ring?.enabled),
            },
            {
                title: "АВР",
                status: controllers.avr
                    ? `${controllers.avr.active_source || "-"}${controllers.avr.fault && controllers.avr.fault !== "none" ? ` / ${controllers.avr.fault}` : ""}`
                    : "-",
                visible: Boolean(controllers.avr?.enabled),
            },
            {
                title: "Протечки",
                status:
                    leak.length > 0
                        ? `${leak.filter((x) => x?.wet || x?.alarm_latched).length}/${leak.length}`
                        : `${Number(leakSummary?.alert_count || 0)}/${Number(leakSummary?.enabled_count || 0)}`,
                visible:
                    leak.length > 0 ||
                    Number(leakSummary?.enabled_count || 0) > 0,
            },
        ].filter((item) => item.visible);
        if (cards.length > 0) {
            return cards;
        }

        const summary =
            detail?.summary && typeof detail.summary === "object"
                ? detail.summary
                : detail?.system?.summary &&
                    typeof detail.system.summary === "object"
                  ? detail.system.summary
                  : null;
        if (!summary) {
            return cards;
        }

        const fallbackCards = [];
        const fallbackSocketsSummary =
            summary.sockets && typeof summary.sockets === "object"
                ? summary.sockets
                : null;
        if (Number(fallbackSocketsSummary?.enabled || 0) > 0) {
            fallbackCards.push({
                title: "Розетки",
                status: `${Number(fallbackSocketsSummary?.on || 0)}/${Number(fallbackSocketsSummary?.enabled || 0)}`,
                visible: true,
            });
        }
        const fallbackLightsSummary =
            summary.lights && typeof summary.lights === "object"
                ? summary.lights
                : null;
        if (Number(fallbackLightsSummary?.enabled || 0) > 0) {
            fallbackCards.push({
                title: "Освещение",
                status: `${Number(fallbackLightsSummary?.on || 0)}/${Number(fallbackLightsSummary?.enabled || 0)}`,
                visible: true,
            });
        }
        return fallbackCards;
    }

    hasReadyControllerData(detail, nodeId = null) {
        if (!detail || typeof detail !== "object") {
            return false;
        }
        if (this.buildControllerCards(detail).length > 0) {
            return true;
        }
        if (!nodeId) {
            return Object.keys(detail.controllers || {}).length > 0;
        }
        const sockets = detail?.controllers?.sockets;
        if (Array.isArray(sockets) && sockets.length > 0) {
            return true;
        }
        return false;
    }

    diagnoseControllers(summary, sanitized, nodeId = null, session = {}) {
        const scopedSummary = nodeId
            ? this.resolveScopedDetail(summary, nodeId)
            : summary;
        const scopedSanitized = nodeId
            ? this.resolveScopedDetail(sanitized, nodeId)
            : sanitized;
        const baseControllers =
            scopedSummary?.controllers &&
            typeof scopedSummary.controllers === "object"
                ? scopedSummary.controllers
                : {};
        const rawKeys = Object.keys(baseControllers);
        const visibleKeys = Object.keys(
            scopedSanitized?.controllers &&
                typeof scopedSanitized.controllers === "object"
                ? scopedSanitized.controllers
                : {},
        );
        const notes = [];
        const access = summary ? resolveAccess(summary, session) : null;

        if (!summary) {
            notes.push("summary не построен");
        }
        if (access) {
            notes.push(
                `acl: restricted: ${access.restricted ? "yes" : "no"}, matched: ${access.matched ? "yes" : "no"}, object: ${access.objectAllowed ? "yes" : "no"}, device: ${access.deviceAllowed ? "yes" : "no"}`,
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
            notes.push(
                nodeId
                    ? "в summary.stack_units.controllers нет ключей"
                    : "в summary.controllers нет ключей",
            );
        } else {
            notes.push(`raw controllers: ${rawKeys.join(", ")}`);
        }
        if (scopedSanitized && !visibleKeys.length) {
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
        const deviceRow = await this.devicesDb.getByDeviceId(Number(deviceId));
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
            this.setReplyMenuState(ctx, null);
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
        const titleIcon = nodeId
            ? "🧩"
            : objectIcon({
                  icon:
                      deviceRow?.object_icon || deviceRow?.object_type || "house",
              });
        const deviceLabel = nodeId
            ? `${scoped.name || `Stack ${formatHexId(nodeId)}`} (${formatHexId(deviceId)}:${formatHexId(nodeId)})`
            : `${scoped.name || `Устройство ${formatHexId(deviceId)}`} (${formatHexId(deviceId)})`;
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
            this.setReplyMenuState(ctx, {
                kind: "controllers",
                device_id: Number(deviceId),
                node_id: nodeId ? Number(nodeId) : 0,
                object_name: String(scoped?.object_name || "").trim(),
                items: [],
            });
            await this.replyMenu(
                ctx,
                [
                    this.panelTitle(`${titleIcon} ${deviceLabel}`, "Контроллеры"),
                    "Контроллеры не обнаружены.",
                    "",
                    "<b>Диагностика</b>",
                    ...notes.map((line) => `• ${escapeHtml(line)}`),
                ].join("\n"),
                new InlineKeyboard()
                    .text(
                        "⬅️ Назад",
                        String(scoped?.object_name || "").trim().length
                            ? this.buildDevicesBackCallbackData(
                                  scoped.object_name,
                              )
                            : CALLBACK_OBJECTS_BACK,
                    ),
            );
            return;
        }
        this.setReplyMenuState(ctx, {
            kind: "controllers",
            device_id: Number(deviceId),
            node_id: nodeId ? Number(nodeId) : 0,
            object_name: String(scoped?.object_name || "").trim(),
            items: controllerCards
                .map((item) => ({
                    label: `${controllerIcon(item.title)} ${item.title}`,
                    controller: this.controllerKeyByTitle(item.title),
                    match_key: normalizeMenuSelection(item.title),
                }))
                .filter((item) => item.controller),
        });
        const lines = controllerCards.map(
            (item) =>
                `${controllerIcon(item.title)} ${item.title}: <b>${escapeHtml(item.status)}</b>`,
        );
        await this.replyMenu(
            ctx,
            [
                this.panelTitle(`${titleIcon} ${deviceLabel}`, "Контроллеры"),
                lines.join("\n"),
            ].join("\n\n"),
            this.buildControllersReplyKeyboard(scoped, controllerCards),
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

    buildPublicUrl(pathname = "") {
        const base = String(this.settings?.public_base_url || "").trim();
        const rel = String(pathname || "").trim();
        if (!base || !rel) return "";
        try {
            return new URL(rel, base.endsWith("/") ? base : `${base}/`).toString();
        } catch {
            return "";
        }
    }

    async refreshTelegramSummary(
        deviceId,
        nodeId = null,
        what = ["controllers"],
    ) {
        const requestWhat = Array.isArray(what) ? [...what] : ["controllers"];
        if (nodeId) {
            if (!requestWhat.includes("system")) {
                requestWhat.unshift("system");
            }
            const filtered = requestWhat.filter(
                (item) => item !== "stack" && item !== "authz",
            );
            requestWhat.length = 0;
            requestWhat.push(...filtered);
        }
        const initial = await this.registry.buildSummary(
            deviceId,
            this.devicesDb,
        );
        const initialScoped = nodeId
            ? this.resolveScopedDetail(initial, nodeId)
            : initial;
        const hasReadyControllers = this.hasReadyControllerData(
            initialScoped,
            nodeId,
        );
        if (hasReadyControllers || !this.deviceWs) {
            return initial;
        }

        const unit = nodeId ? "stack" : "local";
        const refreshScopeKey = `${Number(deviceId)}:${unit}:${Number(nodeId || 0)}`;
        const sendRefresh = () => {
            this.deviceWs.sendGet(
                Number(deviceId),
                requestWhat,
                unit,
                nodeId || undefined,
            );
            if (nodeId) {
                this.deviceWs.sendGet(
                    Number(deviceId),
                    ["stack", "authz"],
                    "local",
                );
            }
        };
        sendRefresh();
        if (nodeId) {
            this.lastStackSummaryRefreshByScope.set(refreshScopeKey, Date.now());
        }

        const maxWaitMs = nodeId ? 8000 : 3200;
        const refreshEveryMs = nodeId ? 500 : 700;
        const startedAt = Date.now();
        let lastRefreshAt = startedAt;
        while (Date.now() - startedAt < maxWaitMs) {
            await this.delay(120);
            if (Date.now() - lastRefreshAt >= refreshEveryMs) {
                sendRefresh();
                lastRefreshAt = Date.now();
            }
            const current = await this.registry.buildSummary(
                deviceId,
                this.devicesDb,
            );
            const scoped = nodeId
                ? this.resolveScopedDetail(current, nodeId)
                : current;
            if (this.hasReadyControllerData(scoped, nodeId)) {
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
            summary:
                scoped.summary && typeof scoped.summary === "object"
                    ? scoped.summary
                    : detail.summary && typeof detail.summary === "object"
                      ? detail.summary
                      : null,
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
        return `${username} plc: ${plcUsername} tg: ${tgUsername} chat_id: ${chatId}`;
    }

    describeNotificationEvent(summary, type) {
        if (type !== "event") return [];
        const eventPayload = summary?.last_event || {};
        const data =
            eventPayload.data && typeof eventPayload.data === "object"
                ? eventPayload.data
                : {};
        const details = [
            `kind: ${safeText(eventPayload.kind)}`,
            `reason: ${safeText(eventPayload.reason)}`,
        ];
        const policyKey = eventPolicyKey(eventPayload);
        if (policyKey) details.push(`policy: ${policyKey}`);
        const source = eventSourceLabel(summary, eventPayload, data);
        if (source) details.push(`source: ${safeText(source)}`);
        const item = eventItemLabel(data, "");
        if (item) details.push(`item: ${safeText(item)}`);
        return details;
    }

    logTelegramAction(ctx, user, action, details = "") {
        logger.info(
            `telegram action: user: ${this.describeTelegramUser(user, ctx)} action: ${action}${details ? ` ${details}` : ""}`,
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
