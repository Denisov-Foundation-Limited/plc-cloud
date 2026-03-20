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
    constructor() {
        this.sessions = new Map();
    }

    create(user, nowMs) {
        const username = typeof user === "string" ? user : user?.username || "";
        const token = crypto.randomUUID();
        this.sessions.set(token, {
            uid: username,
            username,
            plc_username:
                typeof user === "string" ? "" : user?.plc_username || "",
            telegram_username:
                typeof user === "string" ? "" : user?.telegram_username || "",
            chat_id: typeof user === "string" ? "" : user?.chat_id || "",
            allowed_objects: Array.isArray(user?.allowed_objects)
                ? [...user.allowed_objects]
                : [],
            notification_prefs: Array.isArray(user?.notification_prefs)
                ? [...user.notification_prefs]
                : [],
            createdAt: nowMs(),
        });
        return token;
    }

    get(token) {
        return this.sessions.get(token) || null;
    }

    delete(token) {
        this.sessions.delete(token);
    }

    fromRequest(req) {
        const token = req.cookies?.session;
        if (!token) return null;
        return this.get(token);
    }

    has(token) {
        return this.sessions.has(token);
    }

    updateUser(user, previousUsername = "") {
        const nextUsername = String(user?.username || "").trim();
        const prevUsername = String(previousUsername || "").trim();
        if (!nextUsername && !prevUsername) return 0;
        let updated = 0;
        for (const session of this.sessions.values()) {
            const sessionUsername = String(session?.username || "").trim();
            if (
                sessionUsername !== nextUsername &&
                sessionUsername !== prevUsername
            ) {
                continue;
            }
            session.uid = nextUsername || session.uid || sessionUsername;
            session.username = nextUsername || sessionUsername;
            session.plc_username = String(user?.plc_username || "").trim();
            session.telegram_username = String(
                user?.telegram_username || "",
            ).trim();
            session.chat_id = String(user?.chat_id || "").trim();
            session.allowed_objects = Array.isArray(user?.allowed_objects)
                ? [...user.allowed_objects]
                : [];
            session.notification_prefs = Array.isArray(user?.notification_prefs)
                ? [...user.notification_prefs]
                : [];
            updated += 1;
        }
        return updated;
    }
}
