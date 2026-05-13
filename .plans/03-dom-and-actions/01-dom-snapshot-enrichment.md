# DOM Snapshot Enrichment

Status: DONE. Skip unless changing DOM serialization, element indexes, or prompt budgets.

## Goal

Improve page understanding while keeping DOM serialization fast and bounded.

## Features

- Use CDP DOMSnapshot data where available for bounds, visibility, and clickability.
- Normalize coordinates to CSS pixels.
- Track stable element indexes for current page state.
- Include only useful computed styles: display, visibility, opacity, pointer-events, cursor, overflow, position.
- Enforce max serialized text and clickable element budgets.

## Performance Rules

- Build lookup maps once per snapshot.
- Avoid O(n²) node scans.
- Prefer explicit budgets over serializing entire pages.

## Acceptance Criteria

- Agent prompts include concise interactive element lists.
- Element indexes map back to executable actions for the current snapshot.
- Heavy pages do not produce unbounded context.

## Implementation Notes

- `src/dom/cdp-snapshot.ts` performs `DOMSnapshot.captureSnapshot` + `Accessibility.getFullAXTree`, merges them by `backendDOMNodeId`, applies the interactive predicate, sorts by paint order, and assigns sequential indexes.
- `SelectorMap.byIndex` carries index → `backendNodeId` for the current snapshot and is threaded through `BrowserStateSummary` to the action executor.
- Actions resolve via `DOM.resolveNode` + `Runtime.callFunctionOn`; stale lookups return `"Element [N] no longer exists in the DOM"`. No `data-agent-idx` attributes are ever written.
- Budgets live in `DomBudgetOptions` (`AgentOptions.domBudgets`) with defaults exported from `cdp-snapshot.ts`.
- Same-origin iframes are walked via `contentDocumentIndex`; cross-origin OOPIFs are out of scope.
