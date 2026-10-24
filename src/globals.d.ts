declare const IS_DEV: boolean;
declare const VERSION: string;
declare const REPO_URL: string;
declare const INSTALL_URL: string;

declare function GM_getValue<T = unknown>(key: string, defaultValue?: T): T;
declare function GM_setValue(key: string, value: unknown): void;
declare function GM_deleteValue(key: string): void;
declare function GM_registerMenuCommand(caption: string, onClick: () => void): unknown;
declare function GM_xmlhttpRequest(details: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    data?: string;
    timeout?: number;
    responseType?: string;
    onload?(resp: { status: number; statusText: string; responseText: string; response: unknown }): void;
    onerror?(err: unknown): void;
    ontimeout?(): void;
    onabort?(): void;
}): { abort(): void };
declare function GM_setClipboard(text: string): void;
declare const unsafeWindow: typeof globalThis;
