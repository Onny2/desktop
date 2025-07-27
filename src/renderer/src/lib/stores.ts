import { writable } from "svelte/store";

export const installStatus = writable(null);
export const serverStatus = writable(null);

export const serverStartedAt = writable(null);

export const serverLogs = writable([]);
