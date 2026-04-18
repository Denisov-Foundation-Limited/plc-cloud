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
import { InlineKeyboard, InputFile } from "grammy";
import { renderMeteoChart } from "../utils/MeteoChartRenderer.js";

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

function panelDivider() {
    return "━━━━━━━━━━━━━━━━━";
}

function metricValue(sensor, keys = []) {
    for (const key of keys) {
        if (
            sensor &&
            Object.prototype.hasOwnProperty.call(sensor, key) &&
            sensor[key] !== null &&
            sensor[key] !== undefined
        ) {
            return sensor[key];
        }
    }
    return undefined;
}

function sensorBusAddress(sensor) {
    const candidates = [
        sensor?.ds18_addr,
        sensor?.ds18b20_addr,
        sensor?.address,
        sensor?.addr,
        sensor?.onewire_addr,
        sensor?.serial,
    ];
    for (const candidate of candidates) {
        const raw = String(candidate ?? "").trim();
        if (raw) return raw;
    }
    return "";
}

function sensorHistoryRange(history = []) {
    if (!Array.isArray(history) || history.length < 2) return "";
    const start = new Date(Number(history[0]?.ts || 0));
    const end = new Date(Number(history[history.length - 1]?.ts || 0));
    const hhmm = (value) =>
        Number.isFinite(value.getTime())
            ? `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`
            : "--:--";
    return `${hhmm(start)}-${hhmm(end)}`;
}

