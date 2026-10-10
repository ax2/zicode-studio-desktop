import * as fs from "node:fs";
import { writeTasks } from "./task-repository";

const [file, revision, gate] = process.argv.slice(2);
fs.writeFileSync(`${gate}.${process.pid}`, "ready");
while (!fs.existsSync(gate)) await new Promise((resolve) => setTimeout(resolve, 10));
try {
  writeTasks(file, [{ id: `process-${process.pid}` }], revision, () => {});
  process.stdout.write("saved");
} catch (error) {
  process.stdout.write((error as Error).message);
}
