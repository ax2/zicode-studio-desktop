import type { TaskCenterOptions } from "./store";
import { createTaskCenterApp } from "./TaskCenterApp";

export {
  childTarget,
  filteredTasks,
  filterLabel,
  formatDate,
  retryLimitReached,
  statusLabel,
} from "./logic";
export type { TaskCenterOptions } from "./store";
export { createTaskCenterApp } from "./TaskCenterApp";

// Keep the vanilla shell's setupTaskCenterApp contract.
export function setupTaskCenterApp(options: TaskCenterOptions) {
  return createTaskCenterApp(options);
}
