/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
import { normalizePhrase, toConfigHandle } from "@x/text";

import type { KeyValueBackend } from "./backend";
import { type AccountEntry, type BlockerConfig, defaultConfig, exportConfigJson, LIMITS, normalizeAccountEntry, normalizeConfig, prepareImport } from "./config";

const logger = new Logger("ConfigStore");

export const CONFIG_KEY = "xReplyBlockerConfigV1";
export const SECRETS_KEY = "xReplyBlockerAiSecretsV1";

export interface ConfigChange {
    config: BlockerConfig;
    previous: BlockerConfig;
    remote: boolean;
    revision: number;
}

export type AddPhraseResult = { ok: true; phrase: string } | { ok: false; reason: "empty" | "exists" | "limit" };

export class ConfigStore {
    private current: BlockerConfig;
    private key = "";
    private listeners = new Set<(change: ConfigChange) => void>();
    private keyListeners = new Set<() => void>();
    private unlisten: Array<() => void> = [];
    revision = 0;

    constructor(private readonly backend: KeyValueBackend) {
        const stored = backend.read(CONFIG_KEY);
        this.current = stored == null ? defaultConfig() : normalizeConfig(stored);
        const secrets = backend.read(SECRETS_KEY) as { apiKey?: unknown } | null;
        this.key = typeof secrets?.apiKey === "string" ? secrets.apiKey.trim() : "";
        this.unlisten.push(backend.listen?.(CONFIG_KEY, (value, remote) => this.onRemote(value, remote)) ?? (() => {}));
        this.unlisten.push(backend.listen?.(SECRETS_KEY, (value, remote) => {
            if (!remote) return;
            const k = (value as { apiKey?: unknown } | null)?.apiKey;
            this.key = typeof k === "string" ? k.trim() : "";
            for (const l of this.keyListeners) l();
        }) ?? (() => {}));
    }

    dispose() {
        for (const off of this.unlisten) off();
        this.unlisten = [];
    }

    get config(): BlockerConfig {
        return this.current;
    }

    snapshot(): BlockerConfig {
        return structuredClone(this.current);
    }

    get apiKey(): string {
        return this.key;
    }

    subscribe(listener: (change: ConfigChange) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    onApiKeyChange(listener: () => void): () => void {
        this.keyListeners.add(listener);
        return () => this.keyListeners.delete(listener);
    }

    private emit(previous: BlockerConfig, remote: boolean) {
        const change = { config: this.current, previous, remote, revision: this.revision };
        for (const l of Array.from(this.listeners)) {
            try { l(change); } catch (e) { logger.error("Config listener failed", e); }
        }
    }

    private onRemote(value: unknown, remote: boolean) {
        if (!remote) return;
        if (value == null || typeof value !== "object") {
            logger.warn("Ignored invalid remote config");
            return;
        }
        const previous = this.current;
        this.current = normalizeConfig(value);
        this.revision++;
        this.emit(previous, true);
    }

    save(next: BlockerConfig): BlockerConfig {
        const normalized = normalizeConfig(next);
        this.backend.write(CONFIG_KEY, JSON.stringify(normalized));
        const previous = this.current;
        this.current = normalized;
        this.revision++;
        this.emit(previous, false);
        return normalized;
    }

    update(mutator: (draft: BlockerConfig) => void): BlockerConfig {
        const draft = this.snapshot();
        mutator(draft);
        return this.save(draft);
    }

    setApiKey(raw: string) {
        const apiKey = raw.trim();
        this.backend.write(SECRETS_KEY, JSON.stringify({ apiKey }));
        this.key = apiKey;
        for (const l of this.keyListeners) l();
    }

    addPhrase(raw: string): AddPhraseResult {
        const phrase = normalizePhrase(raw);
        if (!phrase) return { ok: false, reason: "empty" };
        const list = this.current.blacklists.phrases;
        if (list.includes(phrase)) return { ok: false, reason: "exists" };
        if (list.length >= LIMITS.phrases) return { ok: false, reason: "limit" };
        this.update(c => { c.blacklists.phrases.push(phrase); });
        return { ok: true, phrase };
    }

    addAllowHandle(raw: string): boolean {
        const handle = toConfigHandle(raw);
        if (!handle) return false;
        this.update(c => {
            c.allowHandles = [...c.allowHandles.filter(h => h !== handle), handle];
            c.blacklists.accounts = c.blacklists.accounts.filter(a => a.handle !== handle);
        });
        return true;
    }

    removeAllowHandle(raw: string): boolean {
        const handle = toConfigHandle(raw);
        if (!this.current.allowHandles.includes(handle)) return false;
        this.update(c => { c.allowHandles = c.allowHandles.filter(h => h !== handle); });
        return true;
    }

    findAccount(raw: string): AccountEntry | undefined {
        const handle = toConfigHandle(raw);
        return this.current.blacklists.accounts.find(a => a.handle === handle);
    }

    addBlockedAccount(raw: unknown): boolean {
        const entry = normalizeAccountEntry(raw);
        if (!entry || this.current.allowHandles.includes(entry.handle)) return false;
        const existing = this.findAccount(entry.handle);
        if (existing && entry.source !== "manual") return false;
        if (!existing && this.current.blacklists.accounts.length >= LIMITS.accounts) return false;
        this.update(c => {
            c.blacklists.accounts = [...c.blacklists.accounts.filter(a => a.handle !== entry.handle), entry];
        });
        return true;
    }

    removeBlockedAccount(raw: string): boolean {
        const handle = toConfigHandle(raw);
        if (!this.findAccount(handle)) return false;
        this.update(c => { c.blacklists.accounts = c.blacklists.accounts.filter(a => a.handle !== handle); });
        return true;
    }

    clearAutomaticAccounts(): number {
        const removed = this.current.blacklists.accounts.filter(a => a.source !== "manual").length;
        if (removed) this.update(c => { c.blacklists.accounts = c.blacklists.accounts.filter(a => a.source === "manual"); });
        return removed;
    }

    importConfig(raw: unknown): BlockerConfig {
        return this.save(prepareImport(raw));
    }

    exportConfig(): string {
        return exportConfigJson(this.current);
    }
}
