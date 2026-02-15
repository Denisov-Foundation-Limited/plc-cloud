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
import { AppContainer } from './app/AppContainer.js';
import { rootLogger } from './utils/Logger.js';

const logger = rootLogger.child('APP');
const ROOT = process.cwd();

logger.info('Application init');

const container = new AppContainer({ rootDir: ROOT });
const app = container.build();
await app.init();

const PORT = process.env.PORT || 3000;
app.listen(PORT, '192.168.1.108');
