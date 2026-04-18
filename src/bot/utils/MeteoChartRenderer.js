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

import chartJsNodeCanvasPkg from "chartjs-node-canvas";

const { ChartJSNodeCanvas } = chartJsNodeCanvasPkg;

const WIDTH = 1200;
const HEIGHT = 720;

function formatLabel(ts) {
    const date = new Date(Number(ts || 0));
    if (!Number.isFinite(date.getTime())) return "--:--";
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function toNumericSeries(history, key) {
    return history.map((entry) => {
        const value = Number(entry?.[key]);
        return Number.isFinite(value) ? value : null;
    });
}

export async function renderMeteoChart({
    history = [],
    sensorName = "Sensor",
    deviceName = "",
    showHumidity = false,
}) {
    const labels = history.map((entry) => formatLabel(entry?.ts));
    const tempSeries = toNumericSeries(history, "temp_c");
    const humiditySeries = showHumidity ? toNumericSeries(history, "humidity") : [];

    const canvas = new ChartJSNodeCanvas({
        width: WIDTH,
        height: HEIGHT,
        backgroundColour: "#f7f4ed",
    });

    const configuration = {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "Температура, °C",
                    data: tempSeries,
                    borderColor: "#c25b2a",
                    backgroundColor: "rgba(194, 91, 42, 0.16)",
                    yAxisID: "yTemp",
                    borderWidth: 3,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    tension: 0.28,
                    spanGaps: true,
                    fill: true,
                },
                ...(showHumidity
                    ? [
                          {
                              label: "Влажность, %",
                              data: humiditySeries,
                              borderColor: "#2d7fb8",
                              backgroundColor: "rgba(45, 127, 184, 0.10)",
                              yAxisID: "yHumidity",
                              borderWidth: 3,
                              pointRadius: 0,
                              pointHoverRadius: 3,
                              tension: 0.28,
                              spanGaps: true,
                              fill: false,
                          },
                      ]
                    : []),
            ],
        },
        options: {
            responsive: false,
            animation: false,
            plugins: {
                title: {
                    display: true,
                    text: deviceName
                        ? `${sensorName} · ${deviceName}`
                        : `${sensorName}`,
                    color: "#24201b",
                    font: {
                        size: 24,
                        weight: "bold",
                    },
                    padding: {
                        top: 20,
                        bottom: 20,
                    },
                },
                legend: {
                    display: true,
                    labels: {
                        color: "#3c342d",
                        boxWidth: 18,
                        font: {
                            size: 14,
                        },
                    },
                },
            },
            interaction: {
                mode: "index",
                intersect: false,
            },
            scales: {
                x: {
                    ticks: {
                        color: "#5e554b",
                        maxTicksLimit: 8,
                    },
                    grid: {
                        color: "rgba(70, 62, 52, 0.08)",
                    },
                },
                yTemp: {
                    type: "linear",
                    position: "left",
                    ticks: {
                        color: "#8f431f",
                        callback: (value) => `${value}°C`,
                    },
                    grid: {
                        color: "rgba(194, 91, 42, 0.08)",
                    },
                },
                ...(showHumidity
                    ? {
                          yHumidity: {
                              type: "linear",
                              position: "right",
                              min: 0,
                              max: 100,
                              ticks: {
                                  color: "#2d6d99",
                                  callback: (value) => `${value}%`,
                              },
                              grid: {
                                  drawOnChartArea: false,
                              },
                          },
                      }
                    : {}),
            },
        },
    };

    return canvas.renderToBuffer(configuration, "image/png");
}
