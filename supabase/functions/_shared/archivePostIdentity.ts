/** Post references identify archive rows only. They are never media fetch URLs. */
export type ArchivePostReference = { statusId: string; handle: string | null; kind: "id" | "url" };

const STORED_HOSTS = ["twitter.com", "x.com", "mobile.twitter.com"];
export const MAX_ARCHIVE_POST_VARIANTS = 25;

export function parseArchivePostReference(value: unknown): ArchivePostReference | null {
  if (typeof value !== "string" || value.length > 512) return null;
  const input = value.trim();
  if (/^[0-9]{1,30}$/.test(input)) return { statusId: input, handle: null, kind: "id" };
  const match = /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com|mobile\.twitter\.com|fxtwitter\.com|vxtwitter\.com)\/([A-Za-z0-9_]{1,50})\/status\/([0-9]{1,30})(?:\/(?:photo|video)\/[1-4])?\/?(?:[?#][^\s]*)?$/i.exec(input);
  return match ? { statusId: match[2], handle: match[1], kind: "url" } : null;
}

/** A closed set of complete identities; no author wildcard or numeric suffix search. */
export function archivePostIdentityVariants(value: unknown): string[] {
  const reference = parseArchivePostReference(value);
  if (!reference) return [];
  const variants = [reference.statusId];
  if (reference.handle) {
    for (const host of STORED_HOSTS) {
      for (const scheme of ["https", "http"]) {
        for (const prefix of ["", "www."]) {
          const identity = `${scheme}://${prefix}${host}/${reference.handle}/status/${reference.statusId}`;
          variants.push(identity, `${identity}/`);
        }
      }
    }
  }
  return variants;
}

/** Share parameters and mirror domains are input aliases, never stored grant identities. */
export function isArchivePostIdentity(value: unknown): value is string {
  return typeof value === "string" && archivePostIdentityVariants(value).some((identity) => identity.toLowerCase() === value.toLowerCase());
}

export function matchesArchivePostReference(identity: unknown, reference: unknown): identity is string {
  return isArchivePostIdentity(identity)
    && archivePostIdentityVariants(reference).some((candidate) => candidate.toLowerCase() === identity.toLowerCase());
}
