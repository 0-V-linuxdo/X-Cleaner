/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { loadSettings, settingsStore } from "@api/Settings";
import { pruneOrphanedPluginSettings, registerPlugin, startAllPlugins, trackKnownPlugins } from "@api/PluginManager";
import { Logger } from "@utils/Logger";
import { type Plugin, StartAt } from "@utils/types";

import Plugins from "~plugins";

export * as Events from "@api/Events";
export * as PluginManager from "@api/PluginManager";
export * as SettingsApi from "@api/Settings";
export { Settings } from "@api/Settings";
export { plugins } from "@api/PluginManager";

const logger = new Logger("Core", "#1d9bf0");
let booted = false;

export function boot() {
    if (booted) return;
    booted = true;
    // Read-only marker so a check after an update can tell which build the page is running.
    document.documentElement.dataset.xcVersion = VERSION;
    loadSettings();
    for (const plugin of Object.values(Plugins)) registerPlugin(plugin as Plugin);
    pruneOrphanedPluginSettings();
    trackKnownPlugins();
    startAllPlugins(StartAt.Init);
    const onReady = () => startAllPlugins(StartAt.DOMContentLoaded);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady, { once: true });
    else onReady();
    addEventListener("pagehide", () => settingsStore.flush());
    logger.info(`${VERSION} started with ${Object.keys(Plugins).length} plugins`);
}
