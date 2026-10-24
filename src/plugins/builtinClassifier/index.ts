/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classify } from "@rules/classifier";
import { Icons } from "@ui/icons";
import { checkRow } from "@plugins/panel/kit";
import type { PanelContext } from "@plugins/panel/types";
import { h } from "@ui/h";
import definePlugin from "@utils/types";

function createCategoriesPage(ctx: PanelContext) {
    const c = () => ctx.store.config;
    const rows = [
        checkRow("成人引流", () => c().categories.adult, v => ctx.commit(d => { d.categories.adult = v; })),
        checkRow("加密货币引流", () => c().categories.crypto, v => ctx.commit(d => { d.categories.crypto = v; })),
        checkRow("推广用户名", () => c().categories.promotionalName, v => ctx.commit(d => { d.categories.promotionalName = v; })),
        checkRow("保护根帖作者回复", () => c().protections.op, v => ctx.commit(d => { d.protections.op = v; })),
    ];
    return { el: h("div", { class: "xc-page" }, rows), update: () => rows.forEach(r => r.sync()) };
}

export default definePlugin({
    name: "BuiltinClassifier",
    description: "内置本地分类器：对成人引流、加密货币引流和推广用户名三类分别加权打分，有保守、均衡、激进三档灵敏度。",
    icon: Icons.sparkles,
    tags: ["filters"],
    enabledByDefault: true,
    panelPages: [{ tab: "settings", id: "categories", label: "类别", order: 20, create: createCategoriesPage }],
    replyJudges: [{
        id: "classifier",
        priority: 90,
        judge(ctx, env) {
            const c = classify(ctx, env.config, env.aiReady);
            env.state.classification = c;
            if (c.action !== "hide" || !c.category) return null;
            return {
                action: "hide", source: "classifier", category: c.category, reason: c.reason, score: c.score, threshold: c.threshold, signals: c.signals,
                autoEntry: c.autoBlacklistEligible ? { source: "local-auto", category: c.category, reason: c.reason, score: c.score } : null,
            };
        },
    }],
});
