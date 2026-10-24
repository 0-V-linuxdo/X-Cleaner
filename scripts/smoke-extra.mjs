import base, { extra } from "./smoke-status.mjs";
export default async function (page) { await base(page); await extra(page); }
