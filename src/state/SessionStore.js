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
import crypto from "node:crypto";

export class SessionStore {
    constructor({ sqliteDb, nowMs, sessionTtlMs = 30 * 24 * 60 * 60 * 1000 }) {
        this.sqliteDb = sqliteDb;
        this.nowMs = nowMs;
        this.sessionTtlMs = sessionTtlMs;
    }

    parseJsonArray_(value) {
        if (!value) return [];
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    serializeSession_(row) {
        if (!row) return null;
        const now = this.nowMs();
        const expiresAt = Number(row.expires_at_ms || 0);
        if (!Number.isFinite(expiresAt) || expiresAt <= now) {
            return null;
        }
        return {
            uid: String(row.uid || "").trim(),
            username: String(row.username || "").trim(),
            plc_username: String(row.plc_username || "").trim(),
            telegram_username: String(row.telegram_username || "").trim(),
            chat_id: String(row.chat_id || "").trim(),
            allowed_objects: this.parseJsonArray_(row.allowed_objects_json),
            notification_prefs: this.parseJsonArray_(row.notification_prefs_json),
            createdAt: Number(row.created_at_ms || 0),
            expiresAt,
        };
    }

    async model_() {
        const models = await this.sqliteDb.init();
        return models.WebSession;
    }

    async create(user) {
        const username = typeof user === "string" ? user : user?.username || "";
        const token = crypto.randomUUID();
        const createdAt = this.nowMs();
        const expiresAt = createdAt + this.sessionTtlMs;
        const WebSession = await this.model_();
        await WebSession.upsert({
            token,
            uid: username,
            username,
            plc_username:
                typeof user === "string" ? "" : user?.plc_username || "",
            telegram_username:
                typeof user === "string" ? "" : user?.telegram_username || "",
            chat_id: typeof user === "string" ? "" : user?.chat_id || "",
            allowed_objects_json: JSON.stringify(
                Array.isArray(user?.allowed_objects) ? user.allowed_objects : [],
            ),
            notification_prefs_json: JSON.stringify(
                Array.isArray(user?.notification_prefs)
                    ? user.notification_prefs
                    : [],
            ),
            created_at_ms: createdAt,
            expires_at_ms: expiresAt,
        });
        return token;
    }

    async get(token) {
        if (!token) return null;
        const WebSession = await this.model_();
        const row = await WebSession.findByPk(String(token));
        const raw = row?.get ? row.get({ plain: true }) : row;
        const session = this.serializeSession_(raw);
        if (!session && row) {
            await row.destroy();
        }
        return session;
    }

    async delete(token) {
        if (!token) return;
        const WebSession = await this.model_();
        await WebSession.destroy({ where: { token: String(token) } });
    }

    async fromRequest(req) {
        const token = req.cookies?.session;
        if (!token) return null;
        return await this.get(token);
    }

    async has(token) {
        return Boolean(await this.get(token));
    }

    async updateUser(user, previousUsername = "") {
        const nextUsername = String(user?.username || "").trim();
        const prevUsername = String(previousUsername || "").trim();
        if (!nextUsername && !prevUsername) return 0;
        const WebSession = await this.model_();
        const Op = WebSession.sequelize.Sequelize.Op;
        const rows = await WebSession.findAll({
            where: {
                username: {
                    [Op.in]: [...new Set([nextUsername, prevUsername].filter(Boolean))],
                },
            },
        });
        let updated = 0;
        for (const row of rows) {
            await row.update({
                uid: nextUsername || row.uid || String(row.username || "").trim(),
                username: nextUsername || String(row.username || "").trim(),
                plc_username: String(user?.plc_username || "").trim(),
                telegram_username: String(user?.telegram_username || "").trim(),
                chat_id: String(user?.chat_id || "").trim(),
                allowed_objects_json: JSON.stringify(
                    Array.isArray(user?.allowed_objects)
                        ? user.allowed_objects
                        : [],
                ),
                notification_prefs_json: JSON.stringify(
                    Array.isArray(user?.notification_prefs)
                        ? user.notification_prefs
                        : [],
                ),
            });
            updated += 1;
        }
        return updated;
    }

    async cleanupExpired() {
        const WebSession = await this.model_();
        const now = this.nowMs();
        await WebSession.destroy({
            where: {
                expires_at_ms: {
                    [WebSession.sequelize.Sequelize.Op.lte]: now,
                },
            },
        });
    }
}
