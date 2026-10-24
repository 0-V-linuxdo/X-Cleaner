/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { defineHook } from "@api/PluginManager";
import { ReplyController } from "@filter/controller";
import type { Judge } from "@filter/types";
import type { Sensitivity } from "@config/config";
import { checkRow } from "@plugins/panel/kit";
import type { PanelContext } from "@plugins/panel/types";
import { h } from "@ui/h";
import definePlugin, { StartAt } from "@utils/types";

import { getConfigStore } from "../blockerConfig";
import { CHECKS } from "@x/health";

let controller: ReplyController | null = null;

export function getController(): ReplyController {
    return controller ??= new ReplyController(getConfigStore());
}

export function disposeController() {
    controller?.stop();
    controller = null;
}

export function isFilterActive(): boolean {
    return !!controller?.active;
}

const LEVELS: [Sensitivity, string][] = [["conservative", "保守"], ["balanced", "均衡"], ["aggressive", "激进"]];

function createRunPage(ctx: PanelContext) {
    const c = () => ctx.store.config;
    const enabled = checkRow("启用屏蔽", () => c().enabled, v => ctx.commit(d => { d.enabled = v; }));
    const auto = checkRow("自动将垃圾回复作者加入账号黑名单", () => c().autoBlacklistAccounts, v => ctx.commit(d => { d.autoBlacklistAccounts = v; }));
    const buttons = LEVELS.map(([value, label]) => h("button", { type: "button", onclick: () => ctx.commit(d => { d.sensitivity = value; }) }, label));
    const sync = () => {
        enabled.sync();
        auto.sync();
        LEVELS.forEach(([value], i) => buttons[i].setAttribute("aria-pressed", String(c().sensitivity === value)));
    };
    const el = h("div", { class: "xc-page" }, enabled, auto,
        h("div", { class: "xc-toggle-row" }, h("strong", null, "识别强度"), h("div", { class: "xc-segmented", role: "group", "aria-label": "识别强度" }, buttons)));
    sync();
    return { el, update: sync };
}

const OP_PROTECTION: Judge = {
    id: "op-protection",
    priority: 40,
    judge: (ctx, env) => (ctx.isOp && env.config.protections.op ? { action: "allow", source: "protection" } : null),
    quick: (input, env) => {
        const op = env.route.opHandle;
        return op && input.authorHandle === op && env.config.protections.op ? { action: "allow", source: "protection" } : null;
    },
};

export default definePlugin({
    name: "ReplyFilter",
    description: "在帖子详情页扫描回复，判定对话作用域，并按优先级调用各个判定器隐藏垃圾回复。",
    tags: ["replies", "core"],
    required: true,
    startAt: StartAt.DOMContentLoaded,
    dependencies: ["BlockerConfig"],
    healthChecks: [CHECKS.primaryColumn, CHECKS.posts],
    replyJudges: [OP_PROTECTION],
    panelPages: [{ tab: "settings", id: "run", label: "运行", order: 10, isDefault: true, create: createRunPage }],
    managedStyle: '[data-xrb-hidden="true"]{display:none !important}',

    events: {
        navigate() {
            controller?.navigate();
        },
    },

    start() {
        getController().start();
    },

    stop() {
        controller?.stop();
    },
});

defineHook("replyJudges", {
    provider: "ReplyFilter",
    attach(plugin, judges) {
        const offs = judges.map(j => getController().addJudge(plugin.name, j));
        return () => { for (const off of offs) off(); };
    },
});
