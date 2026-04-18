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
import path from "node:path";
import { asClass, asValue, createContainer, InjectionMode } from "awilix";
import { AppServer } from "./AppServer.js";
import { DatastoreFactory } from "./factories/DatastoreFactory.js";
import { HttpFactory } from "./factories/HttpFactory.js";
import { WsFactory } from "./factories/WsFactory.js";
import { UsersDb } from "../db/UsersDb.js";
import { DevicesDb } from "../db/DevicesDb.js";
import { TelegramConfigDb } from "../db/TelegramConfigDb.js";
import { SqliteDb } from "../db/SqliteDb.js";
import { ApiRouter } from "../http/ApiRouter.js";
import { SessionStore } from "../state/SessionStore.js";
import { DeviceRegistry } from "../state/DeviceRegistry.js";
import { WebWsServer } from "../ws/WebWsServer.js";
import { DeviceWsServer } from "../ws/DeviceWsServer.js";
import { TelegramBotService } from "../bot/TelegramBotService.js";

export class AppContainer {
    constructor({ rootDir }) {
        this.rootDir = rootDir;
        this.dataDir = path.join(rootDir, "data");
        this.publicDir = path.join(rootDir, "public");
        this.protoPath = path.join(rootDir, "proto.json");
    }

    create() {
        const container = createContainer({
            injectionMode: InjectionMode.PROXY,
        });
        container.register({
            container: asValue(container),
            rootDir: asValue(this.rootDir),
            dataDir: asValue(this.dataDir),
            publicDir: asValue(this.publicDir),
            protoPath: asValue(this.protoPath),
            defaultObjects: asValue(["Квартира", "Дача", "Деревня"]),
            onlineTtlMs: asValue(30_000),
            sessionTtlMs: asValue(30 * 24 * 60 * 60 * 1000),
            seedSampleEnabled: asValue(
                process.env.PLC_CLOUD_SEED_SAMPLE === "1",
            ),
            nowMs: asValue(() => Date.now()),
            telegramBotToken: asValue(process.env.TELEGRAM_BOT_TOKEN || ""),
            telegramBotPublicBaseUrl: asValue(
                process.env.TELEGRAM_BOT_PUBLIC_BASE_URL || "",
            ),
            telegramBotWebhookPath: asValue(
                process.env.TELEGRAM_BOT_WEBHOOK_PATH || "/telegram/webhook",
            ),
            telegramBotSecretToken: asValue(
                process.env.TELEGRAM_BOT_SECRET_TOKEN || "",
            ),
            sessions: asClass(SessionStore).singleton(),
            registry: asClass(DeviceRegistry).singleton(),
            sqliteDb: asClass(SqliteDb).singleton(),
            usersDb: asClass(UsersDb).singleton(),
            devicesDb: asClass(DevicesDb).singleton(),
            telegramConfigDb: asClass(TelegramConfigDb).singleton(),
            telegramBotService: asClass(TelegramBotService).singleton(),
            datastoreFactory: asClass(DatastoreFactory).singleton(),
            httpFactory: asClass(HttpFactory).singleton(),
            wsFactory: asClass(WsFactory).singleton(),
            apiRouter: asClass(ApiRouter).transient(),
            webWsServer: asClass(WebWsServer).transient(),
            deviceWsServer: asClass(DeviceWsServer).transient(),
            appServer: asClass(AppServer).singleton(),
        });
        return container;
    }

    build() {
        const container = this.create();
        return container.resolve("appServer");
    }
}
