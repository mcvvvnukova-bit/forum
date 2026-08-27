import { describe, expect, it } from "vitest";
import {
  assertLivePilotPolicyActive,
  checksumLivePilotPolicy,
  LIVE_PILOT_POLICY,
  LIVE_PILOT_POLICY_HISTORY,
  LIVE_PILOT_POLICY_V1,
  LIVE_PILOT_POLICY_V2_ACTIVE,
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

  it("preserves the exact active v2 snapshot after terminal consumption", () => {
    expect(LIVE_PILOT_POLICY_V2_ACTIVE).toMatchObject({
      version: 2,
      scopeKey: "okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02",
      authorization: {
        reviewedAt: "2026-08-27T09:40:50+03:00",
        expiresAt: "2026-08-27T21:40:50+03:00",
        status: "active",
      },
      command: { kind: "live-pilot", okved: "43.11", year: 2025, maxCompanies: 10 },
    });
    expect(LIVE_PILOT_POLICY_V2_ACTIVE.checksumSha256).toBe(
      "59c874e60e119a923d50034c6ee859bf65ff2baffb3dad4bc71ef8a232585542",
    );
  });

  it("exposes immutable v1 and active-v2 authorization history", () => {
    expect(LIVE_PILOT_POLICY_HISTORY).toEqual([
      LIVE_PILOT_POLICY_V1,
      LIVE_PILOT_POLICY_V2_ACTIVE,
    ]);
    expect(Object.isFrozen(LIVE_PILOT_POLICY_HISTORY)).toBe(true);
  });

  it("deep-freezes every policy snapshot and representative nested values", () => {
    for (const policy of [
      LIVE_PILOT_POLICY_V1,
      LIVE_PILOT_POLICY_V2_ACTIVE,
      LIVE_PILOT_POLICY,
    ]) {
      expect(Object.isFrozen(policy)).toBe(true);
      expect(Object.isFrozen(policy.authorization)).toBe(true);
      expect(Object.isFrozen(policy.command)).toBe(true);
      expect(Object.isFrozen(policy.runScope)).toBe(true);
      expect(Object.isFrozen(policy.runScope.requiredFinancialMetrics)).toBe(true);
      expect(Object.isFrozen(policy.routes)).toBe(true);
      expect(Object.isFrozen(policy.limits)).toBe(true);
    }

    expect(() => {
      (LIVE_PILOT_POLICY_V2_ACTIVE.authorization as unknown as { status: string }).status = "consumed";
    }).toThrow(TypeError);
    expect(() => {
      (LIVE_PILOT_POLICY_V2_ACTIVE.command as unknown as { okved: string }).okved = "99";
    }).toThrow(TypeError);
    expect(() => {
      (LIVE_PILOT_POLICY.runScope.requiredFinancialMetrics as unknown as string[]).push("revenue");
    }).toThrow(TypeError);
    expect(() => {
      (LIVE_PILOT_POLICY.routes as unknown as string[]).push("forbidden-route");
    }).toThrow(TypeError);
    expect(() => {
      (LIVE_PILOT_POLICY.limits as unknown as Record<string, number>).acceptedCompanies = 11;
    }).toThrow(TypeError);

    expect(LIVE_PILOT_POLICY_V2_ACTIVE.checksumSha256).toBe(
      "59c874e60e119a923d50034c6ee859bf65ff2baffb3dad4bc71ef8a232585542",
    );
    expect(LIVE_PILOT_POLICY.checksumSha256).toBe(
      "87f9294a8c9175d754757bb55ad6bc470dae379575079fd60d851d4e3165adae",
    );
  });

  it("binds the current v2 snapshot as consumed at the terminal timestamp", () => {
    expect(LIVE_PILOT_POLICY).toMatchObject({
      version: 2,
      scopeKey: "okved-live-pilot/43.11/2025/10/all-legal-entities/attempt-2026-08-27-02",
      authorization: {
        reviewedAt: "2026-08-27T09:40:50+03:00",
        consumedAt: "2026-08-27T08:39:58Z",
        status: "consumed",
      },
    });
    expect(LIVE_PILOT_POLICY.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(LIVE_PILOT_POLICY.checksumSha256).not.toBe(
      LIVE_PILOT_POLICY_V2_ACTIVE.checksumSha256,
    );
    expect(() => assertLivePilotPolicyActive(LIVE_PILOT_POLICY)).toThrow(
      "LIVE_PILOT_AUTHORIZATION_CONSUMED",
    );
  });

  it("accepts v2 through expiry and rejects it after expiry", () => {
    expect(() => assertLivePilotPolicyActive(
      LIVE_PILOT_POLICY_V2_ACTIVE,
      new Date("2026-08-27T18:00:00+03:00"),
    )).not.toThrow();
    expect(() => assertLivePilotPolicyActive(
      LIVE_PILOT_POLICY_V2_ACTIVE,
      new Date("2026-08-27T21:40:50+03:00"),
    )).not.toThrow();
    expect(() => assertLivePilotPolicyActive(
      LIVE_PILOT_POLICY_V2_ACTIVE,
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
      LIVE_PILOT_POLICY_V2_ACTIVE,
      new Date("invalid clock"),
    )).toThrow("LIVE_PILOT_AUTHORIZATION_EXPIRED");
  });
});

function withActiveAuthorization(
  authorizationPatch: Partial<Omit<LivePilotActiveAuthorization, "status">>,
): LivePilotPolicy {
  const { checksumSha256: _checksumSha256, ...document } = LIVE_PILOT_POLICY_V2_ACTIVE;
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
