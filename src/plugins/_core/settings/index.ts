/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { dispatch, subscribe } from "@api/Events";
import { isPluginEnabled, plugins } from "@api/PluginManager";
import type { PageInstance } from "@plugins/panel/types";
import { h } from "@ui/h";
import { Icons } from "@ui/icons";
import type { TooltipHandle } from "@ui/tooltip";
import { Logger } from "@utils/Logger";
import definePlugin, { type Plugin, StartAt } from "@utils/types";

import { type ListFilter, openPluginSettings, openSettingsPanel, pluginCard, reloadBanner, searchFilterBar } from "./panel";
import css from "./styles.css";

const logger = new Logger("Settings");

export function openPanel() {
    dispatch("settingsOpen");
    openSettingsPanel();
}

function onKey(e: KeyboardEvent) {
    if (e.altKey && e.shiftKey && e.code === "KeyX") {
        e.preventDefault();
        openPanel();
    }
}

/** The drawer's 「插件」 tab: the same cards as the plugin manager, in one column. */
function createPluginsPage(): PageInstance {
    let search = "";
    let filter: ListFilter = "all";
    let tips: TooltipHandle[] = [];
    const list = h("div", { class: "xc-pm-grid" });
    const bar = searchFilterBar("", v => { search = v.trim().toLowerCase(); render(); }, v => { filter = v; render(); });
    const onConfig = (p: Plugin) => {
        const page = p.panelPages?.[0];
        if (p.settings || !page) openPluginSettings(p, false);
        else dispatch("panelOpen", { tab: page.tab, page: page.id });
    };
    function render() {
        for (const t of tips) t.destroy();
        tips = [];
        const names = Object.keys(plugins)
            .filter(n => !plugins[n].hidden && !plugins[n].required && !(plugins[n].dev && !IS_DEV))
            .filter(n => filter === "all" || isPluginEnabled(n) === (filter === "enabled"))
            .sort((a, b) => a.localeCompare(b));
        bar.input.placeholder = `搜索 ${names.length} 个插件...`;
        const shown = names.filter(n => !search || `${n} ${plugins[n].description}`.toLowerCase().includes(search));
        list.replaceChildren(...shown.map(n => pluginCard(n, { tips, rerender: render, onConfig })));
        if (!shown.length) list.replaceChildren(h("p", { class: "xc-pm-empty" }, "没有匹配搜索的插件。"));
    }
    const off = subscribe("pluginToggle", render);
    const banner = reloadBanner();
    const el = h("div", { class: "xc-pm-page" },
        banner.el,
        h("div", { class: "xc-row" }, h("span", { class: "xc-muted", style: "flex:1;font-size:13px" }, "开关功能。点击滑杆图标进入配置。"), h("button", { class: "xc-btn xc-btn-sm", type: "button", onclick: openPanel }, "插件管理")),
        bar.el,
        list,
    );
    render();
    return { el, update: render, dispose: () => { off(); banner.dispose(); for (const t of tips) t.destroy(); } };
}

export default definePlugin({
    name: "Settings",
    description: "插件管理：单独开关每个插件并修改插件设置。可从面板「插件」标签、脚本菜单或 Alt+Shift+X 打开。",
    icon: Icons.settings,
    tags: ["core"],
    required: true,
    startAt: StartAt.DOMContentLoaded,
    managedStyle: css,
    dependencies: ["CoreUI"],
    panelPages: [{ tab: "plugins", id: "list", label: "插件", order: 0, create: createPluginsPage }],

    start() {
        document.addEventListener("keydown", onKey, true);
        try {
            if (typeof GM_registerMenuCommand === "function") GM_registerMenuCommand("X Cleaner 插件管理", openPanel);
        } catch (e) {
            logger.error("Menu command registration failed", e);
        }
    },

    stop() {
        document.removeEventListener("keydown", onKey, true);
    },
});
