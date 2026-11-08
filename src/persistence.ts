import { digest, packProject, unpackProject } from "./project-package";
import { snapshot } from "./project";
import type { Project } from "./project";

interface Directory extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
}
declare global { interface Window { showDirectoryPicker?: (options: { mode: "readwrite"; id: string }) => Promise<Directory> } }
interface Cache { bytes: Uint8Array; directory?: Directory; hash?: string; diskProjectId?: string; projectId?: string; name?: string; modifiedAt?: string }
export interface StoredProject { id: string; name: string; modifiedAt: string }
export interface SaveState { cache: string; disk: string; busy: boolean }
const FILE = "project.oled.zip";
function request<T>(transaction: IDBTransaction, operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let result: T;
    operation.onsuccess = () => { result = operation.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error ?? operation.error ?? new Error("本地恢复缓存事务失败"));
    transaction.onerror = () => reject(transaction.error ?? operation.error ?? new Error("本地恢复缓存不可写"));
  });
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("oled-studio-v1", 2);
    open.onupgradeneeded = () => {
      for (const name of ["state", "projects", "catalog"]) if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name);
    };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("恢复缓存升级被其他窗口阻塞，请关闭其他设计器窗口"));
    open.onsuccess = () => resolve(open.result);
  });
}
async function loadCache(): Promise<Cache | undefined> {
  const db = await database();
  try {
    const tx = db.transaction("state", "readonly"), currentId = await request<string | undefined>(tx, tx.objectStore("state").get("current-id"));
    if (currentId) {
      const projectTx = db.transaction("projects", "readonly");
      return await request<Cache | undefined>(projectTx, projectTx.objectStore("projects").get(currentId));
    }
    const oldTx = db.transaction("state", "readonly");
    return await request<Cache | undefined>(oldTx, oldTx.objectStore("state").get("current"));
  }
  finally { db.close(); }
}
async function storeCache(cache: Cache): Promise<void> {
  const db = await database();
  try {
    if (!cache.projectId) throw new Error("恢复缓存缺少项目标识");
    const tx = db.transaction(["state", "projects", "catalog"], "readwrite");
    tx.objectStore("state").delete("current");
    tx.objectStore("state").put(cache.projectId, "current-id");
    tx.objectStore("catalog").put({ id: cache.projectId, name: cache.name ?? "", modifiedAt: cache.modifiedAt ?? "" }, cache.projectId);
    await request(tx, tx.objectStore("projects").put(cache, cache.projectId));
  }
  finally { db.close(); }
}
async function diskBytes(directory: Directory): Promise<Uint8Array | undefined> {
  try {
    const file = await (await directory.getFileHandle(FILE)).getFile();
    if (file.size > 128 * 1024 * 1024) throw new Error("目录中的项目包超过 128 MiB，未读取或覆盖");
    return new Uint8Array(await file.arrayBuffer());
  }
  catch (error) { if (error instanceof DOMException && error.name === "NotFoundError") return undefined; throw error; }
}
export class Persistence {
  state: SaveState = { cache: "尚未缓存", disk: "尚未授权目录", busy: false };
  private directory: Directory | undefined;
  private hash: string | undefined;
  private diskProjectId: string | undefined;
  private pending: Project | undefined;
  private running: Promise<void> | undefined;
  private cacheFailure: unknown;
  private epoch = 0;
  private onState: (state: SaveState) => void;
  private onError: (error: unknown) => void;
  constructor(onState: (state: SaveState) => void, onError: (error: unknown) => void) {
    this.onState = onState; this.onError = onError;
  }
  get hasDirectory(): boolean { return !!this.directory; }
  async recover(): Promise<Project | undefined> {
    const cache = await loadCache();
    if (!cache) return undefined;
    return this.restore(cache);
  }
  private async restore(cache: Cache): Promise<Project> {
    const project = await unpackProject(cache.bytes);
    const granted = cache.directory ? await cache.directory.queryPermission({ mode: "readwrite" }) === "granted" : false;
    this.directory = cache.directory; this.hash = cache.hash; this.diskProjectId = cache.diskProjectId;
    this.state.cache = "已恢复浏览器缓存";
    this.state.disk = this.directory ? granted ? "目录已有权限，修改后自动写盘" : "已记住目录；请点击重新授权后保存" : "尚未授权目录";
    this.onState(this.state); return project;
  }
  async listProjects(): Promise<StoredProject[]> {
    const db = await database();
    try {
      const tx = db.transaction("catalog", "readonly");
      const result = await request<StoredProject[]>(tx, tx.objectStore("catalog").getAll());
      return result.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    } finally { db.close(); }
  }
  async openProject(id: string): Promise<Project> {
    await this.flush();
    const cache = await this.projectCache(id);
    const project = await this.restore(cache); this.epoch++; return project;
  }
  async readProject(id: string): Promise<Project> {
    return unpackProject((await this.projectCache(id)).bytes);
  }
  private async projectCache(id: string): Promise<Cache> {
    const db = await database();
    let cache: Cache | undefined;
    try { const tx = db.transaction("projects", "readonly"); cache = await request<Cache | undefined>(tx, tx.objectStore("projects").get(id)); }
    finally { db.close(); }
    if (!cache) throw new Error("浏览器项目缓存不存在；请从目录或项目包打开");
    return cache;
  }
  async deleteProject(id: string): Promise<void> {
    await this.flush();
    const db = await database();
    try {
      const tx = db.transaction(["projects", "catalog"], "readwrite");
      tx.objectStore("catalog").delete(id);
      await request(tx, tx.objectStore("projects").delete(id));
    } finally { db.close(); }
  }
  async chooseDirectory(): Promise<Project | undefined> {
    if (!window.showDirectoryPicker) throw new Error("当前浏览器不支持目录写入，请使用桌面 Chrome/Edge；仍可下载/导入项目包");
    const directory = await window.showDirectoryPicker({ mode: "readwrite", id: "oled-project" });
    await this.flush();
    const bytes = await diskBytes(directory);
    const project = bytes ? await unpackProject(bytes) : undefined;
    this.directory = directory; this.hash = bytes ? await digest(bytes) : undefined;
    this.diskProjectId = project?.id;
    this.epoch++;
    this.state.disk = bytes ? "已打开目录项目" : "目录已授权，等待保存";
    this.onState(this.state); return project;
  }
  async authorize(): Promise<void> {
    if (!this.directory) throw new Error("请先选择项目目录");
    if (await this.directory.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("目录写入授权被拒绝；项目仍可通过下载保存");
    this.state.disk = "目录已重新授权，等待保存"; this.onState(this.state);
  }
  async detach(): Promise<void> {
    await this.flush(); this.epoch++; this.directory = undefined; this.hash = undefined; this.diskProjectId = undefined;
    this.state.disk = "项目未绑定目录，请选择一个空目录保存"; this.onState(this.state);
  }
  save(project: Project): void {
    this.cacheFailure = undefined;
    this.pending = snapshot(project);
    this.state.cache = "有修改，等待缓存";
    if (this.directory) this.state.disk = "有修改，尚未写盘";
    this.onState(this.state);
    if (!this.running) {
      this.running = this.drain().finally(() => { this.running = undefined; });
    }
  }
  async flush(): Promise<void> {
    await this.running;
    if (this.cacheFailure) throw this.cacheFailure;
  }
  private async drain(): Promise<void> {
    this.state.busy = true; this.onState(this.state);
    try {
      while (this.pending) {
        const project = this.pending; this.pending = undefined;
        const epoch = this.epoch, bytes = await packProject(project);
        const cache: Cache = { bytes, projectId: project.id, name: project.name, modifiedAt: project.modifiedAt };
        if (this.directory) cache.directory = this.directory;
        if (this.hash) cache.hash = this.hash;
        if (this.diskProjectId) cache.diskProjectId = this.diskProjectId;
        await storeCache(cache);
        this.state.cache = this.pending ? "有更新等待缓存" : "浏览器恢复缓存已保存（不等于磁盘）";
        this.onState(this.state);
        if (!this.directory || epoch !== this.epoch) continue;
        const directory = this.directory;
        try {
          const write = async () => {
            if (await directory.queryPermission({ mode: "readwrite" }) !== "granted") {
              this.state.disk = "未获目录权限，请点击重新授权"; this.onState(this.state); return;
            }
            if (this.diskProjectId && this.diskProjectId !== project.id) throw new Error("目录属于另一项目，请为新项目选择空目录");
            const existing = await diskBytes(directory);
            const actual = existing ? await digest(existing) : undefined;
            if (actual !== this.hash) throw new Error("目录项目被外部修改或删除；未覆盖磁盘，请重新打开目录或另选空目录");
            const file = await directory.getFileHandle(FILE, { create: true });
            const writer = await file.createWritable();
            try { await writer.write(bytes.slice().buffer); await writer.close(); }
            catch (error) { await writer.abort().catch((abortError: unknown) => this.onError(abortError)); throw error; }
            this.hash = await digest(bytes); this.diskProjectId = project.id;
            cache.hash = this.hash; cache.diskProjectId = project.id;
            await storeCache(cache);
            this.state.disk = this.pending ? "旧版本已写盘，新修改等待保存" : "磁盘已保存：project.oled.zip";
            this.onState(this.state);
          };
          if (navigator.locks) await navigator.locks.request("oled-studio-directory-write", write);
          else throw new Error("浏览器缺少跨窗口保存锁，不能安全自动写盘，请下载项目包");
        } catch (error) {
          this.state.disk = "磁盘保存失败 / 冲突，浏览器缓存已保留"; this.onState(this.state); this.onError(error);
        }
      }
    } catch (error) {
      this.cacheFailure = error;
      this.state.cache = "缓存保存失败，请立即下载备份";
      this.state.disk = "保存失败，未确认磁盘完成";
      this.onError(error);
    } finally { this.state.busy = false; this.onState(this.state); }
  }
}
