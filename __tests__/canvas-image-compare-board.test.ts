import { it } from "vitest";
import { verifyConnectedTaskPanel } from "./helpers/canvas-board-contract-harness";

it("creates image comparison from the connection menu and accepts the second image", async () => verifyConnectedTaskPanel("compare"));
