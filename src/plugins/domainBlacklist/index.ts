/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LIMITS } from "@config/config";
import { domainWarning } from "@rules/domains";
import { matchDomain } from "@rules/lists";
import { stringListPage } from "@plugins/panel/stringList";
import { Icons } from "@ui/icons";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "DomainBlacklist",
    description: "域名黑名单：匹配回复中可见链接的域名及其子域。不访问链接，也不解析 t.co 短链。",
    icon: Icons.ban,
    tags: ["filters"],
    enabledByDefault: true,
    panelPages: [{
        tab: "blacklist",
        id: "domains",
        label: "域名",
        order: 20,
        create: stringListPage({
            label: "域名",
            placeholder: "example.com",
            statsPrefix: "domain",
            limit: LIMITS.domains,
            fullMessage: `域名黑名单已满（${LIMITS.domains}）。`,
            savedToast: "域名黑名单已保存。",
            get: c => c.blacklists.domains,
            set: (c, list) => { c.blacklists.domains = list; },
            normalize: raw => {
                const { domain } = domainWarning(raw);
                return domain ? { value: domain } : { error: "请输入有效域名。" };
            },
            hint: raw => domainWarning(raw).warning,
        }),
    }],
    replyJudges: [{
        id: "domain",
        priority: 70,
        judge(ctx, env) {
            const hit = matchDomain(env.config.blacklists.domains, ctx);
            if (!hit) return null;
            const reason = `域名黑名单：${hit.domain}`;
            return { action: "hide", source: "domain", category: "域名黑名单", reason, match: { kind: "domain", value: hit.domain }, statsKey: `domain:${hit.domain}`, autoEntry: { source: "local-auto", category: "域名黑名单", reason } };
        },
    }],
});
