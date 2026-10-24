import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { basename, dirname, resolve } from "path";

const isDev = process.argv.includes("--dev");
const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const VERSION_DATE = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, "");
const version = `${pkg.version}.${VERSION_DATE}`;
const pluginRoot = resolve("src/plugins");

// The built script is committed under dist/, so script managers can update straight from the repository.
export const REPO_URL = "https://github.com/0-V-linuxdo/X-Cleaner";
const RAW_URL = "https://raw.githubusercontent.com/0-V-linuxdo/X-Cleaner/main/dist";
export const DOWNLOAD_URL = `${RAW_URL}/X%20Cleaner.user.js`;
const UPDATE_URL = `${RAW_URL}/X%20Cleaner.meta.js`;

export const HEADER = `// ==UserScript==
// @name         X Cleaner
// @namespace    https://github.com/0-V-linuxdo/x-cleaner
// @version      ${version}
// @description  A plugin-based cleaner for x.com: hide adult promotion, crypto funnels and promotional reply accounts. Includes review, lists, safe regex rules and optional AI-assisted rule drafts.
// @author       X Cleaner Contributors
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'/%3E%3Cpath d='m4.5 4.5 15 15'/%3E%3C/svg%3E
// @match        https://x.com/*
// @match        https://www.x.com/*
// @match        https://mobile.x.com/*
// @match        https://m.x.com/*
// @match        https://twitter.com/*
// @match        https://www.twitter.com/*
// @match        https://mobile.twitter.com/*
// @match        https://m.twitter.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @connect      *
// @license      GPL-3.0-or-later
// @homepageURL  ${REPO_URL}
// @supportURL   ${REPO_URL}/issues
// @updateURL    ${UPDATE_URL}
// @downloadURL  ${DOWNLOAD_URL}
// ==/UserScript==
`;

function scan(dir: string, out: { imports: string[]; entries: string[]; i: number }) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
        if (entry.name.endsWith(".dev") && !isDev) continue;
        const path = `${dir}/${entry.name}`;
        if (!existsSync(`${path}/index.ts`)) continue;
        const v = `p${out.i++}`;
        out.imports.push(`import ${v} from ${JSON.stringify(path)};`);
        out.entries.push(`[${v}.name]: ${v}`);
    }
}

export function pluginModule(): string {
    const out = { imports: [] as string[], entries: [] as string[], i: 0 };
    scan(`${pluginRoot}/_core`, out);
    scan(`${pluginRoot}/_api`, out);
    scan(pluginRoot, out);
    return `${out.imports.join("\n")}\nexport default { ${out.entries.join(", ")} };\n`;
}

export function writePluginModule() {
    mkdirSync("src/generated", { recursive: true });
    const file = "src/generated/plugins.ts";
    const next = pluginModule().replaceAll(`"${pluginRoot}/`, '"@plugins/');
    if (!existsSync(file) || readFileSync(file, "utf8") !== next) writeFileSync(file, next);
}

const cssModules: import("bun").BunPlugin = {
    name: "xc-css",
    setup(build) {
        build.onResolve({ filter: /\.css$/ }, args => {
            const alias = args.path.match(/^@(\w+)\/(.*)$/);
            const path = alias ? resolve("src", alias[1], alias[2]) : resolve(args.resolveDir ?? dirname(args.importer), args.path);
            return { path, namespace: "xc-css" };
        });
        build.onLoad({ filter: /.*/, namespace: "xc-css" }, async args => {
            const css = await Bun.file(args.path).text();
            const file = basename(args.path, ".css");
            const name = file === "styles" ? basename(dirname(args.path)) : file;
            return { contents: `export default ${JSON.stringify(css)}; export const styleName = ${JSON.stringify(name)};`, loader: "js" };
        });
    },
};

export const bunPlugins = [cssModules];

if (import.meta.main) {
    writePluginModule();
    const result = await Bun.build({
        entrypoints: ["src/index.ts"],
        target: "browser",
        format: "iife",
        minify: false,
        define: { IS_DEV: JSON.stringify(isDev), VERSION: JSON.stringify(version), REPO_URL: JSON.stringify(REPO_URL), DOWNLOAD_URL: JSON.stringify(DOWNLOAD_URL) },
        plugins: bunPlugins,
    });
    if (!result.success) {
        for (const log of result.logs) console.error(log);
        process.exit(1);
    }
    const code = await result.outputs[0].text();
    mkdirSync("dist", { recursive: true });
    const out = "dist/X Cleaner.user.js";
    writeFileSync(out, `${HEADER}\n${code}`);
    // The script manager polls this small file and only downloads the full script when @version grows.
    writeFileSync("dist/X Cleaner.meta.js", HEADER);
    console.log(`Built ${out} (${(code.length / 1024).toFixed(1)} KB)`);
}
