import { commandHelp, parseFlags, usage } from "../args.ts";
import {
  appendContinuationHelp,
  applyTextFileFlag,
  collectKnownArgs,
  dispatchCommandGroup,
  formatCommandArg,
  requireValue,
} from "../lib/cli-helpers.ts";
import {
  COMMENT_ECHO_PREVIEW,
  COMMENT_LIST_PREVIEW,
  compactComment,
  paginationInfo,
} from "../lib/linear-format.ts";
import { asArray, callToolData } from "../lib/mcp-tools.ts";
import { commentCreateHelp, commentListHelp, groupHelp } from "./help.ts";
import { DEFAULT_LIMIT, ensureIssueExists, runMutation } from "./shared.ts";

const COMMENT_CREATE_HELP = [
  'Run `linear-axi comments create --issue <id> --body "<text>"`',
  commandHelp("comments create"),
];
const COMMENT_LIST_FIELDS = ["issue", "limit", "cursor", "orderBy"];

export async function commentCommand(args, runtime) {
  return dispatchCommandGroup(args, {
    name: "comments",
    help: () => groupHelp("comments", ["list", "create"]),
    handlers: {
      list: (rest) => listCommentsCommand(rest, runtime),
      create: (rest) => createCommentCommand(rest, runtime),
    },
    unknownHelp: [
      "Run `linear-axi comments list --issue <id>`",
      'Run `linear-axi comments create --issue <id> --body "<text>"`',
    ],
  });
}

async function listCommentsCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "comments list",
    value: COMMENT_LIST_FIELDS,
    boolean: ["full"],
  });
  if (parsed.help) return commentListHelp();
  if (!parsed.issue) {
    throw usage("comments list requires --issue", ["Run `linear-axi comments list --issue <id>`"]);
  }
  const { issue, ...toolArgs } = collectKnownArgs(
    { ...parsed, limit: parsed.limit ?? DEFAULT_LIMIT },
    COMMENT_LIST_FIELDS,
  );
  toolArgs.issueId = issue;
  const data = await callToolData(runtime, "list_comments", toolArgs);
  const comments = asArray(data);
  const rows = parsed.full
    ? data
    : comments.map((comment) => compactComment(comment, COMMENT_LIST_PREVIEW));
  const page = paginationInfo(data, comments.length);
  const issueArg = formatCommandArg(parsed.issue);
  const help = [];
  if (comments.length === 0) {
    help.push(
      `Run \`linear-axi comments create --issue ${issueArg} --body "<text>"\` to add a comment`,
    );
  }
  if (!parsed.full && rows.some((comment) => comment.truncated)) {
    help.push(
      `Run \`linear-axi comments list --issue ${issueArg} --full\` to show complete comment bodies`,
    );
  }
  appendContinuationHelp(
    help,
    "linear-axi comments list",
    parsed,
    ["issue", "limit", "orderBy", "full"],
    page.cursor,
  );
  return {
    count: page.count,
    ...(page.cursor ? { cursor: page.cursor } : {}),
    comments: parsed.full ? rows : rows.map(({ truncated: _truncated, ...comment }) => comment),
    ...(help.length > 0 ? { help } : {}),
  };
}

async function createCommentCommand(args, runtime) {
  const parsed = parseFlags(args, {
    command: "comments create",
    value: ["issue", "body", "body-file"],
  });
  if (parsed.help) return commentCreateHelp();
  requireValue(parsed.issue, "comments create requires --issue", COMMENT_CREATE_HELP);
  const toolArgs = collectKnownArgs(parsed, ["body"]);
  toolArgs.issueId = parsed.issue;
  await applyTextFileFlag(toolArgs, parsed, { flag: "body-file", field: "body", cwd: runtime.cwd });
  requireValue(toolArgs.body, "--body or --body-file is required", COMMENT_CREATE_HELP);
  await ensureIssueExists(toolArgs.issueId, runtime);
  const issueArg = formatCommandArg(toolArgs.issueId);
  return runMutation(runtime, {
    tool: "save_comment",
    args: toolArgs,
    help: [`Run \`linear-axi comments list --issue ${issueArg}\` to check existing comments`],
    render: (comment) => {
      const { truncated, ...compact } = compactComment(comment, COMMENT_ECHO_PREVIEW);
      return {
        comment: compact,
        ...(truncated
          ? {
              help: [
                `Run \`linear-axi comments list --issue ${issueArg} --full\` to show complete comment bodies`,
              ],
            }
          : {}),
      };
    },
  });
}
