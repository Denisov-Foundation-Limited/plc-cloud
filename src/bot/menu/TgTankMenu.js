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

function tankLevelLabel(item) {
    if (item?.level_full) return "полный";
    if (item?.level_mid) return "средний";
    if (item?.level_low) return "низкий";
    return "пусто";
}

function tankLevelPercent(item) {
    const direct =
        item?.level_percent ??
        item?.level_pct ??
        item?.percent ??
        item?.level;
    const numeric = Number(direct);
    if (Number.isFinite(numeric) && numeric >= 0) {
        return Math.max(0, Math.min(100, Math.round(numeric)));
    }
    if (item?.level_full) return 99;
    if (item?.level_mid) return 66;
    if (item?.level_low) return 33;
    return 0;
}

function tankLevelIcon(item) {
    if (item?.level_full) return "🟢";
    if (item?.level_mid) return "🟡";
    if (item?.level_low) return "🟠";
    return "⚪";
}

function buttonLabel(item, fallback) {
    const raw = String(item?.name || fallback).trim() || fallback;
    const short = raw.length > 14 ? `${raw.slice(0, 14)}…` : raw;
    return `🛢 ${short}`;
}

function itemName(item, fallback) {
    const raw = String(item?.name || fallback).trim();
    return raw || fallback;
}

