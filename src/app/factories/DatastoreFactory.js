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
export class DatastoreFactory {
    constructor({
        usersDb,
        devicesDb,
        telegramConfigDb,
        seedSampleEnabled = false,
    }) {
        this.usersDb = usersDb;
        this.devicesDb = devicesDb;
        this.telegramConfigDb = telegramConfigDb;
        this.seedSampleEnabled = seedSampleEnabled;
    }

    async build() {
        await this.usersDb.init();
        await this.devicesDb.init();
        await this.telegramConfigDb.init();
        if (this.seedSampleEnabled) {
            await this.devicesDb.ensureSample();
        }

        return {
            usersDb: this.usersDb,
            devicesDb: this.devicesDb,
            telegramConfigDb: this.telegramConfigDb,
        };
    }
}
