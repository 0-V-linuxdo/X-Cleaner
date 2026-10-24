/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { subscribe } from "@api/Events";
import { AiQueueError } from "@ai/queue";
import { generateRule } from "@ai/rule-generator";
import { aiUnavailableReason } from "@ai/transport";
import { autoGrow, pill } from "@plugins/panel/components";
import { FIELD_LABELS, MAX_REGEX_RULES, newRegexId, type RegexField, type RegexRule } from "@rules/regex";
import { checkCandidate, type SafetyResult, type SelectedPhrase } from "@rules/safety";
import { type Draft, type DraftRule, fieldValues, type FieldValues } from "@rules/synthesizer";
import { h, svgIcon } from "@ui/h";
import { Icons } from "@ui/icons";
import { showToast } from "@ui/toast";
import { contextSignature, OWNED_ATTR, type ReplyContext } from "@x/dom";

import { getAiQueue, onAiConfigChange } from "../_api/aiClient";
import { getConfigStore } from "../_api/blockerConfig";
import { getController } from "../_api/replyFilter";
import { analyze, AnalysisAbort, encodeSelection, selectionPhrase } from "./analysis";

export interface DraftTarget {
    routeKey: string;
    tweetId: string;
    handle: string;
    signature: string;
}

export interface DraftOutcome {
    saved: boolean;
    reason: "saved" | "cancelled";
}

type Busy = null | "analyze" | "regen" | "save";

const CHANGED = "回复内容或页面已变化，请重新点击回复旁的屏蔽按钮。";
const ABORTED = "页面或设置已变化，AI 规则生成已中止。";
const SOURCE_FIELDS: SelectedPhrase["field"][] = ["body", "displayName", "handle"];

let current: RuleDraftDialog | null = null;

export function activeDraft(): RuleDraftDialog | null {
    return current;
}

export function liveTarget(t: DraftTarget): ReplyContext | null {
    const c = getController();
    if (c.route.routeKey !== t.routeKey) return null;
    const ctx = c.liveContext(t.tweetId);
    if (!ctx || ctx.authorHandle !== t.handle || contextSignature(ctx) !== t.signature) return null;
    return ctx;
}

function protectedValues(): FieldValues[] {
    return getController().protectedContexts(50).map(fieldValues);
}

/** §17.1: open the draft dialog for one reply. Resolves when the dialog closes. */
export function openRuleDraft(target: DraftTarget, initial: (ctx: ReplyContext) => Draft | null): Promise<DraftOutcome> | null {
    if (!target.signature || !target.tweetId) throw new Error("回复身份不完整，操作已中止。");
    if (current) {
        if (current.busy) throw new Error("当前规则正在生成或保存，请完成后再分析其他回复。");
        if (current.target.tweetId === target.tweetId) {
            showToast("这条回复的规则草稿已经打开。", { type: "info" });
            return null;
        }
        throw new Error("请先保存或取消当前的规则草稿，再分析其他回复。");
    }
    const ctx = liveTarget(target);
    if (!ctx) throw new Error(CHANGED);
    const draft = initial(ctx);
    if (!draft) throw new Error("当前回复没有可用于生成规则的稳定字段。");
    return new Promise(resolve => {
        current = new RuleDraftDialog(target, ctx, draft, outcome => {
            current = null;
            resolve(outcome);
        });
    });
}

export function closeActiveDraft() {
    current?.forceClose();
}

class RuleDraftDialog {
    busy: Busy = null;
    private values: FieldValues;
    private draft: Draft;
    private negatives: string[] = [];
    private candidates: (SelectedPhrase & { checked: boolean })[] = [];
    private validation: SafetyResult | null = null;
    private validating = false;
    private validationSeq = 0;
    private requestSeq = 0;
    private flowToken = {};
    private aborted: ((reason: Error) => void) | null = null;
    private offs: Array<() => void> = [];
    private returnFocus: HTMLElement | null;
    private source: SelectedPhrase["field"];
    private selection = "";

