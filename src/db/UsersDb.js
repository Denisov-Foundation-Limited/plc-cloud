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
import { normalizeNotificationPrefs } from "../notifications/NotificationCatalog.js";

export class UsersDb {
    constructor({ dataDir, sqliteDb }) {
        this.filePath = path.join(dataDir, "users.json");
        this.sqliteDb = sqliteDb;
    }

    async init() {
        const { User } = await this.sqliteDb.init();
        await this.importLegacyIfNeeded_(User);

        const existing = await User.findByPk("admin");
        if (!existing) {
            await User.create({
                username: "admin",
                password_hash: sha256(""),
                plc_username: "",
                telegram_username: "",
                chat_id: "",
                telegram_notify_online: false,
                telegram_notify_offline: false,
                telegram_notify_events: false,
                notification_prefs_json: "[]",
                allowed_objects_json: "[]",
                telegram_menu_state_json: "",
            });
        }

        const rows = await User.findAll();
        for (const row of rows) {
            const patch = {};
            if (typeof row.plc_username !== "string") patch.plc_username = "";
            if (typeof row.telegram_username !== "string")
                patch.telegram_username = "";
            if (typeof row.chat_id !== "string")
                patch.chat_id =
                    row.chat_id === null || row.chat_id === undefined
                        ? ""
                        : String(row.chat_id);
            if (typeof row.telegram_notify_online !== "boolean")
                patch.telegram_notify_online = Boolean(
                    this.normalizeChatId(row.chat_id),
                );
            if (typeof row.telegram_notify_offline !== "boolean")
                patch.telegram_notify_offline = Boolean(
                    this.normalizeChatId(row.chat_id),
                );
            if (typeof row.telegram_notify_events !== "boolean")
                patch.telegram_notify_events = Boolean(
                    this.normalizeChatId(row.chat_id),
                );
            if (typeof row.notification_prefs_json !== "string")
                patch.notification_prefs_json = "[]";
            const normalizedPrefs = normalizeNotificationPrefs(
                this.parseNotificationPrefs_(row.notification_prefs_json),
            );
            if (
                JSON.stringify(
                    this.parseNotificationPrefs_(row.notification_prefs_json),
                ) !== JSON.stringify(normalizedPrefs)
            ) {
                patch.notification_prefs_json =
                    JSON.stringify(normalizedPrefs);
            }
            const normalizedAllowedObjects = this.normalizeAllowedObjects(
                this.parseAllowedObjects_(row.allowed_objects_json),
            );
            if (
                JSON.stringify(this.parseAllowedObjects_(row.allowed_objects_json)) !==
                JSON.stringify(normalizedAllowedObjects)
            ) {
                patch.allowed_objects_json =
                    JSON.stringify(normalizedAllowedObjects);
            }
            if (typeof row.telegram_menu_state_json !== "string")
                patch.telegram_menu_state_json = "";
            if (Object.keys(patch).length) {
                await row.update(patch);
            }
        }
    }

    async findByUsername(username) {
        const { User } = await this.sqliteDb.init();
        const row = await User.findByPk(String(username || "").trim());
        return row ? this.toAuthRow_(row) : null;
    }

    async findByTelegramIdentity({ chatId = "", telegramUsername = "" } = {}) {
        const normalizedChatId = this.normalizeChatId(chatId);
        const normalizedUsername =
            this.normalizeTelegramUsername(telegramUsername).toLowerCase();
        const { User } = await this.sqliteDb.init();
        const rows = await User.findAll();
        const found = rows.find((row) => {
            const rowChatId = this.normalizeChatId(row.chat_id);
            const rowUsername = this.normalizeTelegramUsername(
                row.telegram_username,
            ).toLowerCase();
            if (normalizedChatId && rowChatId && rowChatId === normalizedChatId)
                return true;
            if (
                normalizedUsername &&
                rowUsername &&
                rowUsername === normalizedUsername
            )
                return true;
            return false;
        });
        return found ? this.toAuthRow_(found) : null;
    }

    async validateCredentials(username, password) {
        const row = await this.findByUsername(username);
        if (!row) return false;
        return sha256(password || "") === row.password_hash;
    }

    async listUsers() {
        const { User } = await this.sqliteDb.init();
        const rows = await User.findAll({ order: [["username", "ASC"]] });
        return rows.map((row) => this.toPublicRow_(row));
    }

