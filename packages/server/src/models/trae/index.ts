import { registerModelClient } from "@prismshadow/penguin-core";
import { TraeModelClient } from "./client.js";

// Registered by the host that loads this module. Core remains provider-independent.
registerModelClient("trae", (options) => new TraeModelClient(options));
export { listTraeModels } from "./catalog.js";
export { traeAuthStatus } from "./auth.js";
export { TraeModelClient } from "./client.js";
