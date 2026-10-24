import { beforeEach, describe, expect, test } from "bun:test";

import { subscribe } from "@api/Events";
import { isReloadNeeded, plugins, pruneOrphanedPluginSettings, registerPlugin, setPluginEnabled, startPlugin } from "@api/PluginManager";
import { loadSettings, migratePluginSetting, migratePluginSettings, migrateSettingsToPlugin, PlainSettings } from "@api/Settings";
import { closeNotice, hasNotice, showNotice } from "@ui/notice";
import { memoryStorage } from "@utils/storage";
import definePlugin from "@utils/types";

let n = 0;
const fresh = (prefix: string) => `${prefix}${n++}`;

beforeEach(() => loadSettings(memoryStorage()));

describe("settings migration", () => {
    test("migratePluginSettings carries settings, stars, pins and first-seen over to the new name", () => {
        loadSettings(memoryStorage({ XCleanerSettings: { plugins: { OldName: { enabled: true, x: 1 } }, core: { pinnedPlugins: ["OldName"], starredPlugins: ["OldName"], knownPlugins: { OldName: 5 } } } }));
        migratePluginSettings("NewName", "Older", "OldName");
        expect(PlainSettings.plugins.NewName).toEqual({ enabled: true, x: 1 });
        expect(PlainSettings.plugins.OldName).toBeUndefined();
        expect(PlainSettings.core.pinnedPlugins).toEqual(["NewName"]);
        expect(PlainSettings.core.starredPlugins).toEqual(["NewName"]);
        expect(PlainSettings.core.knownPlugins).toEqual({ NewName: 5 });
    });

    test("migratePluginSettings never overwrites settings the new name already has", () => {
        loadSettings(memoryStorage({ XCleanerSettings: { plugins: { A: { v: 1 }, B: { v: 2 } } } }));
        migratePluginSettings("B", "A");
        expect(PlainSettings.plugins.B).toEqual({ v: 2 });
        expect(PlainSettings.plugins.A).toEqual({ v: 1 });
    });

    test("migratePluginSetting renames a key; migrateSettingsToPlugin moves keys between plugins", () => {
        loadSettings(memoryStorage({ XCleanerSettings: { plugins: { P: { old: 3 }, Src: { a: 1, b: 2 } } } }));
        migratePluginSetting("P", "fresh", "old");
        expect(PlainSettings.plugins.P).toEqual({ fresh: 3 });
        migrateSettingsToPlugin("Dst", "Src", "a", "missing");
        expect(PlainSettings.plugins.Dst).toEqual({ a: 1 });
        expect(PlainSettings.plugins.Src).toEqual({ b: 2 });
    });

    test("pruneOrphanedPluginSettings drops settings of plugins that are not registered", () => {
        const keep = definePlugin({ name: fresh("Keep"), description: "" });
        registerPlugin(keep);
        loadSettings(memoryStorage({ XCleanerSettings: { plugins: { [keep.name]: { enabled: true }, GonePlugin: { enabled: true } } } }));
        expect(pruneOrphanedPluginSettings()).toEqual(["GonePlugin"]);
        expect(Object.keys(PlainSettings.plugins)).toContain(keep.name);
        expect(PlainSettings.plugins.GonePlugin).toBeUndefined();
    });
});

describe("plugin lifecycle extras", () => {
    test("toggling a requiresRestart plugin flags a pending reload", () => {
        const seen: string[] = [];
        const off = subscribe("reloadNeeded", e => seen.push(e.name));
        const p = definePlugin({ name: fresh("Restart"), description: "", requiresRestart: true });
        registerPlugin(p);
        setPluginEnabled(p.name, true);
        off();
        expect(seen).toEqual([p.name]);
        expect(isReloadNeeded()).toBe(true);
    });

    test("a failed start records why, and a later successful start clears it", () => {
        let fail = true;
        const p = definePlugin({ name: fresh("Crashy"), description: "", start() { if (fail) throw new Error("boom"); } });
        registerPlugin(p);
        expect(startPlugin(p)).toBe(false);
        expect(plugins[p.name].startError).toBe("boom");
        fail = false;
        expect(startPlugin(p)).toBe(true);
        expect(p.startError).toBeUndefined();
    });

    test("a missing dependency is recorded as the start error", () => {
        const p = definePlugin({ name: fresh("NeedsDep"), description: "", dependencies: ["NoSuchPlugin"] });
        registerPlugin(p);
        expect(startPlugin(p)).toBe(false);
        expect(p.startError).toContain("NoSuchPlugin");
    });
});

describe("notices", () => {
    test("persist until closed, and one id replaces the previous notice", () => {
        let closed = 0;
        showNotice({ id: "n1", message: "first" });
        showNotice({ id: "n1", message: "second", onClose: () => closed++ });
        const all = document.querySelectorAll(".xc-notice");
        expect(all.length).toBe(1);
        expect(all[0].textContent).toContain("second");
        expect(hasNotice("n1")).toBe(true);
        closeNotice("n1");
        expect(hasNotice("n1")).toBe(false);
        expect(closed).toBe(1);
        expect(document.querySelector(".xc-notices")).toBeNull();
    });

    test("the action button runs and closes the notice", () => {
        let ran = false;
        showNotice({ id: "n2", message: "m", action: { label: "Go", onClick: () => { ran = true; } } });
        document.querySelector<HTMLButtonElement>('.xc-notice[data-id="n2"] .xc-btn')!.click();
        expect(ran).toBe(true);
        expect(hasNotice("n2")).toBe(false);
    });
});
