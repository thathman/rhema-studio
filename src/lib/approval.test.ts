import { describe, expect, it } from "vitest"
import { approvalLabel, approvalState } from "./approval"

describe("approval state", () => {
  it("is none, approved or changed depending on the approved revision", () => {
    expect(approvalState(null)).toBe("none")
    expect(approvalState({ revision: 3, approved_revision: null })).toBe("none")
    expect(approvalState({ revision: 3, approved_revision: 3 })).toBe("approved")
    expect(approvalState({ revision: 5, approved_revision: 3 })).toBe("changed")
    expect(approvalLabel({ revision: 5, approved_revision: 3, approved_at: null })).toBe("Changed since approval (v3 approved, now v5)")
    expect(approvalLabel({ revision: 3, approved_revision: 3, approved_at: null })).toBe("Approved")
  })
})
