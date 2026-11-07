/** Explicit Project-wide skill synchronization. */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { SkillSyncResponse } from "../api/types.js";
@Interface()
export abstract class SkillSynchronization {
  abstract preview(projectId: string): Promise<SkillSyncResponse>;
  abstract sync(projectId: string): Promise<SkillSyncResponse>;
}