    async createUser({
        username,
        password,
        plc_username = "",
        telegram_username = "",
        chat_id = "",
        telegram_notify_online = false,
        telegram_notify_offline = false,
        telegram_notify_events = false,
        notification_prefs = [],
        allowed_objects = [],
        telegram_menu_state = null,
    }) {
        const uname = String(username || "").trim();
        if (!uname) throw new Error("username_required");
        const { User } = await this.sqliteDb.init();
        const existing = await User.findByPk(uname);
        if (existing) throw new Error("user_exists");
        const row = await User.create({
            username: uname,
            password_hash: sha256(password || ""),
            plc_username: String(plc_username || "").trim(),
            telegram_username: this.normalizeTelegramUsername(
                telegram_username,
            ),
            chat_id: this.normalizeChatId(chat_id),
            telegram_notify_online: this.normalizeBool(
                telegram_notify_online,
            ),
            telegram_notify_offline: this.normalizeBool(
                telegram_notify_offline,
            ),
            telegram_notify_events: this.normalizeBool(
                telegram_notify_events,
            ),
            notification_prefs_json: JSON.stringify(
                normalizeNotificationPrefs(notification_prefs),
            ),
            allowed_objects_json: JSON.stringify(
                this.normalizeAllowedObjects(allowed_objects),
            ),
            telegram_menu_state_json: this.normalizeTelegramMenuStateJson_(
                telegram_menu_state,
            ),
        });
        return this.toPublicRow_(row);
    }

