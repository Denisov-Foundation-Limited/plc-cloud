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
        telegramBotToken,
        telegramBotPublicBaseUrl,
        telegramBotWebhookPath,
        telegramBotSecretToken,
    }) {
        this.filePath = path.join(dataDir, "telegram.json");
        this.defaults = this.normalize({
            token: telegramBotToken,
            public_base_url: telegramBotPublicBaseUrl,
            webhook_path: telegramBotWebhookPath,
            secret_token: telegramBotSecretToken,
        });
    }

    async init() {
        const fileExists = await this.hasStorageFile();
        const data = await this.readData();
        const normalized = this.normalize({
            token: fileExists ? data.token : this.defaults.token,
            public_base_url: fileExists
                ? data.public_base_url
                : this.defaults.public_base_url,
            webhook_path: fileExists
                ? data.webhook_path
                : this.defaults.webhook_path,
            secret_token: fileExists
                ? data.secret_token
                : this.defaults.secret_token,
        });
        await this.writeData(normalized);
    }

    async getSettings() {
        const data = await this.readData();
        return this.normalize(data);
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
        await this.writeData(next);
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

    async hasStorageFile() {
        try {
            await fs.access(this.filePath);
            return true;
        } catch (err) {
            return false;
        }
    }

    async readData() {
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (err) {
            if (err.code === "ENOENT") {
                return {};
            }
            throw err;
        }
    }

    async writeData(data) {
        await fs.writeFile(
            this.filePath,
            JSON.stringify(this.normalize(data), null, 2),
            "utf8",
        );
    }
}
