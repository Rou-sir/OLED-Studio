import { zip, unzip, strToU8, strFromU8 } from "fflate";
import { parseProject, parseResource } from "./project";
import type { Project, Resource } from "./project";

const LIMIT = 128 * 1024 * 1024;
export async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer)),
    byte => byte.toString(16).padStart(2, "0")).join("");
}
function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("已取消项目包操作，当前项目保留");
}
export async function packProject(project: Project, signal?: AbortSignal): Promise<Uint8Array> {
  assertActive(signal);
  parseProject(project, project.resources);
  const files: Record<string, Uint8Array> = {};
  const descriptors = [];
  let total = 0;
  for (const resource of project.resources) {
    assertActive(signal);
    const { data, source, ...metadata } = resource;
    const dataPath = `resources/${resource.id}.bin`, sourcePath = source ? `sources/${resource.id}.bin` : undefined;
    files[dataPath] = data;
    if (sourcePath && source) files[sourcePath] = source;
    total += data.length + (source?.length ?? 0);
    if (total > LIMIT) throw new Error("项目资源总量超过 128 MiB");
    descriptors.push({ ...metadata, dataPath, dataLength: data.length, dataHash: await digest(data),
      ...(source && sourcePath ? { sourcePath, sourceLength: source.length, sourceHash: await digest(source) } : {}) });
  }
  files["project.json"] = strToU8(JSON.stringify({ ...project, resources: descriptors }));
  if (files["project.json"].length > 8 * 1024 * 1024) throw new Error("项目清单超过 8 MiB");
  assertActive(signal);
  return new Promise((resolve, reject) => {
    const cancel = () => { terminate(); reject(new Error("已取消项目包操作，当前项目保留")); };
    const terminate = zip(files, { level: 1 }, (error, data) => {
      signal?.removeEventListener("abort", cancel);
      if (error) reject(error); else resolve(data);
    });
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("项目清单无效");
  return value as Record<string, unknown>;
}
export async function unpackProject(bytes: Uint8Array, signal?: AbortSignal): Promise<Project> {
  assertActive(signal);
  if (bytes.length > LIMIT || bytes.length < 22) throw new Error("项目包无效或超过 128 MiB");
  const names = new Set<string>();
  let size = 0;
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    const cancel = () => { terminate(); reject(new Error("已取消项目包操作，当前项目保留")); };
    const terminate = unzip(bytes, { filter(file) {
    if (names.has(file.name) || !/^(?:project\.json|(?:resources|sources)\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.bin)$/.test(file.name)) throw new Error("项目包含重复或未允许的路径");
    names.add(file.name); size += file.originalSize;
    if (size > LIMIT || file.originalSize > (file.name === "project.json" ? 8 : 32) * 1024 * 1024) throw new Error("项目包解压大小超过预算");
    return true;
    } }, (error, data) => {
      signal?.removeEventListener("abort", cancel);
      if (error) reject(error); else resolve(data);
    });
    signal?.addEventListener("abort", cancel, { once: true });
  });
  assertActive(signal);
  if (!files["project.json"]) throw new Error("项目包缺少清单");
  const manifest = record(JSON.parse(strFromU8(files["project.json"])) as unknown);
  const entries = manifest["resources"];
  if (!Array.isArray(entries) || entries.length > 10000) throw new Error("资源清单无效");
  const used = new Set(["project.json"]);
  const resources: Resource[] = [];
  for (const entry of entries) {
    assertActive(signal);
    const resource = record(entry);
    const read = async (prefix: "data" | "source"): Promise<Uint8Array> => {
      const path = resource[`${prefix}Path`], length = resource[`${prefix}Length`], hash = resource[`${prefix}Hash`];
      if (typeof path !== "string" || used.has(path) || path !== `${prefix === "data" ? "resources" : "sources"}/${String(resource["id"])}.bin`) throw new Error("资源文件路径不匹配或重复引用");
      const data = files[path];
      if (!data || data.length !== length || typeof hash !== "string" || await digest(data) !== hash) throw new Error("资源文件缺失、长度或 SHA-256 校验失败");
      used.add(path); return data;
    };
    const data = await read("data"), source = resource["sourcePath"] !== undefined ? await read("source") : undefined;
    resources.push(parseResource(resource, data, source));
  }
  if (used.size !== names.size) throw new Error("项目包含未在清单声明的文件");
  return parseProject(manifest, resources);
}