    private backdrop: HTMLElement;
    private eyebrow = h("p", { class: "xc-rd-eyebrow" });
    private title = h("h2", { class: "xc-rd-title", id: "xc-rd-title" });
    private closeBtn = h("button", { class: "xc-btn xc-btn-icon", type: "button", "aria-label": "取消" }, svgIcon(Icons.close, 20));
    private nameInput = h("input", { class: "xc-input", type: "text", maxLength: 100, "aria-label": "规则名称" });
    private sourceInput = h("textarea", { class: "xc-textarea xc-mono", rows: 1, maxLength: 200, "aria-label": "正则表达式" });
    private flagsInput = h("input", { class: "xc-input xc-mono", type: "text", maxLength: 4, "aria-label": "Flags" });
    private fieldSelect = h("select", { class: "xc-select", "aria-label": "匹配字段" }, (Object.keys(FIELD_LABELS) as RegexField[]).map(f => h("option", { value: f }, FIELD_LABELS[f])));
    private reasonText = h("p", { class: "xc-rd-reason" });
    private confidenceText = h("span", { class: "xc-pill xc-pill-accent" });
    private targetCard = h("div", { class: "xc-rd-card" });
    private canaryCard = h("div", { class: "xc-rd-card" });
    private validationMsg = h("p", { class: "xc-form-msg", role: "status" });
    private followup = h("textarea", { class: "xc-textarea", rows: 2, maxLength: 1000, placeholder: "例如：缩小匹配范围，并排除正常讨论。", "aria-label": "补充要求" });
    private followupBtn = h("button", { class: "xc-btn xc-btn-sm", type: "button" }, "发送追问");
    private regenBtn = h("button", { class: "xc-btn", type: "button" }, "重新生成");
    private cancelBtn = h("button", { class: "xc-btn", type: "button" }, "取消");
    private saveBtn = h("button", { class: "xc-btn xc-btn-primary", type: "submit" }, "保存并启用");
    private selectorTabs = h("div", { class: "xc-tabs xc-rd-sources", role: "tablist", "aria-label": "划词来源" });
    private selectorArea = h("div", { class: "xc-rd-selector-area" });
    private preview = h("div", { class: "xc-rd-preview", hidden: true });
    private candidateList = h("div", { class: "xc-rd-candidates" });
    private selectorHint = h("p", { class: "xc-muted xc-rd-hint" });
    private addPhrasesBtn = h("button", { class: "xc-btn xc-btn-sm", type: "button" }, "加入勾选词语");
    private analyzePhrasesBtn = h("button", { class: "xc-btn xc-btn-sm", type: "button" }, "分析勾选词语");

