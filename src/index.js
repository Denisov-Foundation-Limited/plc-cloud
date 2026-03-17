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
import { AppContainer } from "./app/AppContainer.js";
import { rootLogger } from "./utils/Logger.js";

const logger = rootLogger.child("APP");
const ROOT = process.cwd();

logger.info("Application init");

const appContainer = new AppContainer({ rootDir: ROOT });
const container = appContainer.create();
const app = container.resolve("appServer");
await app.init();

const HOST = process.env.HOST || "0.0.0.0";
const WEB_PORT = Number(process.env.WEB_PORT || 80);
const DEVICE_PORT = Number(process.env.PORT || 3001);
app.listen({ webPort: WEB_PORT, devicePort: DEVICE_PORT, host: HOST });
