import type { FontRequest, FontResult } from "./font-worker";

export class FontTool {
  private worker: Worker | undefined;
  private reject: ((error: Error) => void) | undefined;
  cancel(): void {
    this.worker?.terminate(); this.worker = undefined;
    this.reject?.(new Error("已取消字体生成，原资源保留")); this.reject = undefined;
  }
  generate(request: FontRequest, progress: (done: number, total: number) => void): Promise<FontResult> {
    this.cancel();
    return new Promise((resolve, reject) => {
      this.reject = reject;
      const url = URL.createObjectURL(new Blob([OLED_WORKER_SOURCE], { type: "text/javascript" }));
      let worker: Worker;
      try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
      this.worker = worker;
      const stop = () => { worker.terminate(); this.worker = undefined; this.reject = undefined; };
      worker.onmessage = (event: MessageEvent<FontResult | { type: "progress"; done: number; total: number } | { type: "error"; message: string }>) => {
        const message = event.data;
        if (message.type === "progress") { progress(message.done, message.total); return; }
        stop();
        if (message.type === "error") reject(new Error(message.message)); else resolve(message);
      };
      worker.onerror = event => { stop(); reject(new Error(`字体 Worker 失败：${event.message}`)); };
      worker.postMessage(request, [request.source]);
    });
  }
}
