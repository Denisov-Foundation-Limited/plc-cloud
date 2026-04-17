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
import { rootLogger } from "../../utils/Logger.js";

const logger = rootLogger.child("TG_BOT");

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

function buttonLabel(name, state, fallback, id = 0) {
    const raw = String(name || fallback).trim();
    const prefix = Number.isFinite(Number(id)) && Number(id) > 0 ? `#${Number(id)} ` : "";
    const short = raw.length > 11 ? `${raw.slice(0, 11)}…` : raw;
    return `${state ? "🟢" : "⚪"} ${prefix}${short}`;
}

async function safeAnswerCallbackQuery(ctx, options = {}) {
    if (!ctx?.callbackQuery?.id) return;
    await ctx.answerCallbackQuery(options);
}

export class TgSocketMenu {
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
        const detail = await this.waitForSocketDetail(
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
        const list = Array.isArray(detail?.controllers?.sockets)
            ? detail.controllers.sockets
            : [];
        if (!list.length) {
            await replyMenu(
                ctx,
                "Нет доступных розеток.",
                this.buildBackKeyboard(
                    Number(detail?.device_id || 0),
                    Number(detail?.node_id || 0),
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }
        const activeCount = list.filter((item) => Boolean(item?.state)).length;
        const lines = list.map((item) => {
            const state = Boolean(item?.state);
            return `${state ? "🟢" : "⚪"} ${String(item?.name || `Розетка ${Number(item?.id)}`).trim()}`;
        });
        await replyMenu(
            ctx,
            [
                panelTitle(`🔌 ${detail.name || `#${deviceId}`}`, "Розетки"),
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

    async waitForSocketDetail(deviceId, nodeId, user, getScopedDetail) {
        let detail = await getScopedDetail(deviceId, nodeId, user);
        const hasSockets = (value) =>
            Array.isArray(value?.controllers?.sockets) &&
            value.controllers.sockets.length > 0;
        if (hasSockets(detail) || !nodeId || !this.deviceWs) {
            return detail;
        }
        const startedAt = Date.now();
        while (Date.now() - startedAt < 5000) {
            this.deviceWs.sendGet(
                Number(deviceId),
                ["system", "controllers"],
                "stack",
                nodeId || undefined,
            );
            await this.delay(250);
            detail = await getScopedDetail(deviceId, nodeId, user);
            if (hasSockets(detail)) {
                return detail;
            }
        }
        return detail;
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
            await safeAnswerCallbackQuery(ctx, {
                text: "Устройство оффлайн",
                show_alert: true,
            });
            return;
        }
        if (
            !canSendControllerCommand(
                summary,
                user || {},
                "sockets",
                "toggle",
                { id: itemId },
            )
        ) {
            await safeAnswerCallbackQuery(ctx, {
                text: "Нет прав на управление",
                show_alert: true,
            });
            return;
        }
        const result = this.deviceWs?.sendCmd(
            Number(deviceId),
            "sockets",
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
        logger.info(
            `telegram sockets toggle dispatch: device_id: ${Number(deviceId)} node_id: ${Number(nodeId || 0)} item_id: ${Number(itemId)} sent: ${result?.ok ? "yes" : "no"}`,
        );
        if (!result?.ok) {
            await safeAnswerCallbackQuery(ctx, {
                text: "Команда не отправлена",
                show_alert: true,
            });
            return;
        }
        const detail = await getScopedDetail(deviceId, nodeId, user);
        const currentItem = Array.isArray(detail?.controllers?.sockets)
            ? detail.controllers.sockets.find(
                  (item) => Number(item?.id) === Number(itemId),
              )
            : null;
        const expectedState = currentItem ? !Boolean(currentItem.state) : null;
        this.deviceWs?.sendGet(
            Number(deviceId),
            nodeId ? ["system", "controllers"] : ["controllers"],
            nodeId ? "stack" : "local",
            nodeId || undefined,
        );
        await safeAnswerCallbackQuery(ctx, { text: "Переключаю..." });
        if (!detail) return;
        const refreshed = await this.waitForSocketState(
            Number(deviceId),
            nodeId,
            user,
            getScopedDetail,
            Number(itemId),
            expectedState,
        );
        await this.renderDetail(
            ctx,
            refreshed || detail,
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
            await safeAnswerCallbackQuery(ctx, {
                text: "Устройство недоступно",
                show_alert: true,
            });
            return;
        }
        const list = Array.isArray(detail?.controllers?.sockets)
            ? detail.controllers.sockets
            : [];
        if (!list.length) {
            await safeAnswerCallbackQuery(ctx, {
                text: "Нет доступных розеток",
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
                    "sockets",
                    "set",
                    { id, state: targetState },
                )
            ) {
                continue;
            }
            this.deviceWs?.sendCmd(
                Number(deviceId),
                "sockets",
                "set",
                { id, state: targetState },
                actor,
                nodeId ? "stack" : "local",
                nodeId || undefined,
            );
        }
        this.deviceWs?.sendGet(
            Number(deviceId),
            nodeId ? ["system", "controllers"] : ["controllers"],
            nodeId ? "stack" : "local",
            nodeId || undefined,
        );
        await safeAnswerCallbackQuery(ctx, {
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
        const list = Array.isArray(detail?.controllers?.sockets)
            ? detail.controllers.sockets
            : [];
        const deviceId = Number(detail?.device_id);
        const nodeId = Number(detail?.node_id || 0);
        const buttons = [];
        for (const item of list) {
            const id = Number(item?.id);
            if (!Number.isFinite(id)) continue;
            const state = Boolean(item?.state);
            buttons.push({
                label: buttonLabel(item?.name, state, `Розетка ${id}`, id),
                data: this.toggleCallbackData(deviceId, nodeId, id),
            });
        }
        keyboard.text(
            "🟢 Вкл все",
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
        return `menu:controller:${Number(deviceId)}:${Number(nodeId || 0)}:sockets`;
    }

    toggleCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:toggle:${Number(deviceId)}:${Number(nodeId || 0)}:sockets:${Number(itemId)}`;
    }

    setAllCallbackData(deviceId, nodeId = 0, state = "off") {
        return `menu:setall:${Number(deviceId)}:${Number(nodeId || 0)}:sockets:${state === "on" ? "on" : "off"}`;
    }

    delay(ms) {
        return new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, Number(ms) || 0)),
        );
    }

    async waitForSocketState(
        deviceId,
        nodeId,
        user,
        getScopedDetail,
        itemId,
        expectedState = null,
    ) {
        const startedAt = Date.now();
        let lastDetail = await getScopedDetail(deviceId, nodeId, user);
        while (Date.now() - startedAt < 3000) {
            this.deviceWs?.sendGet(
                Number(deviceId),
                nodeId ? ["system", "controllers"] : ["controllers"],
                nodeId ? "stack" : "local",
                nodeId || undefined,
            );
            await this.delay(250);
            lastDetail = await getScopedDetail(deviceId, nodeId, user);
            const item = Array.isArray(lastDetail?.controllers?.sockets)
                ? lastDetail.controllers.sockets.find(
                      (entry) => Number(entry?.id) === Number(itemId),
                  )
                : null;
            if (!item) continue;
            if (expectedState === null) return lastDetail;
            if (Boolean(item.state) === Boolean(expectedState)) return lastDetail;
        }
        return lastDetail;
    }

    patchOneState(detail, itemId, updater) {
        const next = {
            ...detail,
            controllers: {
                ...(detail?.controllers || {}),
                sockets: Array.isArray(detail?.controllers?.sockets)
                    ? detail.controllers.sockets.map((item) => {
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
                sockets: Array.isArray(detail?.controllers?.sockets)
                    ? detail.controllers.sockets.map((item) => ({
                          ...item,
                          state: Boolean(state),
                      }))
                    : [],
            },
        };
    }
}