    constructor(readonly target: DraftTarget, ctx: ReplyContext, draft: Draft, private done: (o: DraftOutcome) => void) {
        this.values = fieldValues(ctx);
        this.draft = draft;
        this.returnFocus = document.activeElement as HTMLElement | null;
        this.source = SOURCE_FIELDS.find(f => this.values[f]) ?? "body";
        const endpoint = getConfigStore().config.ai.endpoint;
        const identity = [ctx.displayName, ctx.authorHandle && `@${ctx.authorHandle}`].filter(Boolean).join(" · ") || "当前回复";

        autoGrow(this.sourceInput);
        const form = h("form", { class: "xc-rd-form" },
            h("section", { class: "xc-rd-target", "aria-label": "分析目标" },
                h("p", { class: "xc-rd-identity" }, identity),
                this.selectorTabs, this.selectorArea, this.preview, this.candidateList,
                h("div", { class: "xc-row" }, this.addPhrasesBtn, this.analyzePhrasesBtn),
                this.selectorHint,
                endpoint ? h("p", { class: "xc-muted xc-rd-endpoint" }, `AI 服务：${endpoint}`) : null,
            ),
            h("label", null, "规则名称", this.nameInput),
            h("label", null, "正则表达式", this.sourceInput),
            h("div", { class: "xc-rd-grid" }, h("label", null, "Flags", this.flagsInput), h("label", null, "匹配字段", this.fieldSelect)),
            h("div", { class: "xc-rd-conclusion" }, h("strong", null, "分析结论"), this.reasonText, this.confidenceText),
            h("div", { class: "xc-rd-cards" }, this.targetCard, this.canaryCard),
            this.validationMsg,
            h("details", { class: "xc-rd-followup" }, h("summary", null, "追问 AI"), h("label", null, "补充要求", this.followup), h("div", null, this.followupBtn)),
            h("div", { class: "xc-rd-actions" }, this.regenBtn, this.cancelBtn, this.saveBtn),
        );
        const dialog = h("div", { class: "xc-rd-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "xc-rd-title" },
            h("header", { class: "xc-rd-head" }, h("div", null, this.eyebrow, this.title), this.closeBtn),
            form,
        );
        this.backdrop = h("div", { class: "xc-root xc-rule-dialog-backdrop", [OWNED_ATTR]: "" }, dialog);

        this.backdrop.addEventListener("mousedown", e => { if (e.target === this.backdrop) this.cancel(); });
        this.closeBtn.addEventListener("click", () => this.cancel());
        this.cancelBtn.addEventListener("click", () => this.cancel());
        form.addEventListener("submit", e => { e.preventDefault(); void this.save(); });
        for (const input of [this.nameInput, this.sourceInput, this.flagsInput]) input.addEventListener("input", () => this.onEdit());
        this.fieldSelect.addEventListener("change", () => this.onEdit());
        this.followup.addEventListener("input", () => this.renderBusy());
        this.followupBtn.addEventListener("click", () => void this.runAnalysis(this.followup.value.trim(), "regen"));
        this.regenBtn.addEventListener("click", () => void this.runAnalysis(`Generate a different, narrower rule than this rejected draft: ${this.sourceInput.value}`, "regen"));
        this.addPhrasesBtn.addEventListener("click", () => this.addPhrases());
        this.analyzePhrasesBtn.addEventListener("click", () => {
            const selected = this.candidates.filter(c => c.checked);
            if (selected.length) void this.runAnalysis(encodeSelection(selected), "analyze");
        });
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopImmediatePropagation();
            this.cancel();
        };
        document.addEventListener("keydown", onKey, true);
        this.offs.push(() => document.removeEventListener("keydown", onKey, true));
        // AI generation stops only when the page or the AI settings change (「现状」fix: other config edits no longer abort it).
        this.offs.push(onAiConfigChange(() => this.aborted?.(new AnalysisAbort(ABORTED))));
        this.offs.push(subscribe("filterRouteChanged", () => this.aborted?.(new AnalysisAbort(ABORTED))));

        this.renderSelector();
        this.applyDraft(draft);
        this.renderBusy();
        (document.body ?? document.documentElement).appendChild(this.backdrop);
        queueMicrotask(() => this.nameInput.focus());
        void this.validate();
    }

    // ---------- selector (§17.3) ----------

    private sources(): SelectedPhrase["field"][] {
        return SOURCE_FIELDS.filter(f => this.values[f]);
    }

    private renderSelector() {
        const sources = this.sources();
        const labels: Record<SelectedPhrase["field"], string> = { body: "回复正文", displayName: "显示名", handle: "@handle" };
        this.selectorTabs.hidden = sources.length <= 1;
        this.selectorTabs.replaceChildren(...sources.map(f => h("button", {
            type: "button", class: "xc-tab", role: "tab", "aria-selected": String(f === this.source), tabindex: f === this.source ? "0" : "-1",
            onclick: () => { this.source = f; this.selection = ""; this.renderSelector(); },
        }, labels[f])));
        if (!sources.length) {
            this.selectorArea.replaceChildren();
        } else {
            const area = h("textarea", { class: "xc-textarea", rows: 3, readOnly: true, "aria-label": `${labels[this.source]}，划选后可加入词语` });
            area.value = this.values[this.source];
            const read = () => {
                const phrase = selectionPhrase(area.value.slice(area.selectionStart ?? 0, area.selectionEnd ?? 0));
                this.selection = phrase ?? "";
                this.renderPreview();
            };
            for (const ev of ["select", "mouseup", "keyup"]) area.addEventListener(ev, read);
            this.selectorArea.replaceChildren(area);
        }
        this.renderPreview();
        this.renderCandidates();
        const nonBody = sources.some(f => f !== "body");
        this.selectorHint.textContent = !sources.length
            ? "该回复没有可划选的正文、显示名或账号。"
            : nonBody ? "在回复正文、显示名或账号中划选词语并勾选，可加入黑名单，或据此分析规则。" : "在原文中划选词语并勾选，可加入黑名单，或据此分析规则。";
    }

