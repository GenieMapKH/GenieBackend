/** Audit probes assert the observed flaws, not the desired repaired behavior.
 * No database, Redis, provider, real token, or external network is used.
 */
import "reflect-metadata";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { firstValueFrom, of } from "rxjs";
import { verifySignedToken } from "@tilomnov/shared";
import { AuthMiddleware } from "../../api-gateway/src/auth.middleware";
import { RevokedSessions as GatewayRevocations } from "../../api-gateway/src/revoked-sessions";
import { JwtStrategy } from "../../shared/src/auth/jwt.strategy";
import { OptionalJwtAuthGuard } from "../../shared/src/auth/optional-jwt-auth.guard";
import { ContactDetailsInterceptor } from "../../property/src/properties/contact-details";
import { UsersController } from "../../user/src/users/users.controller";
import { PeopleSearchService } from "../../property/src/search/people-search.service";
import { PropertyImageService } from "../../property/src/properties/services/property-image.service";
import { AccountService } from "../../authentication/src/auth/account/account.service";
import { MockPaymentProvider } from "../../payment/src/payments/mock-payment.provider";
import { decodeMessage } from "../../shared/src/messaging/message-contracts";
import { RefreshTokenRepository } from "../../authentication/src/auth/sessions/refresh-token.repository";
import { SessionService } from "../../authentication/src/auth/sessions/session.service";
import { SessionRevocationService } from "../../authentication/src/auth/sessions/session-revocation.service";
import { hashRefreshToken } from "../../authentication/src/auth/sessions/refresh-token-hash";
import { AdminGuard } from "../../shared/src/auth/admin.guard";
import { verifySignedToken as verifyAdminToken } from "../../shared/src/auth/signed-token";

// Token signature correctness has its own existing tests. These probes isolate
// authorization after a token has been verified, using fabricated claims only.
jest.mock("@tilomnov/shared", () => ({
  ...jest.requireActual("@tilomnov/shared"),
  verifySignedToken: jest.fn(),
}));
jest.mock("../../authentication/src/firebase/firebase.service", () => ({
  FirebaseService: class {},
}));
jest.mock("../../shared/src/auth/signed-token", () => ({
  ...jest.requireActual("../../shared/src/auth/signed-token"),
  verifySignedToken: jest.fn(),
}));

const claims = {
  sub: "audit-user",
  sid: "audit-revoked-session",
  role: "user",
  typ: "access",
};
const context = (user?: unknown, headers: object = {}) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
  }) as ExecutionContext;

test("F01: public optional authentication reveals contacts for revoked claims; protected gateway rejects them", async () => {
  const user = JwtStrategy.prototype.validate(claims);
  const optional = new OptionalJwtAuthGuard();
  expect(optional.handleRequest(undefined, user, undefined)).toEqual(user);
  const interceptor = new ContactDetailsInterceptor({
    create: () => ({ consume: async () => undefined }),
  } as never);
  const body = { id: "other-listing", contactPhone: "+85512345678" };
  expect(
    await firstValueFrom(
      interceptor.intercept(context(user), { handle: () => of(body) }),
    ),
  ).toHaveProperty("contactPhone");
  expect(
    await firstValueFrom(
      interceptor.intercept(context(), { handle: () => of(body) }),
    ),
  ).not.toHaveProperty("contactPhone");
  (verifySignedToken as jest.Mock).mockResolvedValue(claims);
  const gateway = new AuthMiddleware({ has: async () => true } as never);
  await expect(
    gateway.use(
      {
        method: "GET",
        headers: { authorization: "Bearer fabricated-audit-token" },
      } as never,
      {} as never,
      jest.fn(),
    ),
  ).rejects.toBeInstanceOf(UnauthorizedException);
});

test("F02: revocation disappears when its Redis key is absent or Redis errors", async () => {
  const client = { exists: jest.fn().mockResolvedValue(1) };
  const revoked = new GatewayRevocations({ client } as never);
  expect(await revoked.has("audit-session")).toBe(true);
  client.exists.mockResolvedValue(0);
  expect(await revoked.has("audit-session")).toBe(false);
  client.exists.mockRejectedValue(new Error("fabricated Redis outage"));
  expect(await revoked.has("audit-session")).toBe(false);
});

