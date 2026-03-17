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
export async function api(path, options = {}) {
    const res = await fetch(path, { ...options, credentials: "include" });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "request_failed");
    }
    return res.json();
}
