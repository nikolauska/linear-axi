import { asArray } from "./mcp-tools.ts";

// Preview limits balance tokens against follow-up calls: `--full` returns Linear's whole raw
// record, so text an agent almost always needs to read (issue descriptions, comment threads)
// gets a generous limit, while echoes of text the agent just wrote stay short.
export const COMMENT_LIST_PREVIEW = 1000;
export const COMMENT_ECHO_PREVIEW = 120;
const ISSUE_DESCRIPTION_PREVIEW = 4000;

const FIELD_HINTS = {
  issues: "id,title,state,assignee",
  documents: "id,title,updatedAt",
  projects: "id,name,status",
  teams: "id,name",
  users: "id,name,email",
  labels: "id,name",
};

// Each list keeps the fields an agent needs to pick the next command; a shared id/name/state
// shape produced empty columns for teams and statuses and presence text for users.
const ROW_FIELDS = {
  documents: ["id", "title", "updatedAt"],
  teams: ["id", "name"],
  users: ["id", "name", "email"],
  labels: ["id", "name"],
  statuses: ["id", "name", "type"],
  cycles: ["id", "number", "name", "startsAt", "endsAt"],
  milestones: ["id", "name", "targetDate"],
};

const STATUS_RANKS = {
  "in progress": 0,
  started: 0,
  planned: 1,
  todo: 1,
  "to do": 1,
  backlog: 2,
};

export function compactRows(alias, data) {
  if (alias === "issues") return compactIssues(data);
  if (alias === "projects") return compactProjects(data);
  return selectFields(asArray(data), ROW_FIELDS[alias] ?? ["id", "name"]);
}

export function parseFields(fields) {
  return fields
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

export function fieldHint(publicName) {
  return FIELD_HINTS[publicName] ?? "id,name";
}

export function selectFields(items, fields) {
  return items.map((item) => {
    const selected = {};
    for (const field of fields) {
      selected[field] = fieldValue(item, field);
    }
    return selected;
  });
}

export function missingFields(items, fields) {
  if (items.length === 0) return [];
  return fields.filter((field) => items.every((item) => rawFieldValue(item, field) === undefined));
}

export function paginationInfo(data, rowCount) {
  const total = data?.totalCount ?? data?.total ?? data?.pageInfo?.totalCount;
  const hasNextPageValue = data?.hasNextPage ?? data?.pageInfo?.hasNextPage;
  const cursor = data?.cursor ?? data?.nextCursor ?? data?.pageInfo?.endCursor;
  const hasCursor = cursor !== undefined && cursor !== null && cursor !== "";
  const hasNextPage = hasNextPageValue === undefined ? hasCursor : Boolean(hasNextPageValue);
  return {
    count:
      typeof total === "number"
        ? `${rowCount} of ${total} total`
        : `${rowCount} returned${hasNextPage ? " (more available)" : ""}`,
    cursor: hasNextPage ? cursor : undefined,
  };
}

export function compactComment(comment, limit) {
  const body = formattedPreview(comment.body ?? "", limit);
  return {
    id: comment.id ?? "",
    author: comment.user?.name ?? comment.author?.name ?? "",
    created: comment.createdAt ?? "",
    body: body.text,
    truncated: body.truncated,
  };
}

export function compactIssues(data) {
  return groupByStatusPriority(
    asArray(data).map((issue) => ({
      state: rowState(issue),
      title: issue.title ?? "",
      assignee: personName(issue.assignee),
      id: issue.identifier ?? issue.id ?? "",
    })),
  );
}

function compactProjects(data) {
  return groupByStatusPriority(
    asArray(data).map((project) => ({
      status: projectStatus(project),
      name: project.name ?? project.title ?? "",
      id: project.id ?? project.identifier ?? "",
    })),
  );
}

export function compactIssueDetail(issue) {
  const description = String(issue.description ?? issue.body ?? "");
  const preview = formattedPreview(description, ISSUE_DESCRIPTION_PREVIEW);
  return {
    truncated: preview.truncated,
    issue: {
      id: issue.identifier ?? issue.id ?? "",
      title: issue.title ?? "",
      state: issueState(issue),
      priority: priorityName(issue.priority),
      assignee: personName(issue.assignee),
      team: namedValue(issue.team),
      project: namedValue(issue.project),
      labels: labelNames(issue.labels),
      description: preview.text,
      url: issue.url ?? "",
    },
  };
}

// Mutation results echo the fields a caller can set so the agent can confirm the change landed.
export function compactIssueMutation(issue) {
  return withoutEmpty({
    id: issue.identifier ?? issue.id ?? "",
    title: issue.title ?? "",
    state: issueState(issue),
    priority: priorityName(issue.priority),
    assignee: personName(issue.assignee),
    project: namedValue(issue.project),
    team: namedValue(issue.team),
    labels: labelNames(issue.labels),
    dueDate: issue.dueDate ?? "",
    estimate: issue.estimate?.value ?? issue.estimate ?? "",
    url: issue.url ?? "",
  });
}

export function compactProjectMutation(project) {
  return withoutEmpty({
    id: project.id ?? "",
    name: project.name ?? "",
    status: projectStatus(project),
    lead: personName(project.lead),
    team: project.team?.name ?? project.teams?.[0]?.name ?? project.team ?? "",
    startDate: project.startDate ?? "",
    targetDate: project.targetDate ?? "",
    url: project.url ?? "",
  });
}

export function compactDocumentMutation(document) {
  return {
    id: document.id ?? "",
    title: document.title ?? document.name ?? "",
    team: namedValue(document.team),
    project: namedValue(document.project),
    url: document.url ?? "",
  };
}

export function compactDocumentDetail(document, id) {
  const content = rewriteMcpHints(String(document.content ?? document.body ?? ""), id);
  const preview = formattedPreview(content, 1200);
  return {
    truncated: preview.truncated,
    document: {
      id: document.id ?? id ?? "",
      title: document.title ?? document.name ?? "",
      content: preview.text,
      team: namedValue(document.team),
      project: namedValue(document.project),
      url: document.url ?? "",
    },
  };
}

export function compactMilestone(milestone) {
  const preview = formattedPreview(String(milestone.description ?? ""), 500);
  return {
    truncated: preview.truncated,
    milestone: withoutEmpty({
      id: milestone.id ?? "",
      name: milestone.name ?? "",
      targetDate: milestone.targetDate ?? "",
      project: namedValue(milestone.project),
      description: preview.text,
    }),
  };
}

export function sanitizeDocument(document, id) {
  if (!document || typeof document !== "object") return document;
  return {
    ...document,
    content:
      document.content === undefined
        ? document.content
        : rewriteMcpHints(String(document.content), id ?? document.id),
  };
}

function rawFieldValue(item, field) {
  return field.split(".").reduce((current, part) => current?.[part], item);
}

function fieldValue(item, field) {
  const value = rawFieldValue(item, field);
  if (value === undefined) return "";
  if (value === null) return null;
  if (typeof value === "object") {
    return value.name ?? value.displayName ?? value.identifier ?? value.id ?? JSON.stringify(value);
  }
  return value;
}

function withoutEmpty(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([key, value]) =>
      ["id", "title", "name"].includes(key)
        ? true
        : value !== "" && !(Array.isArray(value) && value.length === 0),
    ),
  );
}

