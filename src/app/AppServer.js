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
import fs from "node:fs";

import { rootLogger } from "../utils/Logger.js";

const logger = rootLogger.child("APP");

export class AppServer {
    constructor({
        rootDir,
        dataDir,
        publicDir,
        protoPath,
        defaultObjects,
        onlineTtlMs,
        sessions,
        registry,
        datastoreFactory,
        httpFactory,
        wsFactory,
        telegramBotService,
    }) {
        this.rootDir = rootDir;
        this.dataDir = dataDir;
        this.publicDir = publicDir;
        this.protoPath = protoPath;
        this.defaultObjects = defaultObjects;
        this.onlineTtlMs = onlineTtlMs;

        this.proto = JSON.parse(fs.readFileSync(this.protoPath, "utf8"));

        this.sessions = sessions;
        this.registry = registry;
        this.datastoreFactory = datastoreFactory;
        this.httpFactory = httpFactory;
        this.wsFactory = wsFactory;
        this.telegramBotService = telegramBotService;

        this.usersDb = null;
        this.devicesDb = null;
        this.app = null;
        this.webServer = null;
        this.deviceServer = null;
        this.webWs = null;
        this.deviceWs = null;
        this.offlineTimer = null;
        this.devicePingTimer = null;
        this.sessionCleanupTimer = null;
    }

    async init() {
        this.ensureDir(this.dataDir);

        const datastores = await this.datastoreFactory.build();
        this.usersDb = datastores.usersDb;
        this.devicesDb = datastores.devicesDb;

        const http = this.httpFactory.build({
            onDeviceDisconnect: (deviceId) => {
                const disconnected = this.registry.disconnect(deviceId);
                if (disconnected && this.webWs) {
                    this.webWs.clearDeviceTransientState?.(deviceId);
                    this.webWs.broadcast({
                        type: "device_offline",
                        device_id: deviceId,
                    });
                }
                void this.telegramBotService?.notifyDeviceOffline?.(deviceId);
            },
        });
        this.app = http.app;
        this.webServer = http.createServer();
        this.deviceServer = http.createServer();

        const ws = this.wsFactory.build({
            webServer: this.webServer,
            deviceServer: this.deviceServer,
            proto: this.proto,
            onDeviceOnline: (deviceId) => {
                this.webWs?.broadcast({
                    type: "device_online",
                    device_id: deviceId,
                });
                void this.telegramBotService?.notifyDeviceOnline?.(deviceId);
            },
            onDeviceOffline: (deviceId) => {
                this.webWs?.clearDeviceTransientState?.(deviceId);
                this.webWs?.broadcast({
                    type: "device_offline",
                    device_id: deviceId,
                });
                void this.telegramBotService?.notifyDeviceOffline?.(deviceId);
            },
            onDeviceUpdate: (summary) => {
                this.webWs?.broadcastDeviceUpdate(summary);
                void this.telegramBotService?.notifyDeviceUpdate?.(summary);
            },
        });

        this.webWs = ws.webWs;
        this.deviceWs = ws.deviceWs;
        this.telegramBotService?.setDeviceWs?.(this.deviceWs);

        this.offlineTimer = setInterval(() => {
            this.registry.expireStale((deviceId) => {
                this.webWs?.clearDeviceTransientState?.(deviceId);
                this.webWs?.broadcast({
                    type: "device_offline",
                    device_id: deviceId,
                });
                void this.telegramBotService?.notifyDeviceOffline?.(deviceId);
            });
        }, 5_000);

        this.devicePingTimer = setInterval(() => {
            this.deviceWs?.pingAll();
        }, 10_000);

        this.sessionCleanupTimer = setInterval(() => {
            void this.sessions.cleanupExpired?.();
        }, 60_000);

        await this.telegramBotService?.init();
    }

    async close() {
        if (this.offlineTimer) clearInterval(this.offlineTimer);
        if (this.devicePingTimer) clearInterval(this.devicePingTimer);
        if (this.sessionCleanupTimer) clearInterval(this.sessionCleanupTimer);
        if (this.telegramBotService?.shutdown) {
            await this.telegramBotService.shutdown();
        }
    }

    listen({ webPort = 80, devicePort, host = "127.0.0.1" }) {
        this.webServer.listen(webPort, host, () => {
            logger.info(`plc-cloud web listening on http://${host}:${webPort}`);
        });

        this.deviceServer.listen(devicePort, host, () => {
            logger.info(
                `plc-cloud device ws listening on ws://${host}:${devicePort}/ws/device`,
            );
        });
    }

    ensureDir(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}
