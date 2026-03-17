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
function pad(value) {
    return String(value).padStart(2, "0");
}

function formatDate(now) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function formatTime(now) {
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export class Logger {
    constructor(scope = "APP", clock = () => new Date()) {
        this.scope = String(scope || "APP").toUpperCase();
        this.clock = clock;
    }

    child(scope) {
        return new Logger(scope, this.clock);
    }

    log(level, message) {
        const now = this.clock();
        const lvl = String(level || "INFO").toUpperCase();
        const text = String(message ?? "");
        const line = `[${formatDate(now)}][${formatTime(now)}][${lvl}][${this.scope}] ${text}`;
        console.log(line);
    }

    info(message) {
        this.log("INFO", message);
    }

    warn(message) {
        this.log("WARN", message);
    }

    error(message) {
        this.log("ERROR", message);
    }

    debug(message) {
        this.log("DEBUG", message);
    }
}

export const rootLogger = new Logger("APP");