test("F02: admin access resumes when a revoked-session key is lost; a Redis error still fails closed", async () => {
  (verifyAdminToken as jest.Mock).mockResolvedValue({
    ...claims,
    role: "admin",
    adminMfa: true,
  });
  const client = { exists: jest.fn().mockResolvedValue(1) };
  const guard = new AdminGuard(
    { user: { findFirst: async () => ({ role: "admin" }) } } as never,
    { client } as never,
  );
  const request = context(undefined, {
    authorization: "Bearer fabricated-admin-token",
  });
  await expect(guard.canActivate(request)).rejects.toBeInstanceOf(
    UnauthorizedException,
  );
  client.exists.mockResolvedValue(0); // The same condition after eviction/restart.
  expect(await guard.canActivate(request)).toBe(true);
  client.exists.mockRejectedValue(new Error("fabricated Redis outage"));
  await expect(guard.canActivate(request)).rejects.toThrow(
    "Could not verify administrator session",
  );
});

test("D01: direct service identity comes entirely from an unsigned header", () => {
  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    UsersController,
    "getProfile",
  );
  const parameter = Object.values(args)[0] as {
    factory: (data: unknown, ctx: ExecutionContext) => string;
  };
  expect(
    parameter.factory(
      undefined,
      context(undefined, { "x-user-id": "audit-victim" }),
    ),
  ).toBe("audit-victim");
  expect(() => parameter.factory(undefined, context())).toThrow(
    UnauthorizedException,
  );
});

test("F06: publishing exposes the account recovery email without a separate public-email choice", async () => {
  const row = {
    id: "audit-owner",
    name: "Fixture",
    username: null,
    avatarUrl: null,
    createdAt: new Date(),
    role: "user",
    email: "recovery@example.invalid",
    phone: null,
    _count: { properties: 1 },
  };
  const people = new PeopleSearchService({
    user: { findFirst: async () => row },
  } as never);
  expect((await people.findProfile(row.id)).email).toBe(
    "recovery@example.invalid",
  );
  row._count.properties = 0;
  expect((await people.findProfile(row.id)).email).toBeNull();
});

test("F08: the 30-image limit permits repeated batches of unconfirmed upload capabilities", async () => {
  const storage = {
    createPresignedUrls: jest.fn(
      async (_folder: string, names: string[]) => names,
    ),
  };
  const images = new PropertyImageService(
    {} as never,
    { findOwned: async () => ({ images: [] }) } as never,
    storage as never,
    {} as never,
    {} as never,
  );
  const batch = Array.from({ length: 30 }, (_, i) => `fixture-${i}.jpg`);
  expect(
    await images.createUploadUrls("audit-user", "audit-property", batch),
  ).toHaveLength(30);
  expect(
    await images.createUploadUrls("audit-user", "audit-property", batch),
  ).toHaveLength(30);
  expect(storage.createPresignedUrls).toHaveBeenCalledTimes(2);
  await expect(
    images.createUploadUrls("audit-user", "audit-property", [
      ...batch,
      "extra.jpg",
    ]),
  ).rejects.toThrow();
});

