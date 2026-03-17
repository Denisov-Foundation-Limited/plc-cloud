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

export function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

export function generateApiKey() {
    return crypto.randomBytes(16).toString("hex");
}
