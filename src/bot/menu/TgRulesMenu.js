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

function rulesTitle(detail) {
    const name = String(detail?.name || "").trim() || "Контроллер";
    return `📜 ${name}`;
}

function ruleName(rule) {
    const id = Number(rule?.id || 0);
    const raw = String(rule?.name || "").trim();
    return raw || `Правило ${id || "?"}`;
}

export class TgRulesMenu {
    constructor({ registry, devicesDb }) {
        this.registry = registry;
        this.devicesDb = devicesDb;
        this.deviceWs = null;
    }

    setDeviceWs(deviceWs) {
        this.deviceWs = deviceWs;
    }

    runCallbackData(deviceId, nodeId = 0, ruleId) {
        return `menu:rules:run:${Number(deviceId)}:${Number(nodeId || 0)}:${Number(ruleId || 0)}`;
    }

    refreshCallbackData(deviceId, nodeId = 0) {
        return `menu:rules:refresh:${Number(deviceId)}:${Number(nodeId || 0)}`;
    }

    async open(
        ctx,
        {
            deviceId,
            nodeId = null,
            user,
            getScopedDetail,
            replyMenu,
            controllersCallbackData,
            leadText = "",
        },
    ) {
        const detail = await this.waitForRulesDetail(
            deviceId,
            nodeId,
            user,
            getScopedDetail,
        );
        if (!detail) {
            await replyMenu(ctx, "Правила недоступны.");
            return;
        }
        const rules = Array.isArray(detail?.controllers?.rules)
            ? detail.controllers.rules.filter((item) => Number(item?.id) > 0)
            : [];
        const lines = [
            panelTitle(rulesTitle(detail), "Правила"),
            leadText ? escapeHtml(String(leadText)) : "",
            rules.length
                ? rules
                      .map(
                          (item) =>
                              `📜 ${escapeHtml(ruleName(item))}`,
                      )
                      .join("\n")
                : "Доступных правил нет.",
        ].filter(Boolean);
        const keyboard = new InlineKeyboard();
        for (const rule of rules) {
            keyboard
                .text(
                    `📜 ${ruleName(rule)}`,
                    this.runCallbackData(deviceId, nodeId, rule.id),
                )
                .row();
        }
        keyboard
            .text("🔄 Обновить", this.refreshCallbackData(deviceId, nodeId))
            .text(
                "◀️ Назад",
                controllersCallbackData(deviceId, nodeId),
            );
        await replyMenu(ctx, lines.join("\n\n"), keyboard);
    }

    async refresh(
        ctx,
        {
            deviceId,
            nodeId = null,
            user,
            getScopedDetail,
            replyMenu,
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
            controllersCallbackData,
        });
    }

    async run(
        ctx,
        {
            deviceId,
            nodeId = null,
            ruleId,
            user,
            getScopedDetail,
            replyMenu,
            controllersCallbackData,
        },
    ) {
        const detail = await getScopedDetail(deviceId, nodeId, user);
        if (!detail) {
            await ctx.answerCallbackQuery({
                text: "Правила недоступны",
                show_alert: true,
            });
            return;
        }
        const rule = Array.isArray(detail?.controllers?.rules)
            ? detail.controllers.rules.find(
                  (item) => Number(item?.id) === Number(ruleId),
              ) || null
            : null;
        if (
            !canSendControllerCommand(
                detail,
                user || {},
                "rules",
                "run",
                { id: Number(ruleId) },
            )
        ) {
            await ctx.answerCallbackQuery({
                text: "Нет прав на запуск правила",
                show_alert: true,
            });
            return;
        }
        const result = this.deviceWs?.sendCmd(
            Number(deviceId),
            "rules",
            "run",
            { id: Number(ruleId) },
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
                text: "Правило не отправлено",
                show_alert: true,
            });
            return;
        }
        await ctx.answerCallbackQuery({
            text: rule ? ruleName(rule) : "Правило",
        });
        await this.delay(400);
        await this.open(ctx, {
            deviceId,
            nodeId,
            user,
            getScopedDetail,
            replyMenu,
            controllersCallbackData,
            leadText: `Запускаю: ${rule ? ruleName(rule) : `Правило ${ruleId}`}`,
        });
    }

    delay(ms) {
        return new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, Number(ms) || 0)),
        );
    }

    async waitForRulesDetail(deviceId, nodeId, user, getScopedDetail) {
        let detail = await getScopedDetail(deviceId, nodeId, user);
        const hasRules = (value) =>
            Array.isArray(value?.controllers?.rules) &&
            value.controllers.rules.length >= 0;
        if (!this.deviceWs) {
            return detail;
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
            this.deviceWs.sendGet(
                Number(deviceId),
                nodeId ? ["system", "controllers"] : ["controllers"],
                nodeId ? "stack" : "local",
                nodeId || undefined,
            );
            await this.delay(attempt === 0 ? 300 : 200);
            detail = await getScopedDetail(deviceId, nodeId, user);
            if (hasRules(detail)) {
                return detail;
            }
        }
        return detail;
    }
}
