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
import { InlineKeyboard } from "grammy";
import { canSendControllerCommand } from "../../auth/AccessControl.js";

const THERMO_MODES = ["off", "heat_only", "cool_only", "auto"];

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function panelTitle(title, subtitle = "") {
    return [
        `<b>${escapeHtml(title)}</b>`,
        subtitle ? `<code>${escapeHtml(subtitle)}</code>` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

function panelDivider() {
    return "━━━━━━━━━━━━━━━━━";
}

function modeLabel(mode) {
    const normalized = String(mode || "off").toLowerCase();
    if (normalized === "heat_only") return "Нагрев";
    if (normalized === "cool_only") return "Охлаждение";
    if (normalized === "auto") return "Авто";
    return "Выкл";
}

function modeIcon(mode) {
    const normalized = String(mode || "off").toLowerCase();
    if (normalized === "heat_only") return "🔥";
    if (normalized === "cool_only") return "❄️";
    if (normalized === "auto") return "◌";
    return "⏻";
}

function processLabel(item) {
    if (!item?.enabled) return "контур отключен";
    if (item?.heat_on) return "нагрев";
    if (item?.cool_on) return "охлаждение";
    if (item?.power_on) return "ожидание";
    return "питание выкл";
}

function processIcon(item) {
    if (!item?.enabled) return "⚪";
    if (item?.heat_on) return "🔥";
    if (item?.cool_on) return "❄️";
    if (item?.power_on) return "🟢";
    return "⚪";
}

function formatTemperature(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "--";
    return num.toFixed(1);
}

function itemName(item, fallback) {
    const raw = String(item?.name || fallback).trim();
    return raw || fallback;
}

function buttonLabel(item, fallback) {
    const raw = itemName(item, fallback);
    const short = raw.length > 14 ? `${raw.slice(0, 14)}…` : raw;
    return `${processIcon(item)} ${short}`;
}

function nextMode(currentMode) {
    const current = String(currentMode || "off").toLowerCase();
    const index = THERMO_MODES.indexOf(current);
    return THERMO_MODES[(index + 1 + THERMO_MODES.length) % THERMO_MODES.length];
}

export class TgThermoMenu {
    constructor({ registry, devicesDb }) {
        this.registry = registry;
        this.devicesDb = devicesDb;
        this.deviceWs = null;
    }

    setDeviceWs(deviceWs) {
        this.deviceWs = deviceWs;
    }

    async open(
        ctx,
        {
            deviceId,
            nodeId = null,
            user,
            getScopedDetail,
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        },
    ) {
        const detail = await getScopedDetail(deviceId, nodeId, user);
        if (!detail) {
            await replyMenu(
                ctx,
                "Устройство недоступно.",
                new InlineKeyboard().text("🏘 К началу", mainMenuCallbackData),
            );
            return;
        }
        const list = Array.isArray(detail?.controllers?.thermo)
            ? detail.controllers.thermo
            : [];
        if (!list.length) {
            await replyMenu(
                ctx,
                "Нет доступных термостатов.",
                this.buildBackKeyboard(
                    deviceId,
                    nodeId,
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }
        const activeCount = list.filter(
            (item) => Boolean(item?.heat_on || item?.cool_on),
        ).length;
        const lines = list.map((item) => {
            const id = Number(item?.id);
            const sensorName = String(
                item?.sensor_name ?? item?.sensor_label ?? "",
            ).trim();
            const sensor = formatTemperature(
                item?.temp_c ?? item?.sensor_temp_c ?? item?.sensor_temp,
            );
            const target = formatTemperature(item?.target ?? item?.target_c);
            return [
                `${processIcon(item)} ${itemName(item, `Термо ${id}`)}`,
                `   ${modeIcon(item?.mode)} Режим работы: ${modeLabel(item?.mode)}`,
                `   🌡 ${sensorName || `Датчик ${Number(item?.sensor || 0) || "?"}`}: ${sensor}°C / 🎯 ${target}°C`,
            ].join("\n");
        });
        await replyMenu(
            ctx,
            [
                panelTitle(`🌡 ${detail.name || `#${deviceId}`}`, "Термостаты"),
                lines.map(escapeHtml).join("\n"),
                `${panelDivider()}\nВсего: ${list.length}   Активно: ${activeCount}`,
            ].join("\n\n"),
            this.buildKeyboard(
                detail,
                controllersCallbackData,
                mainMenuCallbackData,
            ),
        );
    }

    async openItem(
        ctx,
        {
            deviceId,
            nodeId = null,
            itemId,
            user,
            getScopedDetail,
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        },
    ) {
        const detail = await getScopedDetail(deviceId, nodeId, user);
        if (!detail) {
            await replyMenu(
                ctx,
                "Устройство недоступно.",
                new InlineKeyboard().text("🏘 К началу", mainMenuCallbackData),
            );
            return;
        }
        const item = this.findItem(detail, itemId);
        if (!item) {
            await replyMenu(
                ctx,
                "Термостат не найден.",
                this.buildBackKeyboard(
                    deviceId,
                    nodeId,
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }
        const id = Number(item?.id);
        const sensorName = String(
            item?.sensor_name ?? item?.sensor_label ?? "",
        ).trim();
        const sensor = formatTemperature(
            item?.temp_c ?? item?.sensor_temp_c ?? item?.sensor_temp,
        );
        const target = formatTemperature(item?.target ?? item?.target_c);
        const lines = [
            panelTitle(
                `🌡 ${itemName(item, `Термо ${id}`)}`,
                `${detail.name || `#${deviceId}`}`,
            ),
            `${processIcon(item)} <b>${escapeHtml(processLabel(item))}</b>`,
            `${modeIcon(item?.mode)} Режим работы: <b>${escapeHtml(modeLabel(item?.mode))}</b>`,
            `🪪 Датчик: <b>${escapeHtml(sensorName || `#${Number(item?.sensor || 0) || "?"}`)}</b>`,
            `🌡 Датчик: <b>${escapeHtml(sensor)}°C</b>`,
            `🎯 Цель: <b>${escapeHtml(target)}°C</b>`,
            `${panelDivider()}`,
            `${item?.power_on ? "🟢" : "⚪"} Питание`,
            `${item?.heat_on ? "🔥" : "⚪"} Нагрев`,
            `${item?.cool_on ? "❄️" : "⚪"} Охлаждение`,
            `${item?.enabled ? "🟢" : "⚪"} Контур`,
        ];
        await replyMenu(
            ctx,
            lines.join("\n"),
            this.buildItemKeyboard(
                detail,
                item,
                controllersCallbackData,
                mainMenuCallbackData,
            ),
        );
    }

    async togglePower(
        ctx,
        {
            deviceId,
            nodeId = null,
            itemId,
            user,
            getScopedDetail,
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        },
    ) {
        const detail = await getScopedDetail(deviceId, nodeId, user);
        const item = this.findItem(detail, itemId);
        if (!detail || !item) {
            await ctx.answerCallbackQuery({
                text: "Термостат недоступен",
                show_alert: true,
            });
            return;
        }
        const nextState = item?.power_on ? "off" : "on";
        const ok = await this.sendCommand({
            deviceId,
            nodeId,
            user,
            controller: "thermo",
            action: "power",
            args: { id: Number(itemId), state: nextState },
        });
        if (!ok) {
            await ctx.answerCallbackQuery({
                text: "Нет прав или устройство оффлайн",
                show_alert: true,
            });
            return;
        }
        await ctx.answerCallbackQuery({
            text: nextState === "on" ? "Питание включаю..." : "Питание выключаю...",
        });
        await this.replyPatchedItem(
            ctx,
            detail,
            itemId,
            (current) => ({
                ...current,
                power_on: nextState === "on",
                heat_on: false,
                cool_on: false,
            }),
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        );
    }

    async cycleMode(
        ctx,
        {
            deviceId,
            nodeId = null,
            itemId,
            user,
            getScopedDetail,
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        },
    ) {
        const detail = await getScopedDetail(deviceId, nodeId, user);
        const item = this.findItem(detail, itemId);
        if (!detail || !item) {
            await ctx.answerCallbackQuery({
                text: "Термостат недоступен",
                show_alert: true,
            });
            return;
        }
        const mode = nextMode(item?.mode);
        const ok = await this.sendCommand({
            deviceId,
            nodeId,
            user,
            controller: "thermo",
            action: "mode",
            args: { id: Number(itemId), mode },
        });
        if (!ok) {
            await ctx.answerCallbackQuery({
                text: "Нет прав или устройство оффлайн",
                show_alert: true,
            });
            return;
        }
        await ctx.answerCallbackQuery({
            text: `Режим: ${modeLabel(mode)}`,
        });
        await this.replyPatchedItem(
            ctx,
            detail,
            itemId,
            (current) => ({ ...current, mode }),
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        );
    }

    async adjustTarget(
        ctx,
        {
            deviceId,
            nodeId = null,
            itemId,
            delta = 0,
            user,
            getScopedDetail,
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        },
    ) {
        const detail = await getScopedDetail(deviceId, nodeId, user);
        const item = this.findItem(detail, itemId);
        if (!detail || !item) {
            await ctx.answerCallbackQuery({
                text: "Термостат недоступен",
                show_alert: true,
            });
            return;
        }
        const currentTarget = Number(item?.target ?? item?.target_c);
        if (!Number.isFinite(currentTarget)) {
            await ctx.answerCallbackQuery({
                text: "Нет текущей цели",
                show_alert: true,
            });
            return;
        }
        const nextTarget =
            Math.round((currentTarget + Number(delta || 0)) * 10) / 10;
        const ok = await this.sendCommand({
            deviceId,
            nodeId,
            user,
            controller: "thermo",
            action: "target",
            args: { id: Number(itemId), target_c: nextTarget },
        });
        if (!ok) {
            await ctx.answerCallbackQuery({
                text: "Нет прав или устройство оффлайн",
                show_alert: true,
            });
            return;
        }
        await ctx.answerCallbackQuery({
            text: `Цель: ${nextTarget.toFixed(1)}°C`,
        });
        await this.replyPatchedItem(
            ctx,
            detail,
            itemId,
            (current) => ({ ...current, target: nextTarget, target_c: nextTarget }),
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        );
    }

    async sendCommand({
        deviceId,
        nodeId = null,
        user,
        controller,
        action,
        args,
    }) {
        const summary = await this.registry.buildSummary(
            deviceId,
            this.devicesDb,
        );
        if (
            !summary ||
            !canSendControllerCommand(
                summary,
                user || {},
                controller,
                action,
                args || {},
            )
        ) {
            return false;
        }
        const result = this.deviceWs?.sendCmd(
            Number(deviceId),
            controller,
            action,
            args || {},
            {
                uid: user?.username || user?.plc_username || "",
                username: user?.username || "",
                plc_username: user?.plc_username || "",
                source: "telegram",
                session_id: `tg:${String(user?.chat_id || "")}`,
            },
            nodeId ? "stack" : "local",
            nodeId || undefined,
        );
        if (!result?.ok) return false;
        this.deviceWs?.sendGet(
            Number(deviceId),
            ["controllers"],
            nodeId ? "stack" : "local",
            nodeId || undefined,
        );
        return true;
    }

    findItem(detail, itemId) {
        const list = Array.isArray(detail?.controllers?.thermo)
            ? detail.controllers.thermo
            : [];
        return list.find((item) => Number(item?.id) === Number(itemId)) || null;
    }

    patchItem(detail, itemId, updater) {
        return {
            ...detail,
            controllers: {
                ...(detail?.controllers || {}),
                thermo: Array.isArray(detail?.controllers?.thermo)
                    ? detail.controllers.thermo.map((item) =>
                          Number(item?.id) === Number(itemId)
                              ? updater({ ...item })
                              : item,
                      )
                    : [],
            },
        };
    }

    async replyPatchedItem(
        ctx,
        detail,
        itemId,
        updater,
        replyMenu,
        mainMenuCallbackData,
        controllersCallbackData,
    ) {
        const patched = this.patchItem(detail, itemId, updater);
        const item = this.findItem(patched, itemId);
        if (!item) return;
        const id = Number(item?.id);
        const sensorName = String(
            item?.sensor_name ?? item?.sensor_label ?? "",
        ).trim();
        const sensor = formatTemperature(
            item?.temp_c ?? item?.sensor_temp_c ?? item?.sensor_temp,
        );
        const target = formatTemperature(item?.target ?? item?.target_c);
        const lines = [
            panelTitle(
                `🌡 ${itemName(item, `Термо ${id}`)}`,
                `${patched.name || `#${patched.device_id}`}`,
            ),
            `${processIcon(item)} <b>${escapeHtml(processLabel(item))}</b>`,
            `${modeIcon(item?.mode)} Режим работы: <b>${escapeHtml(modeLabel(item?.mode))}</b>`,
            `🪪 Датчик: <b>${escapeHtml(sensorName || `#${Number(item?.sensor || 0) || "?"}`)}</b>`,
            `🌡 Датчик: <b>${escapeHtml(sensor)}°C</b>`,
            `🎯 Цель: <b>${escapeHtml(target)}°C</b>`,
            `${panelDivider()}`,
            `${item?.power_on ? "🟢" : "⚪"} Питание`,
            `${item?.heat_on ? "🔥" : "⚪"} Нагрев`,
            `${item?.cool_on ? "❄️" : "⚪"} Охлаждение`,
            `${item?.enabled ? "🟢" : "⚪"} Контур`,
        ];
        await replyMenu(
            ctx,
            lines.join("\n"),
            this.buildItemKeyboard(
                patched,
                item,
                controllersCallbackData,
                mainMenuCallbackData,
            ),
        );
    }

    buildKeyboard(detail, controllersCallbackData, mainMenuCallbackData) {
        const keyboard = new InlineKeyboard();
        const list = Array.isArray(detail?.controllers?.thermo)
            ? detail.controllers.thermo
            : [];
        const deviceId = Number(detail?.device_id);
        const nodeId = Number(detail?.node_id || 0);
        const buttons = [];
        for (const item of list) {
            const id = Number(item?.id);
            if (!Number.isFinite(id)) continue;
            buttons.push({
                label: buttonLabel(item, `Термо ${id}`),
                data: this.itemCallbackData(deviceId, nodeId, id),
            });
        }
        for (let i = 0; i < buttons.length; i += 2) {
            const left = buttons[i];
            const right = buttons[i + 1];
            keyboard.text(left.label, left.data);
            if (right) keyboard.text(right.label, right.data);
            keyboard.row();
        }
        keyboard
            .text("🧩 Контроллеры", controllersCallbackData(deviceId, nodeId))
            .row();
        keyboard.text("🏘 К началу", mainMenuCallbackData);
        return keyboard;
    }

    buildItemKeyboard(
        detail,
        item,
        controllersCallbackData,
        mainMenuCallbackData,
    ) {
        const keyboard = new InlineKeyboard();
        const deviceId = Number(detail?.device_id);
        const nodeId = Number(detail?.node_id || 0);
        const itemId = Number(item?.id);
        keyboard
            .text(
                item?.power_on ? "⏻ Выключить" : "⏻ Включить",
                this.powerCallbackData(deviceId, nodeId, itemId),
            )
            .text(
                `${modeIcon(item?.mode)} Режим`,
                this.modeCallbackData(deviceId, nodeId, itemId),
            )
            .row();
        keyboard
            .text("−0.5°C", this.targetCallbackData(deviceId, nodeId, itemId, -5))
            .text("+0.5°C", this.targetCallbackData(deviceId, nodeId, itemId, 5))
            .row();
        keyboard
            .text(
                "🌡 К списку термо",
                this.controllerCallbackData(deviceId, nodeId),
            )
            .row();
        keyboard
            .text("🧩 Контроллеры", controllersCallbackData(deviceId, nodeId))
            .row();
        keyboard.text("🏘 К началу", mainMenuCallbackData);
        return keyboard;
    }

    buildBackKeyboard(
        deviceId,
        nodeId,
        controllersCallbackData,
        mainMenuCallbackData,
    ) {
        return new InlineKeyboard()
            .text(
                "🧩 Контроллеры",
                controllersCallbackData(deviceId, nodeId || 0),
            )
            .row()
            .text("🏘 К началу", mainMenuCallbackData);
    }

    controllerCallbackData(deviceId, nodeId = 0) {
        return `menu:controller:${Number(deviceId)}:${Number(nodeId || 0)}:thermo`;
    }

    itemCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:thermo:view:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}`;
    }

    powerCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:thermo:power:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}`;
    }

    modeCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:thermo:mode:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}`;
    }

    targetCallbackData(deviceId, nodeId = 0, itemId, deltaTenths = 0) {
        return `menu:thermo:target:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}:${Number(deltaTenths || 0)}`;
    }

    delay(ms) {
        return new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, Number(ms) || 0)),
        );
    }
}