    private renderPreview() {
        this.preview.hidden = !this.selection;
        if (!this.selection) return this.preview.replaceChildren();
        this.preview.replaceChildren(
            h("span", { class: "xc-rd-preview-text" }, this.selection),
            h("button", { class: "xc-btn xc-btn-sm", type: "button", onclick: () => {
                const existing = this.candidates.find(c => c.phrase === this.selection);
                if (existing) existing.checked = true;
                else this.candidates.push({ phrase: this.selection, field: this.source, checked: true });
                this.selection = "";
                this.renderPreview();
                this.renderCandidates();
            } }, "添加"),
            h("button", { class: "xc-btn xc-btn-sm", type: "button", onclick: () => { this.selection = ""; this.renderPreview(); } }, "清除"),
        );
    }

    private renderCandidates() {
        const showSource = this.candidates.some(c => c.field !== "body");
        const labels: Record<SelectedPhrase["field"], string> = { body: "正文", displayName: "显示名", handle: "@handle" };
        this.candidateList.replaceChildren(...this.candidates.map(c => h("button", {
            type: "button", class: "xc-rd-candidate", role: "checkbox", "aria-checked": String(c.checked),
            disabled: !!this.busy,
            onclick: () => { c.checked = !c.checked; this.renderCandidates(); },
        }, c.phrase, showSource ? pill(labels[c.field], "muted") : null)));
        const any = this.candidates.some(c => c.checked);
        this.addPhrasesBtn.disabled = !any || !!this.busy;
        this.analyzePhrasesBtn.disabled = !any || !!this.busy;
    }

    private addPhrases() {
        const checked = this.candidates.filter(c => c.checked);
        if (!checked.length) return showToast("没有可加入的词语。", { type: "info" });
        const store = getConfigStore();
        const added: string[] = [];
        let full = false;
        let exists = 0;
        for (const c of checked) {
            const r = store.addPhrase(c.phrase);
            if (r.ok) added.push(c.phrase);
            else if (r.reason === "limit") full = true;
            else if (r.reason === "exists") exists++;
        }
        this.candidates = this.candidates.filter(c => !added.includes(c.phrase));
        this.renderCandidates();
        if (added.length === checked.length) showToast(added.length === 1 ? `已加入词语「${added[0]}」。` : `已加入 ${added.length} 个词语。`, { type: "success" });
        else if (added.length) showToast(`已加入 ${added.length} 个词语，其余已存在或无法加入。`, { type: "success" });
        else if (full) showToast("词语黑名单已满（500）。", { type: "error" });
        else if (exists === checked.length) showToast(checked.length === 1 ? `词语「${checked[0].phrase}」已在黑名单中。` : "这些词语已在黑名单中。", { type: "info" });
        else showToast("没有可加入的词语。", { type: "info" });
    }

    // ---------- draft + validation (§17.5) ----------

    private applyDraft(draft: Draft) {
        this.draft = draft;
        this.nameInput.value = draft.rule.name;
        this.sourceInput.value = draft.rule.source;
        this.flagsInput.value = draft.rule.flags || "iu";
        this.fieldSelect.value = draft.rule.fields[0] ?? "body";
        this.sourceInput.dispatchEvent(new Event("input"));
        this.reasonText.textContent = draft.reason;
        const showConfidence = draft.confidence != null && draft.origin !== "exact-fallback";
        this.confidenceText.hidden = !showConfidence;
        this.confidenceText.textContent = showConfidence ? `置信度 ${Math.round(draft.confidence! * 100)}%` : "";
    }

    private currentRule(): DraftRule {
        return { name: this.nameInput.value.trim(), source: this.sourceInput.value, flags: this.flagsInput.value, fields: [this.fieldSelect.value as RegexField] };
    }

    private onEdit() {
        void this.validate();
    }

    private async validate(): Promise<SafetyResult | null> {
        const seq = ++this.validationSeq;
        this.validation = null;
        this.validating = true;
        this.renderValidation();
        const live = liveTarget(this.target);
        if (!live) {
            this.validating = false;
            this.validation = { valid: false, code: null, message: CHANGED, targetMatch: false, canarySafe: false };
            this.renderValidation();
            return this.validation;
        }
        const rule = this.currentRule();
        const result = await checkCandidate({ rule, target: this.values, negatives: this.negatives, protectedContexts: protectedValues(), skipBreadth: this.draft.origin === "phrase-selection" });
        if (seq !== this.validationSeq) return null;
        this.validating = false;
        this.validation = liveTarget(this.target) ? result : { valid: false, code: null, message: "校验期间回复内容或页面发生了变化。", targetMatch: false, canarySafe: false };
        this.renderValidation();
        return this.validation;
    }