function rowState(item) {
  return item.state?.name ?? item.status?.name ?? item.state ?? item.status ?? "";
}

function issueState(issue) {
  return issue.state?.name ?? issue.status ?? issue.state ?? "";
}

function projectStatus(project) {
  return project.status?.name ?? project.state?.name ?? project.status ?? project.state ?? "";
}

function priorityName(priority) {
  if (priority === undefined || priority === null) return "";
  return priority?.name ?? priority;
}

function labelNames(labels) {
  const list = Array.isArray(labels) ? labels : (labels?.nodes ?? []);
  return list.map((label) => label?.name ?? label);
}

function personName(person) {
  return person?.name ?? person?.displayName ?? person ?? "";
}

function namedValue(value) {
  return value?.name ?? value ?? "";
}

function groupByStatusPriority(items) {
  return items.sort((left, right) => {
    const leftStatus = statusLabel(left.status ?? left.state);
    const rightStatus = statusLabel(right.status ?? right.state);
    const rankDifference = (STATUS_RANKS[leftStatus] ?? 3) - (STATUS_RANKS[rightStatus] ?? 3);
    return rankDifference || leftStatus.localeCompare(rightStatus);
  });
}

function statusLabel(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function formattedPreview(value, limit) {
  const text = String(value ?? "");
  if (text.length <= limit) return { text, truncated: false };
  return {
    text: `${text.slice(0, limit)}... (truncated, ${text.length} chars total)`,
    truncated: true,
  };
}

function rewriteMcpHints(text, id) {
  const replacement = id
    ? `run \`linear-axi documents view ${id} --full\``
    : "run `linear-axi documents view <id> --full`";
  return text.replace(/use `get_document`/g, replacement);
}
