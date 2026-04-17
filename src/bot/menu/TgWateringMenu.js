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

const WEEKDAY_BUTTONS = [
    { key: "mon", label: "Пн", bit: 1 },
    { key: "tue", label: "Вт", bit: 2 },
    { key: "wed", label: "Ср", bit: 3 },
    { key: "thu", label: "Чт", bit: 4 },
    { key: "fri", label: "Пт", bit: 5 },
    { key: "sat", label: "Сб", bit: 6 },
    { key: "sun", label: "Вс", bit: 0 },
];

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

function itemName(item, fallback) {
    const raw = String(item?.name || fallback).trim();
    return raw || fallback;
}

function wateringIcon(item) {
    if (item?.active) return "🟢";
    if (item?.paused) return "⏸";
    if (item?.enabled) return "💧";
    return "⚪";
}

function buttonLabel(item, fallback) {
    const raw = itemName(item, fallback);
    const short = raw.length > 14 ? `${raw.slice(0, 14)}…` : raw;
    return `${wateringIcon(item)} ${short}`;
}

function scheduleTime(item) {
    const hour = Number(item?.hour);
    const minute = Number(item?.minute);
    if (
        !Number.isInteger(hour) ||
        !Number.isInteger(minute) ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
    ) {
        return "--:--";
    }
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function slotInfo(item, slot = 1) {
    const safeSlot = Math.max(1, Math.min(3, Number(slot) || 1));
    if (safeSlot === 2) {
        return {
            hour: Number(item?.hour2),
            minute: Number(item?.minute2),
            duration_s: Number(item?.duration2_s),
        };
    }
    if (safeSlot === 3) {
        return {
            hour: Number(item?.hour3),
            minute: Number(item?.minute3),
            duration_s: Number(item?.duration3_s),
        };
    }
    return {
        hour: Number(item?.hour),
        minute: Number(item?.minute),
        duration_s: Number(item?.duration_s),
    };
}

function slotTimeLabel(item, slot = 1) {
    const info = slotInfo(item, slot);
    if (
        !Number.isInteger(info.hour) ||
        !Number.isInteger(info.minute) ||
        info.hour < 0 ||
        info.hour > 23 ||
        info.minute < 0 ||
        info.minute > 59
    ) {
        return "--:--";
    }
    return `${String(info.hour).padStart(2, "0")}:${String(info.minute).padStart(2, "0")}`;
}

function durationLabel(seconds) {
    const num = Number(seconds);
    if (!Number.isFinite(num) || num <= 0) return "—";
    const minutes = Math.round(num / 60);
    return `${minutes} мин`;
}

function weekdaysMask(item) {
    const mask = Number(item?.weekdays_mask);
    if (!Number.isFinite(mask)) return 0;
    return mask & 0x7f;
}

function weekdayChecked(mask, bit) {
    return (mask & (1 << bit)) !== 0;
}

function weekdaysLabel(mask) {
    const labels = WEEKDAY_BUTTONS.filter((day) => weekdayChecked(mask, day.bit))
        .map((day) => day.label);
    return labels.length ? labels.join(", ") : "не выбраны";
}

function tankLabel(item) {
    const name = String(item?.tank_name || "").trim();
    if (name) return name;
    const id = Number(item?.tank);
    return Number.isFinite(id) && id > 0 ? `Бак #${id}` : "не привязан";
}

function slotSummary(item) {
    const parts = [];
    for (const slot of [1, 2, 3]) {
        const info = slotInfo(item, slot);
        const validTime = slotTimeLabel(item, slot);
        if (validTime === "--:--" && (!Number.isFinite(info.duration_s) || info.duration_s <= 0)) {
            continue;
        }
        parts.push(`${slot}:${validTime}`);
    }
    return parts.length ? parts.join(" · ") : "слоты не заданы";
}

function clampTimePart(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return min;
    return Math.max(min, Math.min(max, Math.trunc(num)));
}

export class TgWateringMenu {
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
        const list = Array.isArray(detail?.controllers?.watering)
            ? detail.controllers.watering
            : [];
        if (!list.length) {
            await replyMenu(
                ctx,
                "Нет доступных правил полива.",
                this.buildBackKeyboard(
                    deviceId,
                    nodeId,
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }
        const activeCount = list.filter((item) => Boolean(item?.active)).length;
        const lines = list.map((item) => {
            const id = Number(item?.id);
            const mask = weekdaysMask(item);
            return [
                `${wateringIcon(item)} ${itemName(item, `Полив ${id}`)}`,
                `   ⏰ ${slotSummary(item)}  ·  📅 ${weekdaysLabel(mask)}`,
                `   🛢 ${tankLabel(item)}`,
            ].join("\n");
        });
        await replyMenu(
            ctx,
            [
                panelTitle(`💧 ${detail.name || `#${deviceId}`}`, "Полив"),
                lines.map(escapeHtml).join("\n\n"),
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
                "Правило полива не найдено.",
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
        const mask = weekdaysMask(item);
        const lines = [
            panelTitle(
                `💧 ${itemName(item, `Полив ${id}`)}`,
                `${detail.name || `#${deviceId}`}`,
            ),
            `${item?.enabled ? "🟢" : "⚪"} Контур: <b>${item?.enabled ? "ВКЛ" : "ВЫКЛ"}</b>`,
            `${item?.active ? "🟢" : "⚪"} Статус: <b>${item?.active ? "Активен" : "Остановлен"}</b>`,
            `${item?.paused ? "⏸" : "⚪"} Пауза: <b>${item?.paused ? "ДА" : "НЕТ"}</b>`,
            `🛢 Бак: <b>${escapeHtml(tankLabel(item))}</b>`,
            `⏰ Слот 1: <b>${escapeHtml(slotTimeLabel(item, 1))}</b> · <b>${escapeHtml(durationLabel(item?.duration_s))}</b>`,
            `📅 Дни: <b>${escapeHtml(weekdaysLabel(mask))}</b>`,
            `${
                Number.isInteger(Number(item?.hour2)) ||
                Number(item?.duration2_s) > 0
                    ? `⏰ Слот 2: <b>${escapeHtml(
                          slotTimeLabel(item, 2),
                      )}</b> · <b>${escapeHtml(durationLabel(item?.duration2_s))}</b>`
                    : ""
            }`,
            `${
                Number.isInteger(Number(item?.hour3)) ||
                Number(item?.duration3_s) > 0
                    ? `⏰ Слот 3: <b>${escapeHtml(
                          slotTimeLabel(item, 3),
                      )}</b> · <b>${escapeHtml(durationLabel(item?.duration3_s))}</b>`
                    : ""
            }`,
        ].filter(Boolean);
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

    async toggleStatus(
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
                text: "Полив недоступен",
                show_alert: true,
            });
            return;
        }
        const nextState = item?.active ? "off" : "on";
        const ok = await this.sendCommand({
            deviceId,
            nodeId,
            user,
            action: "status",
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
            text: nextState === "on" ? "Полив включаю..." : "Полив выключаю...",
        });
        await this.replyPatchedItem(
            ctx,
            detail,
            itemId,
            (current) => ({
                ...current,
                active: nextState === "on",
                enabled: nextState === "on" ? true : current?.enabled,
            }),
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        );
    }

    async toggleWeekday(
        ctx,
        {
            deviceId,
            nodeId = null,
            itemId,
            bit,
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
                text: "Полив недоступен",
                show_alert: true,
            });
            return;
        }
        const currentMask = weekdaysMask(item);
        const safeBit = clampTimePart(bit, 0, 6);
        const nextMask = currentMask ^ (1 << safeBit);
        const ok = await this.sendCommand({
            deviceId,
            nodeId,
            user,
            action: "weekdays",
            args: { id: Number(itemId), weekdays_mask: nextMask },
        });
        if (!ok) {
            await ctx.answerCallbackQuery({
                text: "Нет прав или устройство оффлайн",
                show_alert: true,
            });
            return;
        }
        const label =
            WEEKDAY_BUTTONS.find((day) => day.bit === safeBit)?.label || "День";
        await ctx.answerCallbackQuery({ text: `${label}: сохранено` });
        await this.replyPatchedItem(
            ctx,
            detail,
            itemId,
            (current) => ({ ...current, weekdays_mask: nextMask }),
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        );
    }

    async adjustTime(
        ctx,
        {
            deviceId,
            nodeId = null,
            itemId,
            slot = 1,
            hourDelta = 0,
            minuteDelta = 0,
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
                text: "Полив недоступен",
                show_alert: true,
            });
            return;
        }
        const safeSlot = clampTimePart(slot, 1, 3);
        const current = slotInfo(item, safeSlot);
        let hour = current.hour;
        let minute = current.minute;
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) hour = 0;
        if (!Number.isInteger(minute) || minute < 0 || minute > 59) minute = 0;
        let totalMinutes =
            hour * 60 +
            minute +
            Number(hourDelta || 0) * 60 +
            Number(minuteDelta || 0);
        totalMinutes %= 24 * 60;
        if (totalMinutes < 0) totalMinutes += 24 * 60;
        const nextHour = Math.floor(totalMinutes / 60);
        const nextMinute = totalMinutes % 60;
        const ok = await this.sendCommand({
            deviceId,
            nodeId,
            user,
            action: "time",
            args: {
                id: Number(itemId),
                slot: safeSlot,
                hour: nextHour,
                minute: nextMinute,
            },
        });
        if (!ok) {
            await ctx.answerCallbackQuery({
                text: "Нет прав или устройство оффлайн",
                show_alert: true,
            });
            return;
        }
        await ctx.answerCallbackQuery({
            text: `Слот ${safeSlot}: ${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`,
        });
        await this.replyPatchedSlotEditor(
            ctx,
            detail,
            itemId,
            safeSlot,
            (current) => this.patchSlot(current, safeSlot, {
                hour: nextHour,
                minute: nextMinute,
            }),
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        );
    }

    async adjustDuration(
        ctx,
        {
            deviceId,
            nodeId = null,
            itemId,
            slot = 1,
            deltaMinutes = 0,
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
                text: "Полив недоступен",
                show_alert: true,
            });
            return;
        }
        const safeSlot = clampTimePart(slot, 1, 3);
        const current = slotInfo(item, safeSlot);
        const currentSeconds = Number(current.duration_s);
        const nextSeconds = Math.max(
            0,
            Math.round(
                (Number.isFinite(currentSeconds) ? currentSeconds : 0) +
                    Number(deltaMinutes || 0) * 60,
            ),
        );
        const ok = await this.sendCommand({
            deviceId,
            nodeId,
            user,
            action: "duration",
            args: {
                id: Number(itemId),
                slot: safeSlot,
                duration_s: nextSeconds,
            },
        });
        if (!ok) {
            await ctx.answerCallbackQuery({
                text: "Нет прав или устройство оффлайн",
                show_alert: true,
            });
            return;
        }
        await ctx.answerCallbackQuery({
            text: `Слот ${safeSlot}: ${durationLabel(nextSeconds)}`,
        });
        await this.replyPatchedSlotEditor(
            ctx,
            detail,
            itemId,
            safeSlot,
            (current) => this.patchSlot(current, safeSlot, {
                duration_s: nextSeconds,
            }),
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        );
    }

    async openSlotEditor(
        ctx,
        {
            deviceId,
            nodeId = null,
            itemId,
            slot = 1,
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
                "Правило полива не найдено.",
                this.buildBackKeyboard(
                    deviceId,
                    nodeId,
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }
        const safeSlot = clampTimePart(slot, 1, 3);
        const info = slotInfo(item, safeSlot);
        const lines = [
            panelTitle(
                `💧 ${itemName(item, `Полив ${Number(item?.id)}`)}`,
                `Слот ${safeSlot} · ${detail.name || `#${deviceId}`}`,
            ),
            `🛢 Бак: <b>${escapeHtml(tankLabel(item))}</b>`,
            `⏰ Время: <b>${escapeHtml(slotTimeLabel(item, safeSlot))}</b>`,
            `⌛ Длительность: <b>${escapeHtml(durationLabel(info.duration_s))}</b>`,
            `📅 Дни: <b>${escapeHtml(weekdaysLabel(weekdaysMask(item)))}</b>`,
        ];
        await replyMenu(
            ctx,
            lines.join("\n"),
            this.buildSlotKeyboard(
                detail,
                item,
                safeSlot,
                controllersCallbackData,
                mainMenuCallbackData,
            ),
        );
    }

    async sendCommand({ deviceId, nodeId = null, user, action, args }) {
        const summary = await this.registry.buildSummary(
            deviceId,
            this.devicesDb,
        );
        if (
            !summary ||
            !canSendControllerCommand(
                summary,
                user || {},
                "watering",
                action,
                args || {},
            )
        ) {
            return false;
        }
        const result = this.deviceWs?.sendCmd(
            Number(deviceId),
            "watering",
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
        const list = Array.isArray(detail?.controllers?.watering)
            ? detail.controllers.watering
            : [];
        return list.find((item) => Number(item?.id) === Number(itemId)) || null;
    }

    patchItem(detail, itemId, updater) {
        return {
            ...detail,
            controllers: {
                ...(detail?.controllers || {}),
                watering: Array.isArray(detail?.controllers?.watering)
                    ? detail.controllers.watering.map((item) =>
                          Number(item?.id) === Number(itemId)
                              ? updater({ ...item })
                              : item,
                      )
                    : [],
            },
        };
    }

    patchSlot(item, slot, values) {
        const safeSlot = clampTimePart(slot, 1, 3);
        const next = { ...item };
        if (safeSlot === 2) {
            if (values.hour !== undefined) next.hour2 = values.hour;
            if (values.minute !== undefined) next.minute2 = values.minute;
            if (values.duration_s !== undefined) next.duration2_s = values.duration_s;
            return next;
        }
        if (safeSlot === 3) {
            if (values.hour !== undefined) next.hour3 = values.hour;
            if (values.minute !== undefined) next.minute3 = values.minute;
            if (values.duration_s !== undefined) next.duration3_s = values.duration_s;
            return next;
        }
        if (values.hour !== undefined) next.hour = values.hour;
        if (values.minute !== undefined) next.minute = values.minute;
        if (values.duration_s !== undefined) next.duration_s = values.duration_s;
        return next;
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
        const mask = weekdaysMask(item);
        const lines = [
            panelTitle(
                `💧 ${itemName(item, `Полив ${Number(item?.id)}`)}`,
                `${patched.name || `#${patched.device_id}`}`,
            ),
            `${wateringIcon(item)} Состояние: <b>${escapeHtml(
                item?.active ? "активен" : item?.paused ? "пауза" : item?.enabled ? "готов" : "выкл",
            )}</b>`,
            `🛢 Бак: <b>${escapeHtml(tankLabel(item))}</b>`,
            `📅 Дни: <b>${escapeHtml(weekdaysLabel(mask))}</b>`,
            `⏰ Слоты: <b>${escapeHtml(slotSummary(item))}</b>`,
        ].filter(Boolean);
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

    async replyPatchedSlotEditor(
        ctx,
        detail,
        itemId,
        slot,
        updater,
        replyMenu,
        mainMenuCallbackData,
        controllersCallbackData,
    ) {
        const patched = this.patchItem(detail, itemId, updater);
        const item = this.findItem(patched, itemId);
        if (!item) return;
        const safeSlot = clampTimePart(slot, 1, 3);
        const info = slotInfo(item, safeSlot);
        const lines = [
            panelTitle(
                `💧 ${itemName(item, `Полив ${Number(item?.id)}`)}`,
                `Слот ${safeSlot} · ${patched.name || `#${patched.device_id}`}`,
            ),
            `🛢 Бак: <b>${escapeHtml(tankLabel(item))}</b>`,
            `⏰ Время: <b>${escapeHtml(slotTimeLabel(item, safeSlot))}</b>`,
            `⌛ Длительность: <b>${escapeHtml(durationLabel(info.duration_s))}</b>`,
            `📅 Дни: <b>${escapeHtml(weekdaysLabel(weekdaysMask(item)))}</b>`,
        ];
        await replyMenu(
            ctx,
            lines.join("\n"),
            this.buildSlotKeyboard(
                patched,
                item,
                safeSlot,
                controllersCallbackData,
                mainMenuCallbackData,
            ),
        );
    }

    buildKeyboard(detail, controllersCallbackData, mainMenuCallbackData) {
        const keyboard = new InlineKeyboard();
        const list = Array.isArray(detail?.controllers?.watering)
            ? detail.controllers.watering
            : [];
        const deviceId = Number(detail?.device_id);
        const nodeId = Number(detail?.node_id || 0);
        const buttons = [];
        for (const item of list) {
            const id = Number(item?.id);
            if (!Number.isFinite(id)) continue;
            buttons.push({
                label: buttonLabel(item, `Полив ${id}`),
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
        const mask = weekdaysMask(item);
        keyboard
            .text(
                item?.active ? "⏻ Выключить полив" : "⏻ Включить полив",
                this.statusCallbackData(deviceId, nodeId, itemId),
            )
            .row();
        for (let i = 0; i < WEEKDAY_BUTTONS.length; i += 3) {
            const row = WEEKDAY_BUTTONS.slice(i, i + 3);
            for (const day of row) {
                keyboard.text(
                    `${weekdayChecked(mask, day.bit) ? "☑" : "☐"} ${day.label}`,
                    this.weekdayCallbackData(deviceId, nodeId, itemId, day.bit),
                );
            }
            keyboard.row();
        }
        keyboard
            .text("⏰ Слот 1", this.slotViewCallbackData(deviceId, nodeId, itemId, 1))
            .text("⏰ Слот 2", this.slotViewCallbackData(deviceId, nodeId, itemId, 2))
            .text("⏰ Слот 3", this.slotViewCallbackData(deviceId, nodeId, itemId, 3))
            .row();
        keyboard
            .text(
                "💧 К списку полива",
                this.controllerCallbackData(deviceId, nodeId),
            )
            .row();
        keyboard.text("🧩 Контроллеры", controllersCallbackData(deviceId, nodeId));
        return keyboard;
    }

    buildSlotKeyboard(
        detail,
        item,
        slot,
        controllersCallbackData,
        mainMenuCallbackData,
    ) {
        const keyboard = new InlineKeyboard();
        const deviceId = Number(detail?.device_id);
        const nodeId = Number(detail?.node_id || 0);
        const itemId = Number(item?.id);
        const safeSlot = clampTimePart(slot, 1, 3);
        keyboard
            .text(
                "−1ч",
                this.timeCallbackData(deviceId, nodeId, itemId, safeSlot, -1, 0),
            )
            .text(
                "−1м",
                this.timeCallbackData(deviceId, nodeId, itemId, safeSlot, 0, -1),
            )
            .text(
                "+1м",
                this.timeCallbackData(deviceId, nodeId, itemId, safeSlot, 0, 1),
            )
            .text(
                "+1ч",
                this.timeCallbackData(deviceId, nodeId, itemId, safeSlot, 1, 0),
            )
            .row();
        keyboard
            .text(
                "−1м",
                this.durationCallbackData(
                    deviceId,
                    nodeId,
                    itemId,
                    safeSlot,
                    -1,
                ),
            )
            .text(
                "+1м",
                this.durationCallbackData(
                    deviceId,
                    nodeId,
                    itemId,
                    safeSlot,
                    1,
                ),
            )
            .row();
        keyboard
            .text("⏰ Слот 1", this.slotViewCallbackData(deviceId, nodeId, itemId, 1))
            .text("⏰ Слот 2", this.slotViewCallbackData(deviceId, nodeId, itemId, 2))
            .text("⏰ Слот 3", this.slotViewCallbackData(deviceId, nodeId, itemId, 3))
            .row();
        keyboard
            .text(
                "💧 К правилу",
                this.itemCallbackData(deviceId, nodeId, itemId),
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
        return `menu:controller:${Number(deviceId)}:${Number(nodeId || 0)}:watering`;
    }

    itemCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:watering:view:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}`;
    }

    statusCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:watering:status:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}`;
    }

    weekdayCallbackData(deviceId, nodeId = 0, itemId, bit) {
        return `menu:watering:day:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}:${Number(bit)}`;
    }

    slotViewCallbackData(deviceId, nodeId = 0, itemId, slot = 1) {
        return `menu:watering:slot:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}:${Number(slot || 1)}`;
    }

    timeCallbackData(
        deviceId,
        nodeId = 0,
        itemId,
        slot = 1,
        hourDelta = 0,
        minuteDelta = 0,
    ) {
        return `menu:watering:time:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}:${Number(slot || 1)}:${Number(hourDelta || 0)}:${Number(minuteDelta || 0)}`;
    }

    durationCallbackData(
        deviceId,
        nodeId = 0,
        itemId,
        slot = 1,
        deltaMinutes = 0,
    ) {
        return `menu:watering:duration:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}:${Number(slot || 1)}:${Number(deltaMinutes || 0)}`;
    }

    delay(ms) {
        return new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, Number(ms) || 0)),
        );
    }
}
