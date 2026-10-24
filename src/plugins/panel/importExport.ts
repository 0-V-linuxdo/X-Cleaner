/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { dispatch } from "@api/Events";
import { normalizeRegexRule } from "@rules/regex";
import { h } from "@ui/h";
import { showToast } from "@ui/toast";
import { listJoin, t } from "@utils/i18n";

import { button } from "./components";
import { errorLine } from "./kit";
import type { PageInstance, PanelContext } from "./types";

export function parseImport(text: string): unknown {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(t("配置 JSON 无法解析。"));
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(t("配置必须是 JSON 对象。"));
    const rules = (parsed as any).blacklists?.regexRules;
    if (Array.isArray(rules)) {
        const bad = rules.map((r, i) => normalizeRegexRule(r, i)).filter(r => !r.valid).map(r => r.name);
        if (bad.length) throw new Error(t("正则规则无效：{rules}", { rules: listJoin(bad) }));
    }
    return parsed;
}

export function createImportPage(ctx: PanelContext): PageInstance {
    const area = h("textarea", { class: "xc-textarea xc-mono", rows: 12, placeholder: t("配置 JSON（不包含 API key）"), "aria-label": t("配置 JSON") });
    const msg = errorLine();
    const el = h("div", { class: "xc-page" },
        h("p", { class: "xc-muted" }, t("导出不包含 API key。导入会强制关闭 AI，且不会读取、覆盖或清除当前已保存的 API key。")),
        area,
        h("div", { class: "xc-row" },
            button(t("生成导出内容"), () => {
                area.value = ctx.store.exportConfig();
                area.focus();
                area.select();
                msg.show("");
                showToast(t("导出内容已生成，不包含 API key。"), { type: "success" });
            }),
            button(t("导入配置"), () => {
                try {
                    ctx.store.importConfig(parseImport(area.value));
                    dispatch("configImported");
                    msg.show("");
                    showToast(t("配置已导入；AI 已关闭，API key 未导出或更改。"), { type: "success" });
                } catch (e) {
                    msg.show(e instanceof Error ? e.message : String(e));
                }
            }, { kind: "primary" }),
        ),
        msg,
    );
    return { el };
}
