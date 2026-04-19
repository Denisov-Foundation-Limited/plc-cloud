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

const THERMO_MODES = ["heat_only", "cool_only", "auto"];

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
    if (normalized === "auto") return "🔄";
    return "⏻";
}

function processLabel(item) {
    if (!item?.enabled) return "контур отключен";
    if (item?.heat_on) return "нагрев";
    if (item?.cool_on) return "охлаждение";
    if (item?.power_on) return "ожидание";
    return "выключен";
}

function processIcon(item) {
    if (!item?.enabled) return "⏸";
    if (item?.heat_on) return "🔥";
    if (item?.cool_on) return "❄️";
    if (item?.power_on) return "🌡️";
    return "⏻";
}

function statusIcon(item) {
    if (!item?.enabled) return "⏸";
    if (item?.heat_on) return "🔥";
    if (item?.cool_on) return "❄️";
    if (!item?.power_on) return "⏻";
    return "⏸";
}

function formatTemperature(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "--";
    return num.toFixed(1);
}

function formatTarget(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "--";
    return String(Math.round(num));
}

function itemName(item, fallback) {
    const raw = String(item?.name || fallback).trim();
    return raw || fallback;
}

function buttonLabel(item, fallback) {
    const raw = itemName(item, fallback);
    const short = raw.length > 14 ? `${raw.slice(0, 14)}…` : raw;
    return `♨️ ${short}`;
}

