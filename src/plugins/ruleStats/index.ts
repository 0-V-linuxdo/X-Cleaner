/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Icons } from "@ui/icons";
import { N_, t } from "@utils/i18n";
import definePlugin from "@utils/types";

import { getBackend } from "../_api/blockerConfig";
import { RuleStatsStore } from "./store";

let store: RuleStatsStore | null = null;

export function getRuleStats(): RuleStatsStore | null {
    return store;
}

export default definePlugin({
    name: "RuleStats",
    description: N_("规则命中统计：记录每条词语、域名、正则和账号规则累计隐藏了多少条不重复回复。统计单独保存，不进入配置导出。"),
    icon: Icons.chart,
    tags: ["filters"],
    enabledByDefault: true,
    dependencies: ["BlockerConfig"],

    events: {
        replyHidden({ ctx, verdict }) {
            if (verdict.statsKey) store?.record(ctx.tweetId, verdict.statsKey);
        },
    },

    start() {
        store = new RuleStatsStore(getBackend());
    },

    stop() {
        store?.dispose();
        store = null;
    },
});
