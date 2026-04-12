const fs = require("fs");
const path = require("path");

const targets = ["cpu-features"];

for (const name of targets) {
  const target = path.join(process.cwd(), "node_modules", name);
  try {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`[release] removed optional native dependency: ${name}`);
  } catch (err) {
    console.warn(
      `[release] failed to remove optional native dependency ${name}: ${err.message}`,
    );
  }
}
