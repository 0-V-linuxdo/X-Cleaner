/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { defineHook } from "@api/PluginManager";
import { showToast } from "@ui/toast";
import { Icons } from "@ui/icons";
import { Logger } from "@utils/Logger";
import definePlugin, { StartAt } from "@utils/types";
import { toConfigHandle } from "@x/text";

import { getConfigStore } from "../_api/blockerConfig";
import { getController, isFilterActive } from "../_api/replyFilter";
import { getRuleStats } from "../ruleStats";
import { createImportPage } from "./importExport";
import { Panel } from "./panel";
import { createReviewPage, reviewActions } from "./review";
import css from "./styles.css";
import type { PanelPageDef, PanelTabDef, ReviewAction } from "./types";

export type { PanelContext, PanelPageDef, PanelTabDef, PageInstance, ReviewAction } from "./types";

const logger = new Logger("Panel");

let panel: Panel | null = null;
let offStats: (() => void) | null = null;
let statsPoll: ReturnType<typeof setInterval> | undefined;

export function getPanel(): Panel | null {
    return panel;
}

export function openPanel(tab?: string, page?: string) {
    panel?.show(tab, page);
}

const TABS: PanelTabDef[] = [
    { id: "review", label: "复查", order: 10 },
    { id: "blacklist", label: "黑名单", order: 20 },
    { id: "allowlist", label: "白名单", order: 30 },
    { id: "settings", label: "设置", order: 40 },
    { id: "plugins", label: "插件", order: 50 },
];

const PAGES: PanelPageDef[] = [
    { tab: "review", id: "records", label: "复查", order: 0, create: createReviewPage },
    { tab: "settings", id: "import", label: "导入", order: 40, create: createImportPage },
];

const handleOf = (rec: { context: { authorHandle: string } }) => toConfigHandle(rec.context.authorHandle);

const BASE_ACTIONS: ReviewAction[] = [
    {
        id: "restore",
        order: 10,
        label: () => "恢复",
        run(rec) {
            getController().restore(rec.tweetId);
            showToast("该回复已恢复显示。", { type: "success" });
        },
    },
    {
        id: "allow",
        order: 20,
        label: () => "加入白名单",
        disabled: rec => !handleOf(rec),
        run(rec) {
            const handle = handleOf(rec);
            if (!getConfigStore().addAllowHandle(handle)) throw new Error("保存设置失败。");
            getController().restoreAuthor(handle);
            showToast(`${handle} 已加入白名单。`, { type: "success" });
        },
    },
    {
        id: "block",
        order: 30,
        label: rec => (handleOf(rec) && getConfigStore().findAccount(handleOf(rec)) ? "移出黑名单" : "加入黑名单"),
        disabled: rec => !handleOf(rec),
        run(rec) {
            const store = getConfigStore();
            const handle = handleOf(rec);
            if (store.findAccount(handle)) {
                store.removeBlockedAccount(handle);
                showToast(`${handle} 已移出账号黑名单。`, { type: "success" });
                return;
            }
            if (!store.addBlockedAccount({ handle, source: "manual" })) throw new Error(store.config.allowHandles.includes(handle) ? "该账号已在白名单中。" : "保存设置失败。");
            getController().unrestore(handle);
            getController().configurationChanged();
            showToast(`${handle} 已加入账号黑名单。`, { type: "success" });
        },
    },
];

function registerMenu() {
    if (typeof GM_registerMenuCommand !== "function") return;
    try {
        GM_registerMenuCommand("打开 X Cleaner", () => openPanel("review"));
        GM_registerMenuCommand("打开黑名单与正则", () => openPanel("blacklist"));
    } catch (e) {
        logger.error("Menu command registration failed", e);
    }
}

let menuRegistered = false;

export default definePlugin({
    name: "Panel",
    description: "主面板：右下角悬浮按钮和抽屉，承载复查、黑名单、白名单、设置等页面。各页面由对应插件注册。",
    icon: Icons.shield,
    tags: ["core", "replies"],
    enabledByDefault: true,
    startAt: StartAt.DOMContentLoaded,
    dependencies: ["BlockerConfig", "ReplyFilter"],
    managedStyle: css,
    panelTabs: TABS,
    panelPages: PAGES,
    reviewActions: BASE_ACTIONS,

    events: {
        recordsChanged(records) {
            panel?.setCount(records.length);
            panel?.refresh();
        },
        filterStopped() {
            panel?.setCount(0);
            panel?.refresh();
        },
        panelOpen({ tab, page }) {
            openPanel(tab, page);
        },
        panelRefresh() {
            panel?.refresh();
        },
    },

    start() {
        panel = new Panel(getConfigStore());
        panel.mount();
        if (isFilterActive()) panel.setCount(getController().visibleRecords().length);
        // RuleStats may start or stop independently; re-bind to whatever store is current.
        let bound: unknown = null;
        const bindStats = () => {
            const stats = getRuleStats();
            if (stats === bound) return;
            offStats?.();
            bound = stats;
            offStats = stats?.subscribe(() => panel?.refresh()) ?? null;
        };
        bindStats();
        statsPoll = setInterval(bindStats, 2000);
        if (!menuRegistered) {
            menuRegistered = true;
            registerMenu();
        }
    },

    stop() {
        clearInterval(statsPoll);
        offStats?.();
        offStats = null;
        panel?.destroy();
        panel = null;
    },
});

defineHook("panelTabs", {
    provider: "Panel",
    optional: true,
    attach(_plugin, tabs) {
        for (const t of tabs) panel?.tabs.set(t.id, t);
        panel?.refresh();
        return () => { for (const t of tabs) panel?.tabs.delete(t.id); };
    },
});

defineHook("panelPages", {
    provider: "Panel",
    optional: true,
    attach(_plugin, pages) {
        for (const p of pages) panel?.pages.set(`${p.tab}/${p.id}`, p);
        panel?.rerenderIfOpen();
        return () => { for (const p of pages) panel?.removePage(p.tab, p.id); };
    },
});

defineHook("reviewActions", {
    provider: "Panel",
    optional: true,
    attach(_plugin, actions) {
        for (const a of actions) reviewActions.set(a.id, a);
        panel?.refresh();
        return () => {
            for (const a of actions) if (reviewActions.get(a.id) === a) reviewActions.delete(a.id);
            panel?.refresh();
        };
    },
});
