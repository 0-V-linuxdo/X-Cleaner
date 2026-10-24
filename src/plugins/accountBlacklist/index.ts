/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findAccount } from "@rules/lists";
import { Icons } from "@ui/icons";
import definePlugin from "@utils/types";

import { blacklistMenuItem, blacklistProfileItem } from "./menu";
import { createAccountsPage } from "./page";

export default definePlugin({
    name: "AccountBlacklist",
    description: "账号黑名单：手动条目优先于根帖作者保护；本地自动和 AI 自动条目在保护之后生效。",
    icon: Icons.ban,
    tags: ["filters", "moderation"],
    enabledByDefault: true,
    postMenuItems: [blacklistMenuItem],
    profileMenuItems: [blacklistProfileItem],
    panelPages: [{ tab: "blacklist", id: "accounts", label: "账号", order: 40, isDefault: true, create: createAccountsPage }],
    replyJudges: [
        {
            id: "manual-account",
            priority: 30,
            judge(ctx, env) {
                const entry = findAccount(env.config, ctx.authorHandle);
                if (entry?.source !== "manual") return null;
                return { action: "hide", source: "account", category: "手动账号黑名单", reason: `账号黑名单：${entry.handle}`, match: { kind: "account", value: entry.handle }, statsKey: `account:${entry.handle}` };
            },
            quick(input, env) {
                const entry = input.authorHandle ? findAccount(env.config, input.authorHandle) : undefined;
                return entry?.source === "manual" ? { action: "hide" } : null;
            },
        },
        {
            id: "auto-account",
            priority: 50,
            judge(ctx, env) {
                const entry = findAccount(env.config, ctx.authorHandle);
                if (!entry || entry.source === "manual") return null;
                return { action: "hide", source: "auto-account", category: entry.category || "自动账号黑名单", reason: entry.reason || "自动账号黑名单", score: entry.score, confidence: entry.confidence, match: { kind: "account", value: entry.handle }, statsKey: `account:${entry.handle}` };
            },
            quick(input, env) {
                const entry = input.authorHandle ? findAccount(env.config, input.authorHandle) : undefined;
                return entry && entry.source !== "manual" ? { action: "hide" } : null;
            },
        },
    ],
});
