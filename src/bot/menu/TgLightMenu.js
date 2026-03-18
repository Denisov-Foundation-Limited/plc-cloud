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

function buttonLabel(name, state, fallback) {
    const raw = String(name || fallback).trim();
    const short = raw.length > 15 ? `${raw.slice(0, 15)}…` : raw;
    return `${state ? "🟡" : "⚪"} ${short}`;
}

export class TgLightMenu {
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
                new InlineKeyboard().text("Главное меню", mainMenuCallbackData),
            );
            return;
        }
        await this.renderDetail(
            ctx,
            detail,
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        );
    }

    async renderDetail(
        ctx,
        detail,
        replyMenu,
        mainMenuCallbackData,
        controllersCallbackData,
    ) {
        const list = Array.isArray(detail?.controllers?.lights)
            ? detail.controllers.lights
            : [];
        if (!list.length) {
            await replyMenu(
                ctx,
                "Нет доступного света.",
                this.buildBackKeyboard(
                    deviceId,
                    nodeId,
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }
        const activeCount = list.filter((item) => Boolean(item?.state)).length;
        const lines = list.map((item) => {
            const state = Boolean(item?.state);
            return `${state ? "🟡" : "⚪"} ${String(item?.name || `Свет ${Number(item?.id)}`).trim()}`;
        });
        await replyMenu(
            ctx,
            [
                panelTitle(`💡 ${detail.name || `#${deviceId}`}`, "Освещение"),
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

    async toggle(
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
        const summary = await this.registry.buildSummary(
            deviceId,
            this.devicesDb,
        );
        if (!summary) {
            await ctx.answerCallbackQuery({
                text: "Устройство оффлайн",
                show_alert: true,
            });
            return;
        }
        if (
            !canSendControllerCommand(summary, user || {}, "lights", "toggle", {
                id: itemId,
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
            "lights",
            "toggle",
            { id: Number(itemId) },
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
        const detail = await getScopedDetail(deviceId, nodeId, user);
        this.deviceWs?.sendGet(
            Number(deviceId),
            ["controllers"],
            nodeId ? "stack" : "local",
            nodeId || undefined,
        );
        await ctx.answerCallbackQuery({ text: "Переключаю..." });
        if (!detail) return;
        await this.renderDetail(
            ctx,
            this.patchOneState(detail, itemId, (current) => !current),
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        );
    }

    async setAll(
        ctx,
        {
            deviceId,
            nodeId = null,
            state,
            user,
            getScopedDetail,
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        },
    ) {
        const detail = await getScopedDetail(deviceId, nodeId, user);
        if (!detail) {
            await ctx.answerCallbackQuery({
                text: "Устройство недоступно",
                show_alert: true,
            });
            return;
        }
        const list = Array.isArray(detail?.controllers?.lights)
            ? detail.controllers.lights
            : [];
        if (!list.length) {
            await ctx.answerCallbackQuery({
                text: "Нет доступного света",
                show_alert: true,
            });
            return;
        }
        const targetState = state === "on" ? "on" : "off";
        const actor = {
            uid: user?.username || user?.plc_username || "",
            username: user?.username || "",
            plc_username: user?.plc_username || "",
            source: "telegram",
            session_id: `tg:${String(user?.chat_id || "")}`,
        };
        for (const item of list) {
            const id = Number(item?.id);
            if (!Number.isFinite(id)) continue;
            if (
                !canSendControllerCommand(
                    await this.registry.buildSummary(deviceId, this.devicesDb),
                    user || {},
                    "lights",
                    "set",
                    { id, state: targetState },
                )
            ) {
                continue;
            }
            this.deviceWs?.sendCmd(
                Number(deviceId),
                "lights",
                "set",
                { id, state: targetState },
                actor,
                nodeId ? "stack" : "local",
                nodeId || undefined,
            );
        }
        this.deviceWs?.sendGet(
            Number(deviceId),
            ["controllers"],
            nodeId ? "stack" : "local",
            nodeId || undefined,
        );
        await ctx.answerCallbackQuery({
            text: targetState === "on" ? "Включаю все..." : "Выключаю все...",
        });
        await this.renderDetail(
            ctx,
            this.patchAllStates(detail, targetState === "on"),
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        );
    }

    buildKeyboard(detail, controllersCallbackData, mainMenuCallbackData) {
        const keyboard = new InlineKeyboard();
        const list = Array.isArray(detail?.controllers?.lights)
            ? detail.controllers.lights
            : [];
        const deviceId = Number(detail?.device_id);
        const nodeId = Number(detail?.node_id || 0);
        const buttons = [];
        for (const item of list) {
            const id = Number(item?.id);
            if (!Number.isFinite(id)) continue;
            const state = Boolean(item?.state);
            buttons.push({
                label: buttonLabel(item?.name, state, `Свет ${id}`),
                data: this.toggleCallbackData(deviceId, nodeId, id),
            });
        }
        keyboard.text(
            "🟡 Вкл все",
            this.setAllCallbackData(deviceId, nodeId, "on"),
        );
        keyboard.text(
            "⚪ Выкл все",
            this.setAllCallbackData(deviceId, nodeId, "off"),
        );
        keyboard.row();
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
        return `menu:controller:${Number(deviceId)}:${Number(nodeId || 0)}:lights`;
    }

    toggleCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:toggle:${Number(deviceId)}:${Number(nodeId || 0)}:lights:${Number(itemId)}`;
    }

    setAllCallbackData(deviceId, nodeId = 0, state = "off") {
        return `menu:setall:${Number(deviceId)}:${Number(nodeId || 0)}:lights:${state === "on" ? "on" : "off"}`;
    }

    delay(ms) {
        return new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, Number(ms) || 0)),
        );
    }

    patchOneState(detail, itemId, updater) {
        const next = {
            ...detail,
            controllers: {
                ...(detail?.controllers || {}),
                lights: Array.isArray(detail?.controllers?.lights)
                    ? detail.controllers.lights.map((item) => {
                          if (Number(item?.id) !== Number(itemId)) return item;
                          const current = Boolean(item?.state);
                          return { ...item, state: Boolean(updater(current)) };
                      })
                    : [],
            },
        };
        return next;
    }

    patchAllStates(detail, state) {
        return {
            ...detail,
            controllers: {
                ...(detail?.controllers || {}),
                lights: Array.isArray(detail?.controllers?.lights)
                    ? detail.controllers.lights.map((item) => ({
                          ...item,
                          state: Boolean(state),
                      }))
                    : [],
            },
        };
    }
}