    async updateUser(username, patch = {}) {
        const uname = String(username || "").trim();
        if (!uname) throw new Error("username_required");
        const { User } = await this.sqliteDb.init();
        const row = await User.findByPk(uname);
        if (!row) throw new Error("user_not_found");

        const next = {};
        if (Object.prototype.hasOwnProperty.call(patch, "username")) {
            const nextUsername = String(patch.username || "").trim();
            if (!nextUsername) throw new Error("username_required");
            if (nextUsername !== uname) {
                const existing = await User.findByPk(nextUsername);
                if (existing) throw new Error("user_exists");
            }
            next.username = nextUsername;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "plc_username"))
            next.plc_username = String(patch.plc_username || "").trim();
        if (Object.prototype.hasOwnProperty.call(patch, "telegram_username"))
            next.telegram_username = this.normalizeTelegramUsername(
                patch.telegram_username,
            );
        if (Object.prototype.hasOwnProperty.call(patch, "chat_id"))
            next.chat_id = this.normalizeChatId(patch.chat_id);
        if (
            Object.prototype.hasOwnProperty.call(
                patch,
                "telegram_notify_online",
            )
        )
            next.telegram_notify_online = this.normalizeBool(
                patch.telegram_notify_online,
            );
        if (
            Object.prototype.hasOwnProperty.call(
                patch,
                "telegram_notify_offline",
            )
        )
            next.telegram_notify_offline = this.normalizeBool(
                patch.telegram_notify_offline,
            );
        if (
            Object.prototype.hasOwnProperty.call(
                patch,
                "telegram_notify_events",
            )
        )
            next.telegram_notify_events = this.normalizeBool(
                patch.telegram_notify_events,
            );
        if (
            Object.prototype.hasOwnProperty.call(
                patch,
                "notification_prefs",
            )
        )
            next.notification_prefs_json = JSON.stringify(
                normalizeNotificationPrefs(patch.notification_prefs),
            );
        if (Object.prototype.hasOwnProperty.call(patch, "allowed_objects"))
            next.allowed_objects_json = JSON.stringify(
                this.normalizeAllowedObjects(patch.allowed_objects),
            );
        if (Object.prototype.hasOwnProperty.call(patch, "telegram_menu_state"))
            next.telegram_menu_state_json = this.normalizeTelegramMenuStateJson_(
                patch.telegram_menu_state,
            );
        if (Object.prototype.hasOwnProperty.call(patch, "password"))
            next.password_hash = sha256(patch.password || "");
        await row.update(next);
        return this.toPublicRow_(row);
    }

    async updateTelegramMenuStateByIdentity(
        { chatId = "", telegramUsername = "" } = {},
        telegramMenuState = null,
    ) {
        const normalizedChatId = this.normalizeChatId(chatId);
        const normalizedUsername =
            this.normalizeTelegramUsername(telegramUsername).toLowerCase();
        if (!normalizedChatId && !normalizedUsername) return null;
        const { User } = await this.sqliteDb.init();
        const rows = await User.findAll();
        const row = rows.find((item) => {
            const rowChatId = this.normalizeChatId(item.chat_id);
            const rowUsername = this.normalizeTelegramUsername(
                item.telegram_username,
            ).toLowerCase();
            if (normalizedChatId && rowChatId && rowChatId === normalizedChatId)
                return true;
            if (
                normalizedUsername &&
                rowUsername &&
                rowUsername === normalizedUsername
            )
                return true;
            return false;
        });
        if (!row) return null;
        await row.update({
            telegram_menu_state_json:
                this.normalizeTelegramMenuStateJson_(telegramMenuState),
        });
        return this.toPublicRow_(row);
    }

    async deleteUser(username) {
        const uname = String(username || "").trim();
        if (!uname) throw new Error("username_required");
        if (uname === "admin") throw new Error("admin_delete_forbidden");
        const { User } = await this.sqliteDb.init();
        const deleted = await User.destroy({ where: { username: uname } });
        if (!deleted) throw new Error("user_not_found");
    }

    normalizeTelegramUsername(value) {
        const raw = String(value || "").trim();
        return raw.startsWith("@") ? raw.slice(1) : raw;
    }

    normalizeChatId(value) {
        return String(value || "").trim();
    }

    normalizeAllowedObjects(value) {
        if (Array.isArray(value)) {
            return value
                .map((item) => String(item || "").trim())
                .filter(Boolean);
        }
        return String(value || "")
            .split(",")
            .map((item) => String(item || "").trim())
            .filter(Boolean);
    }

    normalizeBool(value) {
        if (typeof value === "boolean") return value;
        if (typeof value === "number") return value !== 0;
        const raw = String(value || "")
            .trim()
            .toLowerCase();
        return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
    }

    parseAllowedObjects_(value) {
        if (Array.isArray(value)) return this.normalizeAllowedObjects(value);
        const raw = String(value || "").trim();
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            return this.normalizeAllowedObjects(parsed);
        } catch (err) {
            return this.normalizeAllowedObjects(raw);
        }
    }

    parseNotificationPrefs_(value) {
        if (Array.isArray(value)) return normalizeNotificationPrefs(value);
        const raw = String(value || "").trim();
        if (!raw) return [];
        try {
            return normalizeNotificationPrefs(JSON.parse(raw));
        } catch (err) {
            return [];
        }
    }

    parseTelegramMenuState_(value) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            return value;
        }
        const raw = String(value || "").trim();
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed
                : null;
        } catch (err) {
            return null;
        }
    }

    normalizeTelegramMenuStateJson_(value) {
        const parsed = this.parseTelegramMenuState_(value);
        return parsed ? JSON.stringify(parsed) : "";
    }

    toAuthRow_(row) {
        return {
            username: row.username || "",
            password_hash: row.password_hash || "",
            plc_username: row.plc_username || "",
            telegram_username: row.telegram_username || "",
            chat_id: row.chat_id || "",
            telegram_notify_online: this.normalizeBool(
                row.telegram_notify_online,
            ),
            telegram_notify_offline: this.normalizeBool(
                row.telegram_notify_offline,
            ),
            telegram_notify_events: this.normalizeBool(
                row.telegram_notify_events,
            ),
            notification_prefs: this.parseNotificationPrefs_(
                row.notification_prefs_json,
            ),
            allowed_objects: this.normalizeAllowedObjects(
                this.parseAllowedObjects_(row.allowed_objects_json),
            ),
            telegram_menu_state: this.parseTelegramMenuState_(
                row.telegram_menu_state_json,
            ),
        };
    }

    toPublicRow_(row) {
        const auth = this.toAuthRow_(row);
        delete auth.password_hash;
        return auth;
    }

    async importLegacyIfNeeded_(User) {
        const count = await User.count();
        if (count > 0) return;

        let parsed = null;
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            parsed = JSON.parse(raw);
        } catch (err) {
            if (err?.code === "ENOENT") return;
            throw err;
        }

        const users = Array.isArray(parsed?.users) ? parsed.users : [];
        for (const row of users) {
            const username = String(row?.username || "").trim();
            if (!username) continue;
            await User.create({
                username,
                password_hash: String(row?.password_hash || sha256("")),
                plc_username: String(row?.plc_username || "").trim(),
                telegram_username: this.normalizeTelegramUsername(
                    row?.telegram_username,
                ),
                chat_id: this.normalizeChatId(row?.chat_id),
                telegram_notify_online: this.normalizeBool(
                    row?.telegram_notify_online,
                ),
                telegram_notify_offline: this.normalizeBool(
                    row?.telegram_notify_offline,
                ),
                telegram_notify_events: this.normalizeBool(
                    row?.telegram_notify_events,
                ),
                notification_prefs_json: JSON.stringify(
                    normalizeNotificationPrefs(row?.notification_prefs),
                ),
                allowed_objects_json: JSON.stringify(
                    this.normalizeAllowedObjects(row?.allowed_objects),
                ),
            });
        }
    }
}
