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

import { sha256 } from "../utils/crypto.js";

export class UsersDb {
    constructor({ dataDir }) {
        this.filePath = path.join(dataDir, "users.json");
    }

    async init() {
        const data = await this.readData();
        const existing = data.users.find((row) => row.username === "admin");
        if (!existing) {
            data.users.push({
                username: "admin",
                password_hash: sha256(""),
                plc_username: "",
                telegram_username: "",
                chat_id: "",
            });
        }
        let dirty = false;
        for (const row of data.users) {
            if (typeof row.plc_username !== "string") {
                row.plc_username = "";
                dirty = true;
            }
            if (typeof row.telegram_username !== "string") {
                row.telegram_username = "";
                dirty = true;
            }
            if (typeof row.chat_id !== "string") {
                row.chat_id =
                    row.chat_id === null || row.chat_id === undefined
                        ? ""
                        : String(row.chat_id);
                dirty = true;
            }
        }
        if (!existing || dirty) await this.writeData(data);
    }

    async findByUsername(username) {
        const data = await this.readData();
        return data.users.find((row) => row.username === username) || null;
    }

    async findByTelegramIdentity({ chatId = "", telegramUsername = "" } = {}) {
        const normalizedChatId = this.normalizeChatId(chatId);
        const normalizedUsername =
            this.normalizeTelegramUsername(telegramUsername).toLowerCase();
        const data = await this.readData();
        return (
            data.users.find((row) => {
                const rowChatId = this.normalizeChatId(row.chat_id);
                const rowUsername = this.normalizeTelegramUsername(
                    row.telegram_username,
                ).toLowerCase();
                if (
                    normalizedChatId &&
                    rowChatId &&
                    rowChatId === normalizedChatId
                )
                    return true;
                if (
                    normalizedUsername &&
                    rowUsername &&
                    rowUsername === normalizedUsername
                )
                    return true;
                return false;
            }) || null
        );
    }

    async validateCredentials(username, password) {
        const row = await this.findByUsername(username);
        if (!row) return false;
        const passHash = sha256(password || "");
        return passHash === row.password_hash;
    }

    async listUsers() {
        const data = await this.readData();
        return data.users.map((row) => ({
            username: row.username || "",
            plc_username: row.plc_username || "",
            telegram_username: row.telegram_username || "",
            chat_id: row.chat_id || "",
        }));
    }

    async createUser({
        username,
        password,
        plc_username = "",
        telegram_username = "",
        chat_id = "",
    }) {
        const uname = String(username || "").trim();
        if (!uname) throw new Error("username_required");
        const data = await this.readData();
        if (data.users.some((row) => row.username === uname))
            throw new Error("user_exists");
        data.users.push({
            username: uname,
            password_hash: sha256(password || ""),
            plc_username: String(plc_username || "").trim(),
            telegram_username:
                this.normalizeTelegramUsername(telegram_username),
            chat_id: this.normalizeChatId(chat_id),
        });
        await this.writeData(data);
        return {
            username: uname,
            plc_username: String(plc_username || "").trim(),
            telegram_username:
                this.normalizeTelegramUsername(telegram_username),
            chat_id: this.normalizeChatId(chat_id),
        };
    }

    async updateUser(username, patch = {}) {
        const uname = String(username || "").trim();
        if (!uname) throw new Error("username_required");
        const data = await this.readData();
        const row = data.users.find((item) => item.username === uname);
        if (!row) throw new Error("user_not_found");
        if (Object.prototype.hasOwnProperty.call(patch, "username")) {
            const nextUsername = String(patch.username || "").trim();
            if (!nextUsername) throw new Error("username_required");
            if (
                nextUsername !== uname &&
                data.users.some((item) => item.username === nextUsername)
            )
                throw new Error("user_exists");
            row.username = nextUsername;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "plc_username"))
            row.plc_username = String(patch.plc_username || "").trim();
        if (Object.prototype.hasOwnProperty.call(patch, "telegram_username"))
            row.telegram_username = this.normalizeTelegramUsername(
                patch.telegram_username,
            );
        if (Object.prototype.hasOwnProperty.call(patch, "chat_id"))
            row.chat_id = this.normalizeChatId(patch.chat_id);
        if (Object.prototype.hasOwnProperty.call(patch, "password"))
            row.password_hash = sha256(patch.password || "");
        await this.writeData(data);
        return {
            username: row.username || "",
            plc_username: row.plc_username || "",
            telegram_username: row.telegram_username || "",
            chat_id: row.chat_id || "",
        };
    }

    normalizeTelegramUsername(value) {
        const raw = String(value || "").trim();
        return raw.startsWith("@") ? raw.slice(1) : raw;
    }

    normalizeChatId(value) {
        return String(value || "").trim();
    }

    async deleteUser(username) {
        const uname = String(username || "").trim();
        if (!uname) throw new Error("username_required");
        if (uname === "admin") throw new Error("admin_delete_forbidden");
        const data = await this.readData();
        const nextUsers = data.users.filter((row) => row.username !== uname);
        if (nextUsers.length === data.users.length)
            throw new Error("user_not_found");
        data.users = nextUsers;
        await this.writeData(data);
    }

    async readData() {
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") {
                return { users: [] };
            }
            return {
                users: Array.isArray(parsed.users) ? parsed.users : [],
            };
        } catch (err) {
            if (err.code === "ENOENT") {
                return { users: [] };
            }
            throw err;
        }
    }

    async writeData(data) {
        const payload = JSON.stringify(data, null, 2);
        await fs.writeFile(this.filePath, payload, "utf8");
    }
}
