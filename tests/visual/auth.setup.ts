import { expect, test } from "@playwright/test";

const visualTestPassword = "visual-test-password";

test("prepare password-mode visual authentication", async ({ request }) => {
  const initialStatus = await request.get("/api/auth/setup");
  expect(initialStatus.ok(), "visual auth setup status should be available").toBe(true);

  const initialBody = (await initialStatus.json()) as { required?: boolean };
  if (initialBody.required) {
    const setupResponse = await request.post("/api/auth/setup", {
      data: {
        username: "visual-test-admin",
        displayName: "Visual Test Admin",
        password: visualTestPassword,
      },
    });

    expect(setupResponse.ok(), "visual auth setup should create the reserved local admin").toBe(true);
  }

  const finalStatus = await request.get("/api/auth/setup");
  expect(finalStatus.ok(), "visual auth setup status should remain available").toBe(true);
  await expect(finalStatus.json()).resolves.toMatchObject({ required: false });
});
