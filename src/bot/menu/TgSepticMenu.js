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

function itemName(item, fallback) {
    const raw = String(item?.name || fallback).trim();
    return raw || fallback;
}

function monitorOn(item) {
    return Boolean(item?.monitoring_on ?? item?.monitor_on ?? item?.monitor);
}

function levelLabel(item) {
    if (item?.alarm) return "полный";
    if (item?.warning) return "предупреждение";
    return "пустой";
}

function levelIcon(item) {
    if (item?.alarm) return "🔴";
    if (item?.warning) return "🟠";
    return "🟢";
}

function stateIcon(item) {
    if (!monitorOn(item)) return "⚪";
    if (item?.alarm) return "🔴";
    if (item?.warning) return "🟠";
    return "🟢";
}

function buttonLabel(item, fallback) {
    const raw = itemName(item, fallback);
    const short = raw.length > 14 ? `${raw.slice(0, 14)}…` : raw;
    return `🚽 ${short}`;
}

export class TgSepticMenu {
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
        const detail = await this.waitForSepticDetail(
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
        const list = this.list(detail);
        if (!list.length) {
            const summary =
                !Array.isArray(detail?.controllers?.septic) &&
                detail?.controllers?.septic &&
                typeof detail.controllers.septic === "object"
                    ? detail.controllers.septic
                    : null;
            if (summary && Number(summary?.enabled_count ?? summary?.enabled ?? 0) > 0) {
                await replyMenu(
                    ctx,
                    [
                        panelTitle(
                            `${objectIcon({ icon: detail?.object_icon || detail?.object_type || "house" })} ${detail.name || `#${deviceId}`}`,
                            "Септик",
                        ),
                        `🚽 Септиков: <b>${Number(summary?.enabled_count ?? summary?.enabled ?? 0)}</b>`,
                        `🟠 Предупреждения: <b>${summary?.warning ? 1 : 0}</b>`,
                        `🔴 Аварии: <b>${summary?.alarm ? 1 : 0}</b>`,
                        "Подробные данные септика со слейва ещё не догружены.",
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
                detail?._controller_loading === "septic"
                    ? "Данные септика со слейва ещё загружаются."
                    : "Нет доступного септика.",
                this.buildBackKeyboard(
                    deviceId,
                    nodeId,
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }
        const alarms = list.filter((item) => Boolean(item?.alarm)).length;
        const lines = list.map((item) => {
            const id = Number(item?.id);
            return [
                `🚽 ${itemName(item, `Септик ${id}`)}`,
                `    🔌 Питание: ${monitorOn(item) ? "🟢" : "⚪"} / 📟 Статус: ${stateIcon(item)}`,
            ].join("\n");
        });
        await replyMenu(
            ctx,
            [
                panelTitle(
                    `${objectIcon({ icon: detail?.object_icon || detail?.object_type || "house" })} ${detail.name || `#${deviceId}`}`,
                    "Септик",
                ),
                lines.map(escapeHtml).join("\n\n"),
                `${panelDivider()}\nВсего: ${list.length}   Аварии: ${alarms}`,
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
        const detail = await this.waitForSepticDetail(
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
                "Септик не найден.",
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
            panelTitle(`🚽 ${itemName(item, `Септик ${id}`)}`),
            "",
            `🔌 Питание: ${monitorOn(item) ? "🟢" : "⚪"}`,
            `📟 Статус: ${stateIcon(item)}`,
            `🚨 Авария: ${item?.alarm ? "🔴" : "⚪"}`,
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

    async toggleMonitor(
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
        const detail = await this.waitForSepticDetail(
            deviceId,
            nodeId,
            user,
            getScopedDetail,
        );
        const item = this.findItem(detail, itemId);
        if (!detail || !item) {
            await ctx.answerCallbackQuery({
                text: "Септик недоступен",
                show_alert: true,
            });
            return;
        }
        const nextState = monitorOn(item) ? "off" : "on";
        const summary = await this.registry.buildSummary(
            deviceId,
            this.devicesDb,
        );
        if (
            !summary ||
            !canSendControllerCommand(summary, user || {}, "septic", "monitor", {
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
            "septic",
            "monitor",
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
        await this.replyPatchedItem(
            ctx,
            detail,
            itemId,
            (current) => ({ ...current, monitoring_on: nextState === "on" }),
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
        const detail = await this.waitForSepticDetail(
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

    findItem(detail, itemId) {
        const list = this.list(detail);
        return list.find((item) => Number(item?.id) === Number(itemId)) || null;
    }

    list(detail) {
        if (Array.isArray(detail?.controllers?.septic)) {
            return detail.controllers.septic;
        }
        const septic =
            detail?.controllers?.septic &&
            typeof detail.controllers.septic === "object"
                ? detail.controllers.septic
                : null;
        if (!septic) return [];
        const enabledCount = Number(septic?.enabled_count ?? septic?.enabled ?? 0);
        if (!(enabledCount > 0 || septic?.warning || septic?.alarm)) {
            return [];
        }
        return [
            {
                id: Number(septic?.id || 1),
                enabled: true,
                group_id: Number(septic?.group_id || 0),
                name: septic?.name || "Септик",
                monitoring_on: Boolean(
                    septic?.monitoring_on ?? septic?.monitor_on ?? septic?.monitor,
                ),
                warning: Boolean(septic?.warning),
                alarm: Boolean(septic?.alarm),
            },
        ];
    }

    patchItem(detail, itemId, updater) {
        const list = this.list(detail);
        return {
            ...detail,
            controllers: {
                ...(detail?.controllers || {}),
                septic: list.map((item) =>
                    Number(item?.id) === Number(itemId)
                        ? updater({ ...item })
                        : item,
                ),
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
            panelTitle(`🚽 ${itemName(item, `Септик ${id}`)}`),
            "",
            `🔌 Питание: ${monitorOn(item) ? "🟢" : "⚪"}`,
            `📟 Статус: ${stateIcon(item)}`,
            `🚨 Авария: ${item?.alarm ? "🔴" : "⚪"}`,
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

    async waitForSepticDetail(
        deviceId,
        nodeId,
        user,
        getScopedDetail,
        options = {},
    ) {
        const forceRefresh = Boolean(options?.forceRefresh);
        let detail = await getScopedDetail(deviceId, nodeId, user);
        const hasSeptic = (value) => this.list(value).length > 0;
        if (!this.deviceWs) {
            return detail;
        }
        if (!forceRefresh && (hasSeptic(detail) || !nodeId)) {
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
            if (hasSeptic(detail)) {
                return detail;
            }
        }
        return detail;
    }

    buildKeyboard(detail, controllersCallbackData, mainMenuCallbackData) {
        const keyboard = new InlineKeyboard();
        const list = this.list(detail);
        const deviceId = Number(detail?.device_id);
        const nodeId = Number(detail?.node_id || 0);
        const buttons = [];
        for (const item of list) {
            const id = Number(item?.id);
            if (!Number.isFinite(id)) continue;
            buttons.push({
                label: buttonLabel(item, `Септик ${id}`),
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
            .text("◀️ Назад", controllersCallbackData(deviceId, nodeId));
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
                `${monitorOn(item) ? "🟢" : "⚪"} Питание`,
                this.monitorCallbackData(deviceId, nodeId, itemId),
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
        return `menu:controller:${Number(deviceId)}:${Number(nodeId || 0)}:septic`;
    }

    itemCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:septic:view:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}`;
    }

    monitorCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:septic:monitor:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}`;
    }

    refreshCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:septic:refresh:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}`;
    }

    delay(ms) {
        return new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, Number(ms) || 0)),
        );
    }
}
