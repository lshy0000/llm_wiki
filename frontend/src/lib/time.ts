export const APP_TIME_ZONE = "Asia/Shanghai"
export const APP_LOCALE = "zh-CN"

export type DateInput = Date | string | number | null | undefined

type DateParts = {
  year: string
  month: string
  day: string
  hour: string
  minute: string
  second: string
}

const shanghaiDateTimeParts = new Intl.DateTimeFormat(`${APP_LOCALE}-u-ca-gregory`, {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
})

export function parseDateInput(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatShanghaiDateTime(value: DateInput, fallback = ""): string {
  const date = parseDateInput(value)
  if (!date) return invalidDateFallback(value, fallback)
  const parts = getShanghaiParts(date)
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

export function formatShanghaiDate(value: DateInput, fallback = ""): string {
  const date = parseDateInput(value)
  if (!date) return invalidDateFallback(value, fallback)
  const parts = getShanghaiParts(date)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function formatShanghaiTime(value: DateInput, fallback = ""): string {
  const date = parseDateInput(value)
  if (!date) return invalidDateFallback(value, fallback)
  const parts = getShanghaiParts(date)
  return `${parts.hour}:${parts.minute}`
}

export function formatShanghaiClockStamp(value: DateInput, fallback = ""): string {
  const date = parseDateInput(value)
  if (!date) return invalidDateFallback(value, fallback)
  const parts = getShanghaiParts(date)
  return `${parts.hour}${parts.minute}${parts.second}`
}

export function formatShanghaiMonthDay(value: DateInput, fallback = ""): string {
  const date = parseDateInput(value)
  if (!date) return invalidDateFallback(value, fallback)
  const parts = getShanghaiParts(date)
  return `${Number(parts.month)}月${Number(parts.day)}日`
}

export function formatShanghaiConversationTime(value: DateInput, now: DateInput = new Date(), fallback = ""): string {
  const date = parseDateInput(value)
  const nowDate = parseDateInput(now)
  if (!date || !nowDate) return invalidDateFallback(value, fallback)
  return isSameShanghaiDate(date, nowDate)
    ? formatShanghaiTime(date, fallback)
    : formatShanghaiMonthDay(date, fallback)
}

export function isSameShanghaiDate(left: DateInput, right: DateInput): boolean {
  const leftDate = parseDateInput(left)
  const rightDate = parseDateInput(right)
  if (!leftDate || !rightDate) return false
  return shanghaiDateKey(leftDate) === shanghaiDateKey(rightDate)
}

export function shanghaiToday(now: Date = new Date()): string {
  return formatShanghaiDate(now)
}

export function shanghaiTodayCompact(now: Date = new Date()): string {
  return shanghaiToday(now).replace(/-/g, "")
}

export function formatShanghaiFileTimestamp(now: Date = new Date()): string {
  const parts = getShanghaiParts(now)
  const ms = String(now.getMilliseconds()).padStart(3, "0")
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}-${ms}`
}

function getShanghaiParts(date: Date): DateParts {
  const raw = Object.create(null) as Record<string, string>
  for (const part of shanghaiDateTimeParts.formatToParts(date)) {
    if (part.type !== "literal") raw[part.type] = part.value
  }
  return {
    year: raw.year ?? "0000",
    month: raw.month ?? "00",
    day: raw.day ?? "00",
    hour: raw.hour === "24" ? "00" : raw.hour ?? "00",
    minute: raw.minute ?? "00",
    second: raw.second ?? "00",
  }
}

function shanghaiDateKey(date: Date): string {
  const parts = getShanghaiParts(date)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function invalidDateFallback(value: DateInput, fallback: string): string {
  if (fallback) return fallback
  return typeof value === "string" ? value : ""
}
