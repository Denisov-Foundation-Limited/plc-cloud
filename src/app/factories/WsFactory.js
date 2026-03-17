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
import { WebSocketServer } from "ws";
import { asValue } from "awilix";
import { rootLogger } from "../../utils/Logger.js";

const logger = rootLogger.child("WS");

export class WsFactory {
    constructor({ container, sessions, devicesDb, registry }) {
        this.container = container;
        this.sessions = sessions;
        this.devicesDb = devicesDb;
        this.registry = registry;
    }

    build({
        webServer,
        deviceServer,
        proto,
        onDeviceOnline,
        onDeviceOffline,
        onDeviceUpdate,
    }) {
        const webWss = new WebSocketServer({ noServer: true });
        const deviceWss = new WebSocketServer({ noServer: true });

        const webScope = this.container.createScope();
        webScope.register({
            wss: asValue(webWss),
        });
        const webWs = webScope.resolve("webWsServer");

        const deviceScope = this.container.createScope();
        deviceScope.register({
            wss: asValue(deviceWss),
            proto: asValue(proto),
            onDeviceOnline: asValue(onDeviceOnline),
            onDeviceOffline: asValue(onDeviceOffline),
            onDeviceUpdate: asValue(onDeviceUpdate),
        });
        const deviceWs = deviceScope.resolve("deviceWsServer");

        webWs.setDeviceWs(deviceWs);

        webServer.on("upgrade", (req, socket, head) => {
            const { url = "" } = req;
            if (!url.startsWith("/ws/web")) {
                socket.destroy();
                return;
            }
            logger.info(`upgrade web ${req.socket.remoteAddress || "unknown"}`);
            webWss.handleUpgrade(req, socket, head, (ws) =>
                webWss.emit("connection", ws, req),
            );
        });

        deviceServer.on("upgrade", (req, socket, head) => {
            const { url = "" } = req;
            if (!url.startsWith("/ws/device")) {
                socket.destroy();
                return;
            }
            logger.info(
                `upgrade device ${req.socket.remoteAddress || "unknown"}`,
            );
            deviceWss.handleUpgrade(req, socket, head, (ws) =>
                deviceWss.emit("connection", ws, req),
            );
        });

        webWs.init();
        deviceWs.init();

        return { webWs, deviceWs, webWss, deviceWss };
    }
}
