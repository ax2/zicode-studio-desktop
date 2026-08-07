import { createTaskCenterApp } from "./TaskCenterApp";
import type { TaskCenterOptions } from "./store";

export { createTaskCenterApp } from "./TaskCenterApp";
export type { TaskCenterOptions } from "./store";
export {
  childTarget,
  filterLabel,
  filteredTasks,
  formatDate,
  retryLimitReached,
  statusLabel,
} from "./logic";

// Keep the vanilla shell's setupTaskCenterApp contract.
export function setupTaskCenterApp(options: TaskCenterOptions) {
  return createTaskCenterApp(options);
}
