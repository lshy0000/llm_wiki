import { describe, expect, it } from "vitest"
import {
  formatShanghaiConversationTime,
  formatShanghaiClockStamp,
  formatShanghaiDate,
  formatShanghaiDateTime,
  formatShanghaiFileTimestamp,
  formatShanghaiMonthDay,
  formatShanghaiTime,
  isSameShanghaiDate,
  shanghaiToday,
  shanghaiTodayCompact,
} from "./time"

describe("Shanghai time formatting", () => {
  const utcEvening = new Date("2026-05-27T20:13:59.123Z")

  it("formats absolute timestamps in Asia/Shanghai", () => {
    expect(formatShanghaiDateTime(utcEvening)).toBe("2026-05-28 04:13:59")
    expect(formatShanghaiDate(utcEvening)).toBe("2026-05-28")
    expect(formatShanghaiTime(utcEvening)).toBe("04:13")
    expect(formatShanghaiClockStamp(utcEvening)).toBe("041359")
    expect(formatShanghaiMonthDay(utcEvening)).toBe("5月28日")
  })

  it("compares days by Shanghai calendar date", () => {
    expect(isSameShanghaiDate(
      "2026-05-27T20:13:59.123Z",
      "2026-05-28T15:59:59.999Z",
    )).toBe(true)
    expect(isSameShanghaiDate(
      "2026-05-27T20:13:59.123Z",
      "2026-05-28T16:00:00.000Z",
    )).toBe(false)
  })

  it("uses Shanghai today for compact human dates", () => {
    expect(shanghaiToday(utcEvening)).toBe("2026-05-28")
    expect(shanghaiTodayCompact(utcEvening)).toBe("20260528")
    expect(formatShanghaiFileTimestamp(utcEvening)).toBe("20260528-041359-123")
  })

  it("formats conversation timestamps relative to Shanghai day", () => {
    expect(formatShanghaiConversationTime(
      "2026-05-27T20:13:59.123Z",
      "2026-05-28T15:00:00.000Z",
    )).toBe("04:13")
    expect(formatShanghaiConversationTime(
      "2026-05-27T20:13:59.123Z",
      "2026-05-28T16:00:00.000Z",
    )).toBe("5月28日")
  })

  it("keeps invalid string inputs visible unless a fallback is provided", () => {
    expect(formatShanghaiDateTime("not-a-date")).toBe("not-a-date")
    expect(formatShanghaiDateTime("not-a-date", "未知时间")).toBe("未知时间")
    expect(formatShanghaiDateTime(null, "未知时间")).toBe("未知时间")
  })
})
