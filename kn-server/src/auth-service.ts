import { createHash, randomBytes } from "node:crypto"
import { Client } from "ldapts"
import type { AuthContext, CompanyMemberRole } from "./types.js"
import type { KnowledgeRepository } from "./repository.js"

interface LdapProfile {
  providerSubject: string
  username: string
  displayName: string
  email?: string
}

export interface AuthPayload {
  token: string
  expiresAt: string
  user: {
    id: string
    username: string
    displayName: string
    email?: string
    role: CompanyMemberRole
  }
  company: {
    id: string
    name: string
    slug: string
  }
}

export class AuthService {
  constructor(private readonly repo: KnowledgeRepository) {}

  async loginWithLdap(username: string, password: string): Promise<AuthPayload> {
    if (!username.trim()) throw new Error("username is required")
    if (!password) throw new Error("password is required")

    const profile = await this.verifyLdap(username.trim(), password)
    const company = await this.repo.ensureDefaultCompany()
    const identity = await this.repo.upsertIdentity({
      provider: "ldap",
      providerSubject: profile.providerSubject,
      username: profile.username,
      displayName: profile.displayName,
      email: profile.email,
    })
    const memberCount = await this.repo.countCompanyMembers(company.id)
    const role: CompanyMemberRole = memberCount === 0 ? "company_admin" : "member"
    const member = await this.repo.ensureCompanyMember(company.id, identity.id, role)
    const token = randomBytes(32).toString("base64url")
    const expiresAt = new Date(Date.now() + Number(process.env.KN_SESSION_HOURS ?? 12) * 60 * 60 * 1000).toISOString()
    await this.repo.createSession({
      tokenHash: hashToken(token),
      identityId: identity.id,
      companyId: company.id,
      memberId: member.id,
      expiresAt,
    })
    return {
      token,
      expiresAt,
      user: {
        id: identity.id,
        username: identity.username,
        displayName: identity.displayName,
        email: identity.email,
        role: member.role,
      },
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
      },
    }
  }

  async authenticate(token: string | undefined): Promise<AuthContext | undefined> {
    if (!token) return undefined
    return this.repo.getSessionByTokenHash(hashToken(token))
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return
    await this.repo.deleteSession(hashToken(token))
  }

  toPayload(auth: AuthContext, token?: string): Omit<AuthPayload, "token"> & { token?: string } {
    return {
      token,
      expiresAt: auth.session.expiresAt,
      user: {
        id: auth.identity.id,
        username: auth.identity.username,
        displayName: auth.identity.displayName,
        email: auth.identity.email,
        role: auth.member.role,
      },
      company: {
        id: auth.company.id,
        name: auth.company.name,
        slug: auth.company.slug,
      },
    }
  }

  private async verifyLdap(username: string, password: string): Promise<LdapProfile> {
    const url = process.env.LDAP_URL
    if (!url) {
      if (process.env.KN_LDAP_DEV_ALLOW_PASSWORD !== "true") {
        throw new Error("LDAP_URL is required. Set KN_LDAP_DEV_ALLOW_PASSWORD=true only for local development.")
      }
      return {
        providerSubject: `local-dev:${username.toLowerCase()}`,
        username,
        displayName: username,
      }
    }

    const client = new Client({ url, timeout: 8000, connectTimeout: 8000 })
    try {
      const userDn = await this.resolveUserDn(client, username)
      await client.bind(userDn, password)
      const profile = await this.readUserProfile(client, userDn, username)
      return profile
    } finally {
      await client.unbind().catch(() => undefined)
    }
  }

  private async resolveUserDn(client: Client, username: string): Promise<string> {
    const template = process.env.LDAP_USER_DN_TEMPLATE
    if (template) return template.replaceAll("{username}", username)
    const domain = process.env.LDAP_DOMAIN
    if (!process.env.LDAP_BIND_DN || !process.env.LDAP_BIND_PASSWORD) {
      return domain ? `${username}@${domain}` : username
    }

    await client.bind(process.env.LDAP_BIND_DN, process.env.LDAP_BIND_PASSWORD)
    const baseDn = process.env.LDAP_BASE_DN
    if (!baseDn) throw new Error("LDAP_BASE_DN is required when using LDAP_BIND_DN")
    const filter = (process.env.LDAP_USER_FILTER ?? "(|(uid={username})(sAMAccountName={username})(mail={username}))")
      .replaceAll("{username}", escapeLdapFilter(username))
    const result = await client.search(baseDn, {
      scope: "sub",
      filter,
      attributes: ["dn", "uid", "sAMAccountName", "cn", "displayName", "mail"],
      sizeLimit: 2,
    })
    if (result.searchEntries.length !== 1) throw new Error("LDAP user not found or not unique")
    return String(result.searchEntries[0].dn)
  }

  private async readUserProfile(client: Client, userDn: string, username: string): Promise<LdapProfile> {
    const baseDn = process.env.LDAP_BASE_DN
    if (!baseDn) {
      return {
        providerSubject: userDn,
        username,
        displayName: username,
      }
    }

    const result = await client.search(baseDn, {
      scope: "sub",
      filter: `(distinguishedName=${escapeLdapFilter(userDn)})`,
      attributes: ["uid", "sAMAccountName", "cn", "displayName", "mail"],
      sizeLimit: 1,
    }).catch(() => ({ searchEntries: [] }))
    const entry = result.searchEntries[0] as Record<string, unknown> | undefined
    const ldapUsername = readAttr(entry, "sAMAccountName", "uid") ?? username
    return {
      providerSubject: userDn,
      username: ldapUsername,
      displayName: readAttr(entry, "displayName", "cn") ?? ldapUsername,
      email: readAttr(entry, "mail"),
    }
  }
}

export function extractBearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim()
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function readAttr(entry: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!entry) return undefined
  for (const key of keys) {
    const value = entry[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0].trim()
  }
  return undefined
}

function escapeLdapFilter(value: string): string {
  return value
    .replaceAll("\\", "\\5c")
    .replaceAll("*", "\\2a")
    .replaceAll("(", "\\28")
    .replaceAll(")", "\\29")
    .replaceAll("\0", "\\00")
}
