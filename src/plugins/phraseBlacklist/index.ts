/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LIMITS } from "@config/config";
import { matchPhrase } from "@rules/lists";
import { stringListPage } from "@plugins/panel/stringList";
import { normalizePhrase } from "@x/text";
import { Icons } from "@ui/icons";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "PhraseBlacklist",
    description: "词语黑名单：依次检查回复正文、显示名和 handle，忽略全角和零宽字符混淆。",
    icon: Icons.filter,
    tags: ["filters"],
    enabledByDefault: true,
    panelPages: [{
        tab: "blacklist",
        id: "phrases",
        label: "词语",
        order: 10,
        create: stringListPage({
            label: "词语",
            placeholder: "要屏蔽的词语",
            description: "点击回复旁的盾牌，在弹窗正文、显示名或账号中划词并勾选后加入，或据此分析规则。",
            statsPrefix: "phrase",
            limit: LIMITS.phrases,
            fullMessage: `词语黑名单已满（${LIMITS.phrases}）。`,
            savedToast: "词语黑名单已保存。",
            get: c => c.blacklists.phrases,
            set: (c, list) => { c.blacklists.phrases = list; },
            normalize: raw => {
                const value = normalizePhrase(raw);
                return value ? { value } : { error: "词语不能为空。" };
            },
        }),
    }],
    replyJudges: [{
        id: "phrase",
        priority: 60,
        judge(ctx, env) {
            const hit = matchPhrase(env.config.blacklists.phrases, ctx);
            if (!hit) return null;
            const reason = `词语黑名单：“${hit.phrase}”`;
            return { action: "hide", source: "phrase", category: "词语黑名单", reason, match: { kind: "phrase", value: hit.phrase, field: hit.field }, statsKey: `phrase:${hit.phrase}`, autoEntry: { source: "local-auto", category: "词语黑名单", reason } };
        },
        quick: (input, env) => (matchPhrase(env.config.blacklists.phrases, input) ? { action: "hide" } : null),
    }],
});
