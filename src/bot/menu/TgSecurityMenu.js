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

function sensorStateIcon(sensor) {
    if (!sensor?.enabled) return "⚪";
    if (sensor?.detect) return sensor?.silent ? "🟡" : "🔴";
    return "🟢";
}

function sensorTypeLabel(sensor) {
    const type = String(sensor?.type || "").trim();
    return type || "-";
}

function itemName(item, fallback) {
    const raw = String(item?.name || fallback).trim();
    return raw || fallback;
}

export class TgSecurityMenu {
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

        const security =
            detail?.controllers?.security &&
            typeof detail.controllers.security === "object"
                ? detail.controllers.security
                : null;

        if (!security) {
            await replyMenu(
                ctx,
                "Охрана недоступна.",
                this.buildBackKeyboard(
                    deviceId,
                    nodeId,
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }

        const sensors = Array.isArray(security?.sensors) ? security.sensors : [];
        const detectedCount = sensors.length
            ? sensors.filter((item) => Boolean(item?.detect)).length
            : Number(security?.detected_count ?? 0);
        const enabledSensors = sensors.length
            ? sensors.filter((item) => Boolean(item?.enabled)).length
            : Number(security?.sensors_enabled ?? 0);
        const lines = [
            panelTitle(
                `${objectIcon({ icon: detail?.object_icon || detail?.object_type || "house" })} ${detail.name || `#${deviceId}`}`,
                "Охрана",
            ),
            `🛡 Контур: ${security?.enabled ? "🟢" : "⚪"}`,
            `🔐 Режим: <b>${security?.armed ? "На охране" : "Снято"}</b>`,
            `🚨 Тревога: ${security?.alarm ? "🔴" : "⚪"}`,
            `🧩 Датчики: <b>${enabledSensors}</b>`,
            `⚠️ Сработки: <b>${detectedCount}</b>`,
        ];

        if (sensors.length) {
            lines.push("");
            lines.push(
                sensors
                    .slice(0, 8)
                    .map((sensor) => {
                        const id = Number(sensor?.id);
                        return `${sensorStateIcon(sensor)} ${itemName(sensor, `Датчик ${id}`)} · ${sensorTypeLabel(sensor)}`;
                    })
                    .join("\n"),
            );
        }

        await replyMenu(
            ctx,
            lines.join("\n"),
            this.buildItemKeyboard(
                detail,
                security,
                controllersCallbackData,
                mainMenuCallbackData,
            ),
        );
    }

    async toggleArmed(
        ctx,
        {
            deviceId,
            nodeId = null,
            user,
            getScopedDetail,
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
            arm = true,
        },
    ) {
        const detail = await getScopedDetail(deviceId, nodeId, user);
        const security =
            detail?.controllers?.security &&
            typeof detail.controllers.security === "object"
                ? detail.controllers.security
                : null;
        if (!detail || !security) {
            await ctx.answerCallbackQuery({
                text: "Охрана недоступна",
                show_alert: true,
            });
            return;
        }

        const summary = await this.registry.buildSummary(deviceId, this.devicesDb);
        const action = arm ? "arm" : "disarm";
        if (!summary || !canSendControllerCommand(summary, user || {}, "security", action, {})) {
            await ctx.answerCallbackQuery({
                text: "Нет прав на управление",
                show_alert: true,
            });
            return;
        }

        const result = this.deviceWs?.sendCmd(
            Number(deviceId),
            "security",
            action,
            {},
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
            text: arm ? "Ставлю на охрану..." : "Снимаю с охраны...",
        });

        const freshDetail = await this.waitForFreshDetail(
            deviceId,
            nodeId,
            user,
            getScopedDetail,
            arm,
        );
        await this.replyFreshItem(
            ctx,
            freshDetail ||
                this.patchSecurity(detail, (current) => ({
                    ...current,
                    armed: arm,
                    alarm: arm ? current?.alarm : false,
                })),
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        );
    }

