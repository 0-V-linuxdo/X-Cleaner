/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { subscribe } from "@api/Events";
import { validateAiSettings } from "@ai/transport";
import { button } from "@plugins/panel/components";
import { errorLine } from "@plugins/panel/kit";
import type { PageInstance, PanelContext } from "@plugins/panel/types";
import { h } from "@ui/h";
import { showToast } from "@ui/toast";
import { t } from "@utils/i18n";

export function createAiSettingsPage(ctx: PanelContext): PageInstance {
    const store = ctx.store;
    const enable = h("input", { type: "checkbox" });
    const endpoint = h("input", { class: "xc-input", type: "url", "aria-label": "Endpoint", autocomplete: "off" });
    const model = h("input", { class: "xc-input", type: "text", "aria-label": "Model", autocomplete: "off" });
    const save = h("button", { class: "xc-btn xc-btn-primary", type: "submit" }, t("保存 AI 设置"));
    const msg = errorLine();
    const settingsForm = h("form", { class: "xc-form" }, h("label", null, "Endpoint", endpoint), h("label", null, "Model", model), h("div", { class: "xc-row" }, save), msg);
    const key = h("input", { class: "xc-input", type: "password", "aria-label": "API key", autocomplete: "off" });
    const clearKey = button(t("清除密钥"), () => {
        if (!confirm(t("清除已保存的 API key？"))) return;
        try {
            store.setApiKey("");
            showToast(t("API key 已清除。"), { type: "success" });
        } catch {
            showToast(t("保存设置失败。"), { type: "error" });
        }
        sync();
    }, { kind: "danger" });
    const keyForm = h("form", { class: "xc-form" }, h("label", null, "API key", key), h("div", { class: "xc-row" }, h("button", { class: "xc-btn", type: "submit" }, t("保存密钥")), clearKey));
    const el = h("div", { class: "xc-page" },
        h("label", { class: "xc-toggle-row" }, h("strong", null, t("启用 AI")), enable),
        h("p", { class: "xc-muted" }, t("启用后，临界回复可能发送作者显示名、@handle、正文、链接及最多两张图片 URL 到你配置的服务。API key 单独保存，不随配置导出。")),
        settingsForm,
        keyForm,
    );

    // Drafts survive re-renders and outside config changes; a config import overwrites endpoint/model only.
    let seen = { endpoint: store.config.ai.endpoint, model: store.config.ai.model };
    endpoint.value = seen.endpoint;
    model.value = seen.model;

    const sync = () => {
        const ai = store.config.ai;
        enable.checked = ai.enabled && ai.consented;
        if (endpoint.value === seen.endpoint) endpoint.value = ai.endpoint;
        if (model.value === seen.model) model.value = ai.model;
        seen = { endpoint: ai.endpoint, model: ai.model };
        key.placeholder = store.apiKey ? t("已保存；留空不更改") : t("未保存");
        clearKey.disabled = !store.apiKey;
    };

    const offImport = subscribe("configImported", () => {
        endpoint.value = store.config.ai.endpoint;
        model.value = store.config.ai.model;
        msg.show("");
        sync();
    });
    const offKey = store.onApiKeyChange(sync);

    enable.addEventListener("change", () => {
        if (!enable.checked) {
            ctx.commit(c => { c.ai.enabled = false; c.ai.consented = false; });
            sync();
            return;
        }
        const error = validateAiSettings(endpoint.value, model.value);
        if (error) {
            showToast(error, { type: "error" });
            enable.checked = false;
            return;
        }
        const target = endpoint.value.trim();
        if (!confirm(t("启用 AI 复核会把作者显示名、@handle、回复正文、链接及最多两张图片 URL 发送到：\n\n{target}\n\n是否继续？", { target }))) {
            enable.checked = false;
            return;
        }
        const ok = ctx.commit(c => {
            c.ai.endpoint = target;
            c.ai.model = model.value.trim();
            c.ai.enabled = true;
            c.ai.consented = true;
        });
        if (ok) {
            endpoint.value = store.config.ai.endpoint;
            model.value = store.config.ai.model;
        }
        sync();
    });

    settingsForm.addEventListener("submit", e => {
        e.preventDefault();
        const error = validateAiSettings(endpoint.value, model.value);
        if (error) return msg.show(error);
        msg.show("");
        save.textContent = t("保存中…");
        settingsForm.setAttribute("aria-busy", "true");
        for (const c of [endpoint, model, save]) c.disabled = true;
        const nextEndpoint = endpoint.value.trim();
        const changed = nextEndpoint !== store.config.ai.endpoint;
        try {
            const ok = ctx.commit(c => {
                c.ai.endpoint = nextEndpoint;
                c.ai.model = model.value.trim();
                if (changed) {
                    c.ai.enabled = false;
                    c.ai.consented = false;
                }
            });
            if (ok) {
                endpoint.value = store.config.ai.endpoint;
                model.value = store.config.ai.model;
                showToast(changed ? t("Endpoint 已保存；请重新启用 AI 并确认发送范围。") : t("AI 设置已保存。"), { type: "success" });
            }
        } finally {
            save.textContent = t("保存 AI 设置");
            settingsForm.removeAttribute("aria-busy");
            for (const c of [endpoint, model, save]) c.disabled = false;
            sync();
        }
    });

    keyForm.addEventListener("submit", e => {
        e.preventDefault();
        const value = key.value.trim();
        if (!value) {
            showToast(store.apiKey ? t("留空时不会更改已保存密钥。") : t("请输入 API key。"), { type: "info" });
            return;
        }
        try {
            store.setApiKey(value);
            key.value = "";
            showToast(t("API key 已单独保存。"), { type: "success" });
        } catch {
            showToast(t("保存设置失败。"), { type: "error" });
        }
        sync();
    });

    sync();
    return {
        el,
        update: sync,
        dispose: () => { offImport(); offKey(); },
    };
}
