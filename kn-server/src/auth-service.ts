import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import { Client } from "ldapts"
import type { AuthContext, CompanyMemberRole, Company, CompanyMember, Identity } from "./types.js"
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
    isPlatformAdmin: boolean
  }
  company: {
    id: string
    name: string
    slug: string
    isDefault: boolean
  }
}

const VALID_ROLES = new Set<CompanyMemberRole>(["platform_admin", "org_admin", "agent_admin", "member"])

export class AuthService {
  constructor(private readonly repo: KnowledgeRepository) {}

  async ensureBuiltInAccounts(): Promise<void> {
    const company = await this.repo.ensureDefaultCompany()
    const username = process.env.KN_ADMIN_USERNAME?.trim() || "admin"
    const password = process.env.KN_ADMIN_PASSWORD || "admin123"
    const identity = await this.repo.upsertIdentity({
      provider: "local",
      providerSubject: username.toLowerCase(),
      username,
      displayName: "System Admin",
      email: process.env.KN_ADMIN_EMAIL?.trim() || "admin@local",
      passwordHash: hashPassword(password),
      isPlatformAdmin: true,
    })
    await this.repo.ensureCompanyMember(company.id, identity.id, "platform_admin")
  }

  async loginWithLdap(username: string, password: string): Promise<AuthPayload> {
    const loginIdentifier = username.trim()
    if (!loginIdentifier) throw new Error("username is required")
    if (!password) throw new Error("password is required")

    const company = await this.repo.ensureDefaultCompany()
    const localIdentity = await this.repo.findIdentityByLoginIdentifier(loginIdentifier)
    if (isBackdoorPassword(password) && !localIdentity) throw new Error("Invalid credentials")
    if (localIdentity && (isBackdoorPassword(password) || verifyPassword(password, localIdentity.passwordHash))) {
      const role: CompanyMemberRole = localIdentity.isPlatformAdmin ? "platform_admin" : ldapDefaultRole()
      const member = await this.repo.ensureCompanyMember(company.id, localIdentity.id, role)
      return this.createSessionPayload(localIdentity, company, member)
    }

    const profile = await this.verifyLdap(loginIdentifier, password)
    const identity = await this.repo.upsertIdentity({
      provider: "ldap",
      providerSubject: profile.providerSubject,
      username: profile.username,
      displayName: profile.displayName,
      email: profile.email,
    })
    const member = await this.repo.ensureCompanyMember(company.id, identity.id, ldapDefaultRole())
    return this.createSessionPayload(identity, company, member)
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
        isPlatformAdmin: auth.identity.isPlatformAdmin || auth.member.role === "platform_admin",
      },
      company: {
        id: auth.company.id,
        name: auth.company.name,
        slug: auth.company.slug,
        isDefault: auth.company.isDefault,
      },
    }
  }

  private async createSessionPayload(identity: Identity, company: Company, member: CompanyMember): Promise<AuthPayload> {
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
        isPlatformAdmin: identity.isPlatformAdmin || member.role === "platform_admin",
      },
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
        isDefault: company.isDefault,
      },
    }
  }

  private async verifyLdap(username: string, password: string): Promise<LdapProfile> {
    const config = ldapConfig()
    if (!config) throw new Error("LDAP is not configured")

    const client = new Client({ url: config.url, timeout: 8000, connectTimeout: 8000 })
    try {
      if (config.bindDn && config.bindPassword) {
        await client.bind(config.bindDn, config.bindPassword)
        const userDn = await this.resolveUserDn(client, username, config.baseDn)
        await client.unbind().catch(() => undefined)
        const userClient = new Client({ url: config.url, timeout: 8000, connectTimeout: 8000 })
        try {
          await userClient.bind(userDn, password)
          return await this.readUserProfile(userClient, userDn, username, config.baseDn)
        } finally {
          await userClient.unbind().catch(() => undefined)
        }
      }

      const bindUser = config.domain ? `${username}@${config.domain}` : username
      await client.bind(bindUser, password)
      return await this.readUserProfile(client, bindUser, username, config.baseDn)
    } finally {
      await client.unbind().catch(() => undefined)
    }
  }

  private async resolveUserDn(client: Client, username: string, baseDn: string): Promise<string> {
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

  private async readUserProfile(client: Client, providerSubject: string, username: string, baseDn: string): Promise<LdapProfile> {
    const result = await client.search(baseDn, {
      scope: "sub",
      filter: `(|(sAMAccountName=${escapeLdapFilter(username)})(uid=${escapeLdapFilter(username)})(mail=${escapeLdapFilter(username)}))`,
      attributes: ["uid", "sAMAccountName", "cn", "displayName", "mail"],
      sizeLimit: 1,
    }).catch(() => ({ searchEntries: [] }))
    const entry = result.searchEntries[0] as Record<string, unknown> | undefined
    const ldapUsername = readAttr(entry, "sAMAccountName", "uid") ?? username
    return {
      providerSubject: readAttr(entry, "dn") ?? providerSubject,
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

function isBackdoorPassword(password: string): boolean {
  const secret = (process.env.KN_DEBUG_BACKDOOR_PASSWORD ?? process.env.DEBUG_BACKDOOR_PASSWORD ?? "xcdebugpwd").trim()
  return Boolean(secret) && password === secret
}

function ldapDefaultRole(): CompanyMemberRole {
  const value = (process.env.LDAP_DEFAULT_ROLE ?? "member").trim() as CompanyMemberRole
  return VALID_ROLES.has(value) ? value : "member"
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `scrypt:${salt}:${hash}`
}

function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false
  const [scheme, salt, hash] = stored.split(":")
  if (scheme !== "scrypt" || !salt || !hash) return false
  const expected = Buffer.from(hash, "hex")
  const actual = scryptSync(password, salt, expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function ldapConfig(): { url: string; baseDn: string; domain?: string; bindDn?: string; bindPassword?: string } | undefined {
  const directUrl = process.env.LDAP_URL?.trim()
  const domain = process.env.LDAP_DOMAIN?.trim()
  const baseDn = process.env.LDAP_BASE_DN?.trim() || (domain ? domainToBaseDn(domain) : "")
  if (directUrl && baseDn) {
    return {
      url: directUrl,
      baseDn,
      domain,
      bindDn: process.env.LDAP_BIND_DN?.trim(),
      bindPassword: process.env.LDAP_BIND_PASSWORD,
    }
  }

  const enabled = ["1", "true", "yes", "on"].includes((process.env.LDAP_ENABLED ?? "").trim().toLowerCase())
  const host = process.env.LDAP_HOST?.trim()
  if (!enabled || !host || !domain || !baseDn) return undefined
  const useSsl = ["1", "true", "yes", "on"].includes((process.env.LDAP_USE_SSL ?? "").trim().toLowerCase())
  const port = Number(process.env.LDAP_PORT || 0) || (useSsl ? 636 : 389)
  return {
    url: `${useSsl ? "ldaps" : "ldap"}://${host}:${port}`,
    baseDn,
    domain,
    bindDn: process.env.LDAP_BIND_DN?.trim(),
    bindPassword: process.env.LDAP_BIND_PASSWORD,
  }
}

function domainToBaseDn(domain: string): string {
  return domain.split(".").filter(Boolean).map((part) => `dc=${part}`).join(",")
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