    private renderValidation() {
        const v = this.validation;
        const card = (el: HTMLElement, title: string, ok: boolean | null, pending: string, good: string, bad: string) => {
            el.dataset.state = ok === null ? "pending" : ok ? "ok" : "fail";
            el.replaceChildren(h("strong", null, title), h("span", null, ok === null ? pending : ok ? good : bad));
        };
        card(this.targetCard, "当前回复", this.validating ? null : !!v?.targetMatch, "正在验证...", "已命中当前回复", "未命中当前回复");
        card(this.canaryCard, "安全样本", this.validating ? null : !!v?.canarySafe, "正在检查...", "未命中安全样本", "安全样本检查未通过");
        this.validationMsg.textContent = this.validating ? "" : v && !v.valid ? v.message : v?.valid ? "规则已通过安全校验。" : "";
        this.validationMsg.dataset.kind = v?.valid ? "success" : "error";
        this.renderBusy();
    }

    private canSave(): boolean {
        const rule = this.currentRule();
        const v = this.validation;
        return !!rule.name && !!rule.source && !!rule.fields[0] && !this.validating && !!v?.valid && v.targetMatch && v.canarySafe && !this.busy;
    }

    private renderBusy() {
        const busy = this.busy;
        const lockForm = !!busy;
        for (const el of [this.nameInput, this.sourceInput, this.flagsInput, this.fieldSelect, this.followup]) el.disabled = lockForm;
        this.regenBtn.disabled = lockForm;
        this.followupBtn.disabled = lockForm || !this.followup.value.trim();
        this.regenBtn.textContent = busy === "regen" ? "生成中..." : "重新生成";
        this.followupBtn.textContent = busy === "regen" ? "生成中..." : "发送追问";
        this.saveBtn.textContent = busy === "save" ? "保存中..." : busy ? "分析中..." : "保存并启用";
        this.saveBtn.disabled = !this.canSave();
        const locked = busy === "save" || busy === "regen";
        this.cancelBtn.disabled = locked;
        this.closeBtn.disabled = locked;
        this.eyebrow.textContent = busy === "analyze" || busy === "regen" ? "回复分析" : "屏蔽规则";
        this.title.textContent = busy === "analyze" || busy === "regen" ? "正在分析回复" : "检查并启用规则";
        this.backdrop?.querySelector(".xc-rd-dialog")?.setAttribute("aria-busy", String(!!busy));
        this.renderCandidatesState();
    }

    private renderCandidatesState() {
        for (const b of this.candidateList.querySelectorAll<HTMLButtonElement>("button")) b.disabled = !!this.busy;
        const any = this.candidates.some(c => c.checked);
        this.addPhrasesBtn.disabled = !any || !!this.busy;
        this.analyzePhrasesBtn.disabled = !any || !!this.busy;
    }

    // ---------- analysis (§17.4) ----------

    private async runAnalysis(feedback: string, kind: "analyze" | "regen") {
        if (this.busy || !feedback) return;
        const seq = ++this.requestSeq;
        const token = this.flowToken;
        this.busy = kind;
        this.renderBusy();
        const config = getConfigStore().config;
        try {
            const result = await analyze(feedback, {
                values: this.values,
                negatives: this.negatives,
                protectedContexts: protectedValues(),
                aiUnavailable: config.enabled ? aiUnavailableReason(config.ai) : "AI 未启用或尚未确认数据发送范围",
                targetIntact: () => !!liveTarget(this.target),
                runAi: input => this.runAi(input),
            });
            if (token !== this.flowToken) throw new AnalysisAbort("已选择另一条回复，这次 AI 结果已丢弃。");
            if (seq !== this.requestSeq) throw new AnalysisAbort("已有更新的草稿请求，这次 AI 结果已丢弃。");
            this.negatives = [...new Set([...this.negatives, ...result.aiNegatives])].slice(0, 16);
            this.applyDraft(result.draft);
        } catch (e) {
            if (token !== this.flowToken || seq !== this.requestSeq) return;
            const msg = e instanceof Error ? e.message : String(e);
            this.reasonText.textContent = `分析未完成：${msg.replace(/[。.]$/, "")}。已保留本地可复用草稿。`;
        } finally {
            if (token === this.flowToken && seq === this.requestSeq) {
                this.busy = null;
                this.renderBusy();
                void this.validate();
            }
        }
    }

