import { it } from "vitest";
import { verifyNodeContextActions, verifyMoveOutContextAction, verifyCreateMenuResources } from "./helpers/canvas-board-contract-harness";

it.each([false, true])("operates on the right-clicked node selection (multiple=%s)", verifyNodeContextActions);
it.each([false, true])("moves selected members out through the context menu (multiple=%s)", verifyMoveOutContextAction);
it("opens upload and generation history from the create menu resource section", verifyCreateMenuResources);
