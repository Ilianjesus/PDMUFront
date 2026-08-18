import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "./supabaseClient";
import { requestEmailOtp } from "./supabaseAuth";

vi.mock("./supabaseClient", () => ({
  supabase: {
    auth: {
      signInWithOtp: vi.fn(),
    },
  },
}));

describe("requestEmailOtp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("solicita el OTP sin crear usuarios nuevos", async () => {
    supabase.auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });

    const result = await requestEmailOtp(" Operador@PDMU.MX ");

    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "operador@pdmu.mx",
      options: { shouldCreateUser: false },
    });
    expect(result.email).toBe("operador@pdmu.mx");
  });

  it("no avanza silenciosamente cuando Supabase rechaza la solicitud", async () => {
    supabase.auth.signInWithOtp.mockResolvedValue({
      data: null,
      error: { code: "hook_timeout", message: "Send Email Hook failed" },
    });

    await expect(requestEmailOtp("operador@pdmu.mx")).rejects.toMatchObject({
      name: "SupabaseAuthError",
      code: "hook_timeout",
    });
  });

  it("conserva el código semántico cuando la respuesta incluye un HTTP numérico", async () => {
    supabase.auth.signInWithOtp.mockResolvedValue({
      data: null,
      error: {
        code: 429,
        error_code: "over_email_send_rate_limit",
        message: "email rate limit exceeded",
      },
    });

    await expect(requestEmailOtp("operador@pdmu.mx")).rejects.toMatchObject({
      name: "SupabaseAuthError",
      code: "over_email_send_rate_limit",
    });
  });
});
