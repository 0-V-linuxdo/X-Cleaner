/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { autoGrow, button, pill } from "@plugins/panel/components";
import { errorLine, hitPill, matches, pageHeader } from "@plugins/panel/kit";
import type { PageInstance, PanelContext } from "@plugins/panel/types";
import { FIELD_LABELS, MAX_REGEX_RULES, MAX_SOURCE, newRegexId, orderFlags, type RegexField, type RegexRule, validateRegex } from "@rules/regex";
import { BATCH_TIMEOUT_MS, probeRegex } from "@rules/regex-runner";
import { h } from "@ui/h";
import { showToast } from "@ui/toast";

const FIELDS: RegexField[] = ["body", "displayName", "handle", "links"];

export function createRegexPage(ctx: PanelContext): PageInstance {
    let editing: RegexRule | null = null;
    let testSeq = 0;
    const name = h("input", { class: "xc-input", type: "text", maxLength: 100, "aria-label": "规则名称", placeholder: "规则名称" });
    const source = h("textarea", { class: "xc-textarea xc-mono", rows: 1, maxLength: MAX_SOURCE, placeholder: `正则表达式（最多 ${MAX_SOURCE} 字符）`, "aria-label": "正则表达式" });
    source.style.minHeight = "34px";
    autoGrow(source);
    const flags = h("input", { class: "xc-input xc-mono", type: "text", maxLength: 4, placeholder: "flags：i / m / s / u", "aria-label": "flags" });
    const fieldBoxes = FIELDS.map(f => h("input", { type: "checkbox", value: f }));
    const enabled = h("input", { type: "checkbox" });
    const sample = h("textarea", { class: "xc-textarea", rows: 2, placeholder: "样本文本", "aria-label": "样本文本" });
    const sampleMsg = errorLine();
    const msg = errorLine();
    const submit = h("button", { class: "xc-btn xc-btn-primary", type: "submit" }, "添加规则");
    const cancel = button("取消编辑", () => resetForm());
    const form = h("form", { class: "xc-form" },
        h("label", null, "规则名称", name),
        h("label", null, "正则表达式", source),
        h("label", null, "Flags", flags),
        h("div", { class: "xc-checks", role: "group", "aria-label": "匹配字段" }, FIELDS.map((f, i) => h("label", { class: "xc-check" }, fieldBoxes[i], FIELD_LABELS[f]))),
        h("label", { class: "xc-check" }, enabled, "启用规则"),
        h("label", null, "样本文本", sample),
        sampleMsg,
        h("div", { class: "xc-row" }, button("测试样本", () => void testSample()), submit, cancel),
        msg,
    );
    const list = h("div", { class: "xc-items", role: "list", "aria-label": "正则规则" });
    const header = pageHeader("正则", () => ctx.store.config.blacklists.regexRules.map(r => `regex:${r.id.trim().slice(0, 120)}`), () => renderList());
    const el = h("div", { class: "xc-page" }, header.el, form, list);

    const selectedFields = () => fieldBoxes.filter(b => b.checked).map(b => b.value as RegexField);

    function resetForm() {
        editing = null;
        testSeq++;
        name.value = "";
        source.value = "";
        flags.value = "iu";
        sample.value = "";
        enabled.checked = true;
        fieldBoxes.forEach(b => { b.checked = b.value === "body"; });
        msg.show("");
        sampleMsg.show("");
        submit.textContent = "添加规则";
        cancel.hidden = true;
        source.dispatchEvent(new Event("input"));
    }

    function edit(rule: RegexRule) {
        editing = rule;
        name.value = rule.name;
        source.value = rule.source;
        flags.value = rule.flags;
        enabled.checked = rule.enabled;
        fieldBoxes.forEach(b => { b.checked = rule.fields.includes(b.value as RegexField); });
        msg.show("");
        sampleMsg.show("");
        submit.textContent = "保存规则";
        cancel.hidden = false;
        source.dispatchEvent(new Event("input"));
        name.focus();
    }

    async function testSample() {
        const check = validateRegex(source.value, flags.value, selectedFields());
        if (!check.valid) return sampleMsg.show(check.error!);
        const seq = ++testSeq;
        sampleMsg.show("Worker 测试中...", "info");
        const samples = selectedFields().map(f => ({ key: f, text: sample.value.slice(0, 4000) }));
        let outcome;
        try {
            outcome = await probeRegex(source.value, orderFlags(flags.value), samples, BATCH_TIMEOUT_MS);
        } catch {
            outcome = { status: "error" as const, message: "" };
        }
        if (seq !== testSeq) return;
        switch (outcome.status) {
            case "timeout":
                enabled.checked = false;
                return sampleMsg.show("执行超过 30ms；样本按未命中处理，规则已在表单中停用。");
            case "unavailable":
                return sampleMsg.show("正则 Worker 不可用；为避免阻塞页面，样本未执行。", "warning");
            case "error":
                return sampleMsg.show("正则 Worker 执行失败；样本按未命中处理。");
            default:
                if (outcome.value.length) sampleMsg.show(`命中：${outcome.value.map(k => FIELD_LABELS[k as RegexField]).join("、")}`, "success");
                else sampleMsg.show("未命中样本文本。", "info");
        }
    }

    form.addEventListener("submit", e => {
        e.preventDefault();
        const ruleName = name.value.trim().slice(0, 100);
        if (!ruleName) return msg.show("规则名称不能为空。");
        const fields = selectedFields();
        const check = validateRegex(source.value, flags.value, fields);
        if (!check.valid) return msg.show(check.error!);
        const rules = ctx.store.config.blacklists.regexRules;
        if (!editing && rules.length >= MAX_REGEX_RULES) return msg.show(`正则规则已达到 ${MAX_REGEX_RULES} 条上限。`);
        const rule: RegexRule = {
            id: editing?.id ?? newRegexId(),
            name: ruleName,
            source: source.value,
            flags: orderFlags(flags.value),
            enabled: enabled.checked,
            valid: true,
            fields,
            error: null,
            errorCode: null,
        };
        const target = editing;
        const ok = ctx.commit(c => {
            const at = target ? c.blacklists.regexRules.findIndex(r => r.id === target.id) : -1;
            if (at >= 0) c.blacklists.regexRules.splice(at, 1, rule);
            else c.blacklists.regexRules.push(rule);
        });
        if (!ok) return;
        showToast("正则规则已保存。", { type: "success" });
        resetForm();
    });

    function toggle(rule: RegexRule) {
        if (!rule.enabled) {
            const check = validateRegex(rule.source, rule.flags, rule.fields);
            if (!check.valid) {
                showToast(check.error!, { type: "error" });
                return;
            }
        }
        ctx.commit(c => {
            const r = c.blacklists.regexRules.find(x => x.id === rule.id);
            if (!r) return;
            r.enabled = !rule.enabled;
            if (r.enabled && r.errorCode === "timeout") {
                r.errorCode = null;
                r.error = null;
            }
        });
    }

    function renderList() {
        header.update();
        const q = header.query();
        const rules = ctx.store.config.blacklists.regexRules.filter(r => matches(q, r.name, r.source, r.fields.map(f => FIELD_LABELS[f]).join(" "), r.fields.join(" ")));
        if (!rules.length) {
            list.replaceChildren(h("div", { class: "xc-empty" }, q ? "没有匹配的规则。" : "暂无正则规则。"));
            return;
        }
        list.replaceChildren(...rules.map(r => h("div", { class: "xc-item", role: "listitem" },
            h("div", { class: "xc-item-main" },
                h("div", { class: "xc-item-head" }, h("strong", null, r.name), hitPill(`regex:${r.id.trim().slice(0, 120)}`), pill(r.enabled ? "已启用" : "已停用", r.enabled ? "success" : "muted")),
                h("code", { class: "xc-mono", style: "font-size:12px" }, `/${r.source}/${r.flags}`),
                h("span", { class: "xc-item-meta xc-muted" }, r.fields.map(f => FIELD_LABELS[f] ?? f).join("、")),
                r.error ? h("span", { class: "xc-item-error" }, r.error) : null,
            ),
            h("div", { class: "xc-item-actions" },
                button(r.enabled ? "停用" : "启用", () => toggle(r), { small: true }),
                button("编辑", () => edit(r), { small: true }),
                button("移除", () => {
                    if (ctx.commit(c => { c.blacklists.regexRules = c.blacklists.regexRules.filter(x => x.id !== r.id); }) && editing?.id === r.id) resetForm();
                }, { small: true, kind: "danger" }),
            ),
        )));
    }

    resetForm();
    return {
        el,
        update: renderList,
        onShow: () => {
            header.clearQuery();
            resetForm();
        },
    };
}