    async refresh(
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
        await ctx.answerCallbackQuery({ text: "Обновляю..." });
        await this.open(ctx, {
            deviceId,
            nodeId,
            user,
            getScopedDetail,
            replyMenu,
            mainMenuCallbackData,
            controllersCallbackData,
        });
    }

    patchSecurity(detail, updater) {
        return {
            ...detail,
            controllers: {
                ...(detail?.controllers || {}),
                security:
                    detail?.controllers?.security &&
                    typeof detail.controllers.security === "object"
                        ? updater({ ...detail.controllers.security })
                        : null,
            },
        };
    }

    async waitForFreshDetail(
        deviceId,
        nodeId,
        user,
        getScopedDetail,
        expectedArmed,
    ) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            await this.delay(350);
            const detail = await getScopedDetail(deviceId, nodeId, user);
            const security = detail?.controllers?.security;
            if (
                detail &&
                security &&
                Boolean(security?.armed) === Boolean(expectedArmed)
            ) {
                return detail;
            }
        }
        return await getScopedDetail(deviceId, nodeId, user);
    }

    async replyFreshItem(
        ctx,
        detail,
        replyMenu,
        mainMenuCallbackData,
        controllersCallbackData,
    ) {
        const security =
            detail?.controllers?.security &&
            typeof detail.controllers.security === "object"
                ? detail.controllers.security
                : null;
        if (!detail || !security) return;
        const sensors = Array.isArray(security?.sensors) ? security.sensors : [];
        const detectedCount = sensors.length
            ? sensors.filter((item) => Boolean(item?.detect)).length
            : Number(security?.detected_count ?? 0);
        const enabledSensors = sensors.length
            ? sensors.filter((item) => Boolean(item?.enabled)).length
            : Number(security?.sensors_enabled ?? 0);
        const lines = [
            panelTitle(`🛡 Охрана`),
            `🛡 Контур: ${security?.enabled ? "🟢" : "⚪"}`,
            `🔐 Режим: <b>${security?.armed ? "На охране" : "Снято"}</b>`,
            `🚨 Тревога: ${security?.alarm ? "🔴" : "⚪"}`,
            `🧩 Датчики: <b>${enabledSensors}</b>`,
            `⚠️ Сработки: <b>${detectedCount}</b>`,
        ];
        await replyMenu(
            ctx,
            lines.join("\n"),
            this.buildItemKeyboard(
                detail,
                security,
                controllersCallbackData,
                mainMenuCallbackData,
            ),
            { force_new_message: true },
        );
    }

    buildItemKeyboard(
        detail,
        security,
        controllersCallbackData,
        mainMenuCallbackData,
    ) {
        const keyboard = new InlineKeyboard();
        const deviceId = Number(detail?.device_id);
        const nodeId = Number(detail?.node_id || 0);
        keyboard
            .text(
                `${security?.armed ? "⚪" : "🟢"} На охрану`,
                this.armCallbackData(deviceId, nodeId, true),
            )
            .text(
                `${security?.armed ? "🟢" : "⚪"} Снять`,
                this.armCallbackData(deviceId, nodeId, false),
            )
            .row();
        keyboard
            .text("🔄 Обновить", this.refreshCallbackData(deviceId, nodeId))
            .text("◀️ Назад", controllersCallbackData(deviceId, nodeId));
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
        return `menu:controller:${Number(deviceId)}:${Number(nodeId || 0)}:security`;
    }

    armCallbackData(deviceId, nodeId = 0, arm = true) {
        return `menu:security:${arm ? "arm" : "disarm"}:${Number(deviceId)}:${Number(nodeId || 0)}`;
    }

    refreshCallbackData(deviceId, nodeId = 0) {
        return `menu:security:refresh:${Number(deviceId)}:${Number(nodeId || 0)}`;
    }

    delay(ms) {
        return new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, Number(ms) || 0)),
        );
    }
}
