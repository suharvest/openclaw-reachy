import fs from "node:fs";
import path from "node:path";
import { Type, type TObject, type TProperties } from "@sinclair/typebox";

export type ParsedTool = {
  name: string;
  description: string;
  parameters: TObject<TProperties>;
};

const TOOL_HEADING_RE = /^###\s+`(\w+)`$/;
const PARAM_RE = /^-\s+`(\w+)`\s+\((\w+)\):\s*(.+)$/;

function typeboxForType(raw: string, description: string) {
  switch (raw) {
    case "float":
    case "number":
      return Type.Optional(Type.Number({ description }));
    case "int":
    case "integer":
      return Type.Optional(Type.Integer({ description }));
    case "bool":
    case "boolean":
      return Type.Optional(Type.Boolean({ description }));
    case "string":
    default:
      return Type.Optional(Type.String({ description }));
  }
}

/**
 * Parse a SKILL.md file into tool definitions.
 *
 * Expected format:
 * ```
 * ### `tool_name`
 * Description text.
 * - `param` (type): description
 * ```
 */
export function parseSkillMd(content: string): ParsedTool[] {
  const tools: ParsedTool[] = [];
  const lines = content.split("\n");
  let current: { name: string; description: string; props: TProperties } | null = null;

  for (const line of lines) {
    const headingMatch = line.match(TOOL_HEADING_RE);
    if (headingMatch) {
      // Flush previous tool
      if (current) {
        tools.push({
          name: current.name,
          description: current.description,
          parameters: Type.Object(current.props, { additionalProperties: false }),
        });
      }
      current = { name: headingMatch[1], description: "", props: {} };
      continue;
    }

    if (!current) continue;

    const paramMatch = line.match(PARAM_RE);
    if (paramMatch) {
      const [, paramName, paramType, paramDesc] = paramMatch;
      current.props[paramName] = typeboxForType(paramType, paramDesc);
      continue;
    }

    // Non-empty, non-param line after heading = description
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("-")) {
      if (!current.description) {
        current.description = trimmed;
      }
    }
  }

  // Flush last tool
  if (current) {
    tools.push({
      name: current.name,
      description: current.description,
      parameters: Type.Object(current.props, { additionalProperties: false }),
    });
  }

  return tools;
}

/**
 * Load and parse SKILL.md from the extension root directory.
 * Returns empty array if file not found.
 */
export function loadSkillTools(extensionDir: string): ParsedTool[] {
  const skillPath = path.join(extensionDir, "SKILL.md");
  if (!fs.existsSync(skillPath)) return [];
  const content = fs.readFileSync(skillPath, "utf-8");
  return parseSkillMd(content);
}
