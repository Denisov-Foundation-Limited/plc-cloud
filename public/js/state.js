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
export const state = {
    ws: null,
    objects: [],
    currentObject: null,
    devicesRaw: [],
    devices: [],
    currentDevice: null,
    currentDeviceData: null,
    currentUnit: "local",
    currentNodeId: null,
    targetByDevice: {},
    currentSession: null,
};
