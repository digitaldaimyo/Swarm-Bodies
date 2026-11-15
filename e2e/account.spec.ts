import { expect, test } from "./fixtures";

// Settings → Account (docs/plans/beta.md, step 1). Google sign-in itself is covered by the server
// tests with a fake verifier; here: the section, names from the lists, and deletion.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("account: a guest picks a name from the lists, then deletes the account", async ({ page }) => {
  await page.goto("/?e2e");
  await page.getByRole("button", { name: "Settings" }).click();
  const account = page.getByRole("region", { name: "Account" });
  await expect(account).toContainText("haven't played online yet");
  await expect(account.getByRole("button", { name: "Change name" })).toHaveCount(0);

  // Visiting the Online hub makes this device a guest.
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Play online" }).click();
  // The hub makes the guest over REST; the socket's own status is not this test's business.
  await page.waitForFunction(() => localStorage.getItem("swarm.guest.v1") !== null, null, {
    timeout: 15_000,
  });
  await expect(page.getByText("Sign in with Google in Settings")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(account).toContainText("Playing as");

  await account.getByRole("button", { name: "Change name" }).click();
  await account.getByLabel("First word").selectOption("Jade");
  await account.getByLabel("Second word").selectOption("Bloom");
  await account.getByLabel("Number").fill("512");
  await account.getByRole("button", { name: "Save name" }).click();
  await expect(account).toContainText("Playing as Jade Bloom 512");

  await account.getByRole("button", { name: "Delete account" }).click();
  await account.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(account).toContainText("Your account was deleted.");
  await expect(account).toContainText("haven't played online yet");
});
