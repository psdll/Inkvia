// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { it } from "vitest";
import { verifyGroupConnection, verifyTextIncomingConnection, verifyIndependentImageResults } from "./helpers/canvas-board-contract-harness";

it.each([0, 1, 3])("shows the selected group's connector and connects its %s members", async count => verifyGroupConnection(count, false));
it("opens the existing creation menu when the group connector is dropped on blank canvas", async () => verifyGroupConnection(3, true));
it("opens the text prompt panel after a group connects without generating", async () => verifyGroupConnection(3, false, true));
it("opens the text prompt panel after an image connects without generating", verifyTextIncomingConnection);
it("restores multi-image results in one independently connectable task frame", async () => verifyIndependentImageResults(false));
it("keeps newly generated results in one independently connectable task frame", async () => verifyIndependentImageResults(true));