    private runAi(input: Parameters<typeof generateRule>[0]) {
        const queue = getAiQueue();
        const budget = getConfigStore().config.ai.maxReviewsPerConversation;
        if (!queue.canEnqueue()) return Promise.reject(new AnalysisAbort(`已达到本对话 ${budget} 次 AI 调用上限。`));
        const store = getConfigStore();
        return new Promise<Awaited<ReturnType<typeof generateRule>>>((resolve, reject) => {
            this.aborted = reject;
            queue.enqueue(`rule:${this.target.tweetId}:${this.requestSeq}`, () => generateRule(input, store.config.ai, store.apiKey)).then(resolve, e => {
                reject(e instanceof AiQueueError ? new AnalysisAbort(e.message === "budget" ? `已达到本对话 ${budget} 次 AI 调用上限。` : ABORTED) : e);
            }).finally(() => { this.aborted = null; });
        });
    }

    // ---------- save (§17.7) / close (§17.8) ----------

    private async save() {
        if (!this.canSave()) return;
        this.busy = "save";
        this.renderBusy();
        try {
            const result = await this.validateForSave();
            if (!result.valid || !result.targetMatch || !result.canarySafe) throw new Error(result.message || "规则未通过最终安全校验。");
            if (!liveTarget(this.target)) throw new Error(CHANGED);
            const rule = this.currentRule();
            if (rule.fields.length !== 1) throw new Error("AI 规则必须且只能选择一个字段。");
            const store = getConfigStore();
            const flags = rule.flags.split("").filter((f, i, a) => "imsu".includes(f) && a.indexOf(f) === i).sort((a, b) => "imsu".indexOf(a) - "imsu".indexOf(b)).join("");
            const existing = store.config.blacklists.regexRules.find(r => r.source === rule.source && r.flags === flags && r.fields.length === 1 && r.fields[0] === rule.fields[0]);
            if (!existing && store.config.blacklists.regexRules.length >= MAX_REGEX_RULES) throw new Error(`正则规则已达到 ${MAX_REGEX_RULES} 条上限。`);
            store.update(c => {
                const same = c.blacklists.regexRules.find(r => existing && r.id === existing.id);
                if (same) {
                    same.enabled = true;
                    same.valid = true;
                    same.error = null;
                    same.errorCode = null;
                    if (rule.name) same.name = rule.name.slice(0, 100);
                    return;
                }
                const next: RegexRule = { id: newRegexId("ai-regex", 6), name: rule.name.slice(0, 100), source: rule.source, flags, enabled: true, valid: true, fields: rule.fields, error: null, errorCode: null };
                c.blacklists.regexRules.push(next);
            });
            showToast("屏蔽规则已保存并启用。", { type: "success" });
            this.finish({ saved: true, reason: "saved" });
        } catch (e) {
            showToast(e instanceof Error && e.message ? e.message : "规则保存失败，草稿已保留。", { type: "error" });
            this.busy = null;
            this.renderBusy();
        }
    }

    private async validateForSave(): Promise<SafetyResult> {
        const result = await this.validate();
        return result ?? { valid: false, code: null, message: "规则未通过最终安全校验。", targetMatch: false, canarySafe: false };
    }

    cancel() {
        if (this.busy === "save" || this.busy === "regen") return;
        this.finish({ saved: false, reason: "cancelled" });
    }

    forceClose() {
        this.finish({ saved: false, reason: "cancelled" });
    }

    private finish(outcome: DraftOutcome) {
        this.flowToken = {};
        this.aborted = null;
        for (const off of this.offs) off();
        this.offs = [];
        this.backdrop.remove();
        this.done(outcome);
        if (this.returnFocus?.isConnected) this.returnFocus.focus();
    }
}
