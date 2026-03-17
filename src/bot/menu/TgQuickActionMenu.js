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
import { canSendControllerCommand } from "../../auth/AccessControl.js";

const PRESETS = [
    { key: "home", label: "🏠 Я дома" },
    { key: "prepare", label: "🧳 Собираюсь" },
    { key: "away", label: "🚪 Ушел" },
];

export class TgQuickActionMenu {
    constructor({ registry, devicesDb }) {
        this.registry = registry;
        this.devicesDb = devicesDb;
        this.deviceWs = null;
    }

    setDeviceWs(deviceWs) {
        this.deviceWs = deviceWs;
    }

    items() {
        return [...PRESETS];
    }

    callbackData(deviceId, nodeId = 0, preset) {
        return `menu:quick:${Number(deviceId)}:${Number(nodeId || 0)}:${String(preset || "").trim()}`;
    }

    async run(
        ctx,
        { deviceId, nodeId = null, preset, user, refreshControllers },
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
            !canSendControllerCommand(
                summary,
                user || {},
                "quick_actions",
                "run",
                { preset },
            )
        ) {
            await ctx.answerCallbackQuery({
                text: "Нет прав на быстрое действие",
                show_alert: true,
            });
            return;
        }
        const result = this.deviceWs?.sendCmd(
            Number(deviceId),
            "quick_actions",
            "run",
            { preset: String(preset || "").trim() },
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
                text: "Быстрое действие не отправлено",
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
        await ctx.answerCallbackQuery({ text: this.presetLabel(preset) });
        await this.delay(500);
        await refreshControllers();
    }

    presetLabel(preset) {
        return (
            this.items().find((item) => item.key === preset)?.label ||
            "Быстрое действие"
        );
    }

    delay(ms) {
        return new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, Number(ms) || 0)),
        );
    }
}
