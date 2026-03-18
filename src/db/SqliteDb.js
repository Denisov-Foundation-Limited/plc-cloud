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
import path from "node:path";
import { Sequelize, DataTypes } from "sequelize";

export class SqliteDb {
    constructor({ dataDir }) {
        this.filePath = path.join(dataDir, "plc-cloud.sqlite");
        this.sequelize = null;
        this.models = null;
        this._initPromise = null;
    }

    async init() {
        if (this.models) return this.models;
        if (this._initPromise) return this._initPromise;
        this._initPromise = this.initInternal_();
        return this._initPromise;
    }

    async initInternal_() {
        const sequelize = new Sequelize({
            dialect: "sqlite",
            storage: this.filePath,
            logging: false,
        });

        const DeviceObject = sequelize.define(
            "DeviceObject",
            {
                name: {
                    type: DataTypes.STRING,
                    primaryKey: true,
                    allowNull: false,
                },
                icon: {
                    type: DataTypes.STRING,
                    allowNull: false,
                    defaultValue: "house",
                },
            },
            {
                tableName: "device_objects",
                timestamps: false,
            },
        );

        const Device = sequelize.define(
            "Device",
            {
                device_id: {
                    type: DataTypes.INTEGER,
                    primaryKey: true,
                    allowNull: false,
                },
                name: {
                    type: DataTypes.STRING,
                    allowNull: true,
                },
                api_key: {
                    type: DataTypes.STRING,
                    allowNull: false,
                    unique: true,
                },
                object_name: {
                    type: DataTypes.STRING,
                    allowNull: true,
                },
                last_seen_ms: {
                    type: DataTypes.BIGINT,
                    allowNull: false,
                    defaultValue: 0,
                },
            },
            {
                tableName: "devices",
                timestamps: false,
            },
        );

        const User = sequelize.define(
            "User",
            {
                username: {
                    type: DataTypes.STRING,
                    primaryKey: true,
                    allowNull: false,
                },
                password_hash: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                plc_username: {
                    type: DataTypes.STRING,
                    allowNull: false,
                    defaultValue: "",
                },
                telegram_username: {
                    type: DataTypes.STRING,
                    allowNull: false,
                    defaultValue: "",
                },
                chat_id: {
                    type: DataTypes.STRING,
                    allowNull: false,
                    defaultValue: "",
                },
                telegram_notify_online: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: false,
                },
                telegram_notify_offline: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: false,
                },
                telegram_notify_events: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: false,
                },
                notification_prefs_json: {
                    type: DataTypes.TEXT,
                    allowNull: false,
                    defaultValue: "[]",
                },
                allowed_objects_json: {
                    type: DataTypes.TEXT,
                    allowNull: false,
                    defaultValue: "[]",
                },
            },
            {
                tableName: "users",
                timestamps: false,
            },
        );

        const TelegramConfig = sequelize.define(
            "TelegramConfig",
            {
                id: {
                    type: DataTypes.INTEGER,
                    primaryKey: true,
                    allowNull: false,
                },
                token: {
                    type: DataTypes.TEXT,
                    allowNull: false,
                    defaultValue: "",
                },
                public_base_url: {
                    type: DataTypes.TEXT,
                    allowNull: false,
                    defaultValue: "",
                },
                webhook_path: {
                    type: DataTypes.TEXT,
                    allowNull: false,
                    defaultValue: "/telegram/webhook",
                },
                secret_token: {
                    type: DataTypes.TEXT,
                    allowNull: false,
                    defaultValue: "",
                },
            },
            {
                tableName: "telegram_config",
                timestamps: false,
            },
        );

        await sequelize.sync();
        await this.ensureUserColumns_(sequelize);

        this.sequelize = sequelize;
        this.models = {
            sequelize,
            DeviceObject,
            Device,
            User,
            TelegramConfig,
        };
        return this.models;
    }

    async ensureUserColumns_(sequelize) {
        const qi = sequelize.getQueryInterface();
        const table = await qi.describeTable("users");
        const addIfMissing = async (name, spec) => {
            if (table[name]) return;
            await qi.addColumn("users", name, spec);
        };
        await addIfMissing("telegram_notify_online", {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        });
        await addIfMissing("telegram_notify_offline", {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        });
        await addIfMissing("telegram_notify_events", {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        });
        await addIfMissing("notification_prefs_json", {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: "[]",
        });
        await addIfMissing("allowed_objects_json", {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: "[]",
        });
    }
}
