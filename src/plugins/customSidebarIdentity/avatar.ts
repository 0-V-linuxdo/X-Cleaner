/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The avatar field of CustomSidebarIdentity, after Void++'s AvatarUrlField: a URL, a data:image… or a
// pasted / dropped picture, then a round crop stage you drag and zoom. The crop is baked into a 256px
// PNG data URL, because X's CSP only lets x.com load images from data: and its own hosts.

import { h } from "@ui/h";
import { t } from "@utils/i18n";

export const SOURCE_PX = 1024;
export const AVATAR_PX = 256;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;

export interface CropState {
    avatarUrl: string;
    avatarSource: string;
    cropX: number;
    cropY: number;
    cropZoom: number;
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** The square the crop keeps, in source pixels: `side` long, centred on (x, y) and kept inside the image. */
export function cropRect(w: number, h: number, zoom: number, cx: number, cy: number) {
    const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    const side = Math.min(w, h) / z;
    const x = clamp(cx, side / 2, Math.max(side / 2, w - side / 2));
    const y = clamp(cy, side / 2, Math.max(side / 2, h - side / 2));
    return { z, side, x, y };
}

/** Remote pictures go through GM_xmlhttpRequest, so neither CORS nor X's CSP gets in the way. */
function fetchBlob(url: string): Promise<Blob | null> {
    if (url.startsWith("data:") || typeof GM_xmlhttpRequest !== "function") {
        return fetch(url, url.startsWith("data:") ? undefined : { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" })
            .then(r => (r.ok ? r.blob() : null))
            .catch(() => null);
    }
    return new Promise(resolve => {
        GM_xmlhttpRequest({
            method: "GET",
            url,
            responseType: "blob",
            timeout: 20_000,
            onload: r => resolve(r.status >= 200 && r.status < 300 && r.response instanceof Blob ? r.response : null),
            onerror: () => resolve(null),
            ontimeout: () => resolve(null),
        });
    });
}

async function bitmap(blob: Blob | null): Promise<ImageBitmap | null> {
    if (!blob) return null;
    try { return await createImageBitmap(blob); } catch { return null; }
}

function draw(w: number, hgt: number, paint: (ctx: CanvasRenderingContext2D) => void): string | null {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = hgt;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    paint(ctx);
    const url = canvas.toDataURL("image/png");
    return url.startsWith("data:image/") ? url : null;
}

/** The picture scaled down to at most SOURCE_PX, kept so the crop can be changed later. */
function capped(bmp: ImageBitmap): string | null {
    const scale = Math.min(1, SOURCE_PX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const hgt = Math.max(1, Math.round(bmp.height * scale));
    return draw(w, hgt, ctx => ctx.drawImage(bmp, 0, 0, w, hgt));
}

export async function sourceFrom(input: Blob | string): Promise<string | null> {
    const bmp = await bitmap(typeof input === "string" ? await fetchBlob(input) : input);
    if (!bmp) return null;
    const url = capped(bmp);
    bmp.close();
    return url;
}

export async function bake(src: string, cropX: number, cropY: number, zoom: number): Promise<string | null> {
    const bmp = await bitmap(await fetchBlob(src));
    if (!bmp) return null;
    const { side, x, y } = cropRect(bmp.width, bmp.height, zoom, cropX * bmp.width, cropY * bmp.height);
    const url = draw(AVATAR_PX, AVATAR_PX, ctx => ctx.drawImage(bmp, x - side / 2, y - side / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX));
    bmp.close();
    return url;
}

export function imageFile(data: DataTransfer | null): File | null {
    if (!data) return null;
    for (const file of data.files) if (file.type.startsWith("image/")) return file;
    for (const item of data.items ?? []) if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
    return null;
}

/** Renders the avatar field. `store` is the plugin's live settings store. */
export function renderAvatarField(store: CropState): HTMLElement {
    let adoptGen = 0;
    let urlTimer: ReturnType<typeof setTimeout> | undefined;
    let remoteFail = false;

    const resetCrop = () => { store.cropX = 0.5; store.cropY = 0.5; store.cropZoom = 1; };
    const clearAvatar = () => { store.avatarUrl = ""; store.avatarSource = ""; resetCrop(); };

    async function adopt(src: string) {
        const gen = ++adoptGen;
        resetCrop();
        store.avatarSource = src;
        const baked = await bake(src, 0.5, 0.5, 1);
        if (gen !== adoptGen) return;
        if (baked) store.avatarUrl = baked;
        render();
    }

    async function take(data: DataTransfer | null) {
        const file = imageFile(data);
        if (!file) return;
        remoteFail = false;
        const src = await sourceFrom(file);
        if (src) await adopt(src);
    }

    const cropSrc = () => {
        const source = String(store.avatarSource ?? "");
        const raw = String(store.avatarUrl ?? "");
        return source.startsWith("data:image/") ? source : (raw.startsWith("data:image/") ? raw : "");
    };

    const preview = h("img", { class: "xc-csi-preview", alt: "", referrerPolicy: "no-referrer" });
    const input = h("input", { class: "xc-input xc-csi-url", type: "text" });
    const clear = h("button", { class: "xc-btn xc-btn-sm", type: "button", onclick: () => { ++adoptGen; clearAvatar(); remoteFail = false; input.value = ""; render(); } }, t("清除"));
    const row = h("div", { class: "xc-csi-avatar" }, preview, input, clear);
    const stageSlot = h("div");
    const failHint = h("div", { class: "xc-field-desc", hidden: true }, t("无法读取这个链接的图片。可以把图片粘贴或拖到这里。"));

    const onPaste = (e: ClipboardEvent) => {
        if (!imageFile(e.clipboardData)) return;
        e.preventDefault();
        void take(e.clipboardData);
    };
    row.addEventListener("paste", onPaste);
    row.addEventListener("dragover", e => { if (imageFile(e.dataTransfer)) e.preventDefault(); });
    row.addEventListener("drop", e => {
        if (!imageFile(e.dataTransfer)) return;
        e.preventDefault();
        void take(e.dataTransfer);
    });

    input.addEventListener("input", () => {
        const value = input.value;
        const trimmed = value.trim();
        clearTimeout(urlTimer);
        ++adoptGen;
        remoteFail = false;
        store.avatarUrl = value;
        store.avatarSource = "";
        if (!trimmed) { resetCrop(); render(); return; }
        if (!/^(data:image\/|https?:\/\/)/.test(trimmed)) { render(); return; }
        urlTimer = setTimeout(async () => {
            const src = await sourceFrom(trimmed);
            if (src) await adopt(src);
            else { remoteFail = true; render(); }
        }, trimmed.startsWith("data:") ? 80 : 400);
        render(false);
    });
    input.addEventListener("keydown", e => {
        if (cropSrc() && !input.value && (e.key === "Backspace" || e.key === "Delete")) {
            ++adoptGen;
            clearAvatar();
            render();
        }
    });

    let stageFor = "";
    function render(syncInput = true) {
        const raw = String(store.avatarUrl ?? "");
        const src = cropSrc();
        preview.hidden = !raw;
        // The preview shows the baked crop, which is what the sidebar shows.
        const shown = raw.startsWith("data:image/") ? raw : (src || raw);
        if (raw && preview.getAttribute("src") !== shown) preview.src = shown;
        if (syncInput) input.value = src ? "" : raw;
        input.placeholder = src ? t("已使用粘贴的图片。拖动圆圈调整裁剪，或输入链接替换。") : t("粘贴图片，或输入 https://…");
        clear.hidden = !raw;
        failHint.hidden = !(remoteFail && !src);
        if (src !== stageFor) {
            stageFor = src;
            stageSlot.replaceChildren(...(src ? [cropStage(store, src, () => render(false))] : []));
        }
    }
    render();

    return h("div", { class: "xc-csi-field" }, row, stageSlot, failHint);
}

function cropStage(store: CropState, src: string, onBaked: () => void): HTMLElement {
    let nat: { w: number; h: number } | null = null;
    let pos = { x: num(store.cropX, 0.5), y: num(store.cropY, 0.5), zoom: num(store.cropZoom, 1) };
    let drag: { px: number; py: number; x: number; y: number } | null = null;
    let bakeTimer: ReturnType<typeof setTimeout> | undefined;

    const img = h("img", { class: "xc-csi-stage-img", alt: "", draggable: false });
    const stage = h("div", { class: "xc-csi-stage" }, img);
    const zoom = h("input", { type: "range", class: "xc-csi-zoom", min: ZOOM_MIN, max: ZOOM_MAX, step: 0.05, "aria-label": t("缩放") });
    const zoomVal = h("span", { class: "xc-badge xc-csi-zoom-val" });

    function paint() {
        zoom.value = String(pos.zoom);
        zoomVal.textContent = `${Math.round(pos.zoom * 100)}%`;
        if (!nat) return;
        const r = cropRect(nat.w, nat.h, pos.zoom, pos.x * nat.w, pos.y * nat.h);
        Object.assign(img.style, {
            width: `${(nat.w / r.side) * 100}%`,
            height: `${(nat.h / r.side) * 100}%`,
            left: `${(0.5 - r.x / r.side) * 100}%`,
            top: `${(0.5 - r.y / r.side) * 100}%`,
        });
    }

    function place(nx: number, ny: number, nz: number) {
        if (!nat) pos = { x: nx, y: ny, zoom: clamp(nz, ZOOM_MIN, ZOOM_MAX) };
        else {
            const r = cropRect(nat.w, nat.h, nz, nx * nat.w, ny * nat.h);
            pos = { x: r.x / nat.w, y: r.y / nat.h, zoom: r.z };
        }
        paint();
    }

    function commit(nx: number, ny: number, nz: number, immediate = false) {
        place(nx, ny, nz);
        const next = { ...pos };
        const run = () => {
            store.cropX = next.x;
            store.cropY = next.y;
            store.cropZoom = next.zoom;
            void bake(src, next.x, next.y, next.zoom).then(url => { if (url) { store.avatarUrl = url; onBaked(); } });
        };
        clearTimeout(bakeTimer);
        if (immediate) run();
        else bakeTimer = setTimeout(run, 80);
    }

    img.onload = () => { nat = { w: img.naturalWidth, h: img.naturalHeight }; place(pos.x, pos.y, pos.zoom); };
    img.src = src;

    stage.addEventListener("pointerdown", e => {
        if (e.button !== 0) return;
        stage.setPointerCapture?.(e.pointerId);
        drag = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
    });
    stage.addEventListener("pointermove", e => {
        if (!drag || !nat) return;
        const size = stage.clientWidth;
        if (!size) return;
        const { side } = cropRect(nat.w, nat.h, pos.zoom, drag.x * nat.w, drag.y * nat.h);
        place(drag.x - ((e.clientX - drag.px) * (side / size)) / nat.w, drag.y - ((e.clientY - drag.py) * (side / size)) / nat.h, pos.zoom);
    });
    stage.addEventListener("pointerup", () => {
        if (!drag) return;
        drag = null;
        commit(pos.x, pos.y, pos.zoom, true);
    });
    stage.addEventListener("pointercancel", () => { drag = null; });
    stage.addEventListener("wheel", e => {
        e.preventDefault();
        commit(pos.x, pos.y, clamp(pos.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), ZOOM_MIN, ZOOM_MAX));
    }, { passive: false });
    zoom.addEventListener("input", () => commit(pos.x, pos.y, Number(zoom.value)));
    paint();

    return h("div", { class: "xc-csi-crop" },
        stage,
        h("div", { class: "xc-csi-zoom-row" },
            zoom,
            zoomVal,
            h("button", { class: "xc-btn xc-btn-sm", type: "button", onclick: () => commit(0.5, 0.5, 1, true) }, t("重置")),
        ),
        h("div", { class: "xc-field-desc" }, t("拖动平移，滚轮缩放。圆圈就是侧栏里显示的范围。")),
    );
}
