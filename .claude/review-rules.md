# Code Review Rules

Code review agents must check all items below. These are nitpick-level quality gates — enforce strictly.

## Comments

- No comments that repeat the code. If the code says what it does, a comment saying the same thing is noise.
- Cast justifications must be technically accurate (see Type Safety below).

## Dead Code

Every function, type, and export must have at least one call site at time of writing. No code "for future use" unless explicitly requested.

## Tests

Don't write tests that only verify compile-time guarantees (type assignments, interface conformance). If the compiler checks it, a test adds nothing.

## Type Safety — Cast Review Checklist

For every `as T` cast, verify:
1. Comment explains WHY the cast is necessary
2. Evidence/API docs support the cast being safe
3. A generic type parameter or type guard couldn't eliminate the cast

## TypeScript Type-System Terminology

Branded types (phantom types, opaque types) are compile-time only constructs — erased during transpilation. Common errors to catch:
- "branded at runtime" — oxymoron. At runtime they're plain strings/numbers/etc.
- "branded strings over the same runtime value" — brands don't exist at runtime; say "brands erased at runtime; both are plain strings"
- Cast justifications that imply brands have runtime meaning

Correct pattern: "Brands erased at runtime; both are `string`, so the cast is safe."

## Boundary Typing

All data crossing system boundaries (APIs, etc.) must be strongly typed — both inbound (decoding) and outbound (encoding), with Effect Schema. Flag any `any`, untyped fetch results, or raw JSON access.

## Immutability

No `let` for conditional assignment. Use `const` with:
- Ternary for single-variable branches
- Destructured struct (inline or extracted function) for multi-variable branches
- `yield* Effect.gen(function* () { ... })` when a branch needs effectful computation

Legitimate mutation (accumulators, state flags) must be justified by context — flag if unclear.