function sparkline(values = []) {
    const blocks = "▁▂▃▄▅▆▇█";
    const numeric = values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
    if (!numeric.length) return "—";
    if (numeric.length === 1) return blocks[3];
    const min = Math.min(...numeric);
    const max = Math.max(...numeric);
    if (max - min < 0.0001) {
        return blocks[3].repeat(numeric.length);
    }
    return numeric
        .map((value) => {
            const ratio = (value - min) / (max - min);
            const idx = Math.max(
                0,
                Math.min(blocks.length - 1, Math.round(ratio * (blocks.length - 1))),
            );
            return blocks[idx];
        })
        .join("");
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
                detail?._controller_loading === "meteo"
                    ? "Данные метео-датчиков со слейва ещё загружаются."
                    : "Нет доступных метео-датчиков.",
                this.buildBackKeyboard(
                    deviceId,
                    nodeId,
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }

        const rows = list.map((sensor) => {
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
                `${sensorTypeIcon(sensor)} ${compactLabel(title)}`,
                `      ${metrics.join("   ")}`,
            ].join("\n");
        });

        await replyMenu(
            ctx,
            [
                panelTitle(`🌤 ${detail.name || `#${deviceId}`}`, "Метео"),
                rows.map(escapeHtml).join("\n\n"),
                `━━━━━━━━━━━━━━━━━\nВсего: ${list.length}   Активно: ${list.filter((sensor) => sensor?.enabled).length}`,
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

        const list = Array.isArray(detail?.controllers?.meteo)
            ? detail.controllers.meteo
            : [];
        const sensor = list.find((item) => Number(item?.id) === Number(itemId));
        if (!sensor) {
            await replyMenu(
                ctx,
                "Датчик не найден.",
                this.buildKeyboard(
                    detail,
                    controllersCallbackData,
                    mainMenuCallbackData,
                ),
            );
            return;
        }

        const history = this.registry.getMeteoHistory(deviceId, Number(itemId), {
            nodeId: Number(nodeId || 0) || null,
        });
        const tempSeries = history
            .map((entry) => Number(entry?.temp_c))
            .filter((value) => Number.isFinite(value))
            .slice(-24);
        const humiditySeries = history
            .map((entry) => Number(entry?.humidity))
            .filter((value) => Number.isFinite(value))
            .slice(-24);
        const tempNow = formatTemperature(
            metricValue(sensor, ["temperature_c", "temp_c", "temperature"]),
        );
        const humidityNow = formatHumidity(
            metricValue(sensor, ["humidity", "humidity_pct", "hum"]),
        );
        const hasHumidity =
            Number.isFinite(
                Number(metricValue(sensor, ["humidity", "humidity_pct", "hum"])),
            ) || humiditySeries.length > 0;
        const typeLabel = String(sensor?.type || "").trim() || "-";
        const busAddress = sensorBusAddress(sensor);
        const historyWindow = sensorHistoryRange(history);
        const lines = [
            panelTitle(
                `${sensorTypeIcon(sensor)} ${sensorName(sensor, `Метео ${Number(itemId)}`)}`,
                `${detail.name || `#${deviceId}`}`,
            ),
            `${sensorStatusIcon(sensor)} <b>${escapeHtml(sensor?.ok === false ? "ошибка датчика" : sensor?.enabled === false ? "датчик отключен" : "датчик активен")}</b>`,
            `🪪 ID: <b>${escapeHtml(String(Number(itemId)))}</b>`,
            `🏷 Тип: <b>${escapeHtml(typeLabel)}</b>`,
            ...(busAddress ? [`🔗 Адрес: <code><b>${escapeHtml(busAddress)}</b></code>`] : []),
            `🌡 Температура: <b>${escapeHtml(tempNow)}</b>`,
            ...(hasHumidity ? [`💧 Влажность: <b>${escapeHtml(humidityNow)}</b>`] : []),
            `${panelDivider()}`,
            `<b>Температура</b>${historyWindow ? ` <code>${escapeHtml(historyWindow)}</code>` : ""}`,
            `<code>${escapeHtml(sparkline(tempSeries))}</code>`,
            tempSeries.length
                ? `min: <b>${escapeHtml(formatTemperature(Math.min(...tempSeries)))}</b>   max: <b>${escapeHtml(formatTemperature(Math.max(...tempSeries)))}</b>`
                : "История температуры собирается…",
        ];

        if (hasHumidity) {
            lines.push(
                `${panelDivider()}`,
                `<b>Влажность</b>${historyWindow ? ` <code>${escapeHtml(historyWindow)}</code>` : ""}`,
                `<code>${escapeHtml(sparkline(humiditySeries))}</code>`,
                humiditySeries.length
                    ? `min: <b>${escapeHtml(formatHumidity(Math.min(...humiditySeries)))}</b>   max: <b>${escapeHtml(formatHumidity(Math.max(...humiditySeries)))}</b>`
                    : "История влажности собирается…",
            );
        }

        await replyMenu(
            ctx,
            lines.join("\n"),
            this.buildItemKeyboard(
                detail,
                sensor,
                controllersCallbackData,
                mainMenuCallbackData,
            ),
        );
    }

    async sendChart(
        ctx,
        {
            deviceId,
            nodeId = null,
            itemId,
            user,
            getScopedDetail,
        },
    ) {
        const detail = await getScopedDetail(deviceId, nodeId, user);
        if (!detail) {
            await this.answerCallback_(ctx, {
                text: "Устройство недоступно",
                show_alert: true,
            });
            return;
        }

        const list = Array.isArray(detail?.controllers?.meteo)
            ? detail.controllers.meteo
            : [];
        const sensor = list.find((item) => Number(item?.id) === Number(itemId));
        if (!sensor) {
            await this.answerCallback_(ctx, {
                text: "Датчик не найден",
                show_alert: true,
            });
            return;
        }

        const history = this.registry
            .getMeteoHistory(deviceId, Number(itemId), {
                nodeId: Number(nodeId || 0) || null,
            })
            .slice(-48);
        const hasTempHistory = history.some((entry) =>
            Number.isFinite(Number(entry?.temp_c)),
        );
        if (!hasTempHistory) {
            await this.answerCallback_(ctx, {
                text: "История ещё не накоплена",
                show_alert: true,
            });
            return;
        }

        const hasHumidityHistory = history.some((entry) =>
            Number.isFinite(Number(entry?.humidity)),
        );
        await this.answerCallback_(ctx, { text: "Готовлю график..." });
        const buffer = await renderMeteoChart({
            history,
            sensorName: sensorName(sensor, `Метео ${Number(itemId)}`),
            deviceName: detail?.name || `#${Number(deviceId)}`,
            showHumidity: hasHumidityHistory,
        });
        const chatId = ctx?.chat?.id || ctx?.callbackQuery?.message?.chat?.id;
        if (!chatId) {
            throw new Error("telegram_chat_missing");
        }
        await ctx.api.sendPhoto(
            chatId,
            new InputFile(
                buffer,
                `meteo_${Number(deviceId)}_${Number(nodeId || 0)}_${Number(itemId)}.png`,
            ),
            {
                caption: `${sensorTypeIcon(sensor)} ${sensorName(sensor, `Метео ${Number(itemId)}`)}`,
            },
        );
    }

    buildKeyboard(detail, controllersCallbackData, mainMenuCallbackData) {
        const keyboard = new InlineKeyboard();
        const list = Array.isArray(detail?.controllers?.meteo)
            ? detail.controllers.meteo
            : [];
        const deviceId = Number(detail?.device_id);
        const nodeId = Number(detail?.node_id || 0);
        for (let i = 0; i < list.length; i += 2) {
            const left = list[i];
            const right = list[i + 1];
            if (left) {
                keyboard.text(
                    `🌡 ${compactLabel(sensorName(left, `Метео ${Number(left?.id) || "?"}`), 14)}`,
                    this.itemCallbackData(deviceId, nodeId, Number(left?.id)),
                );
            }
            if (right) {
                keyboard.text(
                    `🌡 ${compactLabel(sensorName(right, `Метео ${Number(right?.id) || "?"}`), 14)}`,
                    this.itemCallbackData(deviceId, nodeId, Number(right?.id)),
                );
            }
            keyboard.row();
        }
        keyboard.text(
            "◀️ Назад",
            controllersCallbackData(
                Number(detail?.device_id),
                Number(detail?.node_id || 0),
            ),
        );
        return keyboard;
    }

    buildItemKeyboard(detail, sensor, controllersCallbackData, mainMenuCallbackData) {
        const deviceId = Number(detail?.device_id);
        const nodeId = Number(detail?.node_id || 0);
        return new InlineKeyboard()
            .text(
                "📈 График",
                this.chartCallbackData(deviceId, nodeId, Number(sensor?.id)),
            )
            .row()
            .text("◀️ Назад", this.controllerCallbackData(deviceId, nodeId));
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
        return `menu:controller:${Number(deviceId)}:${Number(nodeId || 0)}:meteo`;
    }

    itemCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:meteo:view:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}`;
    }

    chartCallbackData(deviceId, nodeId = 0, itemId) {
        return `menu:meteo:chart:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(itemId)}`;
    }

    async answerCallback_(ctx, options = {}) {
        if (
            typeof ctx?.answerCallbackQuery === "function" &&
            String(ctx?.callbackQuery?.id || "").trim()
        ) {
            try {
                await ctx.answerCallbackQuery(options);
            } catch {}
        }
    }
}
