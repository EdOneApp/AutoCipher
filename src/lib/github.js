/**
 * Petit client GitHub REST (issues + commentaires) sans dépendance.
 * Utilise GITHUB_TOKEN + GITHUB_REPOSITORY (fournis automatiquement en Actions).
 */
import { CONFIG } from "../config.js";

const API = "https://api.github.com";

function repoSlug() {
  const slug = CONFIG.env.githubRepository;
  if (!slug || !slug.includes("/")) {
    throw new Error(
      "GITHUB_REPOSITORY manquant ou invalide (attendu 'owner/repo')."
    );
  }
  return slug;
}

async function gh(pathname, { method = "GET", body } = {}) {
  if (!CONFIG.env.githubToken) {
    throw new Error("GITHUB_TOKEN manquant.");
  }
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${CONFIG.env.githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "autocipher-pipeline",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`GitHub ${method} ${pathname} → ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function createIssue({ title, body, labels = [] }) {
  const [owner, repo] = repoSlug().split("/");
  return gh(`/repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: { title, body, labels },
  });
}

export async function listIssueComments(issueNumber) {
  const [owner, repo] = repoSlug().split("/");
  return gh(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`
  );
}

export async function commentIssue(issueNumber, body) {
  const [owner, repo] = repoSlug().split("/");
  return gh(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: { body },
  });
}

export async function closeIssue(issueNumber, stateReason = "completed") {
  const [owner, repo] = repoSlug().split("/");
  return gh(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    body: { state: "closed", state_reason: stateReason },
  });
}

export function issueUrl(issueNumber) {
  return `https://github.com/${repoSlug()}/issues/${issueNumber}`;
}
