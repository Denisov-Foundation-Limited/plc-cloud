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

function tankLevelLabel(item) {
    if (item?.level_full) return "полный";
    if (item?.level_mid) return "средний";
    if (item?.level_low) return "низкий";
    return "пусто";
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
    return `${tankLevelIcon(item)} ${short}`;
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
        const detail = await getScopedDetail(deviceId, nodeId, user);
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
        if (!list.length) {
            await replyMenu(
                ctx,
                "Нет доступных баков.",
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
                `${tankLevelIcon(item)} ${itemName(item, `Бак ${id}`)}`,
                `   Уровень: ${tankLevelLabel(item)}  ·  Питание: ${item?.power_on ? "ВКЛ" : "ВЫКЛ"}`,
            ].join("\n");
        });
        await replyMenu(
            ctx,
            [
                panelTitle(`🛢 ${detail.name || `#${deviceId}`}`, "Баки"),
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
        const detail = await getScopedDetail(deviceId, nodeId, user);
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
            panelTitle(
                `🛢 ${itemName(item, `Бак ${id}`)}`,
                `${detail.name || `#${deviceId}`}`,
            ),
            `${tankLevelIcon(item)} Уровень: <b>${escapeHtml(tankLevelLabel(item))}</b>`,
            `${item?.power_on ? "🟢" : "⚪"} Питание: <b>${item?.power_on ? "ВКЛ" : "ВЫКЛ"}</b>`,
            `${item?.valve_on ? "🟢" : "⚪"} Клапан: <b>${item?.valve_on ? "ВКЛ" : "ВЫКЛ"}</b>`,
            `${item?.pump_on ? "🟢" : "⚪"} Насос: <b>${item?.pump_on ? "ВКЛ" : "ВЫКЛ"}</b>`,
            `${item?.alarm_on ? "🔴" : "⚪"} Авария: <b>${item?.alarm_on ? "ДА" : "НЕТ"}</b>`,
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
            ["controllers"],
            nodeId ? "stack" : "local",
            nodeId || undefined,
        );
        await ctx.answerCallbackQuery({
            text: nextState === "on" ? "Питание включаю..." : "Питание выключаю...",
        });
        await this.replyPatchedItem(
            ctx,
            detail,
            itemId,
            (current) => ({ ...current, power_on: nextState === "on" }),
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        );
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
        const lines = [
            panelTitle(
                `🛢 ${itemName(item, `Бак ${id}`)}`,
                `${patched.name || `#${patched.device_id}`}`,
            ),
            `${tankLevelIcon(item)} Уровень: <b>${escapeHtml(tankLevelLabel(item))}</b>`,
            `${item?.power_on ? "🟢" : "⚪"} Питание: <b>${item?.power_on ? "ВКЛ" : "ВЫКЛ"}</b>`,
            `${item?.valve_on ? "🟢" : "⚪"} Клапан: <b>${item?.valve_on ? "ВКЛ" : "ВЫКЛ"}</b>`,
            `${item?.pump_on ? "🟢" : "⚪"} Насос: <b>${item?.pump_on ? "ВКЛ" : "ВЫКЛ"}</b>`,
            `${item?.alarm_on ? "🔴" : "⚪"} Авария: <b>${item?.alarm_on ? "ДА" : "НЕТ"}</b>`,
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
        keyboard.text("🧩 Контроллеры", controllersCallbackData(deviceId, nodeId));
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
                item?.power_on ? "⏻ Выключить питание" : "⏻ Включить питание",
                this.powerCallbackData(deviceId, nodeId, itemId),
            )
            .row();
        keyboard
            .text(
                "🛢 К списку баков",
                this.controllerCallbackData(deviceId, nodeId),
            )
            .row();
        keyboard.text("🧩 Контроллеры", controllersCallbackData(deviceId, nodeId));
        return keyboard;
    }

    buildBackKeyboard(
        deviceId,
        nodeId,
        controllersCallbackData,
        mainMenuCallbackData,
    ) {
        return new InlineKeyboard().text(
            "🧩 Контроллеры",
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

    delay(ms) {
        return new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, Number(ms) || 0)),
        );
    }
}
