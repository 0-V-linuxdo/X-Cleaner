/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { AiConfig } from "@config/config";
import { t } from "@utils/i18n";

export function validateEndpoint(raw: string): string | null {
    let url: URL;
    try { url = new URL(raw.trim()); } catch { return t("远程 Endpoint 必须使用 HTTPS；HTTP 仅允许 localhost。"); }
    if (url.protocol === "https:") return null;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    return t("远程 Endpoint 必须使用 HTTPS；HTTP 仅允许 localhost。");
}

export function validateAiSettings(endpoint: string, model: string): string | null {
    return validateEndpoint(endpoint) ?? (model.trim() ? null : t("Model 不能为空。"));
}

export function aiReady(ai: AiConfig): boolean {
    return ai.enabled && ai.consented && !validateAiSettings(ai.endpoint, ai.model);
}

export function aiUnavailableReason(ai: AiConfig): string | null {
    if (!ai.enabled || !ai.consented) return t("AI 未启用或尚未确认数据发送范围");
    if (validateAiSettings(ai.endpoint, ai.model)) return t("AI Endpoint 或 Model 尚未正确配置");
    return null;
}

export class AiError extends Error {}

export interface PostOptions {
    endpoint: string;
    apiKey: string;
    body: unknown;
    timeoutMs: number;
}

export type Transport = (opts: PostOptions) => Promise<unknown>;

function errorFromBody(status: number, text: string): AiError {
    try {
        const parsed = JSON.parse(text);
        const msg = parsed?.error?.message;
        if (typeof msg === "string" && msg.trim()) return new AiError(msg.trim().slice(0, 300));
    } catch {}
    return new AiError(`AI request failed (${status}).`);
}

function parseJsonBody(text: string): unknown {
    try { return JSON.parse(text); } catch { throw new AiError("AI response was not valid JSON."); }
}

const headers = (apiKey: string): Record<string, string> => ({ "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) });

export const gmTransport: Transport = ({ endpoint, apiKey, body, timeoutMs }) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
        method: "POST",
        url: endpoint,
        headers: headers(apiKey),
        data: JSON.stringify(body),
        timeout: timeoutMs,
        onload(resp) {
            if (resp.status < 200 || resp.status >= 300) return reject(errorFromBody(resp.status, resp.responseText));
            try { resolve(parseJsonBody(resp.responseText)); } catch (e) { reject(e); }
        },
        onerror: () => reject(new AiError("AI network request failed.")),
        ontimeout: () => reject(new AiError("AI request timed out.")),
        onabort: () => reject(new AiError("AI network request failed.")),
    });
});

export const fetchTransport: Transport = async ({ endpoint, apiKey, body, timeoutMs }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let resp: Response;
    try {
        resp = await fetch(endpoint, { method: "POST", headers: headers(apiKey), body: JSON.stringify(body), signal: controller.signal, credentials: "omit" });
    } catch {
        throw new AiError(controller.signal.aborted ? "AI request timed out." : "AI network request failed.");
    } finally {
        clearTimeout(timer);
    }
    const text = await resp.text();
    if (!resp.ok) throw errorFromBody(resp.status, text);
    return parseJsonBody(text);
};

let override: Transport | null = null;

export function setTransport(t: Transport | null) {
    override = t;
}

export function postJson(opts: PostOptions): Promise<unknown> {
    if (override) return override(opts);
    return typeof GM_xmlhttpRequest === "function" ? gmTransport(opts) : fetchTransport(opts);
}

export function messageContent(response: unknown): string {
    const content = (response as any)?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map(p => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : "")).join("");
    throw new AiError("AI response did not contain a message.");
}

export function extractJsonObject(text: string): unknown {
    const attempts: string[] = [text.trim()];
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) attempts.push(fence[1].trim());
    const balanced = firstBalancedObject(text);
    if (balanced) attempts.push(balanced);
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) attempts.push(text.slice(first, last + 1));
    for (const a of attempts) {
        try { return JSON.parse(a); } catch {}
    }
    throw new AiError("AI response did not contain a JSON object.");
}

function firstBalancedObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === "\\") i++;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
    }
    return null;
}
