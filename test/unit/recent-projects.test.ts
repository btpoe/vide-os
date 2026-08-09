import { describe, it, expect, beforeEach } from "vitest";
import {
  recentProjects,
  rememberProject,
  forgetRecent,
  clearRecentProjects,
} from "@/stores/recent-projects";

/**
 * The recent list.
 *
 * Entries hold a token rather than a path — the web platform has no paths —
 * and the interesting behaviour is what happens when the same project is saved
 * repeatedly, which is most of what anyone does.
 */

beforeEach(() => {
  clearRecentProjects();
});

describe("remembering", () => {
  it("puts the newest first", async () => {
    await rememberProject("First", null);
    await rememberProject("Second", null);
    expect(recentProjects().map((r) => r.name)).toEqual(["Second", "First"]);
  });

  it("moves a repeat to the top rather than adding a row", async () => {
    // Saving the same project ten times should not fill the list with it.
    await rememberProject("Alpha", null);
    await rememberProject("Beta", null);
    await rememberProject("Alpha", null);

    expect(recentProjects().map((r) => r.name)).toEqual(["Alpha", "Beta"]);
  });

  it("keeps a project with no token, since seeing it is still useful", async () => {
    // A downloaded file cannot be reopened in one click, which is not a reason
    // to pretend it was never worked on.
    await rememberProject("Downloaded", null);
    expect(recentProjects()[0].token).toBeNull();
  });

  it("caps the list", async () => {
    for (let i = 0; i < 15; i++) await rememberProject(`Project ${i}`, null);
    expect(recentProjects()).toHaveLength(10);
    expect(recentProjects()[0].name).toBe("Project 14");
  });
});

describe("forgetting", () => {
  it("drops one entry", async () => {
    await rememberProject("Keep", null);
    await rememberProject("Drop", null);

    forgetRecent(recentProjects().find((r) => r.name === "Drop")!);
    expect(recentProjects().map((r) => r.name)).toEqual(["Keep"]);
  });

  it("clears the lot", async () => {
    await rememberProject("A", null);
    clearRecentProjects();
    expect(recentProjects()).toEqual([]);
  });
});
