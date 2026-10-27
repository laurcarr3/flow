import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";

export const idSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80);
const metaSchema = z
  .object({
    id: idSchema,
    status: z.enum(["draft", "ready", "cancelled"]),
    group: z.string().trim().min(1).optional(),
    depends_on: z.array(idSchema).default([]),
  })
  .strict();
export type Feature = z.infer<typeof metaSchema> & {
  title: string;
  raw: string;
  hash: string;
  body: string;
  sections: Record<string, string>;
  path: string;
};
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const parseFeature = (raw: string, path = ""): Feature => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) throw new Error(`${path}: expected YAML frontmatter`);
  const meta = metaSchema.parse(parse(match[1]));
  if (new Set(meta.depends_on).size !== meta.depends_on.length)
    throw new Error("Duplicate dependency");
  const title = /^# (.+)$/m.exec(match[2])?.[1].trim();
  if (!title) throw new Error(`${path}: missing title`);
  const sections: Record<string, string> = {};
  for (const m of match[2].matchAll(
    /^## ([^\r\n]+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm,
  )) {
    const name = m[1].trim().toLowerCase();
    if (name in sections) throw new Error(`Duplicate section: ${name}`);
    sections[name] = m[2].trim();
  }
  return {
    ...meta,
    title,
    raw,
    body: match[2],
    hash: hash(raw),
    sections,
    path,
  };
};
export const contentErrors = (f: Feature): string[] => {
  return ["outcome", "requirements", "acceptance criteria"]
    .filter((s) => {
      const v = (f.sections[s] ?? "")
        .replace(/<!--[^]*?-->/g, "")
        .replace(/[^\p{L}\p{N} ]/gu, "")
        .trim();
      return (
        v.length < 12 ||
        /^(todo|tbd|none|n a|placeholder|to be determined)$/i.test(v)
      );
    })
    .map((s) => `${f.id}: ${s} needs meaningful content`);
};
export const questions = (f: Feature): string | null => {
  const q = f.sections["open questions"]?.trim();
  return !q || /^(none\.?|no open questions\.?|n\/a)$/i.test(q) ? null : q;
};
export const withStatus = (f: Feature, status: Feature["status"]): string => {
  return `---\n${stringify({ id: f.id, status, ...(f.group ? { group: f.group } : {}), depends_on: f.depends_on })}---\n${f.body}`;
};
export const discover = (root: string): Feature[] => {
  let files: string[];
  try {
    files = readdirSync(join(root, "features"));
  } catch (e: any) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const features = files
    .filter((p) => p.endsWith(".md"))
    .sort()
    .map((p) =>
      parseFeature(
        readFileSync(join(root, "features", p), "utf8"),
        join(root, "features", p),
      ),
    );
  const ids = new Set<string>();
  for (const f of features) {
    if (ids.has(f.id)) throw new Error(`Duplicate feature ID: ${f.id}`);
    ids.add(f.id);
  }
  return features;
};
export const graphErrors = (features: Feature[]): string[] => {
  const byId = new Map(features.map((f) => [f.id, f]));
  const errors: string[] = [],
    active = new Set<string>(),
    done = new Set<string>();
  const visit = (id: string, chain: string[]) => {
    if (active.has(id)) {
      errors.push(`Dependency cycle: ${[...chain, id].join(" -> ")}`);
      return;
    }
    if (done.has(id)) return;
    active.add(id);
    for (const dep of byId.get(id)!.depends_on) {
      if (!byId.has(dep)) errors.push(`${id}: missing dependency ${dep}`);
      else visit(dep, [...chain, id]);
    }
    active.delete(id);
    done.add(id);
  };
  for (const f of features) visit(f.id, []);
  return errors;
};

export const acceptanceCriteria = (f: Feature): string[] => {
  const text = f.sections["acceptance criteria"] ?? "";
  const bullets = text
    .split("\n")
    .filter((l) => /^\s*(?:[-*+] |\d+[.)] )/.test(l));
  return (
    bullets.length
      ? bullets.map((l) =>
          l.replace(/^\s*(?:[-*+] |\d+[.)] )(?:\[[ xX]\] )?/, "").trim(),
        )
      : text.split(/\n\s*\n/).map((x) => x.trim())
  ).filter(Boolean);
};

export const feature = (r: string, id: string): Feature => {
  const f = discover(r).find((f) => f.id === id);
  if (!f) throw new Error(`Unknown feature: ${id}`);
  return f;
};