export class TgTankMenu {
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
        const detail = await this.waitForTankDetail(
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
        const list = Array.isArray(detail?.controllers?.tanks)
            ? detail.controllers.tanks
            : [];
        const summary =
            !Array.isArray(detail?.controllers?.tanks) &&
            detail?.controllers?.tanks &&
            typeof detail.controllers.tanks === "object"
                ? detail.controllers.tanks
                : null;
        if (!list.length) {
            if (summary && Number(summary?.enabled_count ?? 0) > 0) {
                await replyMenu(
                    ctx,
                    [
                        panelTitle(
                            `${objectIcon({ icon: detail?.object_icon || detail?.object_type || "house" })} ${detail.name || `#${deviceId}`}`,
                            "Баки",
                        ),
                        `🛢 Баков: <b>${Number(summary?.enabled_count ?? 0)}</b>`,
                        `🚨 Аварии: <b>${Number(summary?.alert_count ?? 0)}</b>`,
                        "Подробные баки со слейва ещё не догружены.",
                    ].join("\n"),
                    this.buildBackKeyboard(
                        deviceId,
                        nodeId,
                        controllersCallbackData,
                        mainMenuCallbackData,
                    ),
                );
                return;
            }
            await replyMenu(
                ctx,
                detail?._controller_loading === "tanks"
                    ? "Данные баков со слейва ещё загружаются."
                    : "Нет доступных баков.",
                this.buildBackKeyboard(
                    deviceId,
                    nodeId,
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }
        const alarmCount = list.filter((item) => Boolean(item?.alarm_on)).length;
        const lines = list.map((item) => {
            const id = Number(item?.id);
            return [
                `🛢 ${itemName(item, `Бак ${id}`)}`,
                `    🔌 Питание: ${item?.power_on ? "🟢" : "⚪"} / 💧 Уровень: ${tankLevelPercent(item)}%`,
            ].join("\n");
        });
        await replyMenu(
            ctx,
            [
                panelTitle(
                    `${objectIcon({ icon: detail?.object_icon || detail?.object_type || "house" })} ${detail.name || `#${deviceId}`}`,
                    "Баки",
                ),
                lines.map(escapeHtml).join("\n\n"),
                `${panelDivider()}\nВсего: ${list.length}   Аварии: ${alarmCount}`,
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
        const detail = await this.waitForTankDetail(
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
                "Бак не найден.",
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
        const lines = [
            panelTitle(`🛢 ${itemName(item, `Бак ${id}`)}`),
            "",
            `🔌 Питание: ${item?.power_on ? "🟢" : "⚪"}`,
            `💧 Уровень: <b>${tankLevelPercent(item)}%</b>`,
            `🚰 Набор: ${item?.valve_on ? "🟢" : "⚪"}`,
            `🌀 Насос: ${item?.pump_on ? "🟢" : "⚪"}`,
            `🚨 Авария: ${item?.alarm_on ? "🔴" : "⚪"}`,
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
                text: "Бак недоступен",
                show_alert: true,
            });
            return;
        }
        const nextState = item?.power_on ? "off" : "on";
        const summary = await this.registry.buildSummary(
            deviceId,
            this.devicesDb,
        );
        if (
            !summary ||
            !canSendControllerCommand(summary, user || {}, "tanks", "power", {
                id: Number(itemId),
                state: nextState,
            })
        ) {
            await ctx.answerCallbackQuery({
                text: "Нет прав на управление",
                show_alert: true,
            });
            return;
        }
        const result = this.deviceWs?.sendCmd(
            Number(deviceId),
            "tanks",
            "power",
            { id: Number(itemId), state: nextState },
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
        if (!result?.ok) {
            await ctx.answerCallbackQuery({
                text: "Команда не отправлена",
                show_alert: true,
            });
            return;
        }
        this.deviceWs?.sendGet(
            Number(deviceId),
            nodeId ? ["system", "controllers"] : ["controllers"],
            nodeId ? "stack" : "local",
            nodeId || undefined,
        );
        await ctx.answerCallbackQuery({
            text: nextState === "on" ? "Питание включаю..." : "Питание выключаю...",
        });
        const freshDetail = await this.waitForFreshDetail(
            deviceId,
            nodeId,
            user,
            getScopedDetail,
            itemId,
            item,
            nextState === "on",
        );
        await this.replyFreshItem(
            ctx,
            freshDetail || this.patchItem(detail, itemId, (current) => ({
                ...current,
                power_on: nextState === "on",
            })),
            itemId,
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
    }

    findItem(detail, itemId) {
        const list = Array.isArray(detail?.controllers?.tanks)
            ? detail.controllers.tanks
            : [];
        return list.find((item) => Number(item?.id) === Number(itemId)) || null;
    }

    patchItem(detail, itemId, updater) {
        return {
            ...detail,
            controllers: {
                ...(detail?.controllers || {}),
                tanks: Array.isArray(detail?.controllers?.tanks)
                    ? detail.controllers.tanks.map((item) =>
                          Number(item?.id) === Number(itemId)
                              ? updater({ ...item })
                              : item,
                      )
                    : [],
            },
        };
    }

    async replyFreshItem(
        ctx,
        detail,
        itemId,
        replyMenu,
        mainMenuCallbackData,
        controllersCallbackData,
    ) {
        const item = this.findItem(detail, itemId);
        if (!item) return;
        const id = Number(item?.id);
        const lines = [
            panelTitle(`🛢 ${itemName(item, `Бак ${id}`)}`),
            "",
            `🔌 Питание: ${item?.power_on ? "🟢" : "⚪"}`,
            `💧 Уровень: <b>${tankLevelPercent(item)}%</b>`,
            `🚰 Набор: ${item?.valve_on ? "🟢" : "⚪"}`,
            `🌀 Насос: ${item?.pump_on ? "🟢" : "⚪"}`,
            `🚨 Авария: ${item?.alarm_on ? "🔴" : "⚪"}`,
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
            { force_new_message: true },
        );
    }

    async waitForFreshDetail(
        deviceId,
        nodeId,
        user,
        getScopedDetail,
        itemId,
        prevItem,
        expectedPowerOn,
    ) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            if (attempt > 0) {
                this.deviceWs?.sendGet(
                    Number(deviceId),
                    nodeId ? ["system", "controllers"] : ["controllers"],
                    nodeId ? "stack" : "local",
                    nodeId || undefined,
                );
            }
            await this.delay(attempt === 0 ? 500 : 350);
            const detail = await getScopedDetail(deviceId, nodeId, user);
            const item = this.findItem(detail, itemId);
            if (!detail || !item) continue;
            const powerMatches = Boolean(item?.power_on) === Boolean(expectedPowerOn);
            const valveChanged = Boolean(item?.valve_on) !== Boolean(prevItem?.valve_on);
            const pumpChanged = Boolean(item?.pump_on) !== Boolean(prevItem?.pump_on);
            if (powerMatches && (valveChanged || pumpChanged || attempt >= 2)) {
                return detail;
            }
        }
        return await getScopedDetail(deviceId, nodeId, user);
    }

    async waitForTankDetail(deviceId, nodeId, user, getScopedDetail) {
        let detail = await getScopedDetail(deviceId, nodeId, user);
        const hasTanks = (value) =>
            Array.isArray(value?.controllers?.tanks) &&
            value.controllers.tanks.length > 0;
        if (hasTanks(detail) || !nodeId || !this.deviceWs) {
            return detail;
        }
        const startedAt = Date.now();
        while (Date.now() - startedAt < 8000) {
            this.deviceWs.sendGet(
                Number(deviceId),
                ["system", "controllers"],
                "stack",
                nodeId || undefined,
            );
            await this.delay(250);
            detail = await getScopedDetail(deviceId, nodeId, user);
            if (hasTanks(detail)) {
                return detail;
            }
        }
        return detail;
    }

    buildKeyboard(detail, controllersCallbackData, mainMenuCallbackData) {
        const keyboard = new InlineKeyboard();
        const list = Array.isArray(detail?.controllers?.tanks)
            ? detail.controllers.tanks
            : [];
        const deviceId = Number(detail?.device_id);
        const nodeId = Number(detail?.node_id || 0);
        const buttons = [];
        for (const item of list) {
            const id = Number(item?.id);
            if (!Number.isFinite(id)) continue;
            buttons.push({
                label: buttonLabel(item, `Бак ${id}`),
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
        return `menu:controller:${Number(deviceId)}:${Number(nodeId || 0)}:tanks`;
    }

    itemCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:tanks:view:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}`;
    }

    powerCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:tanks:power:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}`;
    }

    refreshCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:tanks:refresh:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}`;
    }

    delay(ms) {
        return new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, Number(ms) || 0)),
        );
    }
}
