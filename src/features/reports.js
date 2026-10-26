/**
 * Reports to the SEED team (POST/GET /api/v1/me/reports): a bug, an idea or anything else the user wants
 * the team to see. Only with the user's OK, never private details; the team's replies come back in
 * load_soul (team_answers). Needs the cloud, so local-only mode answers LOCAL_MODE.
 */

import { z } from "zod";
import { cloudOf } from "../api.js";
import { scrub } from "../scrub.js";
import { READ, WRITE, ok, safe } from "../tool-result.js";

export function registerReportTools(server, api) {
  server.registerTool(
    "send_report",
    {
      title: "Tell the SEED team",
      description:
        "Sends a bug, a suggestion or anything else to the team that runs SEED. Ask the user first and send only with their OK. Say what happened and where, in plain words — never private details, secrets or memory content. The team's answer comes back in load_soul (team_answers).",
      inputSchema: {
        kind: z.enum(["bug", "idea", "other"]).describe("bug, idea or other"),
        title: z.string().min(3).max(140).describe("One line, e.g. 'ws_move fails on folders with spaces'"),
        body: z.string().min(1).max(4000).describe("What happened (steps, what you expected) or what the user wishes SEED did"),
        where: z.string().max(120).optional().describe("The tool, page or feature it is about"),
      },
      annotations: WRITE,
    },
    safe(async ({ kind, title, body, where }) => {
      const sent = await cloudOf(api, "send_report").request("/api/v1/me/reports", {
        method: "POST", body: { kind, title: scrub(title), body: scrub(body), ...(where ? { where: scrub(where) } : {}) },
      });
      return ok(sent, "Sent to the SEED team. Their reply will show up in load_soul (team_answers).");
    }),
  );

  server.registerTool(
    "my_reports",
    {
      title: "My reports",
      description: "The reports this user's AIs sent the SEED team, with each one's status and the team's reply. Read-only.",
      inputSchema: {},
      annotations: READ,
    },
    safe(async () => ok(await cloudOf(api, "my_reports").request("/api/v1/me/reports"))),
  );
}
