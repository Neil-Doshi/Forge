export type LockState = "writable" | "readonly" | "unsupported";

export interface ProjectLockHandle {
  state: LockState;
  release: () => void;
  channel?: BroadcastChannel;
}

export async function acquireProjectLock(projectId: string, instanceId: string, onMessage: (message: string) => void): Promise<ProjectLockHandle> {
  const channel = "BroadcastChannel" in window ? new BroadcastChannel(`html-forge-project:${projectId}`) : undefined;
  channel?.addEventListener("message", (event) => {
    const data = event.data as { type?: string; instanceId?: string };
    if (data.instanceId === instanceId) return;
    if (data.type === "presence") onMessage("Another tab is viewing this project.");
    if (data.type === "takeover-request") onMessage("Another tab requested editor takeover.");
  });
  channel?.postMessage({ type: "presence", instanceId });

  const locks = navigator.locks;
  if (!locks?.request) {
    return {
      state: "unsupported",
      channel,
      release: () => channel?.close()
    };
  }

  let releaseHold: (() => void) | undefined;
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });

  const acquired = await new Promise<boolean>((resolve) => {
    void locks.request(`htmlforge-project:${projectId}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      resolve(Boolean(lock));
      if (lock) await hold;
    });
  });

  return {
    state: acquired ? "writable" : "readonly",
    channel,
    release: () => {
      releaseHold?.();
      channel?.close();
    }
  };
}
