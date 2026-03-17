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
import http from "node:http";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { asValue } from "awilix";

export class HttpFactory {
    constructor({
        container,
        publicDir,
        usersDb,
        devicesDb,
        sessions,
        registry,
        nowMs,
        telegramBotService,
    }) {
        this.container = container;
        this.publicDir = publicDir;
        this.usersDb = usersDb;
        this.devicesDb = devicesDb;
        this.sessions = sessions;
        this.registry = registry;
        this.nowMs = nowMs;
        this.telegramBotService = telegramBotService;
    }

    build({ onDeviceDisconnect }) {
        const app = express();
        app.use(express.json());
        app.use(cookieParser());
        this.telegramBotService?.install(app);
        app.use(
            express.static(this.publicDir, {
                setHeaders: (res, filePath) => {
                    const ext = path.extname(filePath).toLowerCase();
                    if (ext === ".html")
                        res.setHeader(
                            "Content-Type",
                            "text/html; charset=utf-8",
                        );
                    if (ext === ".js")
                        res.setHeader(
                            "Content-Type",
                            "application/javascript; charset=utf-8",
                        );
                    if (ext === ".css")
                        res.setHeader(
                            "Content-Type",
                            "text/css; charset=utf-8",
                        );
                    if (ext === ".json")
                        res.setHeader(
                            "Content-Type",
                            "application/json; charset=utf-8",
                        );
                    if ([".html", ".js", ".css", ".json"].includes(ext)) {
                        res.setHeader(
                            "Cache-Control",
                            "no-store, no-cache, must-revalidate",
                        );
                        res.setHeader("Pragma", "no-cache");
                        res.setHeader("Expires", "0");
                    }
                },
            }),
        );

        const scope = this.container.createScope();
        scope.register({
            app: asValue(app),
            onDeviceDisconnect: asValue(onDeviceDisconnect),
            nowMs: asValue(this.nowMs),
        });
        const api = scope.resolve("apiRouter");
        api.init();

        return { app, createServer: () => http.createServer(app) };
    }
}
