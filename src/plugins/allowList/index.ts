/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isAllowed } from "@rules/lists";
import { Icons } from "@ui/icons";
import definePlugin from "@utils/types";

import { allowListMenuItem } from "../accountBlacklist/menu";
import { createAllowPage } from "./page";

export default definePlugin({
    name: "AllowList",
    description: "精确账号白名单：名单内账号的回复永远不会被隐藏，也不会被自动加入黑名单。",
    icon: Icons.shield,
    tags: ["filters"],
    enabledByDefault: true,
    postMenuItems: [allowListMenuItem],
    panelPages: [{ tab: "allowlist", id: "handles", label: "白名单", order: 0, create: createAllowPage }],
    replyJudges: [{
        id: "allowlist",
        priority: 20,
        judge: (ctx, env) => (isAllowed(env.config, ctx.authorHandle) ? { action: "allow", source: "protection" } : null),
        quick: (input, env) => (input.authorHandle && isAllowed(env.config, input.authorHandle) ? { action: "allow", source: "protection" } : null),
    }],
});