test("F05: create-password also replaces an existing password without establishment or session revocation", async () => {
  const users = { update: jest.fn().mockResolvedValue(undefined) };
  const sessions = { endAllSessions: jest.fn() };
  const devices = {
    require: jest.fn().mockRejectedValue(new Error("device too new")),
  };
  const proofs = {
    verify: jest
      .fn()
      .mockResolvedValue({ id: "audit-user", has_password: true }),
  };
  const account = new AccountService(
    users as never,
    sessions as never,
    devices as never,
    proofs as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await account.createPassword(
    "audit-user",
    "fabricated-google-proof",
    "Fixture-only-password-42",
  );
  expect(users.update).toHaveBeenCalledWith(
    "audit-user",
    expect.objectContaining({ has_password: true }),
  );
  expect(devices.require).not.toHaveBeenCalled();
  expect(sessions.endAllSessions).not.toHaveBeenCalled();
  users.update.mockClear();
  proofs.verify.mockRejectedValue(new Error("invalid proof"));
  await expect(
    account.createPassword(
      "audit-user",
      "invalid-fixture",
      "Fixture-only-password-42",
    ),
  ).rejects.toThrow("invalid proof");
  expect(users.update).not.toHaveBeenCalled();
});

test("F07: mock settlement defaults to paid even with NODE_ENV=production", async () => {
  const previousMode = process.env.PAYMENT_MODE;
  const previousNode = process.env.NODE_ENV;
  try {
    delete process.env.PAYMENT_MODE;
    process.env.NODE_ENV = "production";
    const provider = new MockPaymentProvider();
    const request = {
      transactionId: "audit-transaction",
      amount: 10,
      currency: "USD",
      method: "aba_pay" as const,
    };
    expect((await provider.checkTransaction(request)).state).toBe("PAID");
    process.env.PAYMENT_MODE = "disabled";
    expect(() => provider.checkTransaction(request)).toThrow();
  } finally {
    if (previousMode === undefined) delete process.env.PAYMENT_MODE;
    else process.env.PAYMENT_MODE = previousMode;
    if (previousNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNode;
  }
});

test("H01: a syntactically valid broker message needs no producer signature", () => {
  const now = Date.now();
  const message = {
    id: "11111111-1111-4111-8111-111111111111",
    version: 1,
    type: "notification.sign-in.v1",
    source: "authentication",
    destination: "notification",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60000).toISOString(),
    payload: {},
  };
  expect(
    decodeMessage(Buffer.from(JSON.stringify(message)), "notification").source,
  ).toBe("authentication");
  expect(() =>
    decodeMessage(
      Buffer.from(JSON.stringify({ ...message, source: "chat" })),
      "notification",
    ),
  ).toThrow();
});

test("F09: an in-flight refresh issues a live replacement after sign-out-everywhere completed", async () => {
  const token = "fabricated-refresh-token";
  const rows: Record<string, any>[] = [
    {
      id: "t1",
      userId: "audit-user",
      tokenHash: hashRefreshToken(token),
      revoked: false,
      createdAt: new Date(),
      sessionId: "audit-session",
      sessionStartedAt: new Date(),
      deviceName: null,
      platform: null,
      ipAddress: null,
      location: null,
    },
  ];
  const matches = (row: Record<string, any>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const table = {
    findUnique: async ({ where }: any) =>
      rows.find((row) => matches(row, where)) ?? null,
    findFirst: async ({ where }: any) =>
      rows.find((row) => matches(row, where)) ?? null,
    updateMany: async ({ where, data }: any) => {
      const found = rows.filter((row) => matches(row, where));
      found.forEach((row) => Object.assign(row, data));
      return { count: found.length };
    },
    updateManyAndReturn: async ({ where, data }: any) => {
      const found = rows.filter((row) => matches(row, where));
      found.forEach((row) => Object.assign(row, data));
      return found;
    },
    create: async ({ data }: any) => {
      rows.push(data);
      return data;
    },
  };
  // Use the actual repository filters against an in-memory table. The latch
  // permits the exact interleaving of two real service methods, without sleeps.
  const repository = new RefreshTokenRepository({
    refreshToken: table,
  } as never);
  const cutOff = { add: jest.fn().mockResolvedValue(undefined) };
  const revocations = new SessionRevocationService(repository, cutOff as never);
  let reached!: () => void;
  let release!: () => void;
  const atLookup = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const continueLookup = new Promise<void>((resolve) => {
    release = resolve;
  });
  const issuer = {
    issue: jest.fn(async () => {
      await repository.insert({
        id: "t2",
        userId: "audit-user",
        tokenHash: hashRefreshToken("replacement"),
        expiresAt: new Date(Date.now() + 86400000),
        session: {
          id: "audit-session",
          startedAt: new Date().toISOString(),
          deviceName: null,
          platform: null,
          ipAddress: null,
          location: null,
        },
      });
      rows[rows.length - 1].revoked = false;
      return {
        sessionId: "audit-session",
        accessToken: "replacement-access",
        refreshToken: "replacement-refresh",
      };
    }),
  };
  const service = new SessionService(
    { verifyRefreshToken: () => ({ sub: "audit-user", jti: "t1" }) } as never,
    repository,
    issuer as never,
    {
      findById: async () => {
        reached();
        await continueLookup;
        return { id: "audit-user", role: "user" };
      },
    } as never,
    revocations,
    {} as never,
  );
  const refreshing = service.refresh(token, {
    deviceName: null,
    platform: null,
    ipAddress: null,
  });
  await atLookup;
  expect(rows[0].revoked).toBe(true);
  await revocations.endAllSessions("audit-user");
  expect(cutOff.add).toHaveBeenCalledWith([]);
  release();
  expect(await refreshing).toHaveProperty(
    "refreshToken",
    "replacement-refresh",
  );
  expect(await repository.hasActiveToken("audit-session")).toBe(true);
  // Negative control: a refresh started after revocation is refused.
  rows.forEach((row) => {
    row.revoked = true;
  });
  await expect(
    service.refresh(token, {
      deviceName: null,
      platform: null,
      ipAddress: null,
    }),
  ).rejects.toThrow("This device was signed out");
});
