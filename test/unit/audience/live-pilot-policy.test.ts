import { describe, expect, it } from "vitest";
import {
  assertLivePilotPolicyActive,
  checksumLivePilotPolicy,
  LIVE_PILOT_POLICY,
  LIVE_PILOT_POLICY_V1,
  type LivePilotActiveAuthorization,
  type LivePilotPolicy,
  type LivePilotPolicyDocument,
} from "../../../src/modules/audience/domain/live-pilot-policy";

describe("second live-pilot authorization", () => {
  it("preserves v1 as consumed history", () => {
    expect(LIVE_PILOT_POLICY_V1.scopeKey).toBe(
      "okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-26",
    );
    expect(LIVE_PILOT_POLICY_V1.authorization.status).toBe("consumed");
    expect(LIVE_PILOT_POLICY_V1.checksumSha256).toBe(
      "b148497ffd55d725079055e19b85aa997017ccda51c1557ba23dc5d49c18a24a",
    );
    expect(() => assertLivePilotPolicyActive(LIVE_PILOT_POLICY_V1)).toThrow(
      "LIVE_PILOT_AUTHORIZATION_CONSUMED",
    );
  });

  it("binds the exact active v2 scope and expiry", () => {
    expect(LIVE_PILOT_POLICY).toMatchObject({
      version: 2,
      scopeKey: "okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02",
      authorization: {
        reviewedAt: "2026-08-27T09:40:50+03:00",
        expiresAt: "2026-08-27T21:40:50+03:00",
        status: "active",
      },
      command: { kind: "live-pilot", okved: "43.11", year: 2025, maxCompanies: 10 },
    });
    expect(LIVE_PILOT_POLICY.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("accepts v2 through expiry and rejects it after expiry", () => {
    expect(() => assertLivePilotPolicyActive(
      LIVE_PILOT_POLICY,
      new Date("2026-08-27T18:00:00+03:00"),
    )).not.toThrow();
    expect(() => assertLivePilotPolicyActive(
      LIVE_PILOT_POLICY,
      new Date("2026-08-27T21:40:50+03:00"),
    )).not.toThrow();
    expect(() => assertLivePilotPolicyActive(
      LIVE_PILOT_POLICY,
      new Date("2026-08-27T21:40:51+03:00"),
    )).toThrow("LIVE_PILOT_AUTHORIZATION_EXPIRED");
  });

  it.each([
    ["a date-only reviewed timestamp", { reviewedAt: "2026-08-27" }],
    ["a date-only expiry timestamp", { expiresAt: "2026-08-27" }],
    ["an invalid calendar timestamp", { expiresAt: "2026-02-30T21:40:50+03:00" }],
  ])("fails closed for %s", (_label, authorizationPatch) => {
    const policy = withActiveAuthorization(authorizationPatch);

    expect(() => assertLivePilotPolicyActive(policy)).toThrow(
      "LIVE_PILOT_AUTHORIZATION_EXPIRED",
    );
  });

  it("fails closed for an invalid clock", () => {
    expect(() => assertLivePilotPolicyActive(
      LIVE_PILOT_POLICY,
      new Date("invalid clock"),
    )).toThrow("LIVE_PILOT_AUTHORIZATION_EXPIRED");
  });
});

function withActiveAuthorization(
  authorizationPatch: Partial<Omit<LivePilotActiveAuthorization, "status">>,
): LivePilotPolicy {
  const { checksumSha256: _checksumSha256, ...document } = LIVE_PILOT_POLICY;
  const authorization = {
    reviewedAt: "2026-08-27T09:40:50+03:00",
    expiresAt: "2026-08-27T21:40:50+03:00",
    status: "active",
    ...authorizationPatch,
  } as const satisfies LivePilotActiveAuthorization;
  const policy: LivePilotPolicyDocument = {
    ...document,
    authorization,
  };
  return {
    ...policy,
    checksumSha256: checksumLivePilotPolicy(policy),
  };
}
