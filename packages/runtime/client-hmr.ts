/// <reference types="webpack/module" />

let lastHash: string | undefined;
function upToDate() {
  return lastHash!.indexOf(__webpack_hash__) >= 0;
}

function logUpdate(
  updatedModules: (string | number)[],
  renewedModules: (string | number)[] | null,
) {
  const unacceptedModules = updatedModules.filter((moduleId) => {
    return renewedModules && renewedModules.indexOf(moduleId) < 0;
  });

  if (unacceptedModules.length > 0) {
    console.warn(
      "[HMR]",
      "The following modules couldn't be hot updated: (They would need a full reload!)",
      unacceptedModules,
    );
  }

  if (!renewedModules || renewedModules.length === 0) {
    console.info("[HMR]", "Nothing hot updated.");
  } else {
    console.info("[HMR]", "Updated modules:");
    renewedModules.forEach(function (moduleId) {
      if (typeof moduleId === "string" && moduleId.indexOf("!") !== -1) {
        const parts = moduleId.split("!");
        console.info("[HMR]", "-", parts.pop());
        console.info("[HMR]", " ", "-", moduleId);
      } else {
        console.info("[HMR]", "-", moduleId);
      }
    });
    const numberIds = renewedModules.every((moduleId) => {
      return typeof moduleId === "number";
    });
    if (numberIds) {
      console.info(
        "[HMR]",
        'Consider using the optimization.moduleIds: "named" for module names.',
      );
    }
  }
}

async function checkUpdates(fromUpdate = false) {
  try {
    const updatedModules = await import.meta.webpackHot.check();
    if (!updatedModules) {
      if (fromUpdate) console.info("[HMR]", "Update applied");
      else console.warn("[HMR]", "Promised update was not found");
      return;
    }
    const renewedModules = await import.meta.webpackHot.apply({
      ignoreUnaccepted: true,
      onUnaccepted(data) {
        console.warn(
          "[HMR]",
          "Update was not accepted:",
          data.chain.join(" => "),
        );
      },
    });

    logUpdate(updatedModules, renewedModules);

    await checkUpdates(true);
  } catch (e) {
    const status = import.meta.webpackHot.status();
    if (["abort", "fail"].indexOf(status) >= 0) {
      console.warn("[HMR]", "Can't apply update, restart required!", e);
    } else {
      console.warn("[HMR]", "Update failed", e);
    }
  }
}

async function signalled() {
  if (import.meta.webpackHot.status() !== "idle") {
    console.warn(
      "[HMR]",
      `Bundle update, but state is not idle: ${import.meta.webpackHot.status()}`,
    );
    return;
  }
  await checkUpdates();
}

if (import.meta.webpackHot) {
  const ws = new WebSocket("/__freshpack_hmr");
  ws.addEventListener("open", () => {
    console.info("[HMR]", "opened");
  });
  ws.addEventListener("message", (msg) => {
    const data = JSON.parse(msg.data);
    if (data === "invalid") {
      console.info("[HMR]", "webpack is working...");
    } else if ("done" in data) {
      const hash = data.done.hash;
      console.info("[HMR]", "webpack rebuilt", hash);
      signalled();
    }
  });
  ws.addEventListener("close", () => {
    console.info("[HMR]", "closed");
  });
}