function nextMode(currentMode) {
    const current = String(currentMode || "off").toLowerCase();
    const index = THERMO_MODES.indexOf(current);
    if (index < 0) return THERMO_MODES[0];
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
        const detail = await this.waitForThermoDetail(
            deviceId,
            nodeId,
            user,
            getScopedDetail,
        );
        if (!detail) {
            await replyMenu(
                ctx,
                "Устройство недоступно.",
                this.buildBackKeyboard(
                    Number(deviceId),
                    Number(nodeId || 0),
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }
        const list = Array.isArray(detail?.controllers?.thermo)
            ? detail.controllers.thermo
            : [];
        if (!list.length) {
            await replyMenu(
                ctx,
                detail?._controller_loading === "thermo"
                    ? "Данные термостатов со слейва ещё загружаются."
                    : "Нет доступных термостатов.",
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
            const target = formatTarget(item?.target ?? item?.target_c);
            return [
                `♨️ ${itemName(item, `Термо ${id}`)}`,
                `      📟 Статус: ${statusIcon(item)}`,
                `      🌡 ${sensorName || `Датчик ${Number(item?.sensor || 0) || "?"}`}: ${sensor}°C / 🎯 ${target}°C`,
            ].join("\n");
        });
        await replyMenu(
            ctx,
            [
                panelTitle(
                    `${objectIcon({ icon: detail?.object_icon || detail?.object_type || "house" })} ${detail.name || `#${deviceId}`}`,
                    "Термостаты",
                ),
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
        const detail = await this.waitForThermoDetail(
            deviceId,
            nodeId,
            user,
            getScopedDetail,
        );
        if (!detail) {
            await replyMenu(
                ctx,
                "Устройство недоступно.",
                this.buildBackKeyboard(
                    Number(deviceId),
                    Number(nodeId || 0),
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }
        const item = this.findItem(detail, itemId);
        if (!item) {
            await replyMenu(
                ctx,
                detail?._controller_loading === "thermo"
                    ? "Данные термостата со слейва ещё загружаются."
                    : "Термостат не найден.",
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
        const target = formatTarget(item?.target ?? item?.target_c);
        const lines = [
            panelTitle(`♨️ ${itemName(item, `Термо ${id}`)}`),
            "",
            `🔌 Питание: ${item?.power_on ? "🟢" : "⚪"}`,
            `⚙️ Режим: <b>${escapeHtml(modeLabel(item?.mode))}</b>`,
            `🪪 Датчик: <b>${escapeHtml(sensorName || `#${Number(item?.sensor || 0) || "?"}`)}</b>`,
            `🌡 Датчик: <b>${escapeHtml(sensor)}°C</b>`,
            `🎯 Цель: <b>${escapeHtml(target)}°C</b>`,
            `📟 Статус: ${statusIcon(item)}`,
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
        const nextTarget = Math.round(currentTarget + Number(delta || 0));
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
            text: `Цель: ${nextTarget}°C`,
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

    async refreshItem(
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
        await ctx.answerCallbackQuery({
            text: "Обновляю...",
        });
        const detail = await this.waitForThermoDetail(
            deviceId,
            nodeId,
            user,
            getScopedDetail,
            { forceRefresh: true },
        );
        if (!detail) {
            await this.openItem(ctx, {
                deviceId,
                nodeId,
                itemId,
                user,
                getScopedDetail,
                replyMenu,
                mainMenuCallbackData,
                controllersCallbackData,
            });
            return;
        }
        await this.replyPatchedItem(
            ctx,
            detail,
            itemId,
            (current) => current,
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
            nodeId ? ["system", "controllers"] : ["controllers"],
            nodeId ? "stack" : "local",
            nodeId || undefined,
        );
        return true;
    }

    async waitForThermoDetail(
        deviceId,
        nodeId,
        user,
        getScopedDetail,
        options = {},
    ) {
        const forceRefresh = Boolean(options?.forceRefresh);
        let detail = await getScopedDetail(deviceId, nodeId, user);
        const hasThermo = (value) =>
            Array.isArray(value?.controllers?.thermo) &&
            value.controllers.thermo.length > 0;
        if (!this.deviceWs) {
            return detail;
        }
        if (!forceRefresh && (hasThermo(detail) || !nodeId)) {
            return detail;
        }
        const requestWhat = nodeId ? ["system", "controllers"] : ["controllers"];
        const requestUnit = nodeId ? "stack" : "local";
        const startedAt = Date.now();
        const timeoutMs = forceRefresh ? 2500 : 8000;
        const delayMs = forceRefresh ? 350 : 250;
        while (Date.now() - startedAt < timeoutMs) {
            this.deviceWs.sendGet(
                Number(deviceId),
                requestWhat,
                requestUnit,
                nodeId || undefined,
            );
            await this.delay(delayMs);
            detail = await getScopedDetail(deviceId, nodeId, user);
            if (hasThermo(detail)) {
                return detail;
            }
        }
        return detail;
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
        const target = formatTarget(item?.target ?? item?.target_c);
        const lines = [
            panelTitle(`♨️ ${itemName(item, `Термо ${id}`)}`),
            "",
            `🔌 Питание: ${item?.power_on ? "🟢" : "⚪"}`,
            `⚙️ Режим: <b>${escapeHtml(modeLabel(item?.mode))}</b>`,
            `🪪 Датчик: <b>${escapeHtml(sensorName || `#${Number(item?.sensor || 0) || "?"}`)}</b>`,
            `🌡 Датчик: <b>${escapeHtml(sensor)}°C</b>`,
            `🎯 Цель: <b>${escapeHtml(target)}°C</b>`,
            `📟 Статус: ${statusIcon(item)}`,
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
            { force_new_message: true },
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
        keyboard.text("◀️ Назад", controllersCallbackData(deviceId, nodeId));
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
                `${item?.power_on ? "🟢" : "⚪"} Питание`,
                this.powerCallbackData(deviceId, nodeId, itemId),
            )
            .text(
                `${modeIcon(item?.mode)} Режим`,
                this.modeCallbackData(deviceId, nodeId, itemId),
            )
            .row();
        keyboard
            .text("−1°C", this.targetCallbackData(deviceId, nodeId, itemId, -1))
            .text("+1°C", this.targetCallbackData(deviceId, nodeId, itemId, 1))
            .row();
        keyboard
            .text(
                "🔄 Обновить",
                this.refreshCallbackData(deviceId, nodeId, itemId),
            )
            .text("◀️ Назад", this.controllerCallbackData(deviceId, nodeId));
        return keyboard;
    }

    buildBackKeyboard(
        deviceId,
        nodeId,
        controllersCallbackData,
        mainMenuCallbackData,
    ) {
        return new InlineKeyboard().text(
            "◀️ Назад",
            controllersCallbackData(deviceId, nodeId || 0),
        );
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

    targetCallbackData(deviceId, nodeId = 0, itemId, delta = 0) {
        return `menu:thermo:target:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}:${Number(delta || 0)}`;
    }

    refreshCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:thermo:refresh:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}`;
    }

    delay(ms) {
        return new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, Number(ms) || 0)),
        );
    }
}
