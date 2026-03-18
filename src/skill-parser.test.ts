import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSkillTools, parseSkillMd } from "./skill-parser.js";

const SAMPLE = `# Reachy Mini Robot Control

Control a Reachy Mini robot connected to this session.

## Tools

### \`reachy_move_head\`
Move head to target position.
- \`yaw\` (float): Left/right degrees, ±45 max
- \`pitch\` (float): Up/down degrees, ±30 max
- \`roll\` (float): Tilt degrees, ±30 max
- \`duration\` (float): Seconds, default 1.0

### \`reachy_capture_image\`
Capture camera image. Returns filepath.

### \`reachy_set_volume\`
Set system speaker volume.
- \`level\` (int): Volume percentage, 0-100.
`;

describe("parseSkillMd", () => {
  it("parses tools with parameters", () => {
    const tools = parseSkillMd(SAMPLE);
    expect(tools).toHaveLength(3);

    const head = tools.find((t) => t.name === "reachy_move_head");
    expect(head).toBeDefined();
    expect(head!.description).toBe("Move head to target position.");
    const props = head!.parameters.properties;
    expect(Object.keys(props)).toEqual(["yaw", "pitch", "roll", "duration"]);
    expect(props.yaw.type).toBe("number");
    expect(props.duration.type).toBe("number");
  });

  it("parses tools without parameters", () => {
    const tools = parseSkillMd(SAMPLE);
    const capture = tools.find((t) => t.name === "reachy_capture_image");
    expect(capture).toBeDefined();
    expect(capture!.description).toBe("Capture camera image. Returns filepath.");
    expect(Object.keys(capture!.parameters.properties)).toEqual([]);
  });

  it("parses integer type", () => {
    const tools = parseSkillMd(SAMPLE);
    const vol = tools.find((t) => t.name === "reachy_set_volume");
    expect(vol).toBeDefined();
    expect(vol!.parameters.properties.level.type).toBe("integer");
  });
});

describe("loadSkillTools", () => {
  it("loads from extension root SKILL.md", () => {
    const extDir = path.resolve(import.meta.dirname, "..");
    const tools = loadSkillTools(extDir);
    // The actual SKILL.md should have 9 tools
    expect(tools.length).toBeGreaterThanOrEqual(7);
    const names = tools.map((t) => t.name);
    expect(names).toContain("reachy_move_head");
    expect(names).toContain("reachy_status");
    expect(names).toContain("reachy_capture_image");
  });

  it("returns empty for nonexistent directory", () => {
    const tools = loadSkillTools("/nonexistent/path");
    expect(tools).toEqual([]);
  });
});
