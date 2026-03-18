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
import fs from "node:fs/promises";
import path from "node:path";

function normalizePath(value, fallback = "/telegram/webhook") {
    const raw = String(value || fallback).trim() || fallback;
    return raw.startsWith("/") ? raw : `/${raw}`;
}

export class TelegramConfigDb {
    constructor({
        dataDir,
        sqliteDb,
        telegramBotToken,
        telegramBotPublicBaseUrl,
        telegramBotWebhookPath,
        telegramBotSecretToken,
    }) {
        this.filePath = path.join(dataDir, "telegram.json");
        this.sqliteDb = sqliteDb;
        this.defaults = this.normalize({
            token: telegramBotToken,
            public_base_url: telegramBotPublicBaseUrl,
            webhook_path: telegramBotWebhookPath,
            secret_token: telegramBotSecretToken,
        });
    }

    async init() {
        const { TelegramConfig } = await this.sqliteDb.init();
        await this.importLegacyIfNeeded_(TelegramConfig);

        const existing = await TelegramConfig.findByPk(1);
        const normalized = this.normalize({
            token: existing ? existing.token : this.defaults.token,
            public_base_url: existing
                ? existing.public_base_url
                : this.defaults.public_base_url,
            webhook_path: existing
                ? existing.webhook_path
                : this.defaults.webhook_path,
            secret_token: existing
                ? existing.secret_token
                : this.defaults.secret_token,
        });

        if (existing) {
            await existing.update(normalized);
        } else {
            await TelegramConfig.create({
                id: 1,
                ...normalized,
            });
        }
    }

    async getSettings() {
        const { TelegramConfig } = await this.sqliteDb.init();
        const row = await TelegramConfig.findByPk(1);
        return this.normalize(row ? row.get({ plain: true }) : this.defaults);
    }

    async updateSettings(patch = {}) {
        const current = await this.getSettings();
        const next = this.normalize({
            token: Object.prototype.hasOwnProperty.call(patch, "token")
                ? patch.token
                : current.token,
            public_base_url: Object.prototype.hasOwnProperty.call(
                patch,
                "public_base_url",
            )
                ? patch.public_base_url
                : current.public_base_url,
            webhook_path: Object.prototype.hasOwnProperty.call(
                patch,
                "webhook_path",
            )
                ? patch.webhook_path
                : current.webhook_path,
            secret_token: Object.prototype.hasOwnProperty.call(
                patch,
                "secret_token",
            )
                ? patch.secret_token
                : current.secret_token,
        });
        const { TelegramConfig } = await this.sqliteDb.init();
        const row = await TelegramConfig.findByPk(1);
        if (row) {
            await row.update(next);
        } else {
            await TelegramConfig.create({ id: 1, ...next });
        }
        return next;
    }

    normalize(data = {}) {
        return {
            token: String(data.token || "").trim(),
            public_base_url: String(data.public_base_url || "")
                .trim()
                .replace(/\/+$/, ""),
            webhook_path: normalizePath(
                data.webhook_path,
                this.defaults?.webhook_path || "/telegram/webhook",
            ),
            secret_token: String(data.secret_token || "").trim(),
        };
    }

    async importLegacyIfNeeded_(TelegramConfig) {
        const count = await TelegramConfig.count();
        if (count > 0) return;

        let parsed = null;
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            parsed = JSON.parse(raw);
        } catch (err) {
            if (err?.code === "ENOENT") return;
            throw err;
        }

        await TelegramConfig.create({
            id: 1,
            ...this.normalize(parsed || {}),
        });
    }
}
