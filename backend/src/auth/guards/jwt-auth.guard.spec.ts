import { JwtAuthGuard } from "./jwt-auth.guard";
import { UnauthorizedException } from "@nestjs/common";

describe("JwtAuthGuard (Unit)", () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  it("should be defined", () => {
    expect(guard).toBeDefined();
  });

  it("should return user if user is present without error", () => {
    const user = { id: "user-1", email: "test@example.com" };
    const result = guard.handleRequest(null, user);
    expect(result).toEqual(user);
  });

  it("should throw UnauthorizedException if user is missing", () => {
    expect(() => guard.handleRequest(null, false)).toThrow(
      UnauthorizedException,
    );
  });
});
