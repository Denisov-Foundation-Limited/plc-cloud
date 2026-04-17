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

function sensorTypeIcon(sensor) {
    const type = String(sensor?.type || "").toLowerCase();
    const name = String(sensor?.name || "").toLowerCase();
    if (
        name.includes("улиц") ||
        name.includes("outdoor") ||
        name.includes("street")
    )
        return "🌤";
    if (
        name.includes("дом") ||
        name.includes("комнат") ||
        name.includes("room") ||
        name.includes("inside")
    )
        return "🏠";
    if (type === "dht22") return "🌦";
    if (type.includes("temp")) return "🌡";
    return "🌤";
}

function formatTemperature(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    return `${num.toFixed(1)}°C`;
}

function formatHumidity(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    return `${Math.round(num)}%`;
}

function sensorStatusIcon(sensor) {
    if (!sensor?.enabled) return "⚪";
    if (sensor?.ok === false) return "🟠";
    return "🟢";
}

function sensorName(sensor, fallback) {
    return String(sensor?.name || fallback).trim();
}

function compactLabel(value, max = 24) {
    const raw = String(value || "").trim();
    if (!raw) return "-";
    return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

export class TgMeteoMenu {
    constructor({ registry, devicesDb }) {
        this.registry = registry;
        this.devicesDb = devicesDb;
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

        const list = Array.isArray(detail?.controllers?.meteo)
            ? detail.controllers.meteo
            : [];
        if (!list.length) {
            await replyMenu(
                ctx,
                "Нет доступных метео-датчиков.",
                this.buildBackKeyboard(
                    deviceId,
                    nodeId,
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }

        const rows = list.map((sensor, index) => {
            const id = Number(sensor?.id);
            const title = sensorName(
                sensor,
                `Метео ${Number.isFinite(id) ? id : "?"}`,
            );
            const temp = formatTemperature(
                sensor?.temperature_c ?? sensor?.temp_c ?? sensor?.temperature,
            );
            const humidityValue =
                sensor?.humidity ?? sensor?.humidity_pct ?? sensor?.hum;
            const hum = formatHumidity(humidityValue);
            const metrics = [`🌡 ${temp}`];
            if (hum !== "-") {
                metrics.push(`💧 ${hum}`);
            }
            if (sensor?.enabled && sensor?.ok === false) {
                metrics.push("🟠 ошибка");
            }
            if (!sensor?.enabled) {
                metrics.push("⚪ отключен");
            }
            return [
                `${index + 1}. ${sensorTypeIcon(sensor)} ${compactLabel(title)}`,
                `   ${metrics.join("   ")}`,
            ].join("\n");
        });

        await replyMenu(
            ctx,
            [
                panelTitle(`🌤 ${detail.name || `#${deviceId}`}`, "Метео"),
                rows.map(escapeHtml).join("\n\n"),
            ].join("\n\n"),
            this.buildKeyboard(
                detail,
                controllersCallbackData,
                mainMenuCallbackData,
            ),
        );
    }

    buildKeyboard(detail, controllersCallbackData, mainMenuCallbackData) {
        const keyboard = new InlineKeyboard();
        const list = Array.isArray(detail?.controllers?.meteo)
            ? detail.controllers.meteo
            : [];
        const enabledCount = list.filter((sensor) => sensor?.enabled).length;
        keyboard
            .text(`🌤 Датчики: ${list.length}`, "menu:noop")
            .text(`🟢 Активно: ${enabledCount}`, "menu:noop")
            .row();
        keyboard
            .text(
                "🧩 Контроллеры",
                controllersCallbackData(
                    Number(detail?.device_id),
                    Number(detail?.node_id || 0),
                ),
            );
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
        return `menu:controller:${Number(deviceId)}:${Number(nodeId || 0)}:meteo`;
    }
}
